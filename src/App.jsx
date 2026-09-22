import React, { useEffect, useState, useRef } from 'react';
import GestureCursor from './components/GestureCursor';
import HistoryAside from './components/HistoryAside';
import ModalNavbar from './components/ModalNavbar';
import GestureEngine from './gesture-engine/index.js';
import { customSignMapper } from './gesture-engine/index.js';
import MockGestureDriver from './gesture-engine/MockGestureDriver.js';
import gestureEventBus from './events/GestureEventBus.js';
import ScrollEdgeZones from './components/ScrollEdgeZones';
import { HomePage, StudioPage, InfoPage, APP_PAGES } from './pages/index.jsx';
import './App.css';

// A component to display the webcam feed and MediaPipe landmarks for debugging
function DebugWebcamOverlay({ engineRef, isVisible }) {
  const canvasRef = useRef(null);
  const fpsRef = useRef({ frames: 0, fps: 0, lastT: 0 });

  useEffect(() => {
    if (!isVisible || !engineRef.current || !engineRef.current.mediaPipeManager) return;

    let unsubscribe = engineRef.current.mediaPipeManager.onResults((results, timestamp, video) => {
      const f = fpsRef.current;
      f.frames++;
      const now = performance.now();
      if (!f.lastT) f.lastT = now;
      if (now - f.lastT >= 1000) {
        f.fps = f.frames;
        f.frames = 0;
        f.lastT = now;
      }
      const canvas = canvasRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Match canvas size to video aspect ratio
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw video frame (mirrored to match user interaction)
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Draw landmarks
      if (results.landmarks && results.landmarks.length > 0) {
        for (const hand of results.landmarks) {
          ctx.fillStyle = '#10B981'; // Emerald 500
          for (let i = 0; i < hand.length; i++) {
            const point = hand[i];
            ctx.beginPath();
            // Puntos especiales para los dedos índices y pulgares en fucsia
            if (i === 8 || i === 4) {
              ctx.fillStyle = '#D946EF'; // Fuchsia 500
              ctx.arc(point.x * canvas.width, point.y * canvas.height, 6, 0, 2 * Math.PI);
            } else {
              ctx.fillStyle = '#10B981';
              ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, 2 * Math.PI);
            }
            ctx.fill();
          }
        }
      }
      ctx.restore();

      // Render gesture telemetry HUD directly on the canvas preview
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(8, 8, 190, 94);
      ctx.fillStyle = '#f472b6';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`FPS: ${fpsRef.current.fps}`, 14, 22);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`SWIPE: ${window.__lastSwipe || 'NONE'}`, 14, 38);
      ctx.fillStyle = window.__lastFlip ? '#a855f7' : '#94a3b8';
      ctx.fillText(`FLIP: ${window.__lastFlip || 'OFF'}`, 14, 54);
      ctx.fillStyle = '#34d399';
      ctx.fillText(`STATUS: ${window.__lastGestureState || 'TRACKING'}`, 14, 70);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`POS: ${window.__lastHandPos || 'WAITING'}`, 14, 86);
      ctx.restore();
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isVisible, engineRef]);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 w-64 bg-zinc-950 p-2 rounded-xl border border-zinc-700 shadow-2xl z-40 pointer-events-none">
      <div className="flex justify-between items-center mb-2 px-1">
        <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">Dev Mode</p>
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
      </div>
      <canvas 
        ref={canvasRef} 
        className="w-full h-auto rounded-lg bg-zinc-900 object-cover" 
      />
    </div>
  );
}

