/**
 * @typedef {'LEFT' | 'RIGHT' | 'UP' | 'DOWN'} SwipeDirection
 *
 * @typedef {Object} GestureEventMap
 * @property {{ x: number, y: number, rawX: number, rawY: number }} 'hand:move' - Coordenadas de la mano activa
 * @property {{ active: boolean, x: number, y: number }} 'gesture:pinch' - Gesto de pinza
 * @property {{ active: boolean }} 'gesture:fist' - Gesto de puño cerrado
 * @property {{ active: boolean }} 'gesture:open' - Gesto de mano abierta
 * @property {{ direction: SwipeDirection, velocity: number }} 'gesture:swipe' - Deslizamiento rápido
 * @property {{ deltaY: number }} 'ui:scroll' - Desplazamiento vertical
 * @property {void} 'ui:toggle-modal' - Alternar visibilidad de modal
 * @property {void} 'ui:toggle-aside' - Alternar visibilidad del panel lateral
 * @property {{ percentage: number }} 'ui:slider-move' - Posición del comparador antes/después
 */

/**
 * Driver de Simulación de Gestos para desarrollo y fallback sin cámara web.
 * Escucha eventos del teclado y ratón para emitir eventos estandarizados
 * al bus central (GestureEventBus).
 *
 * Mapeo predeterminado de teclas:
 * - W / S: ui:scroll (Scroll Up / Scroll Down)
 * - M: ui:toggle-modal
 * - H: ui:toggle-aside
 * - ArrowLeft / ArrowRight: ui:slider-move (Slider Antes/Después)
 * - Click / Mousedown / Mouseup: gesture:pinch
 * - Mouse Move: hand:move (seguimiento del cursor)
 */
import { gestureEventBus } from '../events/GestureEventBus.js';

export class MockGestureDriver {
  /**
   * @param {Object|null} [eventBus=null] - Instancia de bus de eventos (mitt, EventTarget o similar). Si no se pasa, utiliza el singleton gestureEventBus.
   * @param {Object} [options={}] - Configuración del driver.
   * @param {EventTarget} [options.target] - Elemento al que adjuntar los listeners (default: window).
   * @param {number} [options.scrollDelta=100] - Cantidad de desplazamiento por pulsación de W/S.
   * @param {number} [options.sliderStep=5] - Incremento porcentual por pulsación de flecha.
   * @param {number} [options.initialSliderPercentage=50] - Porcentaje inicial del slider (0-100).
   * @param {boolean} [options.enableMouseMove=true] - Emite hand:move al mover el ratón.
   * @param {boolean} [options.autoStart=true] - Iniciar escucha automáticamente si el entorno lo permite.
   */
  constructor(eventBus = null, options = {}) {
    // Permitir pasar options como primer argumento si no se suministra un bus con métodos
    if (
      eventBus &&
      typeof eventBus === 'object' &&
      !eventBus.emit &&
      !eventBus.dispatchEvent &&
      !eventBus.on &&
      !eventBus.addEventListener
    ) {
      options = eventBus;
      eventBus = null;
    }

    this.eventBus = eventBus || gestureEventBus || null;

    const isBrowser = typeof window !== 'undefined';

    this.options = {
      target: isBrowser ? window : null,
      scrollDelta: 100,
      sliderStep: 5,
      initialSliderPercentage: 50,
      enableMouseMove: true,
      autoStart: true,
      ...options,
    };

    /** @type {number} */
    this.sliderPercentage = Math.max(
      0,
      Math.min(100, this.options.initialSliderPercentage)
    );

    /** @type {boolean} */
    this.isListening = false;

    /** @type {boolean} */
    this.isPinching = false;

    /** @type {number} */
    this.mouseX = 0.5;

    /** @type {number} */
    this.mouseY = 0.5;

    /** @type {number} */
    this.rawX = 0;

    /** @type {number} */
    this.rawY = 0;

    /** @type {number} */
    this._lastPinchTimestamp = 0;

    // Vinculación de manejadores de eventos
    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handleMouseDown = this._handleMouseDown.bind(this);
    this._handleMouseUp = this._handleMouseUp.bind(this);
    this._handleClick = this._handleClick.bind(this);

    if (this.options.autoStart && (isBrowser || this.options.target)) {
      this.start();
    }
  }

