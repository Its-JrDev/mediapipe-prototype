/**
 * @file MediaPipeManager.js
 * @description Manages MediaPipe Tasks Vision HandLandmarker, webcam video stream,
 * and the continuous detection loop running at up to 60 FPS (or camera maximum).
 */

const DEFAULT_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const DEFAULT_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/**
 * Dynamically loads @mediapipe/tasks-vision from local npm package if available,
 * or gracefully falls back to CDN ESM bundle.
 *
 * @param {object} [customVisionModule] - Optional pre-loaded tasks-vision module.
 * @returns {Promise<{ FilesetResolver: any, HandLandmarker: any }>}
 */
export async function loadTasksVision(customVisionModule = null) {
  if (customVisionModule) {
    return customVisionModule;
  }

  if (typeof window !== 'undefined' && window.FilesetResolver && window.HandLandmarker) {
    return {
      FilesetResolver: window.FilesetResolver,
      HandLandmarker: window.HandLandmarker,
    };
  }

  // Attempt dynamic import of local npm package if installed
  try {
    const pkgName = '@mediapipe/tasks-vision';
    const localMod = await import(/* @vite-ignore */ pkgName);
    if (localMod && (localMod.FilesetResolver || localMod.default?.FilesetResolver)) {
      return localMod.FilesetResolver ? localMod : localMod.default;
    }
  } catch {
    // Package not found locally; fallback to CDN
  }

  // Fallback to CDN ESM module
  try {
    const cdnUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm';
    const cdnMod = await import(/* @vite-ignore */ cdnUrl);
    if (cdnMod && (cdnMod.FilesetResolver || cdnMod.default?.FilesetResolver)) {
      return cdnMod.FilesetResolver ? cdnMod : cdnMod.default;
    }
  } catch (cdnErr) {
    throw new Error(
      `[MediaPipeManager] Failed to load @mediapipe/tasks-vision from npm or CDN: ${cdnErr.message}`
    );
  }

  throw new Error('[MediaPipeManager] Could not resolve FilesetResolver and HandLandmarker.');
}

/**
 * MediaPipeManager
 * Configures and controls MediaPipe HandLandmarker and camera stream.
 */
export class MediaPipeManager {
  /**
   * @param {object} [options]
   * @param {string} [options.wasmLoaderPath] - Path to WASM binaries
   * @param {string} [options.modelAssetPath] - URL or path to hand_landmarker.task
   * @param {'GPU' | 'CPU'} [options.delegate='GPU'] - Compute delegate
   * @param {'VIDEO' | 'IMAGE'} [options.runningMode='VIDEO'] - Vision running mode
   * @param {number} [options.numHands=2] - Maximum hands to detect (allows Target Lock selection)
   * @param {number} [options.minHandDetectionConfidence=0.5]
   * @param {number} [options.minHandPresenceConfidence=0.5]
   * @param {number} [options.minTrackingConfidence=0.5]
   * @param {MediaTrackConstraints} [options.camera] - getUserMedia camera constraints
   * @param {HTMLVideoElement} [options.videoElement] - Optional existing video element
   * @param {object} [options.tasksVision] - Optional preloaded @mediapipe/tasks-vision module
   */
  constructor(options = {}) {
    this.options = {
      wasmLoaderPath: options.wasmLoaderPath || DEFAULT_WASM_PATH,
      modelAssetPath: options.modelAssetPath || DEFAULT_MODEL_PATH,
      delegate: options.delegate || 'GPU',
      runningMode: options.runningMode || 'VIDEO',
      numHands: options.numHands ?? 2,
      minHandDetectionConfidence: options.minHandDetectionConfidence ?? 0.5,
      minHandPresenceConfidence: options.minHandPresenceConfidence ?? 0.5,
      minTrackingConfidence: options.minTrackingConfidence ?? 0.5,
      camera: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
        frameRate: { ideal: 60, max: 60 },
        ...options.camera,
      },
      videoElement: options.videoElement || null,
      tasksVision: options.tasksVision || null,
    };

