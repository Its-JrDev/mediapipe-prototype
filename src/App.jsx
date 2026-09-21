import React, { useEffect, useState, useRef } from 'react';
import GestureCursor from './components/GestureCursor';
import HistoryAside from './components/HistoryAside';
import ModalNavbar from './components/ModalNavbar';
import GestureEngine from './gesture-engine/index.js';
import MockGestureDriver from './gesture-engine/MockGestureDriver.js';
import gestureEventBus from './events/GestureEventBus.js';
import './App.css';

// A component to display the webcam feed and MediaPipe landmarks for debugging
function DebugWebcamOverlay({ engineRef, isVisible }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!isVisible || !engineRef.current || !engineRef.current.mediaPipeManager) return;

    let unsubscribe = engineRef.current.mediaPipeManager.onResults((results, timestamp, video) => {
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
      ctx.fillRect(8, 8, 190, 78);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`SWIPE: ${window.__lastSwipe || 'NONE'}`, 14, 22);
      ctx.fillStyle = window.__lastFlip ? '#a855f7' : '#94a3b8';
      ctx.fillText(`FLIP: ${window.__lastFlip || 'READY (Turn Hand)'}`, 14, 38);
      ctx.fillStyle = '#34d399';
      ctx.fillText(`STATUS: ${window.__lastGestureState || 'TRACKING'}`, 14, 54);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`POS: ${window.__lastHandPos || 'WAITING'}`, 14, 70);
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
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrollActive, setIsScrollActive] = useState(false);
  const [handCoords, setHandCoords] = useState({ x: 50, y: 50 });
  const engineRef = useRef(null);
  const driverRef = useRef(null);
  const isDev = import.meta.env.DEV; // Para mostrar la cámara de debug sólo en desarrollo

  // 1. Escuchar la posición nativa del scroll en la página para el indicador de posición
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const pct = maxScroll > 0 ? (scrollY / maxScroll) * 100 : 0;
      setScrollProgress(pct);
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

  // Mapeo de gestos a acciones de la UI
  useEffect(() => {
    // 1. Swipe discreto de lanzamiento rápido (Arriba / Abajo)
    const unsubSwipe = gestureEventBus.on('gesture:swipe', (data) => {
      // Solo permitir swipe si está en modo 2 dedos
      if (!window.__isScrollModeActive) return;

      window.__lastSwipe = data.direction;
      setTimeout(() => { if (window.__lastSwipe === data.direction) window.__lastSwipe = 'NONE'; }, 1000);
      
      if (data.direction === 'UP') {
        window.scrollBy({ top: -550, behavior: 'smooth' });
      } else if (data.direction === 'DOWN') {
        window.scrollBy({ top: 550, behavior: 'smooth' });
      }
    });

    // 2. Control de Estado de Modo Scroll (Solo con 2 dedos extendidos)
    const unsubScrollMode = gestureEventBus.on('gesture:scroll-mode', (data) => {
      const active = Boolean(data.active);
      window.__isScrollModeActive = active;
      setIsScrollActive(active);
      if (active) {
        window.__lastGestureState = '2-FINGER SCROLL';
      } else if (window.__lastGestureState === '2-FINGER SCROLL') {
        window.__lastGestureState = 'TRACKING';
      }
    });

    // 3. Scroll continuo SOLO cuando el modo 2 dedos está activo
    let lastY = null;
    let lastScrollTime = 0;
    const unsubMove = gestureEventBus.on('hand:move', (data) => {
      if (!data) return;
      const now = performance.now();
      const currentY = data.y <= 1 ? data.y * window.innerHeight : data.y;

      // Actualizar posición de la mano para telemetría
      const normX = data.x <= 1 ? Math.round(data.x * 100) : Math.round((data.x / window.innerWidth) * 100);
      const normY = data.y <= 1 ? Math.round(data.y * 100) : Math.round((data.y / window.innerHeight) * 100);
      setHandCoords({ x: normX, y: normY });
      window.__lastHandPos = `X:${normX}% Y:${normY}%`;

      // EXCLUSIVO: Solo hace scroll si está en modo 2 dedos (índice + anular/medio)
      if (window.__isScrollModeActive && lastY !== null) {
        const deltaY = currentY - lastY;
        
        if (Math.abs(deltaY) > 5 && (now - lastScrollTime > 28)) {
          window.scrollBy({ top: deltaY * 2.2, behavior: 'auto' });
          lastScrollTime = now;
        }
      }
      lastY = currentY;
    });

    // 4. Abrir/Cerrar Modal por Gesto de Dar Vuelta a la Mano (Flip Hand)
    let lastFlipToggleTime = 0;
    const unsubFlip = gestureEventBus.on('gesture:flip', (data) => {
      window.__lastFlip = `${data.from} ➔ ${data.facing}`;
      window.__lastGestureState = `FLIP (${data.facing})`;
      setTimeout(() => { if (window.__lastFlip === `${data.from} ➔ ${data.facing}`) window.__lastFlip = null; }, 1500);

      const now = Date.now();
      if (now - lastFlipToggleTime > 800) {
        gestureEventBus.emit('ui:toggle-modal');
        lastFlipToggleTime = now;
      }
    });

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

    return () => {
      unsubSwipe();
      unsubScrollMode();
      unsubMove();
      unsubFlip();
      unsubPinch();
      unsubLost();
      unsubUiScroll();
    };
  }, []);

  return (
    <div className="w-full min-h-[300vh] bg-zinc-900 text-white relative font-sans overflow-x-hidden">
      {/* 1. Barra superior de progreso de scroll (Indicador de Posición de Página) */}
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-zinc-800/60 z-[100] pointer-events-none">
        <div 
          className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500 transition-[width] duration-75 ease-out shadow-[0_0_12px_rgba(52,211,153,0.8)]"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* 2. Indicador flotante de Posición de Scroll y Puntero */}
      <div className="fixed top-20 right-6 z-40 pointer-events-none flex items-center gap-3 px-3.5 py-2 rounded-2xl bg-zinc-950/85 backdrop-blur-xl border border-zinc-800 shadow-2xl transition-all">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-mono font-bold text-zinc-400">Scroll</span>
          <span className="text-sm font-mono font-black text-cyan-300">{Math.round(scrollProgress)}%</span>
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
            {isScrollActive ? '✌️ 2-DEDOS SCROLL' : '🖐️ NAVEGANDO'}
          </span>
        </div>
      </div>

      {/* 3. Barra vertical de posición en el lateral derecho */}
      <div className="fixed right-2 top-1/2 -translate-y-1/2 w-1.5 h-44 bg-zinc-800/70 rounded-full z-40 pointer-events-none overflow-hidden flex flex-col justify-start">
        <div 
          className="w-full bg-gradient-to-b from-cyan-400 to-emerald-400 rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
          style={{ height: `${Math.max(6, scrollProgress)}%` }}
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
          <h1 className="text-6xl md:text-8xl font-black mb-8 bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500 bg-clip-text text-transparent leading-tight pb-2">
            Gestos en Vivo
          </h1>
          <p className="text-2xl text-zinc-400 mb-16 leading-relaxed max-w-3xl">
            1. Dale la <strong className="text-white bg-white/10 px-2 py-1 rounded">Vuelta a la Mano (Palma ↔ Dorso)</strong> para abrir o cerrar el Modal.<br/><br/>
            2. Extiende <strong className="text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-1 rounded font-bold">2 Dedos (Índice y Medio/Anular)</strong> y muévelos hacia Arriba o Abajo para hacer scroll.<br/><br/>
            3. Une tu <strong className="text-white bg-white/10 px-2 py-1 rounded">Pulgar e Índice (Pinch)</strong> para hacer Touch/Click en las tarjetas.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-32">
            {[1, 2, 3, 4].map(i => (
              <button 
                key={i}
                onClick={() => alert(`¡Éxito! Hiciste Touch en la Tarjeta ${i}`)}
                className="group relative bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-emerald-500/50 transition-all p-12 rounded-3xl text-left cursor-pointer overflow-hidden isolate"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
                <h3 className="text-3xl font-bold text-white mb-2">Tarjeta Interactiva {i}</h3>
                <p className="text-zinc-400">Haz Pinch aquí para interactuar</p>
              </button>
            ))}
          </div>
          
          <div className="h-96 w-full rounded-3xl bg-gradient-to-br from-indigo-950 to-zinc-900 border border-indigo-500/20 flex flex-col items-center justify-center p-12 text-center mb-32">
             <h2 className="text-5xl font-bold mb-4 text-indigo-200">Sigue bajando...</h2>
             <p className="text-xl text-zinc-400">Haz Swipe con la mano hacia arriba</p>
          </div>

          <div className="h-[600px] w-full rounded-3xl bg-gradient-to-tl from-cyan-950 to-zinc-900 border border-cyan-500/20 flex flex-col items-center justify-center p-12 text-center shadow-2xl">
             <h2 className="text-6xl font-black mb-6 bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">¡Llegaste al final!</h2>
             <p className="text-2xl text-zinc-400 max-w-lg">Haz un Swipe rápido hacia abajo para volver al inicio de la página.</p>
          </div>
        </div>
      </main>

      <HistoryAside />
      <GestureCursor />
      
      {/* Overlay de Debug (Cámara y Landmarks) */}
      <DebugWebcamOverlay engineRef={engineRef} isVisible={isDev && engineState === 'ready'} />
    </div>
  );
}

export default App;
