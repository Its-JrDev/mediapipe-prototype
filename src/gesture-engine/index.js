/**
 * @file index.js
 * @description Central export and orchestrator for gesture-engine module.
 * Provides MediaPipeManager, HandTracker, GestureInterpreter, and the combined GestureEngine.
 */

import { MediaPipeManager, loadTasksVision } from './MediaPipeManager.js';
import {
  HandTracker,
  LowPassFilter,
  OneEuroFilter,
  Point2DOneEuroFilter,
} from './HandTracker.js';
import {
  GestureInterpreter,
  HAND_LANDMARKS,
  euclideanDistance,
} from './GestureInterpreter.js';
import gestureEventBus, { GESTURE_EVENTS, SWIPE_DIRECTIONS } from '../events/GestureEventBus.js';

export {
  MediaPipeManager,
  loadTasksVision,
  HandTracker,
  LowPassFilter,
  OneEuroFilter,
  Point2DOneEuroFilter,
  GestureInterpreter,
  HAND_LANDMARKS,
  euclideanDistance,
  GESTURE_EVENTS,
  SWIPE_DIRECTIONS,
};

/**
 * GestureEngine
 * High-level coordinator connecting MediaPipeManager, HandTracker, and GestureInterpreter.
 */
export class GestureEngine {
  /**
   * @param {object} [options]
   * @param {object} [options.mediaPipeOptions] - Options passed to MediaPipeManager
   * @param {object} [options.trackerOptions] - Options passed to HandTracker
   * @param {object} [options.interpreterOptions] - Options passed to GestureInterpreter
   * @param {import('../events/GestureEventBus.js').GestureEventBus} [options.eventBus] - Event bus instance
   */
  constructor(options = {}) {
    this.eventBus = options.eventBus || gestureEventBus;

    this.mediaPipeManager = new MediaPipeManager({
      ...options.mediaPipeOptions,
    });

    this.handTracker = new HandTracker({
      eventBus: this.eventBus,
      ...options.trackerOptions,
    });

    this.gestureInterpreter = new GestureInterpreter({
      eventBus: this.eventBus,
      ...options.interpreterOptions,
    });

    // Wire MediaPipe results pipeline:
    // MediaPipeManager -> HandTracker -> GestureInterpreter
    this._unsubscribeMediaPipe = this.mediaPipeManager.onResults(
      (results, timestamp) => {
        const trackedHand = this.handTracker.process(results, timestamp);
        this.gestureInterpreter.process(trackedHand, timestamp);
      }
    );
  }

  /**
   * Initializes the MediaPipe model and vision tasks.
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.mediaPipeManager.initialize();
  }

  /**
   * Starts camera and gesture detection loop.
   * @returns {Promise<void>}
   */
  async start() {
    await this.mediaPipeManager.start();
  }

  /**
   * Pauses detection loop while keeping camera stream open.
   */
  pause() {
    this.mediaPipeManager.pause();
    this.gestureInterpreter.reset();
  }

  /**
   * Resumes paused detection loop.
   */
  resume() {
    this.mediaPipeManager.resume();
  }

  /**
   * Stops detection loop and camera stream.
   */
  stop() {
    this.mediaPipeManager.stop();
    this.handTracker.resetLock();
    this.gestureInterpreter.reset();
  }

  /**
   * Disposes of all resources, models, and listeners.
   */
  cleanup() {
    if (this._unsubscribeMediaPipe) {
      this._unsubscribeMediaPipe();
    }
    this.stop();
    this.mediaPipeManager.cleanup();
  }
}

export default GestureEngine;
