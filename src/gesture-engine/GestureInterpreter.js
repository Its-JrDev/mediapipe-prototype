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
    this.isTwoFingerScroll = false;
    this.currentFacing = 'UNKNOWN'; // 'PALM' | 'BACK' | 'UNKNOWN'
    this._lastFacing = null;
    this._lastFlipTimestamp = 0;

    // Debounce counters
    this._fistFrameCount = 0;
    this._openFrameCount = 0;
    this._facingFrameCount = 0;
    this._candidateFacing = null;

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

    // --- STRICT CLOSED FIST EVALUATION ---
    // A true fist requires ALL 4 main fingers tightly curled into knuckles, thumb tucked, and NOT pinching
    const isFistCandidate = curledCount === 4 && thumbCurled && !this.isPinching;

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
    // At least 4 fingers uncurled and not pinching
    const isOpenCandidate = curledCount <= 1 && !thumbCurled && !this.isPinching;
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

    // --- TWO-FINGER SCROLL POSE EVALUATION (Index + Ring/Middle extended, Thumb & Pinky curled) ---
    // User requested: scroll solo con 2 dedos
    const twoFingersExtended = !indexCurled && (!middleCurled || !ringCurled) && pinkyCurled;
    if (twoFingersExtended && !this.isPinching && !isFistCandidate) {
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
      this._swipeHistory = [];

      this._emitEvent(GESTURE_EVENTS.GESTURE_SWIPE, {
        direction: detectedDirection,
        velocity: Math.round(velocity * 100) / 100,
      });
    }
  }

  /**
   * Detects hand flipping (showing palm vs showing back of hand).
   * Uses cross product of palm vectors (Wrist -> Index MCP) x (Wrist -> Pinky MCP)
   * to determine the surface normal Z direction.
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks
   * @param {number} timestamp
   * @private
   */
  _evaluateFlip(landmarks, timestamp) {
    const wrist = landmarks[HAND_LANDMARKS.WRIST];
    const indexMcp = landmarks[HAND_LANDMARKS.INDEX_MCP];
    const pinkyMcp = landmarks[HAND_LANDMARKS.PINKY_MCP];

    if (!wrist || !indexMcp || !pinkyMcp) return;

    // Vector 1: Wrist -> Index MCP
    const v1 = {
      x: indexMcp.x - wrist.x,
      y: indexMcp.y - wrist.y,
      z: (indexMcp.z || 0) - (wrist.z || 0),
    };

    // Vector 2: Wrist -> Pinky MCP
    const v2 = {
      x: pinkyMcp.x - wrist.x,
      y: pinkyMcp.y - wrist.y,
      z: (pinkyMcp.z || 0) - (wrist.z || 0),
    };

    // Palm normal Z component = (v1.x * v2.y - v1.y * v2.x)
    const normalZ = v1.x * v2.y - v1.y * v2.x;

    // Strong threshold to prevent flickering during edge-on rotations
    let detectedFacing = 'UNKNOWN';
    if (normalZ > 0.008) {
      detectedFacing = 'PALM';
    } else if (normalZ < -0.008) {
      detectedFacing = 'BACK';
    }

    if (detectedFacing !== 'UNKNOWN') {
      if (detectedFacing === this._candidateFacing) {
        this._facingFrameCount++;
        if (this._facingFrameCount >= 3) { // Require 3 stable frames
          if (this.currentFacing !== detectedFacing) {
            const previousFacing = this.currentFacing;
            this.currentFacing = detectedFacing;

            // If we transitioned from a known orientation to the opposite orientation
            if (previousFacing !== 'UNKNOWN' && (timestamp - this._lastFlipTimestamp > 600)) {
              this._lastFlipTimestamp = timestamp;
              this._emitEvent(GESTURE_EVENTS.GESTURE_FLIP, {
                facing: detectedFacing,
                from: previousFacing,
                timestamp,
              });
            }
          }
        }
      } else {
        this._candidateFacing = detectedFacing;
        this._facingFrameCount = 1;
      }
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

    // 4. Evaluate Flip (Rotating hand: palm <-> back)
    this._evaluateFlip(landmarks, timestamp);
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
