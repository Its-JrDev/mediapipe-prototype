/**
 * @file GestureInterpreter.js
 * @description Analyzes hand landmarks and movement vectors to recognize discrete gestures:
 * - Pinch (pinch start / pinch end): Euclidean distance between thumb (4) and index (8) < 0.05
 * - Open Hand / Closed Fist: Distance of fingertips to wrist base (0)
 * - Swipe: Displacement delta and velocity over time window
 *
 * Emits events matching the GestureEventMap specification:
 * - 'gesture:pinch': { active: boolean, x: number, y: number }
 * - 'gesture:fist': { active: boolean }
 * - 'gesture:open': { active: boolean }
 * - 'gesture:swipe': { direction: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN', velocity: number }
 */

import gestureEventBus, { GESTURE_EVENTS, SWIPE_DIRECTIONS } from '../events/GestureEventBus.js';

/**
 * Landmark Indices in MediaPipe Hand Model
 */
export const HAND_LANDMARKS = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
});

/**
 * Calculates Euclidean distance between two points in 2D/3D.
 *
 * @param {{ x: number, y: number, z?: number }} p1
 * @param {{ x: number, y: number, z?: number }} p2
 * @param {boolean} [use3D=false]
 * @returns {number}
 */
export function euclideanDistance(p1, p2, use3D = false) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  if (use3D && p1.z !== undefined && p2.z !== undefined) {
    const dz = p1.z - p2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * GestureInterpreter
 * Analyzes tracked hand landmarks and coordinates to emit discrete gesture events.
 */
export class GestureInterpreter {
  /**
   * @param {object} [options]
   * @param {number} [options.pinchThreshold=0.05] - Distance between thumb (4) and index (8) to trigger pinch
   * @param {number} [options.pinchReleaseThreshold=0.065] - Distance to release pinch (hysteresis)
   * @param {number} [options.fistDebounceFrames=2] - Consecutive frames required to confirm closed fist
   * @param {number} [options.openDebounceFrames=2] - Consecutive frames required to confirm open hand
   * @param {number} [options.swipeWindowMs=280] - Milliseconds window to calculate swipe velocity
   * @param {number} [options.minSwipeDistance=0.12] - Minimum normalized displacement to trigger swipe
   * @param {number} [options.minSwipeVelocity=0.6] - Minimum velocity (units/sec) for swipe
   * @param {number} [options.swipeCooldownMs=400] - Refractory period in ms after a swipe trigger
   * @param {number} [options.edgeTopThreshold=0.18] - Y normalizada bajo la cual empieza zona scroll TOP
   * @param {number} [options.edgeBottomThreshold=0.82] - Y normalizada sobre la cual empieza zona scroll BOTTOM
   * @param {number} [options.edgeDwellMs=300] - Tiempo sostenido en borde para activar EDGE_SCROLL
   * @param {number} [options.discreteCooldownMs=800] - Cooldown exclusivo tras pinch/swipe
   * @param {import('../events/GestureEventBus.js').GestureEventBus} [options.eventBus] - Event bus instance
   */
  constructor(options = {}) {
    this.options = {
      pinchThreshold: options.pinchThreshold ?? 0.05,
      pinchReleaseThreshold: options.pinchReleaseThreshold ?? 0.065,
      fistDebounceFrames: options.fistDebounceFrames ?? 2,
      openDebounceFrames: options.openDebounceFrames ?? 2,
      swipeWindowMs: options.swipeWindowMs ?? 280,
      minSwipeDistance: options.minSwipeDistance ?? 0.12,
      minSwipeVelocity: options.minSwipeVelocity ?? 0.6,
      swipeCooldownMs: options.swipeCooldownMs ?? 400,
      edgeTopThreshold: options.edgeTopThreshold ?? 0.12,
      edgeBottomThreshold: options.edgeBottomThreshold ?? 0.88,
      edgeDwellMs: options.edgeDwellMs ?? 250,
      discreteCooldownMs: options.discreteCooldownMs ?? 800,
      ...options,
    };

    this.eventBus = options.eventBus || gestureEventBus;

    // Máquina de estados exclusiva: solo un modo activo a la vez.
    // TRACKING | PINCH | EDGE_SCROLL | SWIPE_COOLDOWN
    this.mode = 'TRACKING';
    this._edgeZone = 'NONE'; // 'TOP' | 'BOTTOM' | 'NONE'
    this._edgeEnterTime = 0;
    this._lastDiscreteTime = 0;

    // Supresión externa de pinch (el engine la activa con scroll-custom sostenido)
    this.suppressPinch = false;

    // Gesture states
    this.isPinching = false;
    this.isFist = false;
    this.isOpen = false;
    this.isTwoFingerScroll = false;

    // Debounce counters
    this._fistFrameCount = 0;
    this._openFrameCount = 0;

    // Swipe motion tracking buffer
    /** @type {Array<{ x: number, y: number, time: number }>} */
    this._swipeHistory = [];
    this._lastSwipeTimestamp = 0;

    // Metrics snapshot
    this._lastPinchDistance = 1.0;
    this._lastExtendedFingerCount = 0;
    this._lastEvalTime = 0;
    this._evalSkip = false;

    // Local listeners
    this._listeners = new Map();
  }

  /**
   * Sets or updates the event bus.
   * @param {import('../events/GestureEventBus.js').GestureEventBus} bus
   */
  setEventBus(bus) {
    this.eventBus = bus;
  }

  /**
   * Evaluates if a given finger is extended relative to the palm and wrist.
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @param {number} tipIndex
   * @param {number} pipIndex
   * @param {number} mcpIndex
   * @param {number} palmScale
   * @returns {boolean}
   * @private
   */
  /**
   * Evaluates if a finger is curled towards its own knuckle (MCP) using 3D coordinates.
   * In an open hand, tip-to-MCP distance is large (> 1.1 * palmScale).
   * In a curled fist, tip is folded close to MCP (< 0.75 * palmScale).
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @param {number} tipIndex
   * @param {number} mcpIndex
   * @param {number} palmScale
   * @returns {boolean} True if finger is tightly curled into palm
   * @private
   */
  _isFingerCurled(landmarks, tipIndex, mcpIndex, palmScale) {
    const tip = landmarks[tipIndex];
    const mcp = landmarks[mcpIndex];
    const distTipMcp = euclideanDistance(tip, mcp, true);
    return distTipMcp < palmScale * 0.72;
  }

  /**
   * Evaluates if the thumb is curled against the palm/index MCP.
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @param {number} palmScale
   * @returns {boolean} True if thumb is tucked in
   * @private
   */
  _isThumbCurled(landmarks, palmScale) {
    const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
    const indexMcp = landmarks[HAND_LANDMARKS.INDEX_MCP];
    const middleMcp = landmarks[HAND_LANDMARKS.MIDDLE_MCP];
    const distToIndexMcp = euclideanDistance(thumbTip, indexMcp, true);
    const distToMiddleMcp = euclideanDistance(thumbTip, middleMcp, true);
    return distToIndexMcp < palmScale * 0.65 || distToMiddleMcp < palmScale * 0.75;
  }

  /**
   * Cambia el modo exclusivo y notifica una sola vez por transición.
   * @param {'TRACKING'|'PINCH'|'EDGE_SCROLL'|'SWIPE_COOLDOWN'} next
   * @private
   */
  _setMode(next) {
    if (this.mode === next) return;
    this.mode = next;
    this._emitEvent(GESTURE_EVENTS.GESTURE_MODE, { mode: next });
    if (typeof window !== 'undefined') {
      window.__lastGestureState = next === 'EDGE_SCROLL' ? `${this._edgeZone} SCROLL` : next;
    }
  }

  /**
   * Scroll por bordes top/down: requiere mano sostenida en la franja.
   * @param {number} y - Y normalizada [0,1]
   * @param {number} timestamp
   * @returns {'TOP'|'BOTTOM'|'NONE'}
   * @private
   */
  _evaluateEdgeScroll(y, timestamp) {
    let zone = 'NONE';
    if (y <= this.options.edgeTopThreshold) zone = 'TOP';
    else if (y >= this.options.edgeBottomThreshold) zone = 'BOTTOM';

    if (zone === 'NONE') {
      if (this._edgeZone !== 'NONE') {
        this._edgeZone = 'NONE';
        this._edgeEnterTime = 0;
        this._emitEvent(GESTURE_EVENTS.GESTURE_EDGE_SCROLL, { zone: 'NONE' });
        if (this.mode === 'EDGE_SCROLL') this._setMode('TRACKING');
      }
      return 'NONE';
    }

    if (zone !== this._edgeZone) {
      this._edgeZone = zone;
      this._edgeEnterTime = timestamp;
      this._emitEvent(GESTURE_EVENTS.GESTURE_EDGE_SCROLL, { zone });
      return 'NONE'; // aún no activado, espera dwell
    }

    if (this.mode !== 'EDGE_SCROLL' && timestamp - this._edgeEnterTime >= this.options.edgeDwellMs) {
      // Solo entra a scroll si no hay cooldown de gesto discreto reciente
      if (timestamp - this._lastDiscreteTime >= this.options.discreteCooldownMs) {
        this._setMode('EDGE_SCROLL');
      }
    }
    return this.mode === 'EDGE_SCROLL' ? zone : 'NONE';
  }

  /**
   * Detects pinch gesture: Euclidean distance between thumb tip (4) and index tip (8).
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @param {number} defaultX
   * @param {number} defaultY
   * @private
   */
  _evaluatePinch(landmarks, defaultX, defaultY) {
    // Exclusivo: pinch inhibido durante EDGE_SCROLL, cooldown de swipe o scroll-custom sostenido
    if (this.mode === 'EDGE_SCROLL' || this.mode === 'SWIPE_COOLDOWN' || this.suppressPinch) return;
    const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
    const indexTip = landmarks[HAND_LANDMARKS.INDEX_TIP];

    const distance = euclideanDistance(thumbTip, indexTip, true);
    this._lastPinchDistance = distance;

    // Pinch midpoint coordinates
    const pinchX = (thumbTip.x + indexTip.x) / 2;
    const pinchY = (thumbTip.y + indexTip.y) / 2;
    const x = Math.max(0, Math.min(1, pinchX || defaultX));
    const y = Math.max(0, Math.min(1, pinchY || defaultY));

    if (!this.isPinching) {
      if (distance < this.options.pinchThreshold) {
        this.isPinching = true;
        this._lastDiscreteTime = performance.now();
        this._setMode('PINCH');
        this._emitEvent(GESTURE_EVENTS.GESTURE_PINCH, {
          active: true,
          x,
          y,
        });
      }
    } else {
      if (distance > this.options.pinchReleaseThreshold) {
        this.isPinching = false;
        this._lastDiscreteTime = performance.now();
        this._setMode('TRACKING');
        this._emitEvent(GESTURE_EVENTS.GESTURE_PINCH, {
          active: false,
          x,
          y,
        });
      }
    }
  }

  /**
   * Detects open hand and closed fist gestures using fingertip-to-knuckle 3D biomechanics.
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @private
   */
  _evaluateHandPose(landmarks) {
    const wrist = landmarks[HAND_LANDMARKS.WRIST];
    const middleMcp = landmarks[HAND_LANDMARKS.MIDDLE_MCP];
    const palmScale = euclideanDistance(wrist, middleMcp, true) || 0.1;

    // Check individual finger curl: all 4 fingers must curl to their knuckles
    const indexCurled = this._isFingerCurled(landmarks, HAND_LANDMARKS.INDEX_TIP, HAND_LANDMARKS.INDEX_MCP, palmScale);
    const middleCurled = this._isFingerCurled(landmarks, HAND_LANDMARKS.MIDDLE_TIP, HAND_LANDMARKS.MIDDLE_MCP, palmScale);
    const ringCurled = this._isFingerCurled(landmarks, HAND_LANDMARKS.RING_TIP, HAND_LANDMARKS.RING_MCP, palmScale);
    const pinkyCurled = this._isFingerCurled(landmarks, HAND_LANDMARKS.PINKY_TIP, HAND_LANDMARKS.PINKY_MCP, palmScale);
    const thumbCurled = this._isThumbCurled(landmarks, palmScale);

    // Count curled and extended fingers
    let curledCount = 0;
    if (indexCurled) curledCount++;
    if (middleCurled) curledCount++;
    if (ringCurled) curledCount++;
    if (pinkyCurled) curledCount++;

    const extendedCount = 5 - (curledCount + (thumbCurled ? 1 : 0));
    this._lastExtendedFingerCount = extendedCount;

    // --- PUÑO CERRADO DESACTIVADO ---
    // Solo vale la seña custom (CustomSignMapper). No se emite gesture:fist.
    const isFistCandidate = false;
    this._fistFrameCount = 0;
    if (this.isFist) {
      this.isFist = false;
    }

    // --- OPEN HAND EVALUATION ---
    // At least 4 fingers uncurled and not pinching
    const isOpenCandidate = curledCount <= 1 && !thumbCurled && !this.isPinching;
    if (isOpenCandidate) {
      this._openFrameCount++;
      if (this._openFrameCount >= this.options.openDebounceFrames && !this.isOpen) {
        this.isOpen = true;
        if (this.isFist) {
          this.isFist = false;
          this._fistFrameCount = 0;
        }
        this._emitEvent(GESTURE_EVENTS.GESTURE_OPEN, { active: true });
      }
    } else {
      this._openFrameCount = 0;
      if (this.isOpen) {
        this.isOpen = false;
        this._emitEvent(GESTURE_EVENTS.GESTURE_OPEN, { active: false });
      }
    }

    // --- TWO-FINGER SCROLL POSE (legacy, solo fuera de EDGE_SCROLL/PINCH) ---
    // Se mantiene por compatibilidad pero ya no gobierna el scroll.
    const twoFingersExtended = !indexCurled && (!middleCurled || !ringCurled) && pinkyCurled;
    const allowLegacyScroll = this.mode !== 'EDGE_SCROLL' && this.mode !== 'PINCH' && !this.isPinching && !isFistCandidate;
    if (twoFingersExtended && allowLegacyScroll) {
      if (!this.isTwoFingerScroll) {
        this.isTwoFingerScroll = true;
        this._emitEvent('gesture:scroll-mode', { active: true });
      }
    } else {
      if (this.isTwoFingerScroll) {
        this.isTwoFingerScroll = false;
        this._emitEvent('gesture:scroll-mode', { active: false });
      }
    }
  }

  /**
   * Detects swipe gestures across time window with dedicated vertical sensitivity.
   *
   * @param {number} x - Normalized X coordinate
   * @param {number} y - Normalized Y coordinate
   * @param {number} timestamp - Current frame time in ms
   * @private
   */
  _evaluateSwipe(x, y, timestamp) {
    // Exclusivo: sin swipe durante EDGE_SCROLL ni PINCH
    if (this.mode === 'EDGE_SCROLL' || this.mode === 'PINCH' || this.isPinching) {
      this._swipeHistory = [];
      return;
    }
    if (timestamp - this._lastSwipeTimestamp < this.options.swipeCooldownMs) {
      return;
    }

    this._swipeHistory.push({ x, y, time: timestamp });

    const cutoffTime = timestamp - this.options.swipeWindowMs;
    while (this._swipeHistory.length > 0 && this._swipeHistory[0].time < cutoffTime) {
      this._swipeHistory.shift();
    }

    if (this._swipeHistory.length < 3) {
      return;
    }

    const oldest = this._swipeHistory[0];
    const latest = this._swipeHistory[this._swipeHistory.length - 1];

    const dtSeconds = (latest.time - oldest.time) / 1000;
    if (dtSeconds < 0.05) {
      return;
    }

    const dx = latest.x - oldest.x;
    const dy = latest.y - oldest.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const vx = dx / dtSeconds;
    const vy = dy / dtSeconds;
    const absVx = Math.abs(vx);
    const absVy = Math.abs(vy);
    const velocity = Math.sqrt(vx * vx + vy * vy);

    let detectedDirection = null;

    // Vertical swipe: fast upward or downward hand motion
    if (absDy >= this.options.minSwipeDistance && absVy >= this.options.minSwipeVelocity) {
      detectedDirection = dy > 0 ? SWIPE_DIRECTIONS.DOWN : SWIPE_DIRECTIONS.UP;
    }
    // Horizontal swipe: left or right hand motion
    else if (absDx >= this.options.minSwipeDistance && absVx >= this.options.minSwipeVelocity && absVx > absVy * 1.1) {
      detectedDirection = dx > 0 ? SWIPE_DIRECTIONS.RIGHT : SWIPE_DIRECTIONS.LEFT;
    }

    if (detectedDirection) {
      this._lastSwipeTimestamp = timestamp;
      this._lastDiscreteTime = timestamp;
      this._swipeHistory = [];
      this._setMode('SWIPE_COOLDOWN');
      setTimeout(() => {
        if (this.mode === 'SWIPE_COOLDOWN' && !this.isPinching) this._setMode('TRACKING');
      }, this.options.discreteCooldownMs);

      this._emitEvent(GESTURE_EVENTS.GESTURE_SWIPE, {
        direction: detectedDirection,
        velocity: Math.round(velocity * 100) / 100,
      });
    }
  }

  /**
   * Main processing method. Evaluates gestures on the tracked hand.
   *
   * @param {object|null} trackedHand - Output from HandTracker.process()
   * @param {number} [timestamp] - Current timestamp in ms
   */
  process(trackedHand, timestamp = performance.now()) {
    if (!trackedHand || !trackedHand.landmarks) {
      // Hand lost or not detected: reset active states
      this.reset();
      return;
    }

    // Throttle: cuando está idle (TRACKING sin gesto en curso) evalúa a ~40fps;
    // con gesto en curso (pinch/swipe/scroll) evalúa cada frame para no perderlo.
    // El cursor suave lo mantiene HandTracker vía hand:move, no depende de esto.
    const idle =
      this.mode === 'TRACKING' && !this.isPinching && this._swipeHistory.length === 0;
    if (idle && timestamp - this._lastEvalTime < 25) {
      return;
    }
    this._lastEvalTime = timestamp;

    const landmarks = trackedHand.landmarks;
    const currentX = trackedHand.x;
    const currentY = trackedHand.y;

    // 0. Borde top/down primero: decide si entramos a EDGE_SCROLL
    const edgeActive = this._evaluateEdgeScroll(currentY, timestamp);

    // 1. Pinch (inhibido internamente en EDGE_SCROLL / SWIPE_COOLDOWN)
    this._evaluatePinch(landmarks, currentX, currentY);

    // 2. Pose (open/fist + legacy 2-dedos ya degradado)
    this._evaluateHandPose(landmarks);

    // 3. Swipe solo en TRACKING (inhibido en EDGE_SCROLL/PINCH)
    if (!edgeActive) {
      this._evaluateSwipe(currentX, currentY, timestamp);
    } else {
      this._swipeHistory = [];
    }
  }

  /**
   * Resets all gesture states (useful when hand tracking is lost).
   * Automatically emits release events for any active gestures.
   */
  reset() {
    if (this.isPinching) {
      this.isPinching = false;
      this._emitEvent(GESTURE_EVENTS.GESTURE_PINCH, {
        active: false,
        x: 0,
        y: 0,
      });
    }

    if (this.isFist) {
      this.isFist = false;
    }

    if (this.isOpen) {
      this.isOpen = false;
      this._emitEvent(GESTURE_EVENTS.GESTURE_OPEN, { active: false });
    }

    if (this.isTwoFingerScroll) {
      this.isTwoFingerScroll = false;
      this._emitEvent('gesture:scroll-mode', { active: false });
    }

    if (this._edgeZone !== 'NONE') {
      this._edgeZone = 'NONE';
      this._emitEvent(GESTURE_EVENTS.GESTURE_EDGE_SCROLL, { zone: 'NONE' });
    }

    if (this.mode !== 'TRACKING') {
      this.mode = 'TRACKING';
      this._emitEvent(GESTURE_EVENTS.GESTURE_MODE, { mode: 'TRACKING' });
    }

    this.suppressPinch = false;
    this._fistFrameCount = 0;
    this._openFrameCount = 0;
    this._swipeHistory = [];
    this._edgeEnterTime = 0;
  }

  /**
   * Returns a snapshot of current gesture metrics.
   * @returns {{
   *   isPinching: boolean,
   *   isFist: boolean,
   *   isOpen: boolean,
   *   pinchDistance: number,
   *   extendedFingerCount: number
   * }}
   */
  getState() {
    return {
      isPinching: this.isPinching,
      isFist: this.isFist,
      isOpen: this.isOpen,
      pinchDistance: this._lastPinchDistance,
      extendedFingerCount: this._lastExtendedFingerCount,
      mode: this.mode,
      edgeZone: this._edgeZone,
    };
  }

  /**
   * Registers a local event handler.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void}
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => {
      this._listeners.get(event)?.delete(handler);
    };
  }

  /**
   * Emits event to both external EventBus and local listeners.
   * @param {string} event
   * @param {*} payload
   * @private
   */
  _emitEvent(event, payload) {
    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      this.eventBus.emit(event, payload);
    }

    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[GestureInterpreter] Error in listener for "${event}":`, err);
        }
      }
    }
  }
}

export default GestureInterpreter;
