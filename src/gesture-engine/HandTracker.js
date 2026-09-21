/**
 * @file HandTracker.js
 * @description Hand tracker featuring Target Lock (initial maximum area bounding box,
 * consecutive minimum Euclidean distance tracking) and 1€ Filter (One Euro Filter)
 * for jitter-free, low-latency cursor movement.
 */

import gestureEventBus, { GESTURE_EVENTS } from '../events/GestureEventBus.js';

/**
 * 1D Low Pass Filter
 */
export class LowPassFilter {
  /**
   * @param {number} [alpha=1.0]
   * @param {number} [initVal=0]
   */
  constructor(alpha = 1.0, initVal = 0) {
    this.alpha = alpha;
    this.s = initVal;
    this.initialized = false;
  }

  /**
   * Filters the next value.
   * @param {number} val
   * @param {number} [alpha=this.alpha]
   * @returns {number}
   */
  filter(val, alpha = this.alpha) {
    if (!this.initialized) {
      this.s = val;
      this.initialized = true;
      return val;
    }
    this.s = alpha * val + (1.0 - alpha) * this.s;
    return this.s;
  }

  /**
   * Resets the filter state.
   */
  reset() {
    this.initialized = false;
    this.s = 0;
  }
}

/**
 * 1€ Filter (One Euro Filter) - 1D implementation.
 * References: Casiez, Roussel, Vogel (CHI 2012).
 */
export class OneEuroFilter {
  /**
   * @param {object} [options]
   * @param {number} [options.minCutoff=1.0] - Minimum cutoff frequency in Hz (lower = less jitter when still)
   * @param {number} [options.beta=0.007] - Speed coefficient (higher = less lag when moving fast)
   * @param {number} [options.dCutoff=1.0] - Cutoff frequency for derivative in Hz
   */
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.prevTime = null;
  }

  /**
   * Calculates smoothing factor alpha.
   * @param {number} rate - Sampling frequency in Hz
   * @param {number} cutoff - Cutoff frequency in Hz
   * @returns {number}
   */
  static calculateAlpha(rate, cutoff) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  /**
   * Filters a 1D scalar value.
   * @param {number} val - Raw input value
   * @param {number} timestamp - Timestamp in milliseconds
   * @returns {number} Filtered value
   */
  filter(val, timestamp) {
    if (this.prevTime === null) {
      this.prevTime = timestamp;
      this.xFilter.filter(val);
      return val;
    }

    const dt = (timestamp - this.prevTime) / 1000; // Convert to seconds
    this.prevTime = timestamp;

    if (dt <= 0) {
      return this.xFilter.s;
    }

    const rate = 1.0 / dt;

    // Filter the derivative (speed of change)
    const dx = (val - this.xFilter.s) * rate;
    const edx = this.dxFilter.filter(dx, OneEuroFilter.calculateAlpha(rate, this.dCutoff));

    // Calculate dynamic cutoff frequency based on velocity
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(val, OneEuroFilter.calculateAlpha(rate, cutoff));
  }

  /**
   * Resets filter state.
   */
  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.prevTime = null;
  }
}

/**
 * Point2DOneEuroFilter
 * Filters 2D coordinates (X, Y) independently using 1€ Filter.
 */
export class Point2DOneEuroFilter {
  /**
   * @param {object} [options]
   * @param {number} [options.minCutoff=1.0]
   * @param {number} [options.beta=0.007]
   * @param {number} [options.dCutoff=1.0]
   */
  constructor(options = {}) {
    this.xFilter = new OneEuroFilter(options);
    this.yFilter = new OneEuroFilter(options);
  }

  /**
   * Filters 2D coordinates.
   * @param {number} x
   * @param {number} y
   * @param {number} timestamp - In milliseconds
   * @returns {{ x: number, y: number }}
   */
  filter(x, y, timestamp) {
    return {
      x: this.xFilter.filter(x, timestamp),
      y: this.yFilter.filter(y, timestamp),
    };
  }

  /**
   * Resets both filters.
   */
  reset() {
    this.xFilter.reset();
    this.yFilter.reset();
  }
}

/**
 * HandTracker
 * Identifies and locks onto the primary hand using Target Lock algorithm,
 * smooths interaction coordinates using 1€ Filter, and emits 'hand:move' events.
 */