function App() {
  const [engineState, setEngineState] = useState('initializing');
  // Refs del indicador de scroll: mutación directa del DOM, sin re-renders
  const barRef = useRef(null);
  const pctRef = useRef(null);
  const sideRef = useRef(null);
  const [isScrollActive, setIsScrollActive] = useState(false);
  const [edgeZone, setEdgeZone] = useState('NONE');
  const [gestureMode, setGestureMode] = useState('TRACKING');
  const [page, setPage] = useState(APP_PAGES.HOME);
  const [handCoords, setHandCoords] = useState({ x: 50, y: 50 });
  const engineRef = useRef(null);
  const driverRef = useRef(null);
  const isDev = import.meta.env.DEV; // Para mostrar la cámara de debug sólo en desarrollo

  // 1. Indicador de scroll nativo: pinta por ref a ritmo de frame,
  // sin setState (un setState por scroll event re-renderizaba todo el App a 60-120Hz = tirones)
  useEffect(() => {
    let ticking = false;
    const paint = () => {
      ticking = false;
      const scrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const pct = maxScroll > 0 ? (scrollY / maxScroll) * 100 : 0;
      if (barRef.current) barRef.current.style.width = `${pct}%`;
      if (pctRef.current) pctRef.current.textContent = `${Math.round(pct)}%`;
      if (sideRef.current) sideRef.current.style.height = `${Math.max(6, pct)}%`;
    };
    const handleScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(paint);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const simulateGestures = import.meta.env.VITE_SIMULATE_GESTURES === 'true';

    async function initSystem() {
      try {
        if (simulateGestures) {
          console.log("Starting Mock Gesture Driver...");
          driverRef.current = new MockGestureDriver(gestureEventBus);
          driverRef.current.start();
          if (isMounted) setEngineState('ready');
        } else {
          console.log("Initializing MediaPipe Gesture Engine...");
          engineRef.current = new GestureEngine({
            eventBus: gestureEventBus,
            mediaPipeOptions: {
              // Confianzas bajas para no perder la mano al girar a dorso
              minTrackingConfidence: 0.3,
              minHandPresenceConfidence: 0.4,
            },
            interpreterOptions: {
              pinchThreshold: 0.065,
              pinchReleaseThreshold: 0.085,
              fistDebounceFrames: 5,          // Exige 5 frames seguidos de puño cerrado total
              minSwipeDistance: 0.06,         // Gesto más corto para swipe fácil
              minSwipeVelocity: 0.28,         // Velocidad accesible para swipe vertical
              swipeCooldownMs: 380,           // Cooldown ágil
              swipeWindowMs: 250,
            }
          });
          await engineRef.current.initialize();
          if (isMounted) {
            await engineRef.current.start();
            setEngineState('ready');
          }
        }
      } catch (err) {
        console.error("Failed to initialize engine:", err);
        if (isMounted) setEngineState('error');
      }
    }

    initSystem();

    return () => {
      isMounted = false;
      if (driverRef.current && typeof driverRef.current.stop === 'function') driverRef.current.stop();
      if (engineRef.current) engineRef.current.cleanup();
    };
  }, []);

  // Mapeo de gestos a acciones de la UI (modos exclusivos, sin solapamiento)
  useEffect(() => {
    // Avance por frame sobre el scroll del navegador: pasos instantáneos
    // (behavior:'auto') a ritmo de display con dt normalizado. El scroll
    // sigue siendo el del navegador; el avance por frame da velocidad
    // constante sin los pulsos del easing encadenado (eso eran los tirones).
    const SCROLL_PX_PER_FRAME = 25; // ≈1500px/s a 60Hz
    let scrollRaf = 0;
    let scrollDir = null; // 'UP' | 'DOWN' | null
    let scrollLast = 0;
    let currentZone = 'NONE';
    let currentMode = 'TRACKING';
    let customScrollDir = null; // 'UP' | 'DOWN' | null (scroll por pose, no por borde)

    const frameScroll = (t) => {
      scrollRaf = 0;
      if (!scrollDir) {
        scrollLast = 0;
        return;
      }
      if (!scrollLast) scrollLast = t;
      const dtn = Math.min(32, t - scrollLast) / 16.67;
      scrollLast = t;
      const delta = (scrollDir === 'UP' ? -SCROLL_PX_PER_FRAME : SCROLL_PX_PER_FRAME) * dtn;
      if (delta !== 0) window.scrollBy({ top: delta, behavior: 'auto' });
      scrollRaf = requestAnimationFrame(frameScroll);
    };
    const startNativeScroll = (dir) => {
      if (scrollDir === dir && scrollRaf) return; // idempotente
      scrollDir = dir;
      scrollLast = 0;
      if (!scrollRaf) scrollRaf = requestAnimationFrame(frameScroll);
    };
    const stopNativeScroll = () => {
      // Sin animación en vuelo no hay sobreimpulso: el loop termina solo.
      scrollDir = null;
      scrollLast = 0;
    };

    const startEdgeRepeat = (zone) => {
      currentZone = zone;
      if (zone === 'NONE') return;
      customScrollDir = null; // el borde manda sobre el scroll por pose
      startNativeScroll(zone === 'TOP' ? 'UP' : 'DOWN');
    };
    const stopEdgeRepeat = () => {
      if (!customScrollDir) stopNativeScroll(); // no cortar el scroll por pose
    };
    const stopCustomScroll = () => {
      customScrollDir = null;
    };

    // 1. Modo exclusivo central
    const unsubMode = gestureEventBus.on('gesture:mode', (data) => {
      currentMode = data?.mode || 'TRACKING';
      setGestureMode(currentMode);
      const edgeActive = currentMode === 'EDGE_SCROLL';
      setIsScrollActive(edgeActive);
      window.__lastGestureState = edgeActive ? `${currentZone} SCROLL` : currentMode;
      if (!edgeActive) stopEdgeRepeat();
      else if (currentZone !== 'NONE') startEdgeRepeat(currentZone);
    });

    // 2. Scroll por bordes top/down (única fuente posicional de scroll gestual)
    const unsubEdge = gestureEventBus.on('gesture:edge-scroll', (data) => {
      const zone = data?.zone || 'NONE';
      currentZone = zone;
      setEdgeZone(zone);
      if (zone === 'NONE' || currentMode !== 'EDGE_SCROLL') {
        stopEdgeRepeat();
        return;
      }
      stopCustomScroll();
      startEdgeRepeat(zone);
    });

    // 3. Swipe discreto solo en TRACKING (ignorado en EDGE_SCROLL/PINCH)
    const unsubSwipe = gestureEventBus.on('gesture:swipe', (data) => {
      if (currentMode !== 'TRACKING' && currentMode !== 'SWIPE_COOLDOWN') return;
      if (currentZone !== 'NONE') return;
      window.__lastSwipe = data.direction;
      setTimeout(() => { if (window.__lastSwipe === data.direction) window.__lastSwipe = 'NONE'; }, 1000);
      if (data.direction === 'UP') {
        window.scrollBy({ top: -400, behavior: 'smooth' });
      } else if (data.direction === 'DOWN') {
        window.scrollBy({ top: 400, behavior: 'smooth' });
      }
    });

    // 4. Telemetría de mano (throttle ~8fps: setState a 60fps re-renderiza todo el App)
    let lastTelemetryTime = 0;
    const unsubMove = gestureEventBus.on('hand:move', (data) => {
      if (!data) return;
      const now = performance.now();
      if (now - lastTelemetryTime < 120) return;
      lastTelemetryTime = now;
      const normX = data.x <= 1 ? Math.round(data.x * 100) : Math.round((data.x / window.innerWidth) * 100);
      const normY = data.y <= 1 ? Math.round(data.y * 100) : Math.round((data.y / window.innerHeight) * 100);
      setHandCoords({ x: normX, y: normY });
      window.__lastHandPos = `X:${normX}% Y:${normY}%`;
    });

    // 4. Abrir/Cerrar Modal por seña custom o tecla M (flip palma-dorso eliminado)
    let lastFlipToggleTime = 0;

    const unsubPinch = gestureEventBus.on('gesture:pinch', (data) => {
      if (data.active) window.__lastGestureState = 'PINCH';
      else if (window.__lastGestureState === 'PINCH') window.__lastGestureState = 'TRACKING';
    });

    const unsubLost = gestureEventBus.on('hand:lost', () => {
      window.__lastHandPos = 'MANO FUERA';
    });
    
    // 5. Fallback de scroll por teclado/driver
    const unsubUiScroll = gestureEventBus.on('ui:scroll', (data) => {
      window.scrollBy({ top: data.deltaY, behavior: 'smooth' });
    });

    // 6. Legacy 2-dedos: ya no gobierna scroll, solo compat visual
    const unsubScrollModeLegacy = gestureEventBus.on('gesture:scroll-mode', () => {});

    // 6b. Navegación entre páginas (navbar del modal)
    const unsubNavigate = gestureEventBus.on('ui:navigate', (data) => {
      const next = data?.page;
      if (!next || (next !== APP_PAGES.HOME && next !== APP_PAGES.STUDIO && next !== APP_PAGES.INFO)) return;
      setPage(next);
      window.__lastGestureState = `PAGE:${next}`;
      window.scrollTo({ top: 0, behavior: 'auto' });
    });

    // 7. Seña custom mapeada al modal (entrenada por el usuario estilo try-trackingjs)
    // Ignora etiquetas de scroll y poses cercanas al pinch (lock del engine).
    const unsubCustom = gestureEventBus.on('gesture:custom', (data) => {
      const mapped = customSignMapper.getModalLabel();
      if (!mapped || data?.label !== mapped) return;
      if (data?.label === customSignMapper.getScrollUpLabel()) return;
      if (data?.label === customSignMapper.getScrollDownLabel()) return;
      if (currentMode === 'EDGE_SCROLL' || currentMode === 'PINCH') return;
      const now = Date.now();
      if (now - lastFlipToggleTime > 1500) {
        window.__lastGestureState = `CUSTOM:${data.label}`;
        gestureEventBus.emit('ui:toggle-modal');
        lastFlipToggleTime = now;
      }
    });

    // 8. Scroll custom por pose sostenida (sin ir al borde): nativo mientras se mantiene
    const unsubCustomScroll = gestureEventBus.on('gesture:custom-scroll', (data) => {
      if (data?.active) {
        if (currentMode === 'EDGE_SCROLL' || currentMode === 'PINCH' || currentZone !== 'NONE') return;
        customScrollDir = data.direction;
        setIsScrollActive(true);
        window.__lastGestureState = `CUSTOM SCROLL ${customScrollDir}`;
        startNativeScroll(customScrollDir);
      } else {
        customScrollDir = null;
        if (currentMode !== 'EDGE_SCROLL' && currentZone === 'NONE') stopNativeScroll();
        if (currentMode !== 'EDGE_SCROLL') {
          setIsScrollActive(false);
          window.__lastGestureState = currentMode;
        }
      }
    });

    return () => {
      stopNativeScroll();
      unsubMode();
      unsubEdge();
      unsubSwipe();
      unsubMove();
      unsubPinch();
      unsubLost();
      unsubUiScroll();
      unsubScrollModeLegacy();
      unsubNavigate();
      unsubCustom();
      unsubCustomScroll();
    };
  }, []);

  return (
    <div className="w-full min-h-[300vh] bg-zinc-900 text-white relative font-sans overflow-x-hidden">
      {/* 1. Barra superior de progreso de scroll (Indicador de Posición de Página) */}
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-zinc-800/60 z-[100] pointer-events-none">
        <div
          ref={barRef}
          className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
          style={{ width: '0%' }}
        />
      </div>

      {/* 2. Indicador flotante de Posición de Scroll y Puntero */}
      <div className="fixed top-20 right-6 z-40 pointer-events-none flex items-center gap-3 px-3.5 py-2 rounded-2xl bg-zinc-950/85 backdrop-blur-xl border border-zinc-800 shadow-2xl transition-all">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-mono font-bold text-zinc-400">Scroll</span>
          <span ref={pctRef} className="text-sm font-mono font-black text-cyan-300">0%</span>
        </div>
        <div className="w-px h-6 bg-zinc-800" />
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-mono font-bold text-zinc-400">Puntero Mano</span>
          <span className="text-xs font-mono font-bold text-emerald-400">
            X:{handCoords.x}% Y:{handCoords.y}%
          </span>
        </div>
        <div className="w-px h-6 bg-zinc-800" />
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-700/60">
          <span className={`w-2 h-2 rounded-full ${isScrollActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
          <span className="text-[11px] font-mono font-bold text-zinc-200">
            {isScrollActive ? `▼▲ EDGE SCROLL ${edgeZone}` : `🖐️ ${gestureMode}`}
          </span>
        </div>
      </div>

      {/* 3. Barra vertical de posición en el lateral derecho */}
      <div className="fixed right-2 top-1/2 -translate-y-1/2 w-1.5 h-44 bg-zinc-800/70 rounded-full z-40 pointer-events-none overflow-hidden flex flex-col justify-start">
        <div
          ref={sideRef}
          className="w-full bg-gradient-to-b from-cyan-400 to-emerald-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.8)]"
          style={{ height: '6%' }}
        />
      </div>

      <ModalNavbar />
      
      <main className="w-full flex flex-col items-center pt-24 px-8 pb-32 relative z-0">
        {engineState === 'initializing' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/90 backdrop-blur-md">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-xl font-medium text-zinc-200">Activando Cámara e IA...</p>
            </div>
          </div>
        )}
        
        {engineState === 'error' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/90 backdrop-blur-md">
            <div className="text-center bg-red-950 p-8 rounded-2xl border border-red-500/50 shadow-2xl">
              <p className="text-2xl font-bold text-red-400 mb-2">Error de Visión</p>
              <p className="text-zinc-300">Asegúrate de dar permisos de cámara al navegador.</p>
            </div>
          </div>
        )}

        <div className="max-w-4xl w-full">
          {page === APP_PAGES.HOME && <HomePage />}
          {page === APP_PAGES.STUDIO && <StudioPage />}
          {page === APP_PAGES.INFO && <InfoPage />}
        </div>
      </main>

      <HistoryAside />
      <GestureCursor />
      <ScrollEdgeZones />
      
      {/* Overlay de Debug (Cámara y Landmarks) */}
      <DebugWebcamOverlay engineRef={engineRef} isVisible={isDev && engineState === 'ready'} />
    </div>
  );
}

export default App;
