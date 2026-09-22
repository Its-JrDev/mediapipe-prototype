import React, { useState, useEffect, useRef, useCallback } from 'react';
import { gestureEventBus as defaultBus } from '../events/GestureEventBus.js';

/**
 * Helper hook to resolve and subscribe to the GestureEventBus.
 * Works with direct import, prop eventBus, window.gestureEventBus, or custom EventTarget.
 */
function useGestureBus(propBus) {
  const bus = propBus || (typeof window !== 'undefined' ? (window.gestureEventBus || window.GestureEventBus) : null) || defaultBus;

  const subscribe = useCallback((eventName, handler) => {
    const target = bus || (typeof window !== 'undefined' ? window : null);
    if (!target) return () => {};

    const wrapped = (eventOrData) => {
      const payload = (eventOrData && typeof eventOrData === 'object' && 'detail' in eventOrData)
        ? eventOrData.detail
        : eventOrData;
      handler(payload);
    };

    if (typeof target.on === 'function') {
      target.on(eventName, wrapped);
      return () => {
        if (typeof target.off === 'function') {
          target.off(eventName, wrapped);
        }
      };
    } else if (typeof target.addEventListener === 'function') {
      target.addEventListener(eventName, wrapped);
      return () => {
        if (typeof target.removeEventListener === 'function') {
          target.removeEventListener(eventName, wrapped);
        }
      };
    }

    return () => {};
  }, [bus]);

  const emit = useCallback((eventName, payload) => {
    const target = bus || (typeof window !== 'undefined' ? window : null);
    if (!target) return;

    if (typeof target.emit === 'function') {
      target.emit(eventName, payload);
    } else if (typeof target.dispatchEvent === 'function') {
      target.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
    }
  }, [bus]);

  return { bus, subscribe, emit };
}

// Built-in fallback cinematic SVG images when props are not provided
const DEFAULT_BEFORE_IMG = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18181b" />
      <stop offset="100%" stop-color="#09090b" />
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#27272a" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
  <rect width="100%" height="100%" fill="url(#grid)" />
  
  <g stroke="#71717a" stroke-width="1.5" fill="none" opacity="0.6">
    <circle cx="600" cy="350" r="180" stroke-dasharray="6,6"/>
    <circle cx="600" cy="350" r="120"/>
    <line x1="600" y1="120" x2="600" y2="580" stroke-dasharray="4,4"/>
    <line x1="370" y1="350" x2="830" y2="350" stroke-dasharray="4,4"/>
  </g>

  <g transform="translate(600, 350)" text-anchor="middle">
    <text y="-20" fill="#a1a1aa" font-family="system-ui, sans-serif" font-size="28" font-weight="700" letter-spacing="4">RAW COMPUTER VISION INPUT</text>
    <text y="25" fill="#71717a" font-family="monospace" font-size="16">LANDMARKS: [X, Y, Z] UNPROCESSED</text>
    <text y="60" fill="#52525b" font-family="monospace" font-size="14">NO FILTER // LATENCY: 0ms // NOISE: HIGH</text>
  </g>
</svg>
`);

const DEFAULT_AFTER_IMG = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
  <defs>
    <linearGradient id="bgAfter" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#050814" />
      <stop offset="50%" stop-color="#0b132b" />
      <stop offset="100%" stop-color="#1c0f2a" />
    </linearGradient>
    <linearGradient id="glowLine" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#ec4899" />
    </linearGradient>
    <radialGradient id="neonGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bgAfter)" />
  <circle cx="600" cy="350" r="280" fill="url(#neonGlow)"/>
  
  <g stroke="url(#glowLine)" stroke-width="2.5" fill="none">
    <circle cx="600" cy="350" r="180"/>
    <circle cx="600" cy="350" r="130" opacity="0.8"/>
    <circle cx="600" cy="350" r="80" opacity="0.5"/>
    <polygon points="600,200 730,425 470,425" stroke="#38bdf8" stroke-width="2" opacity="0.7"/>
  </g>

  <g transform="translate(600, 350)" text-anchor="middle">
    <text y="-20" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="28" font-weight="800" letter-spacing="4">MEDIAPIPE NEURAL ENHANCED</text>
    <text y="25" fill="#c084fc" font-family="monospace" font-size="16">1€ FILTER APPLIED // 60 FPS STABLE</text>
    <text y="60" fill="#34d399" font-family="monospace" font-size="14">TARGET LOCK ACTIVE // JITTER: 0.002px</text>
  </g>
</svg>
`);