  /**
   * Asigna o actualiza la instancia del bus de eventos central.
   * @param {Object} eventBus
   */
  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Inicia la captura de eventos de teclado y ratón.
   * @param {Object} [eventBus] - Opcionalmente configura el bus de eventos al iniciar.
   */
  start(eventBus) {
    if (eventBus) {
      this.setEventBus(eventBus);
    }

    if (this.isListening) {
      return;
    }

    const target = this.options.target || (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.addEventListener !== 'function') {
      return;
    }

    target.addEventListener('keydown', this._handleKeyDown, { passive: false });
    target.addEventListener('mousemove', this._handleMouseMove, { passive: true });
    target.addEventListener('mousedown', this._handleMouseDown, { passive: true });
    target.addEventListener('mouseup', this._handleMouseUp, { passive: true });
    target.addEventListener('click', this._handleClick, { passive: true });

    this.isListening = true;
  }

  /**
   * Detiene la captura de eventos y remueve los listeners.
   */
  stop() {
    if (!this.isListening) {
      return;
    }

    const target = this.options.target || (typeof window !== 'undefined' ? window : null);
    if (target && typeof target.removeEventListener === 'function') {
      target.removeEventListener('keydown', this._handleKeyDown);
      target.removeEventListener('mousemove', this._handleMouseMove);
      target.removeEventListener('mousedown', this._handleMouseDown);
      target.removeEventListener('mouseup', this._handleMouseUp);
      target.removeEventListener('click', this._handleClick);
    }

    this.isListening = false;
    this.isPinching = false;
  }

  /**
   * Alias de stop para liberar recursos.
   */
  destroy() {
    this.stop();
    this.eventBus = null;
  }

