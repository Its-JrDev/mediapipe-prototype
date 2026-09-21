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
  const [isVisible, setIsVisible] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [gestureState, setGestureState] = useState('IDLE'); // 'IDLE' | 'TRACKING' | 'PINCH' | 'FIST' | 'OPEN'
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
  const updatePosition = useCallback((targetX, targetY) => {
    setIsVisible(true);

    // Reset hide timer
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 3000);

    const now = Date.now();
    const last = lastPosRef.current || { x: targetX, y: targetY, time: now };
    const dist = Math.hypot(targetX - last.x, targetY - last.y);

    setPos({ x: targetX, y: targetY });

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

      // Handle normalized [0, 1] vs screen pixel coordinates
      if (typeof window !== 'undefined') {
        if (x <= 1 && y <= 1 && x >= 0 && y >= 0) {
          x = x * window.innerWidth;
          y = y * window.innerHeight;
        }
      }

      updatePosition(x, y);
      setGestureState((prev) => (prev === 'PINCH' || prev === 'FIST' ? prev : 'TRACKING'));
    });

    // 2. Pinch Gesture
    const unsubPinch = subscribe('gesture:pinch', (data) => {
      if (!data) return;
      const active = Boolean(data.active);
      setIsPinching(active);
      setGestureState(active ? 'PINCH' : 'TRACKING');

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

    // 3. Fist Gesture
    const unsubFist = subscribe('gesture:fist', (data) => {
      const active = Boolean(data?.active);
      setGestureState(active ? 'FIST' : 'TRACKING');
    });

    // 4. Open Hand Gesture
    const unsubOpen = subscribe('gesture:open', (data) => {
      const active = Boolean(data?.active);
      if (active) setGestureState('OPEN');
    });

    return () => {
      unsubMove();
      unsubPinch();
      unsubFist();
      unsubOpen();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [subscribe, updatePosition, addRipple, emit]);

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
              : gestureState === 'FIST'
              ? 'w-5 h-5 bg-amber-400 scale-110 ring-2 ring-amber-400/50'
              : 'w-3 h-3 bg-cyan-300 ring-2 ring-cyan-400/60'
          }`}
        />

        {/* Subtle Crosshairs */}
        <div className="absolute w-2 h-0.5 bg-white/60 -left-2" />
        <div className="absolute w-2 h-0.5 bg-white/60 -right-2" />
        <div className="absolute h-2 w-0.5 bg-white/60 -top-2" />
        <div className="absolute h-2 w-0.5 bg-white/60 -bottom-2" />
      </div>

      {/* Floating Status Badge */}
      {showBadge && (
        <div
          className={`absolute left-6 -top-3 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium tracking-wide uppercase shadow-lg border backdrop-blur-md transition-all duration-200 whitespace-nowrap flex items-center gap-1.5 ${
            isPinching
              ? 'bg-fuchsia-950/80 border-fuchsia-500/60 text-fuchsia-200'
              : gestureState === 'FIST'
              ? 'bg-amber-950/80 border-amber-500/60 text-amber-200'
              : 'bg-zinc-900/85 border-cyan-500/40 text-cyan-300'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isPinching
                ? 'bg-fuchsia-400 animate-ping'
                : gestureState === 'FIST'
                ? 'bg-amber-400'
                : 'bg-cyan-400 animate-pulse'
            }`}
          />
          <span>{isPinching ? 'PINCH' : gestureState}</span>
          {dwellProgress > 0 && dwellProgress < 100 && (
            <span className="text-white/60">{Math.round(dwellProgress)}%</span>
          )}
        </div>
      )}
    </div>
  );
}
