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
import { CustomSignMapper, customSignMapper } from './CustomSignMapper.js';

export {
  MediaPipeManager,
  loadTasksVision,
  HandTracker,
  LowPassFilter,
  OneEuroFilter,
  Point2DOneEuroFilter,
  GestureInterpreter,
  CustomSignMapper,
  customSignMapper,
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

    this.customSignMapper = options.customSignMapper || customSignMapper;
    this.customSignMapper.eventBus = this.eventBus;

    // Wire MediaPipe results pipeline:
    // MediaPipeManager -> HandTracker -> GestureInterpreter + CustomSignMapper
    this._unsubscribeMediaPipe = this.mediaPipeManager.onResults(
      (results, timestamp) => {
        const trackedHand = this.handTracker.process(results, timestamp);
        // Exclusividad en fuente: con scroll-custom sostenido no hay pinch (una sola acción).
        this.gestureInterpreter.suppressPinch = this.customSignMapper.isScrollHeld();
        this.gestureInterpreter.process(trackedHand, timestamp);
        // Lock anti-choque: cerca del pinch la seña custom no predice,
        // así poses parecidas al pinch no abren el modal sin querer.
        const pinchD = this.gestureInterpreter.getState().pinchDistance;
        this.customSignMapper.setGesturalLock(
          this.gestureInterpreter.isPinching ||
            pinchD < this.gestureInterpreter.options.pinchReleaseThreshold * 1.6,
        );
        this.customSignMapper.process(trackedHand, timestamp);
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
