# Plan de Ejecución Ultra-Intensivo (1 Día / 24 Horas) — Prototipo por Gestos (MediaPipe)

Este plan de desarrollo está diseñado para **ejecución acelerada con Agentes de IA**. Divide el proyecto en 4 módulos independientes con contratos de interfaz claros para que los agentes puedan trabajar en paralelo.

---

## 1. Arquitectura de Módulos (Distribución para Agentes)

```
                       [ Agent 1: Engine ]
                    MediaPipe + Target Lock + Filters
                                  │
                                  ▼
[ Agent 4: Bus ] ──►   GestureEventBus (Pub/Sub)   ◄── [ Agent 2: Driver ]
                                  │                     Keyboard/Mouse Mock
                                  ▼
                       [ Agent 3: UI Components ]
                     Slider, Aside, Modal, Cursor
```

---

## 2. Asignación de Tareas por Agente

### 🤖 Agente 1: Engine de Visión y Reconocimiento de Gestos
* **Responsabilidad:** Configurar MediaPipe Tasks Vision, captura de webcam, detección de mano principal y filtro de suavizado.
* **Entregables:**
  1. `src/gesture-engine/MediaPipeManager.js`: Loop de detección a 60 FPS (o máximo de cámara).
  2. `src/gesture-engine/HandTracker.js`: 
     * **Target Lock:** Bounding Box de mayor área para la primera detección, tracking por distancia euclidiana mínima en frames consecutivos.
     * **Filter:** Implementación del algoritmo **1€ Filter** para suavizar $(X, Y)$.
  3. `src/gesture-engine/GestureInterpreter.js`:
     * Distancia euclidiana entre landmarks `4` (pulgar) y `8` (índice) $< 0.05 \implies$ `PINCH_START` / `PINCH_END`.
     * Distancia de puntas a base $0 \implies$ `OPEN_HAND` / `CLOSED_FIST`.
     * Delta en eje $X$ sobre tiempo $\implies$ `SWIPE_LEFT` / `SWIPE_RIGHT`.

### 🤖 Agente 2: Driver de Simulación (Dev / Fallback)
* **Responsabilidad:** Permitir probar toda la interfaz sin encender la cámara web.
* **Entregables:**
  1. `src/gesture-engine/MockGestureDriver.js`:
     * Escucha eventos del teclado y emite al bus de eventos central (`GestureEventBus`).
     * Teclas:
       * `W` / `S` $\to$ Scroll Up / Down.
       * `M` $\to$ Toggle Modal.
       * `H` $\to$ Toggle Aside (History).
       * `ArrowLeft` / `ArrowRight` $\to$ Mover slider Antes/Después.
       * `Click` de Mouse $\to$ Emular Pinch/Click de gesto.

### 🤖 Agente 3: Componentes de UI Cinematográfica
* **Responsabilidad:** Maquetación interactiva y animaciones asociadas a los eventos de gestos.
* **Entregables:**
  1. `src/components/GestureCursor.jsx`: Cursor virtual que sigue las coordenadas $(X_{smooth}, Y_{smooth})$ con un anillo de progreso (dwell indicator).
  2. `src/components/BeforeAfterSlider.jsx`: Comparador de imágenes donde la posición del divisor $X\%$ es controlada por el índice.
  3. `src/components/HistoryAside.jsx`: Panel lateral (Drawer) que abre/cierra al recibir eventos de `SWIPE`.
  4. `src/components/ModalNavbar.jsx`: Overlay interactivo con animación suave (GSAP o CSS Transitions).

### 🤖 Agente 4: Bus de Eventos Central y Orquestación
* **Responsabilidad:** Integrar todos los módulos y gestionar el estado global.
* **Entregables:**
  1. `src/events/GestureEventBus.js`: Event Emitter ligero (usando `EventTarget` o `mitt`).
  2. `src/App.jsx`: Carga condicional según variables de entorno (`import.meta.env.VITE_SIMULATE_GESTURES`).

---

## 3. Contrato de Interfaz de Eventos (Event Bus API)

Todos los agentes deben ajustarse a la siguiente especificación de eventos:

```typescript
type GestureEventMap = {
  // Coordenadas suavizadas de la mano activa
  'hand:move': { x: number; y: number; rawX: number; rawY: number };

  // Gestos discretos (Triggers)
  'gesture:pinch': { active: boolean; x: number; y: number };
  'gesture:fist': { active: boolean };
  'gesture:open': { active: boolean };
  'gesture:swipe': { direction: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'; velocity: number };

  // Acciones UI derivadas
  'ui:scroll': { deltaY: number };
  'ui:toggle-modal': void;
  'ui:toggle-aside': void;
  'ui:slider-move': { percentage: number };
};
```

---

## 4. Matriz de Ejecución de 24 Horas

```
[00:00 - 02:00]  Configuración inicial de Vite + Estructura de carpetas + Variables .env
[02:00 - 06:00]  PARALELO:
                 ├── Agente 1: Detección MediaPipe + Target Lock + 1€ Filter
                 ├── Agente 2: MockDriver por Teclado
                 └── Agente 3: Componentes UI (Slider, Aside, Modal)
[06:00 - 08:00]  Agente 4: Conexión de EventBus con Componentes UI usando MockDriver
[08:00 - 10:00]  Integración de Agente 1 (MediaPipe real) con EventBus
[10:00 - 12:00]  Calibración de umbrales (Threshholds de Pinch, Swipe y Deadzones)
[12:00 - 14:00]  Pruebas de estrés (múltiples manos, poca iluminación) + Pulido de CSS/Animaciones
```

---

## 5. Prompts Recomendados para tus Agentes de IA

### Prompt para Agente 1 (Engine MediaPipe):
> *"Crea una clase `HandTracker` en JS/TS usando `@mediapipe/tasks-vision`. Debe inicializar la cámara web, detectar manos y aplicar el algoritmo Target Lock para seguir solo la mano con mayor área o menor distancia euclidiana entre frames. Aplica un filtro de suavizado 1€ Filter a las coordenadas X e Y. Emite los eventos `hand:move`, `gesture:pinch` (cuando la distancia entre landmarks 4 y 8 sea menor a 0.05) y `gesture:swipe`."*

### Prompt para Agente 3 (UI Components):
> *"Crea una colección de componentes en React + Tailwind CSS: `BeforeAfterSlider`, `HistoryAside` y `GestureCursor`. Deben reaccionar a un bus de eventos de gestos (`GestureEventBus`). Muestra un cursor circular flotante que siga las coordenadas `{x, y}` pasadas por el evento `hand:move`."*