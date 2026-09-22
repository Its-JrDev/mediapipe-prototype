/**
 * @file GestureEventBus.js
 * @description Central event bus for MediaPipe gesture prototype.
 * Coordinates communication between Vision Engine, Mock Driver, and UI Components.
 *
 * Implements the GestureEventMap specification defined in the development plan:
 * - 'hand:move': { x: number, y: number, rawX: number, rawY: number }
 * - 'gesture:pinch': { active: boolean, x: number, y: number }
 * - 'gesture:fist': { active: boolean }
 * - 'gesture:open': { active: boolean }
 * - 'gesture:swipe': { direction: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN', velocity: number }
 * - 'gesture:edge-scroll': { zone: 'TOP' | 'BOTTOM' | 'NONE' }
 * - 'gesture:mode': { mode: 'TRACKING' | 'PINCH' | 'EDGE_SCROLL' | 'SWIPE_COOLDOWN' }
 * - 'gesture:custom': { label: string, timestamp: number }
 * - 'gesture:custom-scroll': { direction: 'UP' | 'DOWN', active: boolean }
 * - 'gesture:scroll-mode': { active: boolean } (legacy, mantener por compatibilidad)
 * - 'ui:scroll': { deltaY: number }
 * - 'ui:navigate': { page: 'home' | 'studio' | 'info' }
 * - 'ui:toggle-modal': void
 * - 'ui:toggle-aside': void
 * - 'ui:slider-move': { percentage: number }
 */

/**
 * Event constants based on the GestureEventMap contract.
 */
export const GESTURE_EVENTS = Object.freeze({
  HAND_MOVE: 'hand:move',
  GESTURE_PINCH: 'gesture:pinch',
  GESTURE_FIST: 'gesture:fist',
  GESTURE_OPEN: 'gesture:open',
  GESTURE_SWIPE: 'gesture:swipe',
  GESTURE_FLIP: 'gesture:flip',
  GESTURE_EDGE_SCROLL: 'gesture:edge-scroll',
  GESTURE_MODE: 'gesture:mode',
  GESTURE_CUSTOM: 'gesture:custom',
  GESTURE_CUSTOM_SCROLL: 'gesture:custom-scroll',
  GESTURE_SCROLL_MODE: 'gesture:scroll-mode',
  UI_SCROLL: 'ui:scroll',
  UI_NAVIGATE: 'ui:navigate',
  UI_TOGGLE_MODAL: 'ui:toggle-modal',
  UI_TOGGLE_ASIDE: 'ui:toggle-aside',
  UI_SLIDER_MOVE: 'ui:slider-move',
});

/**
 * Valid directions for gesture:swipe event.
 */
export const SWIPE_DIRECTIONS = Object.freeze({
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  UP: 'UP',
  DOWN: 'DOWN',
});

/**
 * Lightweight Event Emitter implementation (zero-dependency, compatible with EventTarget & mitt patterns).
 */
export class GestureEventBus {
  constructor() {
    /**
     * Map of event names to Sets of listener functions.
     * @type {Map<string, Set<Function>>}
     * @private
     */
    this._listeners = new Map();
  }

  /**
   * Subscribes a listener to an event.
   *
   * @param {string} event - Name of the event to listen to.
   * @param {Function} handler - Callback function invoked when event is emitted.
   * @returns {() => void} Unsubscribe function to remove the listener.
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Handler for event "${event}" must be a function.`);
    }

    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }

    this._listeners.get(event).add(handler);

    // Return clean unsubscribe function for React useEffect cleanup
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Unsubscribes a listener from an event.
   *
   * @param {string} event - Name of the event.
   * @param {Function} handler - Callback function to remove.
   */
  off(event, handler) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  /**
   * Emits an event with optional payload to all registered listeners.
   *
   * @param {string} event - Name of the event to emit.
   * @param {*} [payload] - Data payload matching GestureEventMap specification.
   */
  emit(event, payload) {
    const handlers = this._listeners.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    // Iterate over a snapshot copy to allow listeners to safely unsubscribe or subscribe during dispatch
    const snapshot = Array.from(handlers);
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (error) {
        console.error(`[GestureEventBus] Error in listener for event "${event}":`, error);
      }
    }
  }

  /**
   * Subscribes a listener that triggers at most once.
   *
   * @param {string} event - Name of the event.
   * @param {Function} handler - Callback function invoked once.
   * @returns {() => void} Unsubscribe function.
   */
  once(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Handler for event "${event}" must be a function.`);
    }

    const onceWrapper = (payload) => {
      this.off(event, onceWrapper);
      handler(payload);
    };

    return this.on(event, onceWrapper);
  }

  /**
   * Removes all listeners for a given event, or all listeners if no event is passed.
   *
   * @param {string} [event] - Optional event name to clear.
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /**
   * Returns the count of registered listeners for an event or total listeners.
   *
   * @param {string} [event] - Optional event name.
   * @returns {number}
   */
  listenerCount(event) {
    if (event) {
      return this._listeners.get(event)?.size || 0;
    }
    let total = 0;
    for (const set of this._listeners.values()) {
      total += set.size;
    }
    return total;
  }

  // EventTarget compatibility aliases
  addEventListener(event, handler) {
    return this.on(event, handler);
  }

  removeEventListener(event, handler) {
    this.off(event, handler);
  }

  dispatchEvent(eventOrCustomEvent) {
    if (eventOrCustomEvent && typeof eventOrCustomEvent === 'object') {
      const type = eventOrCustomEvent.type;
      const detail = 'detail' in eventOrCustomEvent ? eventOrCustomEvent.detail : undefined;
      this.emit(type, detail);
      return true;
    }
    return false;
  }
}

/**
 * Singleton instance of GestureEventBus for application-wide use.
 */
export const gestureEventBus = new GestureEventBus();

export default gestureEventBus;
