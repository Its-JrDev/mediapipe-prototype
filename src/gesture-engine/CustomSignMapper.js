/**
 * @file CustomSignMapper.js
 * @description Mapeo de señas personalizadas estilo try-trackingjs:
 * graba vectores de landmarks (invariantes a posición/tamaño/mano) y
 * reconoce por k-NN con voto ponderado. Permite asignar una seña
 * entrenada por el usuario a una acción (p. ej. abrir el modal).
 */

import gestureEventBus, { GESTURE_EVENTS } from '../events/GestureEventBus.js';

const STORE = 'custom-signs-v1';
const MAP_STORE = 'custom-sign-modal-label';
const SCROLL_UP_STORE = 'custom-sign-scroll-up';
const SCROLL_DOWN_STORE = 'custom-sign-scroll-down';
const THR_STORE = 'custom-sign-threshold';

/**
 * Vector invariante a posición y tamaño (de try-trackingjs).
 * Sin flip por handedness: MediaPipe cambia Left/Right al girar la mano
 * (palma<->dorso) y eso rompía el vector. La invarianza a espejo se logra
 * en predict() comparando contra la muestra y su versión espejada.
 * @param {Array<{x:number,y:number,z?:number}>} lm - 21 landmarks
 * @returns {number[]} vector de 63 números
 */
export function signFeatures(lm) {
  const w = lm[0];
  const dx = lm[9].x - w.x;
  const dy = lm[9].y - w.y;
  const dz = (lm[9].z ?? 0) - (w.z ?? 0);
  const scale = Math.hypot(dx, dy, dz) || 1;
  const v = [];
  for (const p of lm) {
    v.push(
      (p.x - w.x) / scale,
      (p.y - w.y) / scale,
      ((p.z ?? 0) - (w.z ?? 0)) / scale,
    );
  }
  return v;
}

/**
 * Versión espejada en X de un vector de features (layout x,y,z por landmark).
 * Palma <-> dorso es (aprox.) un espejo, así se reconoce por ambos lados.
 * @param {number[]} v
 * @returns {number[]}
 */
export function mirrorX(v) {
  const m = v.slice();
  for (let i = 0; i < m.length; i += 3) m[i] = -m[i];
  return m;
}

/**
 * Distancia euclidiana entre vectores.
 */
