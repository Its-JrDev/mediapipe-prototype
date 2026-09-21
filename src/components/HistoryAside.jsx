import React, { useState, useEffect, useCallback, useRef } from 'react';
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

  return { bus, subscribe };
}

// Format timestamp helper
function formatTime(timestamp) {
  if (!timestamp) return '--:--:--';
  const d = new Date(timestamp);
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const INITIAL_HISTORY = [
  {
    id: 'init-1',
    type: 'SYSTEM',
    label: 'Bus Listener Ready',
    details: 'Listening for SWIPE, PINCH, FIST, OPEN...',
    timestamp: 0,
    category: 'system',
  },
];

/**
 * HistoryAside
 * Slide-over drawer panel that opens and closes on SWIPE gestures or ui:toggle-aside events.
 * Displays a live cinematic log of gestures and events received over the bus.
 */
export default function HistoryAside({
  eventBus,
  position = 'right', // 'right' | 'left'
  defaultOpen = false,
  maxHistory = 60,
  onToggle,
}) {
  const { subscribe } = useGestureBus(eventBus);

  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [history, setHistory] = useState(INITIAL_HISTORY);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'GESTURES' | 'UI'

  const historyEndRef = useRef(null);
  const lastEventThrottleRef = useRef({});

  const toggleOpen = useCallback((force) => {
    setIsOpen((prev) => {
      const next = typeof force === 'boolean' ? force : !prev;
      if (onToggle) onToggle(next);
      return next;
    });
  }, [onToggle]);

  // Append new event to log
  const addEvent = useCallback((type, label, details, category = 'gestures') => {
    const now = Date.now();
    // Throttling fast-firing events
    const throttleKey = `${type}-${details}`;
    if (lastEventThrottleRef.current[throttleKey] && now - lastEventThrottleRef.current[throttleKey] < 200) {
      return;
    }
    lastEventThrottleRef.current[throttleKey] = now;

    setHistory((prev) => {
      const newItem = {
        id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        label,
        details,
        timestamp: now,
        category,
      };
      return [newItem, ...prev.slice(0, maxHistory - 1)];
    });
  }, [maxHistory]);

  // Subscribe to GestureEventBus
  useEffect(() => {
    // 1. SWIPE GESTURE: opens / closes the drawer
    const unsubSwipe = subscribe('gesture:swipe', (data) => {
      if (!data) return;
      const dir = (data.direction || '').toUpperCase();
      const velocity = data.velocity ? `(v: ${Number(data.velocity).toFixed(2)})` : '';
      addEvent('SWIPE', `Swipe ${dir}`, `${dir} ${velocity}`.trim(), 'gestures');

      if (position === 'right') {
        if (dir === 'LEFT') toggleOpen(true);
        if (dir === 'RIGHT') toggleOpen(false);
      } else {
        if (dir === 'RIGHT') toggleOpen(true);
        if (dir === 'LEFT') toggleOpen(false);
      }
    });

    // 2. TOGGLE ASIDE ACTION (e.g. from MockGestureDriver 'H' key)
    const unsubToggle = subscribe('ui:toggle-aside', () => {
      addEvent('UI_ACTION', 'Toggle Drawer', 'Triggered by ui:toggle-aside', 'ui');
      toggleOpen();
    });

    // 3. PINCH GESTURE
    const unsubPinch = subscribe('gesture:pinch', (data) => {
      if (!data) return;
      const active = Boolean(data.active);
      const coords = typeof data.x === 'number' ? `[${Math.round(data.x)}, ${Math.round(data.y)}]` : '';
      addEvent('PINCH', active ? 'Pinch Engaged' : 'Pinch Released', coords, 'gestures');
    });

    // 4. FIST GESTURE
    const unsubFist = subscribe('gesture:fist', (data) => {
      const active = Boolean(data?.active);
      addEvent('FIST', active ? 'Closed Fist' : 'Fist Released', active ? 'Grip active' : '', 'gestures');
    });

    // 5. OPEN HAND GESTURE
    const unsubOpen = subscribe('gesture:open', (data) => {
      const active = Boolean(data?.active);
      if (active) {
        addEvent('OPEN_HAND', 'Open Hand', 'Hover & relax state', 'gestures');
      }
    });

    // 6. UI SLIDER MOVE
    const unsubSlider = subscribe('ui:slider-move', (data) => {
      if (!data) return;
      const pct = typeof data === 'number' ? data : data.percentage;
      if (typeof pct === 'number') {
        addEvent('SLIDER', 'Slider Move', `Position: ${Math.round(pct)}%`, 'ui');
      }
    });

    // 7. UI SCROLL
    const unsubScroll = subscribe('ui:scroll', (data) => {
      const dy = data?.deltaY ?? 0;
      addEvent('SCROLL', 'UI Scroll', `DeltaY: ${dy}`, 'ui');
    });

    // 8. UI TOGGLE MODAL
    const unsubModal = subscribe('ui:toggle-modal', () => {
      addEvent('MODAL', 'Toggle Modal', 'Modal state toggled', 'ui');
    });

    return () => {
      unsubSwipe();
      unsubToggle();
      unsubPinch();
      unsubFist();
      unsubOpen();
      unsubSlider();
      unsubScroll();
      unsubModal();
    };
  }, [subscribe, position, toggleOpen, addEvent]);

  // Keyboard shortcut listener fallback: 'h' / 'H'
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'h' || e.key === 'H') {
        toggleOpen();
      } else if (e.key === 'Escape' && isOpen) {
        toggleOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggleOpen]);

  // Filter events
  const filteredHistory = history.filter((item) => {
    if (filter === 'GESTURES') return item.category === 'gestures';
    if (filter === 'UI') return item.category === 'ui';
    return true;
  });

  // Badge stylings
  const getBadgeStyle = (type) => {
    switch (type) {
      case 'SWIPE':
        return 'bg-cyan-950 text-cyan-300 border-cyan-500/50';
      case 'PINCH':
        return 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-500/50';
      case 'FIST':
        return 'bg-amber-950 text-amber-300 border-amber-500/50';
      case 'OPEN_HAND':
        return 'bg-emerald-950 text-emerald-300 border-emerald-500/50';
      case 'SLIDER':
      case 'SCROLL':
      case 'MODAL':
      case 'UI_ACTION':
        return 'bg-violet-950 text-violet-300 border-violet-500/50';
      default:
        return 'bg-zinc-800 text-zinc-300 border-zinc-700';
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'SWIPE':
        return '↔️';
      case 'PINCH':
        return '🤏';
      case 'FIST':
        return '✊';
      case 'OPEN_HAND':
        return '🖐️';
      case 'SLIDER':
        return '🎚️';
      case 'SCROLL':
        return '📜';
      case 'MODAL':
        return '🪟';
      default:
        return '⚡';
    }
  };

  const isRight = position === 'right';

  return (
    <>
      {/* Semi-transparent Backdrop Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => toggleOpen(false)}
        aria-hidden="true"
      />

      {/* Floating Trigger Button (when closed) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => toggleOpen(true)}
          className={`fixed z-30 top-20 ${
            isRight ? 'right-0 rounded-l-xl' : 'left-0 rounded-r-xl'
          } px-3 py-2.5 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 text-cyan-400 shadow-xl backdrop-blur-md transition-all duration-200 flex items-center gap-2 group`}
          title="Open Gesture History Drawer [H]"
        >
          <span className="text-base group-hover:scale-110 transition-transform">📋</span>
          <span className="hidden sm:inline font-mono text-xs font-semibold text-zinc-200 tracking-wider">
            HISTORY
          </span>
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        </button>
      )}

      {/* Slide-over Aside Drawer */}
      <aside
        className={`fixed top-0 bottom-0 z-50 w-80 sm:w-96 bg-zinc-950/95 backdrop-blur-2xl text-zinc-100 shadow-2xl flex flex-col transition-transform duration-300 ease-out border-zinc-800/80 ${
          isRight ? 'right-0 border-l' : 'left-0 border-r'
        } ${
          isOpen
            ? 'translate-x-0'
            : isRight
            ? 'translate-x-full'
            : '-translate-x-full'
        }`}
        role="dialog"
        aria-label="Gesture History Drawer"
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-300 text-sm font-bold">
              ⚡
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-zinc-100 flex items-center gap-2">
                Activity History
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              </h2>
              <p className="text-[11px] font-mono text-zinc-400">
                {history.length} events logged
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Clear Button */}
            <button
              type="button"
              onClick={() => setHistory([])}
              className="px-2 py-1 text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              title="Clear event logs"
            >
              Clear
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={() => toggleOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              aria-label="Close drawer"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-4 py-2 bg-zinc-900/40 border-b border-zinc-800 flex items-center gap-1.5 text-xs font-mono">
          <span className="text-zinc-500 mr-1">FILTER:</span>
          {['ALL', 'GESTURES', 'UI'].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilter(cat)}
              className={`px-2.5 py-0.5 rounded-full transition-colors ${
                filter === cat
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-semibold'
                  : 'text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Timeline Log List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 scrollbar-thin scrollbar-thumb-zinc-700">
          {filteredHistory.length === 0 ? (
            <div className="text-center py-16 text-zinc-500 font-mono text-xs">
              <span className="text-2xl block mb-2">🍃</span>
              No events match current filter.
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 transition-all duration-150 flex items-start gap-3"
              >
                {/* Icon */}
                <span className="text-lg select-none pt-0.5" aria-hidden="true">
                  {getIcon(item.type)}
                </span>

                {/* Event Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase border ${getBadgeStyle(
                        item.type
                      )}`}
                    >
                      {item.type}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {formatTime(item.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-zinc-200 truncate">
                    {item.label}
                  </p>
                  {item.details && (
                    <p className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                      {item.details}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={historyEndRef} />
        </div>

        {/* Drawer Footer / Cheat Sheet */}
        <div className="p-3.5 bg-zinc-900/80 border-t border-zinc-800 text-xs font-mono text-zinc-400 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-500">GESTURE TRIGGER:</span>
            <span className="text-cyan-300">SWIPE {isRight ? 'LEFT / RIGHT' : 'RIGHT / LEFT'}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-500">KEYBOARD SHORTCUT:</span>
            <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-200">
              H
            </kbd>
          </div>
        </div>
      </aside>
    </>
  );
}