    /** @type {any} */
    this.handLandmarker = null;
    /** @type {HTMLVideoElement|null} */
    this.video = this.options.videoElement;
    /** @type {MediaStream|null} */
    this.stream = null;
    /** @type {boolean} */
    this.isOwnVideoElement = !options.videoElement;

    // Execution state
    this.isInitialized = false;
    this.isRunning = false;
    this.isPaused = false;
    this._animationFrameId = null;
    this._lastVideoTime = -1;
    this._lastTimestamp = 0;

    // Performance metrics
    this.fps = 0;
    this._frameCount = 0;
    this._lastFpsUpdate = performance.now();

    // Callback listeners for results
    this._resultCallbacks = new Set();
    this._errorCallbacks = new Set();

    // Bound loop function for RAF
    this._loop = this._loop.bind(this);
  }

  /**
   * Initializes Tasks Vision resolver and HandLandmarker model.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized && this.handLandmarker) {
      return;
    }

    try {
      const vision = await loadTasksVision(this.options.tasksVision);
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        this.options.wasmLoaderPath
      );

      const landmarkerOptions = {
        baseOptions: {
          modelAssetPath: this.options.modelAssetPath,
          delegate: this.options.delegate,
        },
        runningMode: this.options.runningMode,
        numHands: this.options.numHands,
        minHandDetectionConfidence: this.options.minHandDetectionConfidence,
        minHandPresenceConfidence: this.options.minHandPresenceConfidence,
        minTrackingConfidence: this.options.minTrackingConfidence,
      };

      try {
        this.handLandmarker = await vision.HandLandmarker.createFromOptions(
          filesetResolver,
          landmarkerOptions
        );
      } catch (gpuError) {
        if (this.options.delegate === 'GPU') {
          console.warn(
            '[MediaPipeManager] GPU delegate failed. Falling back to CPU delegate...',
            gpuError
          );
          landmarkerOptions.baseOptions.delegate = 'CPU';
          this.options.delegate = 'CPU';
          this.handLandmarker = await vision.HandLandmarker.createFromOptions(
            filesetResolver,
            landmarkerOptions
          );
        } else {
          throw gpuError;
        }
      }

      this.isInitialized = true;
    } catch (error) {
      this._emitError(new Error(`[MediaPipeManager] Initialization failed: ${error.message}`));
      throw error;
    }
  }

  /**
   * Sets up camera stream and connects it to the video element.
   *
   * @param {MediaTrackConstraints} [customConstraints]
   * @returns {Promise<HTMLVideoElement>}
   */
  async startCamera(customConstraints) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('[MediaPipeManager] navigator.mediaDevices.getUserMedia is not supported.');
    }

    // Create hidden video element if none was provided
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('muted', '');
      this.video.muted = true;
      this.video.autoplay = true;
      this.video.style.display = 'none';
      document.body.appendChild(this.video);
      this.isOwnVideoElement = true;
    }

    const constraints = {
      video: {
        ...this.options.camera,
        ...customConstraints,
      },
      audio: false,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      await new Promise((resolve, reject) => {
        if (!this.video) return reject(new Error('Video element missing'));

        const onLoaded = () => {
          this.video.removeEventListener('loadeddata', onLoaded);
          resolve();
        };

        if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          resolve();
        } else {
          this.video.addEventListener('loadeddata', onLoaded, { once: true });
        }
      });

      await this.video.play();
      return this.video;
    } catch (error) {
      this._emitError(new Error(`[MediaPipeManager] Camera access failed: ${error.message}`));
      throw error;
    }
  }

  /**
   * Starts detection loop. Initializes engine and camera if not already done.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) return;

    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.stream || !this.video || this.video.paused) {
      await this.startCamera();
    }

    this.isRunning = true;
    this.isPaused = false;
    this._lastVideoTime = -1;
    this._lastTimestamp = 0;
    this._frameCount = 0;
    this._lastFpsUpdate = performance.now();

    this._animationFrameId = requestAnimationFrame(this._loop);
  }

  /**
   * Internal RAF loop for frame detection at up to 60 FPS.
   */
  _loop() {
    if (!this.isRunning) return;

    if (!this.isPaused && this.video && this.handLandmarker) {
      const video = this.video;

      // Ensure video has fresh frame data
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.paused &&
        !video.ended &&
        video.currentTime !== this._lastVideoTime
      ) {
        this._lastVideoTime = video.currentTime;

        // MediaPipe detectForVideo requires strictly increasing timestamps
        let now = performance.now();
        if (now <= this._lastTimestamp) {
          now = this._lastTimestamp + 1;
        }
        this._lastTimestamp = now;

        try {
          const results = this.handLandmarker.detectForVideo(video, now);
          this._updateFps(now);
          this._dispatchResults(results, now, video);
        } catch (detectionError) {
          console.error('[MediaPipeManager] Detection error in loop:', detectionError);
          this._emitError(detectionError);
        }
      }
    }

    this._animationFrameId = requestAnimationFrame(this._loop);
  }

  /**
   * Calculates running FPS metric.
   * @param {number} now
   * @private
   */
  _updateFps(now) {
    this._frameCount++;
    const delta = now - this._lastFpsUpdate;
    if (delta >= 500) {
      this.fps = Math.round((this._frameCount * 1000) / delta);
      this._frameCount = 0;
      this._lastFpsUpdate = now;
    }
  }

  /**
   * Pauses the detection loop without releasing the camera.
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resumes the paused detection loop.
   */
  resume() {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
    }
  }

  /**
   * Stops the detection loop and camera stream.
   */
  stop() {
    this.isRunning = false;
    this.isPaused = false;

    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.srcObject = null;
    }

    this.fps = 0;
  }

  /**
   * Registers a listener callback for detection results.
   * Callback signature: (results: HandLandmarkerResult, timestamp: number, video: HTMLVideoElement) => void
   *
   * @param {Function} callback
   * @returns {() => void} Unsubscribe function
   */
  onResults(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('[MediaPipeManager] Callback must be a function.');
    }
    this._resultCallbacks.add(callback);
    return () => this.offResults(callback);
  }

  /**
   * Unregisters a results listener.
   *
   * @param {Function} callback
   */
  offResults(callback) {
    this._resultCallbacks.delete(callback);
  }

  /**
   * Registers an error callback listener.
   *
   * @param {Function} callback
   * @returns {() => void}
   */
  onError(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('[MediaPipeManager] Error callback must be a function.');
    }
    this._errorCallbacks.add(callback);
    return () => this._errorCallbacks.delete(callback);
  }

  /**
   * Dispatches results to all listeners.
   * @private
   */
  _dispatchResults(results, timestamp, video) {
    if (this._resultCallbacks.size === 0) return;
    for (const callback of this._resultCallbacks) {
      try {
        callback(results, timestamp, video);
      } catch (err) {
        console.error('[MediaPipeManager] Error in onResults listener:', err);
      }
    }
  }

  /**
   * Emits error to registered listeners.
   * @private
   */
  _emitError(error) {
    for (const callback of this._errorCallbacks) {
      try {
        callback(error);
      } catch (err) {
        console.error('[MediaPipeManager] Error in onError listener:', err);
      }
    }
  }

  /**
   * Returns the HTML video element currently being processed.
   * @returns {HTMLVideoElement|null}
   */
  getVideoElement() {
    return this.video;
  }

  /**
   * Complete cleanup of resources, DOM elements, and model memory.
   */
  cleanup() {
    this.stop();
    this._resultCallbacks.clear();
    this._errorCallbacks.clear();

    if (this.handLandmarker && typeof this.handLandmarker.close === 'function') {
      try {
        this.handLandmarker.close();
      } catch {
        // Ignored during disposal
      }
      this.handLandmarker = null;
    }

    if (this.isOwnVideoElement && this.video && this.video.parentNode) {
      this.video.parentNode.removeChild(this.video);
      this.video = null;
    }

    this.isInitialized = false;
  }
}

export default MediaPipeManager;