/**
 * BeforeAfterSlider
 * Image comparator where the division position (X%) is controlled by hand tracking (index finger),
 * keyboard triggers, or direct dragging.
 */
export default function BeforeAfterSlider({
  eventBus,
  beforeImage = DEFAULT_BEFORE_IMG,
  afterImage = DEFAULT_AFTER_IMG,
  beforeLabel = 'Original / RAW',
  afterLabel = 'MediaPipe AI Enhanced',
  initialPosition = 50,
  onChange,
  className = '',
}) {
  const { subscribe, emit } = useGestureBus(eventBus);

  const [position, setPosition] = useState(initialPosition); // 0 to 100
  const [isDragging, setIsDragging] = useState(false);
  const [isHandActive, setIsHandActive] = useState(false);
  const [isPinching, setIsPinching] = useState(false);

  const containerRef = useRef(null);
  const handTimerRef = useRef(null);
  const isPinchingRef = useRef(false);

  // Clamps position and updates state + triggers callbacks
  const updatePosition = useCallback((newPos, source = 'manual') => {
    const clamped = Math.max(0, Math.min(100, newPos));
    setPosition(clamped);
    if (onChange) onChange(clamped);

    if (source === 'manual') {
      emit('ui:slider-move', { percentage: clamped });
    }
  }, [onChange, emit]);

  // Subscribe to GestureEventBus
  useEffect(() => {
    // 1. Explicit slider move action (e.g. from MockGestureDriver Arrow keys)
    const unsubSlider = subscribe('ui:slider-move', (data) => {
      if (!data) return;
      let pct = typeof data === 'number' ? data : data.percentage;
      if (typeof pct === 'number') {
        // If 0..1 normalized, convert to percentage
        if (pct <= 1 && pct >= 0) pct = pct * 100;
        updatePosition(pct, 'bus');
      }
    });

    // 2. Hand movement: solo mueve en PINCH MODE (una sola acción a la vez)
    const unsubHand = subscribe('hand:move', (data) => {
      if (!data || !containerRef.current || !isPinchingRef.current) return;
      let { x } = data;

      // Handle normalized vs pixel coordinates
      if (typeof window !== 'undefined' && x <= 1 && x >= 0) {
        x = x * window.innerWidth;
      }

      const rect = containerRef.current.getBoundingClientRect();

      // Check if hand is within or controlling the slider area
      if (x >= rect.left - 50 && x <= rect.right + 50) {
        setIsHandActive(true);
        if (handTimerRef.current) clearTimeout(handTimerRef.current);
        handTimerRef.current = setTimeout(() => setIsHandActive(false), 2000);

        const relativeX = x - rect.left;
        const pct = (relativeX / rect.width) * 100;
        updatePosition(pct, 'gesture');
      }
    });

    // 3. Pinch gesture (locks or releases dragging)
    const unsubPinch = subscribe('gesture:pinch', (data) => {
      const active = Boolean(data?.active);
      isPinchingRef.current = active;
      setIsPinching(active);
    });

    return () => {
      unsubSlider();
      unsubHand();
      unsubPinch();
      if (handTimerRef.current) clearTimeout(handTimerRef.current);
    };
  }, [subscribe, updatePosition]);

  // Pointer / Mouse / Touch handlers for manual interaction
  const handlePointerDown = (e) => {
    setIsDragging(true);
    handlePointerMove(e);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (clientX === undefined) return;
    const relativeX = clientX - rect.left;
    const pct = (relativeX / rect.width) * 100;
    updatePosition(pct, 'manual');
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  // Keyboard navigation when slider is focused
  const handleKeyDown = (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      updatePosition(position - step, 'manual');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      updatePosition(position + step, 'manual');
    } else if (e.key === 'Home') {
      e.preventDefault();
      updatePosition(0, 'manual');
    } else if (e.key === 'End') {
      e.preventDefault();
      updatePosition(100, 'manual');
    }
  };

  return (
    <div
      className={`relative w-full select-none rounded-2xl overflow-hidden border border-zinc-800/80 bg-zinc-950 shadow-2xl transition-all duration-300 ${
        isHandActive ? 'ring-2 ring-cyan-500/50 shadow-cyan-950/40' : ''
      } ${className}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="slider"
      aria-valuenow={Math.round(position)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Before and After Image Comparison"
    >
      {/* Top Status Bar */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Left Badge: Before */}
        <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold tracking-wider uppercase bg-zinc-900/85 backdrop-blur-md text-zinc-300 border border-zinc-700/60 shadow-lg">
          {beforeLabel}
        </span>

        {/* Center Indicator: Gesture Feedback */}
        {isHandActive && (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium tracking-wide bg-cyan-950/80 backdrop-blur-md text-cyan-300 border border-cyan-500/60 shadow-lg shadow-cyan-950/50 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>PINCH DRAG ACTIVE ({Math.round(position)}%)</span>
          </span>
        )}

        {/* Right Badge: After */}
        <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold tracking-wider uppercase bg-cyan-950/85 backdrop-blur-md text-cyan-300 border border-cyan-500/60 shadow-lg">
          {afterLabel}
        </span>
      </div>

      {/* Main Image Container */}
      <div
        ref={containerRef}
        className="relative w-full h-[380px] sm:h-[480px] md:h-[540px] cursor-ew-resize overflow-hidden touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Layer 1: After Image (Background, Full) */}
        <img
          src={afterImage}
          alt={afterLabel}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          draggable={false}
        />

        {/* Layer 2: Before Image (Clipped overlay) */}
        <div
          className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden"
          style={{
            clipPath: `inset(0 ${100 - position}% 0 0)`,
            willChange: 'clip-path',
          }}
        >
          <img
            src={beforeImage}
            alt={beforeLabel}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            draggable={false}
          />
        </div>

        {/* Layer 3: Vertical Divider Line */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none -translate-x-1/2 z-20 transition-transform duration-75"
          style={{
            left: `${position}%`,
            willChange: 'left',
          }}
        >
          {/* Laser Glow Line */}
          <div className="w-0.5 h-full bg-gradient-to-b from-cyan-400 via-white to-purple-500 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />

          {/* Draggable Center Handle Pill */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-auto cursor-grab active:cursor-grabbing transition-transform duration-200 ${
              isDragging || isPinching ? 'scale-110' : 'hover:scale-105'
            }`}
          >
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-900/90 backdrop-blur-xl border border-cyan-400/80 text-white shadow-2xl shadow-cyan-950/80">
              {/* Left arrow */}
              <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>

              {/* Percentage Tag */}
              <span className="text-[11px] font-mono font-bold tracking-wider text-cyan-200 min-w-[32px] text-center">
                {Math.round(position)}%
              </span>

              {/* Right arrow */}
              <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar: Presets & Controls */}
      <div className="px-4 py-2.5 bg-zinc-900/90 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5 font-mono">
          <span className="text-zinc-500">CONTROL:</span>
          <button
            type="button"
            onClick={() => updatePosition(25, 'manual')}
            className={`px-2 py-0.5 rounded transition-colors ${
              Math.round(position) === 25 ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-zinc-800 text-zinc-300'
            }`}
          >
            25%
          </button>
          <button
            type="button"
            onClick={() => updatePosition(50, 'manual')}
            className={`px-2 py-0.5 rounded transition-colors ${
              Math.round(position) === 50 ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-zinc-800 text-zinc-300'
            }`}
          >
            50%
          </button>
          <button
            type="button"
            onClick={() => updatePosition(75, 'manual')}
            className={`px-2 py-0.5 rounded transition-colors ${
              Math.round(position) === 75 ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-zinc-800 text-zinc-300'
            }`}
          >
            75%
          </button>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
          <span className="hidden sm:inline">
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">←</kbd>{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">→</kbd> to nudge
          </span>
          <span className="text-zinc-500">|</span>
          <span className="text-cyan-400/90">🤏 Pinch + mueve para deslizar</span>
        </div>
      </div>
    </div>
  );
}
