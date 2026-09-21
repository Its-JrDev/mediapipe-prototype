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
      ...options,
    };

    this.eventBus = options.eventBus || gestureEventBus;

    // Gesture states
    this.isPinching = false;
    this.isFist = false;
    this.isOpen = false;

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
  _isFingerExtended(landmarks, tipIndex, pipIndex, mcpIndex, palmScale) {
    const wrist = landmarks[HAND_LANDMARKS.WRIST];
    const tip = landmarks[tipIndex];
    const pip = landmarks[pipIndex];
    const mcp = landmarks[mcpIndex];

    const distTipWrist = euclideanDistance(tip, wrist);
    const distPipWrist = euclideanDistance(pip, wrist);
    const distMcpWrist = euclideanDistance(mcp, wrist);

    // In a fist, fingertips curl in and their distance to wrist is less than or close to PIP/MCP
    return distTipWrist > distPipWrist * 1.05 && distTipWrist > distMcpWrist * 1.15;
  }

  /**
   * Evaluates if the thumb is extended.
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @param {number} palmScale
   * @returns {boolean}
   * @private
   */
  _isThumbExtended(landmarks, palmScale) {
    const wrist = landmarks[HAND_LANDMARKS.WRIST];
    const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
    const thumbMcp = landmarks[HAND_LANDMARKS.THUMB_MCP];
    const indexMcp = landmarks[HAND_LANDMARKS.INDEX_MCP];

    const distTipWrist = euclideanDistance(thumbTip, wrist);
    const distMcpWrist = euclideanDistance(thumbMcp, wrist);
    const distTipIndex = euclideanDistance(thumbTip, indexMcp);

    return distTipWrist > distMcpWrist * 1.15 && distTipIndex > palmScale * 0.55;
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
    const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
    const indexTip = landmarks[HAND_LANDMARKS.INDEX_TIP];

    const distance = euclideanDistance(thumbTip, indexTip);
    this._lastPinchDistance = distance;

    // Pinch midpoint coordinates
    const pinchX = (thumbTip.x + indexTip.x) / 2;
    const pinchY = (thumbTip.y + indexTip.y) / 2;
    const x = Math.max(0, Math.min(1, pinchX || defaultX));
    const y = Math.max(0, Math.min(1, pinchY || defaultY));

    if (!this.isPinching) {
      if (distance < this.options.pinchThreshold) {
        this.isPinching = true;
        this._emitEvent(GESTURE_EVENTS.GESTURE_PINCH, {
          active: true,
          x,
          y,
        });
      }
    } else {
      if (distance > this.options.pinchReleaseThreshold) {
        this.isPinching = false;
        this._emitEvent(GESTURE_EVENTS.GESTURE_PINCH, {
          active: false,
          x,
          y,
        });
      }
    }
  }

  /**
   * Detects open hand and closed fist gestures using fingertip distances to wrist base (0).
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @private
   */
  _evaluateHandPose(landmarks) {
    const wrist = landmarks[HAND_LANDMARKS.WRIST];
    const middleMcp = landmarks[HAND_LANDMARKS.MIDDLE_MCP];
    const palmScale = euclideanDistance(wrist, middleMcp);

    // Check individual finger curl: in a real closed fist, all 4 non-thumb fingertips
    // curl down into the palm so tip is closer to wrist than PIP joint
    const indexCurled = euclideanDistance(landmarks[HAND_LANDMARKS.INDEX_TIP], wrist) < euclideanDistance(landmarks[HAND_LANDMARKS.INDEX_PIP], wrist);
    const middleCurled = euclideanDistance(landmarks[HAND_LANDMARKS.MIDDLE_TIP], wrist) < euclideanDistance(landmarks[HAND_LANDMARKS.MIDDLE_PIP], wrist);
    const ringCurled = euclideanDistance(landmarks[HAND_LANDMARKS.RING_TIP], wrist) < euclideanDistance(landmarks[HAND_LANDMARKS.RING_PIP], wrist);
    const pinkyCurled = euclideanDistance(landmarks[HAND_LANDMARKS.PINKY_TIP], wrist) < euclideanDistance(landmarks[HAND_LANDMARKS.PINKY_PIP], wrist);

    // Count extended fingers
    let extendedCount = 0;
    if (this._isThumbExtended(landmarks, palmScale)) extendedCount++;
    if (!indexCurled) extendedCount++;
    if (!middleCurled) extendedCount++;
    if (!ringCurled) extendedCount++;
    if (!pinkyCurled) extendedCount++;

    this._lastExtendedFingerCount = extendedCount;

    // --- STRICT CLOSED FIST EVALUATION ---
    // ALL 4 primary fingers MUST be curled in towards the palm, not pinching, and thumb must not be outstretched
    const thumbExtended = this._isThumbExtended(landmarks, palmScale);
    const isFistCandidate = indexCurled && middleCurled && ringCurled && pinkyCurled && !thumbExtended && !this.isPinching;

    if (isFistCandidate) {
      this._fistFrameCount++;
      if (this._fistFrameCount >= this.options.fistDebounceFrames && !this.isFist) {
        this.isFist = true;
        if (this.isOpen) {
          this.isOpen = false;
          this._openFrameCount = 0;
          this._emitEvent(GESTURE_EVENTS.GESTURE_OPEN, { active: false });
        }
        this._emitEvent(GESTURE_EVENTS.GESTURE_FIST, { active: true });
      }
    } else {
      this._fistFrameCount = 0;
      if (this.isFist) {
        this.isFist = false;
        this._emitEvent(GESTURE_EVENTS.GESTURE_FIST, { active: false });
      }
    }

    // --- OPEN HAND EVALUATION ---
    // At least 4 fingers fully extended, and not pinching
    const isOpenCandidate = extendedCount >= 4 && !this.isPinching;
    if (isOpenCandidate) {
      this._openFrameCount++;
      if (this._openFrameCount >= this.options.openDebounceFrames && !this.isOpen) {
        this.isOpen = true;
        if (this.isFist) {
          this.isFist = false;
          this._fistFrameCount = 0;
          this._emitEvent(GESTURE_EVENTS.GESTURE_FIST, { active: false });
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
  }

  /**
   * Detects swipe gestures across time window (delta X/Y over time).
   *
   * @param {number} x - Normalized X coordinate
   * @param {number} y - Normalized Y coordinate
   * @param {number} timestamp - Current frame time in ms
   * @private
   */
  _evaluateSwipe(x, y, timestamp) {
    // Check cooldown period
    if (timestamp - this._lastSwipeTimestamp < this.options.swipeCooldownMs) {
      return;
    }

    // Append current position to sliding window
    this._swipeHistory.push({ x, y, time: timestamp });

    // Prune points outside window
    const cutoffTime = timestamp - this.options.swipeWindowMs;
    while (this._swipeHistory.length > 0 && this._swipeHistory[0].time < cutoffTime) {
      this._swipeHistory.shift();
    }

    // Need at least 4 data points spanning at least 60ms to evaluate trajectory
    if (this._swipeHistory.length < 4) {
      return;
    }

    const oldest = this._swipeHistory[0];
    const latest = this._swipeHistory[this._swipeHistory.length - 1];

    const dtSeconds = (latest.time - oldest.time) / 1000;
    if (dtSeconds < 0.06) {
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

    // Horizontal swipe check: |deltaX| dominant over |deltaY|
    if (
      absDx >= this.options.minSwipeDistance &&
      absVx >= this.options.minSwipeVelocity &&
      absVx > absVy * 1.25
    ) {
      detectedDirection = dx > 0 ? SWIPE_DIRECTIONS.RIGHT : SWIPE_DIRECTIONS.LEFT;
    }
    // Vertical swipe check: |deltaY| dominant over |deltaX|
    else if (
      absDy >= this.options.minSwipeDistance &&
      absVy >= this.options.minSwipeVelocity &&
      absVy > absVx * 1.25
    ) {
      detectedDirection = dy > 0 ? SWIPE_DIRECTIONS.DOWN : SWIPE_DIRECTIONS.UP;
    }

    if (detectedDirection) {
      this._lastSwipeTimestamp = timestamp;
      this._swipeHistory = []; // Clear history to prevent duplicate triggers

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

    const landmarks = trackedHand.landmarks;
    const currentX = trackedHand.x;
    const currentY = trackedHand.y;

    // 1. Evaluate Pinch (Landmark 4 vs 8)
    this._evaluatePinch(landmarks, currentX, currentY);

    // 2. Evaluate Pose (Open Hand vs Closed Fist)
    this._evaluateHandPose(landmarks);

    // 3. Evaluate Swipe (Motion vector over time)
    this._evaluateSwipe(currentX, currentY, timestamp);
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
      this._emitEvent(GESTURE_EVENTS.GESTURE_FIST, { active: false });
    }

    if (this.isOpen) {
      this.isOpen = false;
      this._emitEvent(GESTURE_EVENTS.GESTURE_OPEN, { active: false });
    }

    this._fistFrameCount = 0;
    this._openFrameCount = 0;
    this._swipeHistory = [];
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