export class HandTracker {
  /**
   * @param {object} [options]
   * @param {boolean} [options.mirror=true] - Horizontally mirror X coordinates for natural webcam interaction
   * @param {'index_tip' | 'palm_center'} [options.trackingPoint='index_tip'] - Landmark to track for (x, y)
   * @param {number} [options.maxTrackingDistance=0.35] - Maximum normalized Euclidean distance to retain lock
   * @param {number} [options.maxLostFrames=10] - Number of missing frames before target lock is released
   * @param {object} [options.filterOptions] - 1€ Filter configuration { minCutoff, beta, dCutoff }
   * @param {import('../events/GestureEventBus.js').GestureEventBus} [options.eventBus] - Event bus instance
   */
  constructor(options = {}) {
    this.options = {
      mirror: options.mirror ?? true,
      trackingPoint: options.trackingPoint || 'index_tip',
      maxTrackingDistance: options.maxTrackingDistance ?? 0.35,
      maxLostFrames: options.maxLostFrames ?? 10,
      filterOptions: {
        minCutoff: 1.0,
        beta: 0.007,
        dCutoff: 1.0,
        ...options.filterOptions,
      },
      ...options,
    };

    this.eventBus = options.eventBus || gestureEventBus;

    // 1€ Filter instance for cursor coordinates
    this.filter = new Point2DOneEuroFilter(this.options.filterOptions);

    // Target Lock state
    this.lockedTarget = null;
    this.lostFramesCount = 0;
    this.lastTrackedHand = null;

    // Internal listeners
    this._listeners = new Map();
  }

  /**
   * Sets or replaces the event bus.
   * @param {import('../events/GestureEventBus.js').GestureEventBus} bus
   */
  setEventBus(bus) {
    this.eventBus = bus;
  }

  /**
   * Resets the target lock and smoothing filters.
   */
  resetLock() {
    this.lockedTarget = null;
    this.lostFramesCount = 0;
    this.lastTrackedHand = null;
    this.filter.reset();
  }

  /**
   * Computes bounding box and center for a hand's landmarks.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @returns {{
   *   minX: number, maxX: number, minY: number, maxY: number,
   *   width: number, height: number, area: number,
   *   center: { x: number, y: number }
   * }}
   * @private
   */
  _computeHandMetrics(landmarks) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    const area = width * height;

