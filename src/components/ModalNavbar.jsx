import React, { useState, useEffect, useCallback } from 'react';
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
 * ModalNavbar
 * A dual-purpose UI component providing a top navigation bar and an interactive modal overlay
 * with smooth CSS transitions that opens/closes on 'ui:toggle-modal' events or direct user interaction.
 */
export default function ModalNavbar({
  eventBus,
  title = 'MediaPipe Gesture Studio',
  subtitle = 'Computer Vision Prototype',
  defaultModalOpen = false,
  showNavbar = true,
  onModalToggle,
}) {
  const { subscribe, emit } = useGestureBus(eventBus);

  const [isModalOpen, setIsModalOpen] = useState(defaultModalOpen);
  const [activeTab, setActiveTab] = useState('GUIDE'); // 'GUIDE' | 'SHORTCUTS' | 'SETTINGS'
  const [lastGesture, setLastGesture] = useState('READY');

  // Interactive settings state inside modal
  const [audioFeedback, setAudioFeedback] = useState(true);
  const [dwellClick, setDwellClick] = useState(true);
  const [debugOverlay, setDebugOverlay] = useState(false);

  const toggleModal = useCallback((force) => {
    setIsModalOpen((prev) => {
      const next = typeof force === 'boolean' ? force : !prev;
      if (onModalToggle) onModalToggle(next);
      return next;
    });
  }, [onModalToggle]);

  // Subscribe to GestureEventBus
  useEffect(() => {
    // 1. UI TOGGLE MODAL
    const unsubModal = subscribe('ui:toggle-modal', () => {
      toggleModal();
    });

    // 2. Track gesture state for navbar status badge
    const unsubPinch = subscribe('gesture:pinch', (data) => {
      if (data?.active) setLastGesture('PINCH');
    });

    const unsubSwipe = subscribe('gesture:swipe', (data) => {
      if (data?.direction) setLastGesture(`SWIPE ${data.direction}`);
    });

    const unsubFist = subscribe('gesture:fist', (data) => {
      if (data?.active) setLastGesture('FIST');
    });

    const unsubOpen = subscribe('gesture:open', (data) => {
      if (data?.active) setLastGesture('OPEN HAND');
    });

    return () => {
      unsubModal();
      unsubPinch();
      unsubSwipe();
      unsubFist();
      unsubOpen();
    };
  }, [subscribe, toggleModal]);

  // Keyboard shortcut fallback: 'M' or 'm' toggles modal, 'Escape' closes
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'm' || e.key === 'M') {
        toggleModal();
      } else if (e.key === 'Escape' && isModalOpen) {
        toggleModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, toggleModal]);

  return (
    <>
      {/* Top Navigation Bar */}
      {showNavbar && (
        <header className="sticky top-0 z-30 w-full bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/80 px-4 py-3 select-none">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            {/* Brand Logo & Title */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-fuchsia-500 p-0.5 shadow-lg shadow-cyan-500/20">
                <div className="w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center text-cyan-400 font-bold text-base">
                  ⚡
                </div>
              </div>
              <div className="text-left">
                <h1 className="text-sm font-bold tracking-tight text-white m-0 leading-tight">
                  {title}
                </h1>
                <p className="text-[11px] font-mono text-zinc-400 m-0 leading-tight">
                  {subtitle}
                </p>
              </div>
            </div>

            {/* Center Status Pill */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs font-mono text-zinc-300 shadow-inner">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-zinc-400">STATUS:</span>
              <span className="text-cyan-300 font-semibold">{lastGesture}</span>
            </div>

            {/* Right Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Trigger Aside Drawer */}
              <button
                type="button"
                onClick={() => emit('ui:toggle-aside')}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/70 text-zinc-200 text-xs font-medium transition-all duration-150 flex items-center gap-1.5"
                title="Toggle History Aside [H]"
              >
                <span>📋</span>
                <span className="hidden sm:inline">Timeline</span>
                <kbd className="text-[10px] font-mono px-1 py-0.2 bg-zinc-800 border border-zinc-700 rounded text-zinc-400">
                  H
                </kbd>
              </button>

              {/* Trigger Guide / Settings Modal */}
              <button
                type="button"
                onClick={() => toggleModal(true)}
                className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/30 transition-all duration-150 flex items-center gap-1.5"
                title="Open Guide & Settings [M]"
              >
                <span>✨</span>
                <span>Guide & Settings</span>
                <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-black/40 border border-white/20 rounded text-white/90">
                  M
                </kbd>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Interactive Modal Overlay with Smooth CSS Transitions */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ease-out ${
          isModalOpen
            ? 'opacity-100 pointer-events-auto backdrop-blur-md bg-black/70'
            : 'opacity-0 pointer-events-none backdrop-blur-none bg-black/0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Backdrop click dismiss */}
        <div
          className="absolute inset-0"
          onClick={() => toggleModal(false)}
          aria-hidden="true"
        />

        {/* Modal Window Card */}
        <div
          className={`relative w-full max-w-2xl max-h-[90vh] bg-zinc-950/95 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ease-out transform ${
            isModalOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
          }`}
        >
          {/* Modal Header */}
          <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-300 text-xl font-bold">
                🎮
              </div>
              <div>
                <h2 id="modal-title" className="text-base font-bold text-white tracking-wide m-0">
                  Gesture Control Center
                </h2>
                <p className="text-xs text-zinc-400 font-mono m-0 mt-0.5">
                  Interactive reference & simulation controls
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => toggleModal(false)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="px-5 pt-3 bg-zinc-900/30 border-b border-zinc-800/60 flex items-center gap-2">
            {[
              { id: 'GUIDE', label: 'Gestures Guide', icon: '🖐️' },
              { id: 'SHORTCUTS', label: 'Mock Keys (Driver)', icon: '⌨️' },
              { id: 'SETTINGS', label: 'Preferences', icon: '⚙️' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 text-xs font-medium rounded-t-lg transition-all border-b-2 flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? 'border-cyan-400 text-cyan-300 bg-zinc-900/80 font-semibold'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Modal Content Body */}
          <div className="p-6 overflow-y-auto space-y-4 flex-1 text-left text-zinc-200 text-sm">
            {/* TAB 1: GESTURE GUIDE */}
            {activeTab === 'GUIDE' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-start gap-3">
                  <span className="text-2xl pt-0.5">🤏</span>
                  <div>
                    <h3 className="text-xs font-bold font-mono uppercase text-fuchsia-300 m-0">
                      Pinch Gesture
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 m-0">
                      Bring thumb (landmark 4) and index (landmark 8) within &lt;0.05 dist.
                    </p>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-500/40">
                      Trigger: Click / Drag / Select
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-start gap-3">
                  <span className="text-2xl pt-0.5">↔️</span>
                  <div>
                    <h3 className="text-xs font-bold font-mono uppercase text-cyan-300 m-0">
                      Swipe Gesture
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 m-0">
                      Rapid horizontal hand displacement over time across camera frame.
                    </p>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-500/40">
                      Trigger: Toggle History Aside
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-start gap-3">
                  <span className="text-2xl pt-0.5">✊</span>
                  <div>
                    <h3 className="text-xs font-bold font-mono uppercase text-amber-300 m-0">
                      Closed Fist
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 m-0">
                      All finger tips curled close to the wrist/palm root (landmark 0).
                    </p>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-500/40">
                      Trigger: Grip / Hold State
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-start gap-3">
                  <span className="text-2xl pt-0.5">🎚️</span>
                  <div>
                    <h3 className="text-xs font-bold font-mono uppercase text-emerald-300 m-0">
                      Index Pointing (Slider)
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 m-0">
                      Point index finger horizontally to position the Before/After divider.
                    </p>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                      Trigger: Smooth Split X%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SHORTCUTS / MOCK DRIVER */}
            {activeTab === 'SHORTCUTS' && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-400">
                  When camera is offline or for rapid testing, use the built-in keyboard driver:
                </p>
                <div className="divide-y divide-zinc-800 rounded-xl bg-zinc-900/60 border border-zinc-800">
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-xs text-zinc-300">Toggle Modal Overlay</span>
                    <kbd className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-cyan-300 font-bold">
                      M
                    </kbd>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-xs text-zinc-300">Toggle History Drawer</span>
                    <kbd className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-cyan-300 font-bold">
                      H
                    </kbd>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-xs text-zinc-300">Move Before/After Slider</span>
                    <div className="flex gap-1">
                      <kbd className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-cyan-300 font-bold">
                        ←
                      </kbd>
                      <kbd className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-cyan-300 font-bold">
                        →
                      </kbd>
                    </div>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-xs text-zinc-300">Scroll Up / Down</span>
                    <div className="flex gap-1">
                      <kbd className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-cyan-300 font-bold">
                        W
                      </kbd>
                      <kbd className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-cyan-300 font-bold">
                        S
                      </kbd>
                    </div>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-xs text-zinc-300">Emulate Pinch / Click</span>
                    <span className="text-xs font-mono text-zinc-400">Mouse Left Click</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: PREFERENCES */}
            {activeTab === 'SETTINGS' && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200 m-0">
                      Audio Feedback
                    </h4>
                    <p className="text-[11px] text-zinc-400 m-0 mt-0.5">
                      Play acoustic cues on gesture triggers & pinch clicks.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={audioFeedback}
                    onChange={(e) => setAudioFeedback(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200 m-0">
                      Dwell Click Activation
                    </h4>
                    <p className="text-[11px] text-zinc-400 m-0 mt-0.5">
                      Automatically execute click after holding cursor still for 1.0s.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={dwellClick}
                    onChange={(e) => setDwellClick(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200 m-0">
                      Debug Landmark HUD
                    </h4>
                    <p className="text-[11px] text-zinc-400 m-0 mt-0.5">
                      Show raw MediaPipe landmarks and jitter delta.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={debugOverlay}
                    onChange={(e) => setDebugOverlay(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-4 bg-zinc-900/60 border-t border-zinc-800 flex items-center justify-between">
            <span className="text-[11px] font-mono text-zinc-500">
              Press <kbd className="text-zinc-400 font-bold">ESC</kbd> or <kbd className="text-zinc-400 font-bold">M</kbd> to close
            </span>
            <button
              type="button"
              onClick={() => toggleModal(false)}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