export function vecDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export class CustomSignMapper {
  /**
   * @param {object} [options]
   * @param {number} [options.k=5]
   * @param {number} [options.threshold=0.9] - distancia máxima para aceptar
   * @param {number} [options.stableFrames=7] - frames iguales para disparo estable
   * @param {number} [options.cooldownMs=1500]
   * @param {number} [options.sampleEveryMs=80] - throttle de grabación
   */
  constructor(options = {}) {
    this.eventBus = options.eventBus || gestureEventBus;
    this.k = options.k ?? 5;
    this.stableFrames = options.stableFrames ?? 7;
    this.cooldownMs = options.cooldownMs ?? 1500;
    this.sampleEveryMs = options.sampleEveryMs ?? 80;

    this.threshold = this._loadNumber(THR_STORE, options.threshold ?? 0.9);
    // Cache en memoria para el hot path de predicción (20fps)
    this._scrollUpCache = this.getScrollUpLabel();
    this._scrollDownCache = this.getScrollDownLabel();
    /** @type {Record<string, number[][]>} */
    this.samples = this._loadSamples();
    this.recent = [];
    this.recording = null; // { label, until, n }
    this._lastPush = 0;
    this._lastPredictTime = 0;
    this._lastTrigger = 0;
    this._lastSeenOk = 0;
    // Scroll sostenido por pose (seña custom mantenida)
    this._scrollDir = null;
    this._scrollOn = 0;
    this._scrollOff = 0;
    this._scrollActive = false;
    this._scrollActiveDir = null;
    // Lock gestual: el engine lo activa cerca del pinch para que una pose
    // parecida al pinch no dispare la seña custom sin querer
    this._gestureLock = false;
    this._listeners = new Map();
  }

  _loadSamples() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || {};
    } catch {
      return {};
    }
  }

  _loadNumber(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const n = raw == null ? NaN : parseFloat(raw);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.samples));
    } catch {
      // almacenamiento lleno o no disponible: se sigue en memoria
    }
  }

  setThreshold(t) {
    this.threshold = t;
    try {
      localStorage.setItem(THR_STORE, String(t));
    } catch {}
  }

  getLabels() {
    return Object.keys(this.samples).sort();
  }

  countFor(label) {
    return this.samples[label]?.length || 0;
  }

  /** Empieza a grabar muestras para una etiqueta durante `seconds`. */
  startRecording(label, seconds = 2.5) {
    const clean = String(label || '').trim();
    if (!clean) return { ok: false, error: 'Escribe un nombre para la seña' };
    this.recent = [];
    this.recording = { label: clean, until: performance.now() + seconds * 1000, n: 0 };
    return { ok: true };
  }

  getRecordingStatus() {
    if (!this.recording) return null;
    const left = Math.max(0, this.recording.until - performance.now());
    return { ...this.recording, leftMs: Math.round(left) };
  }

  cancelRecording() {
    this.recording = null;
  }

  deleteLabel(label) {
    delete this.samples[label];
    this.save();
    if (this.getModalLabel() === label) this.setModalLabel('');
    if (this.getScrollUpLabel() === label) this.setScrollUpLabel('');
    if (this.getScrollDownLabel() === label) this.setScrollDownLabel('');
  }

  clearAll() {
    this.samples = {};
    this.recent = [];
    this.save();
    this.setModalLabel('');
    this.setScrollUpLabel('');
    this.setScrollDownLabel('');
    this._releaseHeldScroll();
  }

  getModalLabel() {
    try {
      return localStorage.getItem(MAP_STORE) || '';
    } catch {
      return '';
    }
  }

  setModalLabel(label) {
    try {
      localStorage.setItem(MAP_STORE, label || '');
    } catch {}
  }

  getScrollUpLabel() {
    try {
      return localStorage.getItem(SCROLL_UP_STORE) || '';
    } catch {
      return '';
    }
  }

  setScrollUpLabel(label) {
    this._scrollUpCache = label || '';
    try {
      localStorage.setItem(SCROLL_UP_STORE, label || '');
    } catch {}
  }

  getScrollDownLabel() {
    try {
      return localStorage.getItem(SCROLL_DOWN_STORE) || '';
    } catch {
      return '';
    }
  }

  setScrollDownLabel(label) {
    this._scrollDownCache = label || '';
    try {
      localStorage.setItem(SCROLL_DOWN_STORE, label || '');
    } catch {}
  }

  /** El engine avisa cuando la mano está en/cerca del pinch: congela predicción custom. */
  setGesturalLock(locked) {
    this._gestureLock = Boolean(locked);
  }

  /** Scroll sostenido por pose activo: el engine lo usa para inhibir el pinch (una sola acción). */
  isScrollHeld() {
    return this._scrollActive === true;
  }

  /**
   * k-NN con voto ponderado 1/(d+eps), invariante a espejo: compara contra
   * la muestra y su espejo para reconocer palma y dorso. Devuelve etiqueta o null.
   */
  predict(v) {
    const mv = mirrorX(v);
    const all = [];
    for (const [label, arr] of Object.entries(this.samples)) {
      for (const s of arr) all.push([Math.min(vecDist(v, s), vecDist(mv, s)), label]);
    }
    if (!all.length) return null;
    all.sort((a, b) => a[0] - b[0]);
    const top = all.slice(0, this.k);
    if (top[0][0] > this.threshold) return null;
    const votes = {};
    for (const [d, l] of top) votes[l] = (votes[l] || 0) + 1 / (d + 1e-6);
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * Procesa la mano trackeada: graba si hay recording activo,
   * si no predice y emite 'gesture:custom' cuando la etiqueta es estable.
   * @param {object|null} trackedHand
   * @param {number} [timestamp]
   */
  process(trackedHand, timestamp = performance.now()) {
    if (!trackedHand || !trackedHand.landmarks || trackedHand.landmarks.length < 21) {
      // Tolerancia a micro-cortes (giro a dorso): <250ms conserva recent y held
      if (timestamp - this._lastSeenOk < 250) return;
      this.recent = [];
      this._releaseHeldScroll();
      this._scrollDir = null;
      this._scrollOn = 0;
      this._scrollOff = 0;
      return;
    }
    this._lastSeenOk = timestamp;
    // Sin handedness: el vector es invariante a espejo (palma/dorso, izq/der).
    const v = signFeatures(trackedHand.landmarks);

    if (this.recording) {
      if (timestamp < this.recording.until) {
        if (timestamp - this._lastPush >= this.sampleEveryMs) {
          (this.samples[this.recording.label] ||= []).push(v);
          this.recording.n++;
          this._lastPush = timestamp;
        }
      } else {
        this.save();
        this._emitLocal('record-done', { ...this.recording });
        this.recording = null;
        this._lastPush = 0;
      }
      return;
    }

    if (!this.getLabels().length) {
      this._releaseHeldScroll();
      return;
    }
    // Lock gestual (cerca del pinch): ni one-shot ni scroll sostenido,
    // para que poses parecidas no disparen el modal sin querer.
    if (this._gestureLock) {
      this.recent = [];
      this._releaseHeldScroll();
      this._scrollDir = null;
      this._scrollOn = 0;
      this._scrollOff = 0;
      return;
    }
    // Throttle: k-NN sobre todas las muestras cada frame bloquea el hilo;
    // 20fps bastan (7 frames estables ≈ 350ms para disparo).
    if (timestamp - this._lastPredictTime < 50) return;
    this._lastPredictTime = timestamp;
    const label = this.predict(v);
    this._updateHeldScroll(this._scrollDirectionFor(label));
    this.recent.push(label);
    if (this.recent.length > this.stableFrames) this.recent.shift();
    if (this.recent.length < this.stableFrames) return;
    const first = this.recent[0];
    if (first == null) {
      return;
    }
    const stable = this.recent.every((r) => r === first);
    if (stable && timestamp - this._lastTrigger >= this.cooldownMs) {
      this._lastTrigger = timestamp;
      this.recent = [];
      const payload = { label: first, timestamp };
      if (this.eventBus && typeof this.eventBus.emit === 'function') {
        this.eventBus.emit(GESTURE_EVENTS.GESTURE_CUSTOM || 'gesture:custom', payload);
      }
      this._emitLocal('custom', payload);
    }
  }

  /**
   * Dirección de scroll mapeada para una etiqueta ('UP' | 'DOWN' | null).
   */
  _scrollDirectionFor(label) {
    if (!label) return null;
    if (this._scrollUpCache && label === this._scrollUpCache) return 'UP';
    if (this._scrollDownCache && label === this._scrollDownCache) return 'DOWN';
    return null;
  }

  /**
   * Scroll sostenido: la pose mapeada debe mantenerse 3 ticks (≈150ms) para
   * activar y 3 ticks distintos para soltar. Emite 'gesture:custom-scroll'.
   */
  _updateHeldScroll(dir) {
    if (!this._scrollActive) {
      if (dir) {
        if (dir === this._scrollDir) this._scrollOn++;
        else {
          this._scrollDir = dir;
          this._scrollOn = 1;
        }
        if (this._scrollOn >= 3) {
          this._scrollActive = true;
          this._scrollActiveDir = dir;
          this._scrollOff = 0;
          this._emitScroll(dir, true);
        }
      } else {
        this._scrollDir = null;
        this._scrollOn = 0;
      }
      return;
    }
    if (dir === this._scrollActiveDir) {
      this._scrollOff = 0;
      return;
    }
    this._scrollOff++;
    if (this._scrollOff >= 3) {
      this._releaseHeldScroll();
      this._scrollDir = dir;
      this._scrollOn = dir ? 1 : 0;
    }
  }

  _releaseHeldScroll() {
    if (this._scrollActive) {
      this._scrollActive = false;
      this._emitScroll(this._scrollActiveDir, false);
      this._scrollActiveDir = null;
    }
    this._scrollOff = 0;
  }

  _emitScroll(direction, active) {
    if (!direction) return;
    const payload = { direction, active };
    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      this.eventBus.emit(GESTURE_EVENTS.GESTURE_CUSTOM_SCROLL || 'gesture:custom-scroll', payload);
    }
    this._emitLocal('custom-scroll', payload);
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  _emitLocal(event, payload) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(payload);
        } catch (err) {
          console.error(`[CustomSignMapper] listener "${event}":`, err);
        }
      }
    }
  }
}

/** Singleton para uso en UI y engine. */
export const customSignMapper = new CustomSignMapper({});

export default customSignMapper;