    // Center based on wrist (0) and middle MCP (9)
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const center = {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
    };

    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
      area,
      center,
    };
  }

  /**
   * Clones and mirrors landmarks horizontally if mirroring is enabled.
   *
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @returns {Array<{ x: number, y: number, z: number }>}
   * @private
   */
  _prepareLandmarks(landmarks) {
    if (!this.options.mirror) {
      return landmarks;
    }

    return landmarks.map((l) => ({
      x: 1.0 - l.x,
      y: l.y,
      z: l.z,
    }));
  }

  /**
   * Calculates Euclidean distance between two 2D points.
   *
   * @param {{ x: number, y: number }} p1
   * @param {{ x: number, y: number }} p2
   * @returns {number}
   * @private
   */
  _euclideanDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Processes detection results from MediaPipeManager.
   * Applies Target Lock to select the primary hand and 1€ Filter to smooth coordinates.
   * Emits 'hand:move' event via EventBus.
   *
   * @param {object} results - Results from HandLandmarker.detectForVideo
   * @param {number} timestamp - Current frame timestamp in ms
   * @returns {object|null} Tracked hand data or null if no hand locked
   */
  process(results, timestamp = performance.now()) {
    const rawHandsLandmarks = results?.landmarks || [];

    // Case 1: No hands detected in frame
    if (rawHandsLandmarks.length === 0) {
      if (this.lockedTarget) {
        this.lostFramesCount++;
        if (this.lostFramesCount >= this.options.maxLostFrames) {
          this.resetLock();
          this._emitLocal('hand:lost', { timestamp });
          if (this.eventBus && typeof this.eventBus.emit === 'function') {
            this.eventBus.emit('hand:lost', { timestamp });
          }
        }
      }
      return null;
    }

    // Prepare candidate hands with mirrored coordinates and metrics
    const candidates = rawHandsLandmarks.map((rawLandmarks, index) => {
      const landmarks = this._prepareLandmarks(rawLandmarks);
      const metrics = this._computeHandMetrics(landmarks);
      const handedness = results.handedness?.[index]?.[0] || null;
      const worldLandmarks = results.worldLandmarks?.[index] || null;

      return {
        index,
        landmarks,
        worldLandmarks,
        handedness,
        ...metrics,
      };
    });

    let selectedHand = null;

    // Case 2: Target Lock Algorithm
    if (!this.lockedTarget) {
      // INITIAL ACQUISITION: Select hand with largest Bounding Box Area
      let maxArea = -1;
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].area > maxArea) {
          maxArea = candidates[i].area;
          selectedHand = candidates[i];
        }
      }

      if (selectedHand) {
        this.lockedTarget = {
          center: { ...selectedHand.center },
          area: selectedHand.area,
          handedness: selectedHand.handedness?.categoryName,
        };
        this.lostFramesCount = 0;
        this.filter.reset();
      }
    } else {
      // CONSECUTIVE FRAMES: Track by minimum Euclidean distance to previous center
      let minDistance = Infinity;
      let closestCandidate = null;

      for (let i = 0; i < candidates.length; i++) {
        const dist = this._euclideanDistance(candidates[i].center, this.lockedTarget.center);
        if (dist < minDistance) {
          minDistance = dist;
          closestCandidate = candidates[i];
        }
      }

      // Check if closest hand is within allowed tracking radius
      if (closestCandidate && minDistance <= this.options.maxTrackingDistance) {
        selectedHand = closestCandidate;
        this.lockedTarget.center = { ...selectedHand.center };
        this.lockedTarget.area = selectedHand.area;
        this.lostFramesCount = 0;
      } else {
        // Target hand temporarily occluded or out of threshold
        this.lostFramesCount++;
        if (this.lostFramesCount >= this.options.maxLostFrames) {
          // Lock lost; pick the largest area hand as new target
          this.resetLock();
          return this.process(results, timestamp);
        }
        return null;
      }
    }

    if (!selectedHand) {
      return null;
    }

    // Determine raw interaction point (x, y)
    let rawX, rawY;
    if (this.options.trackingPoint === 'palm_center') {
      rawX = selectedHand.center.x;
      rawY = selectedHand.center.y;
    } else {
      // Default: Landmark 8 (Index Finger Tip)
      const indexTip = selectedHand.landmarks[8];
      rawX = indexTip.x;
      rawY = indexTip.y;
    }

    // Clamp normalized raw coordinates to [0, 1]
    rawX = Math.max(0, Math.min(1, rawX));
    rawY = Math.max(0, Math.min(1, rawY));

    // Apply 1€ Filter for smooth, low-latency coordinates
    const filtered = this.filter.filter(rawX, rawY, timestamp);
    const smoothX = Math.max(0, Math.min(1, filtered.x));
    const smoothY = Math.max(0, Math.min(1, filtered.y));

    // Construct tracked hand payload
    const trackedHand = {
      x: smoothX,
      y: smoothY,
      rawX,
      rawY,
      landmarks: selectedHand.landmarks,
      worldLandmarks: selectedHand.worldLandmarks,
      handedness: selectedHand.handedness,
      boundingBox: {
        minX: selectedHand.minX,
        maxX: selectedHand.maxX,
        minY: selectedHand.minY,
        maxY: selectedHand.maxY,
        width: selectedHand.width,
        height: selectedHand.height,
        area: selectedHand.area,
      },
      center: selectedHand.center,
      isLocked: true,
      timestamp,
    };

    this.lastTrackedHand = trackedHand;

    // Emit 'hand:move' matching GestureEventMap specification
    const movePayload = {
      x: smoothX,
      y: smoothY,
      rawX,
      rawY,
    };

    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      this.eventBus.emit(GESTURE_EVENTS.HAND_MOVE, movePayload);
    }

    this._emitLocal('hand', trackedHand);

    return trackedHand;
  }

  /**
   * Registers a local event listener on HandTracker.
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
   * Dispatches local event to HandTracker listeners.
   * @param {string} event
   * @param {*} data
   * @private
   */
  _emitLocal(event, data) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[HandTracker] Error in handler for "${event}":`, err);
        }
      }
    }
  }
}

export default HandTracker;