  /**
   * Emite un evento al bus de eventos configurado respetando el contrato de la arquitectura.
   * @param {string} event - Nombre del evento (e.g. 'ui:scroll', 'gesture:pinch').
   * @param {any} [payload] - Datos del evento según el contrato GestureEventMap.
   */
  emit(event, payload) {
    // Si no hay bus asignado directamente, intentar resolver desde el entorno global
    let bus = this.eventBus;
    if (!bus && typeof window !== 'undefined' && window.gestureEventBus) {
      bus = window.gestureEventBus;
      this.eventBus = bus;
    }

    if (bus) {
      // 1. Soporte para interfaz mitt / EventEmitter (método emit)
      if (typeof bus.emit === 'function') {
        bus.emit(event, payload);
        return;
      }

      // 2. Soporte para EventTarget (método dispatchEvent)
      if (typeof bus.dispatchEvent === 'function') {
        bus.dispatchEvent(new CustomEvent(event, { detail: payload }));
        return;
      }

      // 3. Soporte para interfaz publish / trigger
      if (typeof bus.publish === 'function') {
        bus.publish(event, payload);
        return;
      }

      if (typeof bus.trigger === 'function') {
        bus.trigger(event, payload);
        return;
      }

      // 4. Soporte para bus como función callback
      if (typeof bus === 'function') {
        bus(event, payload);
        return;
      }
    }

    // Fallback: Despachar CustomEvent en window si no hay bus explícito
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent(event, { detail: payload }));
      } catch {
        // Silenciar errores en entornos donde window no es un EventTarget completo
      }
    }
  }

  /**
   * Determina si el evento ocurrió sobre un elemento editable de formulario.
   * @private
   * @param {EventTarget|null} target
   * @returns {boolean}
   */
  _isEditableTarget(target) {
    if (!target || typeof target !== 'object') {
      return false;
    }
    const element = /** @type {HTMLElement} */ (target);
    const tagName = element.tagName ? element.tagName.toUpperCase() : '';
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      Boolean(element.isContentEditable)
    );
  }

  /**
   * Actualiza las coordenadas internas del ratón normalizadas a [0, 1].
   * @private
   * @param {MouseEvent} e
   */
  _updateMouseCoordinates(e) {
    this.rawX = e.clientX ?? 0;
    this.rawY = e.clientY ?? 0;

    let width = 1;
    let height = 1;

    if (this.options.target && typeof this.options.target.innerWidth === 'number' && this.options.target.innerWidth > 0) {
      width = this.options.target.innerWidth;
      height = this.options.target.innerHeight || width;
    } else if (typeof window !== 'undefined' && window.innerWidth > 0) {
      width = window.innerWidth;
      height = window.innerHeight || 1;
    }

    this.mouseX = Math.max(0, Math.min(1, this.rawX / width));
    this.mouseY = Math.max(0, Math.min(1, this.rawY / height));
  }

  /**
   * Manejador de eventos de teclado.
   * @private
   * @param {KeyboardEvent} e
   */
  _handleKeyDown(e) {
    if (this._isEditableTarget(e.target)) {
      return;
    }

    const key = e.key ? e.key.toLowerCase() : '';
    const code = e.code || '';

    // Tecla W: Scroll Up
    if (key === 'w' || code === 'KeyW') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      this.triggerScroll(-this.options.scrollDelta);
      return;
    }

    // Tecla S: Scroll Down
    if (key === 's' || code === 'KeyS') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      this.triggerScroll(this.options.scrollDelta);
      return;
    }

    // Tecla M: Toggle Modal
    if (key === 'm' || code === 'KeyM') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      this.triggerToggleModal();
      return;
    }

    // Tecla H: Toggle Aside (History)
    if (key === 'h' || code === 'KeyH') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      this.triggerToggleAside();
      return;
    }

    // Flecha Izquierda: Decrementar slider Antes/Después
    if (key === 'arrowleft' || code === 'ArrowLeft') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const nextPercentage = Math.max(0, this.sliderPercentage - this.options.sliderStep);
      this.triggerSliderMove(nextPercentage);
      return;
    }

    // Flecha Derecha: Incrementar slider Antes/Después
    if (key === 'arrowright' || code === 'ArrowRight') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const nextPercentage = Math.min(100, this.sliderPercentage + this.options.sliderStep);
      this.triggerSliderMove(nextPercentage);
      return;
    }
  }

  /**
   * Manejador del movimiento del ratón.
   * Emite 'hand:move' con coordenadas normalizadas y crudas.
   * @private
   * @param {MouseEvent} e
   */
  _handleMouseMove(e) {
    this._updateMouseCoordinates(e);

    if (this.options.enableMouseMove) {
      this.triggerHandMove(this.mouseX, this.mouseY, this.rawX, this.rawY);
    }
  }

  /**
   * Manejador de mousedown: activa el estado de pinza (pinch).
   * @private
   * @param {MouseEvent} e
   */
  _handleMouseDown(e) {
    if (e.button !== undefined && e.button !== 0) {
      return; // Solo botón izquierdo principal
    }
    this._updateMouseCoordinates(e);
    this.isPinching = true;
    this._lastPinchTimestamp = Date.now();
    this.triggerPinch(true, this.mouseX, this.mouseY);
  }

  /**
   * Manejador de mouseup: desactiva el estado de pinza (pinch).
   * @private
   * @param {MouseEvent} e
   */
  _handleMouseUp(e) {
    if (this.isPinching) {
      this._updateMouseCoordinates(e);
      this.isPinching = false;
      this._lastPinchTimestamp = Date.now();
      this.triggerPinch(false, this.mouseX, this.mouseY);
    }
  }

  /**
   * Manejador de click complementario para clics sintéticos o programmaticos.
   * @private
   * @param {MouseEvent} e
   */
  _handleClick(e) {
    // Si mousedown/mouseup ya emitieron la pinza recientemente (últimos 250ms), evitar duplicación
    const timeSinceLastPinch = Date.now() - this._lastPinchTimestamp;
    if (timeSinceLastPinch < 250) {
      return;
    }

    this._updateMouseCoordinates(e);
    this.pulsePinch(this.mouseX, this.mouseY, 150);
  }

  // ==========================================
  // Métodos de Disparo (Trigger API)
  // ==========================================

  /**
   * Emite evento de scroll.
   * @param {number} deltaY - Desplazamiento en píxeles (negativo: arriba, positivo: abajo).
   */
  triggerScroll(deltaY) {
    this.emit('ui:scroll', { deltaY });
  }

  /**
   * Emite evento para alternar el modal.
   */
  triggerToggleModal() {
    this.emit('ui:toggle-modal');
  }

  /**
   * Emite evento para alternar el aside lateral.
   */
  triggerToggleAside() {
    this.emit('ui:toggle-aside');
  }

  /**
   * Actualiza el valor del slider y emite el evento 'ui:slider-move'.
   * @param {number} percentage - Valor porcentual entre 0 y 100.
   */
  triggerSliderMove(percentage) {
    this.sliderPercentage = Math.max(0, Math.min(100, Math.round(percentage * 100) / 100));
    this.emit('ui:slider-move', { percentage: this.sliderPercentage });
  }

  /**
   * Emite evento de pinza (pinch).
   * @param {boolean} active - Estado activo o inactivo del gesto.
   * @param {number} [x=this.mouseX] - Coordenada X normalizada [0, 1].
   * @param {number} [y=this.mouseY] - Coordenada Y normalizada [0, 1].
   */
  triggerPinch(active, x = this.mouseX, y = this.mouseY) {
    this.emit('gesture:pinch', {
      active,
      x,
      y,
    });
  }

  /**
   * Dispara una pulsación momentánea de pinza (active: true -> active: false tras durationMs).
   * @param {number} [x=this.mouseX]
   * @param {number} [y=this.mouseY]
   * @param {number} [durationMs=150]
   */
  pulsePinch(x = this.mouseX, y = this.mouseY, durationMs = 150) {
    this.triggerPinch(true, x, y);
    setTimeout(() => {
      this.triggerPinch(false, x, y);
    }, durationMs);
  }

  /**
   * Emite evento de movimiento de mano / cursor.
   * @param {number} x - Coordenada X normalizada [0, 1].
   * @param {number} y - Coordenada Y normalizada [0, 1].
   * @param {number} [rawX=this.rawX] - Coordenada X de pantalla en píxeles.
   * @param {number} [rawY=this.rawY] - Coordenada Y de pantalla en píxeles.
   */
  triggerHandMove(x, y, rawX = this.rawX, rawY = this.rawY) {
    this.emit('hand:move', {
      x,
      y,
      rawX,
      rawY,
    });
  }

  /**
   * Emite evento de deslizamiento (swipe).
   * @param {SwipeDirection} direction - Dirección ('LEFT', 'RIGHT', 'UP', 'DOWN').
   * @param {number} [velocity=1.0] - Velocidad estimada del swipe.
   */
  triggerSwipe(direction, velocity = 1.0) {
    this.emit('gesture:swipe', {
      direction,
      velocity,
    });
  }

  /**
   * Emite evento de gesto de puño.
   * @param {boolean} active
   */
  triggerFist(active) {
    this.emit('gesture:fist', { active });
  }

  /**
   * Emite evento de mano abierta.
   * @param {boolean} active
   */
  triggerOpen(active) {
    this.emit('gesture:open', { active });
  }

  /**
   * Obtiene el porcentaje actual del slider.
   * @returns {number}
   */
  getSliderPercentage() {
    return this.sliderPercentage;
  }

  /**
   * Asigna un valor directo al slider.
   * @param {number} percentage
   * @param {boolean} [emitEvent=true]
   */
  setSliderPercentage(percentage, emitEvent = true) {
    this.sliderPercentage = Math.max(0, Math.min(100, percentage));
    if (emitEvent) {
      this.emit('ui:slider-move', { percentage: this.sliderPercentage });
    }
  }
}

export default MockGestureDriver;
