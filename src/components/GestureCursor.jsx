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

/**
 * GestureCursor
 * Virtual cinematic cursor following (X_smooth, Y_smooth) with dwell progress indicator,
 * pinch reaction, fist/open status, and virtual click dispatch.
 */
export default function GestureCursor({
  eventBus,
  dwellDuration = 1000, // ms required to dwell for click
  dwellThreshold = 20,  // max px delta to consider cursor dwelling
  enableDwellClick = true,
  enableMouseFallback = true,
  showBadge = true,
}) {
  const { subscribe, emit } = useGestureBus(eventBus);

  // Position & states
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [normPos, setNormPos] = useState({ x: 50, y: 50 });
  const [isVisible, setIsVisible] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [isScrollMode, setIsScrollMode] = useState(false);
  const [gestureState, setGestureState] = useState('IDLE'); // 'IDLE' | 'TRACKING' | 'PINCH' | 'FIST' | 'OPEN' | '2-FINGER SCROLL'
  const [dwellProgress, setDwellProgress] = useState(0); // 0 to 100
  const [ripples, setRipples] = useState([]);

  const lastPosRef = useRef(null);
  const dwellStartRef = useRef(null);
  const dwellTriggeredRef = useRef(false);
  const hideTimerRef = useRef(null);
  const hasHandEventsRef = useRef(false);

  // Trigger ripple effect
  const addRipple = useCallback((x, y) => {
    const id = `${Date.now()}-${Math.random()}`;
    setRipples((prev) => [...prev.slice(-3), { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);
  }, []);

  // Update cursor position and check dwell progress
  const updatePosition = useCallback((targetX, targetY, nx, ny) => {
    setIsVisible(true);

    // Reset hide timer: keeps cursor visible as long as frames arrive
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 1500);

    const now = Date.now();
    const last = lastPosRef.current || { x: targetX, y: targetY, time: now };
    const dist = Math.hypot(targetX - last.x, targetY - last.y);

    setPos({ x: targetX, y: targetY });
    if (typeof nx === 'number' && typeof ny === 'number') {
      setNormPos({ x: Math.round(nx * 100), y: Math.round(ny * 100) });
    } else if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
      setNormPos({
        x: Math.round((targetX / window.innerWidth) * 100),
        y: Math.round((targetY / window.innerHeight) * 100),
      });
    }

    // Dwell logic
    if (enableDwellClick) {
      if (dist < dwellThreshold) {
        if (!dwellStartRef.current) {
          dwellStartRef.current = now;
        }

        const elapsed = now - dwellStartRef.current;
        const progress = Math.min(100, (elapsed / dwellDuration) * 100);
        setDwellProgress(progress);

        if (progress >= 100 && !dwellTriggeredRef.current) {
          dwellTriggeredRef.current = true;
          addRipple(targetX, targetY);

          // Attempt virtual click at cursor point
          if (typeof document !== 'undefined') {
            const el = document.elementFromPoint(targetX, targetY);
            if (el) {
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          }
          emit('ui:click', { x: targetX, y: targetY });
        }
      } else {
        // Moved significantly -> reset dwell
        dwellStartRef.current = now;
        dwellTriggeredRef.current = false;
        setDwellProgress(0);
        lastPosRef.current = { x: targetX, y: targetY, time: now };
      }
    } else {
      lastPosRef.current = { x: targetX, y: targetY, time: now };
    }
  }, [dwellDuration, dwellThreshold, enableDwellClick, addRipple, emit]);

  // Subscribe to GestureEventBus
  useEffect(() => {
    // 1. Hand Movement
    const unsubMove = subscribe('hand:move', (data) => {
      if (!data) return;
      hasHandEventsRef.current = true;
      let { x, y } = data;
      const rawNormalizedX = (x <= 1 && x >= 0) ? x : (typeof window !== 'undefined' ? x / window.innerWidth : 0.5);
      const rawNormalizedY = (y <= 1 && y >= 0) ? y : (typeof window !== 'undefined' ? y / window.innerHeight : 0.5);

      // Handle normalized [0, 1] vs screen pixel coordinates
      if (typeof window !== 'undefined') {
        if (x <= 1 && y <= 1 && x >= 0 && y >= 0) {
          x = x * window.innerWidth;
          y = y * window.innerHeight;
        }
      }

      updatePosition(x, y, rawNormalizedX, rawNormalizedY);
      setGestureState((prev) => {
        if (isScrollMode) return '2-FINGER SCROLL';
        if (prev === 'PINCH' || prev === 'FIST') return prev;
        return 'TRACKING';
      });
    });

    // 2. Pinch Gesture
    const unsubPinch = subscribe('gesture:pinch', (data) => {
      if (!data) return;
      const active = Boolean(data.active);
      setIsPinching(active);
      setGestureState(active ? 'PINCH' : (isScrollMode ? '2-FINGER SCROLL' : 'TRACKING'));

      if (active) {
        const lastX = lastPosRef.current ? lastPosRef.current.x : -100;
        const lastY = lastPosRef.current ? lastPosRef.current.y : -100;
        const x = typeof data.x === 'number' ? data.x : lastX;
        const y = typeof data.y === 'number' ? data.y : lastY;
        addRipple(x, y);

        // Virtual click trigger on pinch
        if (typeof document !== 'undefined') {
          const el = document.elementFromPoint(x, y);
          if (el) {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }
        }
        emit('ui:click', { x, y });
      }
    });

    // 3. Scroll Mode (2 Fingers)
    const unsubScrollMode = subscribe('gesture:scroll-mode', (data) => {
      const active = Boolean(data?.active);
      setIsScrollMode(active);
      if (active) {
        setGestureState('2-FINGER SCROLL');
      } else {
        setGestureState((prev) => (prev === '2-FINGER SCROLL' ? 'TRACKING' : prev));
      }
    });

    // 4. Fist Gesture
    const unsubFist = subscribe('gesture:fist', (data) => {
      const active = Boolean(data?.active);
      setGestureState(active ? 'FIST' : (isScrollMode ? '2-FINGER SCROLL' : 'TRACKING'));
    });

    // 5. Open Hand Gesture
    const unsubOpen = subscribe('gesture:open', (data) => {
      const active = Boolean(data?.active);
      if (active && !isScrollMode) setGestureState('OPEN');
    });

    // 6. Hand Lost: hide cursor promptly
    const unsubLost = subscribe('hand:lost', () => {
      setIsVisible(false);
      setGestureState('IDLE');
    });

    return () => {
      unsubMove();
      unsubPinch();
      unsubScrollMode();
      unsubFist();
      unsubOpen();
      unsubLost();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [subscribe, updatePosition, addRipple, emit, isScrollMode]);

  // Mouse fallback for development/testing when no hand tracker is running
  useEffect(() => {
    if (!enableMouseFallback) return;

    const handleMouseMove = (e) => {
      if (!hasHandEventsRef.current) {
        updatePosition(e.clientX, e.clientY);
      }
    };

    const handleMouseDown = (e) => {
      if (!hasHandEventsRef.current) {
        setIsPinching(true);
        setGestureState('PINCH');
        addRipple(e.clientX, e.clientY);
      }
    };

    const handleMouseUp = () => {
      if (!hasHandEventsRef.current) {
        setIsPinching(false);
        setGestureState('TRACKING');
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mousedown', handleMouseDown, { passive: true });
    window.addEventListener('mouseup', handleMouseUp, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [enableMouseFallback, updatePosition, addRipple]);

  if (!isVisible && pos.x < 0) return null;

  // Dwell SVG circle calculations
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (dwellProgress / 100) * circumference;

  return (
    <div
      className="fixed top-0 left-0 pointer-events-none z-[9999] transition-opacity duration-300 select-none"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        willChange: 'transform',
      }}
      aria-hidden="true"
    >
      {/* Ripple Rings */}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-400/80 animate-ping"
          style={{
            width: '60px',
            height: '60px',
          }}
        />
      ))}

      {/* Main Cursor Core */}
      <div className="relative -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        {/* Glow Aura */}
        <div
          className={`absolute rounded-full transition-all duration-300 blur-md ${
            isPinching
              ? 'w-16 h-16 bg-fuchsia-500/50'
              : isScrollMode || gestureState === '2-FINGER SCROLL'
              ? 'w-16 h-16 bg-emerald-400/50 animate-pulse'
              : gestureState === 'FIST'
              ? 'w-14 h-14 bg-amber-500/40'
              : 'w-12 h-12 bg-cyan-400/40'
          }`}
        />

        {/* Dwell Progress Ring (SVG) */}
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
          {/* Background Track */}
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-white/20"
          />
          {/* Progress Indicator */}
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`transition-[stroke-dashoffset] duration-75 ${
              isPinching
                ? 'text-fuchsia-400'
                : isScrollMode
                ? 'text-emerald-400'
                : dwellProgress > 75
                ? 'text-emerald-400'
                : 'text-cyan-400'
            }`}
          />
        </svg>

        {/* Center Target Dot */}
        <div
          className={`absolute rounded-full transition-all duration-200 shadow-lg border border-white/80 ${
            isPinching
              ? 'w-4 h-4 bg-fuchsia-400 scale-125 ring-4 ring-fuchsia-400/40'
              : isScrollMode
              ? 'w-4 h-4 bg-emerald-300 scale-125 ring-4 ring-emerald-400/60'
              : gestureState === 'FIST'
              ? 'w-5 h-5 bg-amber-400 scale-110 ring-2 ring-amber-400/50'
              : 'w-3 h-3 bg-cyan-300 ring-2 ring-cyan-400/60'
          }`}
        />

        {/* Precision Crosshairs */}
        <div className={`absolute h-0.5 -left-3 ${isScrollMode ? 'w-3 bg-emerald-400/80' : 'w-2.5 bg-white/70'}`} />
        <div className={`absolute h-0.5 -right-3 ${isScrollMode ? 'w-3 bg-emerald-400/80' : 'w-2.5 bg-white/70'}`} />
        <div className={`absolute w-0.5 -top-3 ${isScrollMode ? 'h-3 bg-emerald-400/80' : 'h-2.5 bg-white/70'}`} />
        <div className={`absolute w-0.5 -bottom-3 ${isScrollMode ? 'h-3 bg-emerald-400/80' : 'h-2.5 bg-white/70'}`} />
      </div>

      {/* Floating Status & Position Badge */}
      {showBadge && (
        <div
          className={`absolute left-7 -top-4 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold tracking-wider shadow-2xl border backdrop-blur-md transition-all duration-200 whitespace-nowrap flex flex-col gap-0.5 ${
            isPinching
              ? 'bg-fuchsia-950/90 border-fuchsia-500/70 text-fuchsia-200 ring-1 ring-fuchsia-500/40'
              : isScrollMode
              ? 'bg-emerald-950/90 border-emerald-400/70 text-emerald-200 ring-1 ring-emerald-400/40'
              : gestureState === 'FIST'
              ? 'bg-amber-950/90 border-amber-500/70 text-amber-200 ring-1 ring-amber-500/40'
              : 'bg-zinc-950/90 border-cyan-500/50 text-cyan-200 ring-1 ring-cyan-500/30'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isPinching
                  ? 'bg-fuchsia-400 animate-ping'
                  : isScrollMode
                  ? 'bg-emerald-400 animate-pulse'
                  : gestureState === 'FIST'
                  ? 'bg-amber-400'
                  : 'bg-cyan-400 animate-pulse'
              }`}
            />
            <span className="uppercase">
              {isPinching
                ? 'TOUCH (PINCH)'
                : isScrollMode
                ? '✌️ 2-FINGER SCROLL'
                : gestureState}
            </span>
            {dwellProgress > 0 && dwellProgress < 100 && (
              <span className="text-white/60">({Math.round(dwellProgress)}%)</span>
            )}
          </div>
          {/* Position Coordinates Indicator */}
          <div className="text-[9px] text-zinc-400 flex items-center gap-2 font-mono">
            <span>POS:</span>
            <span className="text-white font-semibold">{normPos.x}%, {normPos.y}%</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">{Math.round(pos.x)}px, {Math.round(pos.y)}px</span>
          </div>
        </div>
      )}
    </div>
  );
}
