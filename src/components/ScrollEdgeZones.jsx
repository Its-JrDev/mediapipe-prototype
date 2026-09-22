import React, { useEffect, useState } from 'react';
import { gestureEventBus as defaultBus } from '../events/GestureEventBus.js';

/**
 * ScrollEdgeZones
 * Bandas fijas top/bottom que indican scroll por borde.
 * Sin pointer-events: solo feedback visual, no capturan clicks.
 */
export default function ScrollEdgeZones({ eventBus }) {
  const bus = eventBus || defaultBus;
  const [zone, setZone] = useState('NONE');
  const [mode, setMode] = useState('TRACKING');

  useEffect(() => {
    const unsubEdge = bus.on('gesture:edge-scroll', (data) => {
      setZone(data?.zone || 'NONE');
    });
    const unsubMode = bus.on('gesture:mode', (data) => {
      setMode(data?.mode || 'TRACKING');
    });
    return () => {
      unsubEdge();
      unsubMode();
    };
  }, [bus]);

  const active = mode === 'EDGE_SCROLL' && zone !== 'NONE';
  const topHot = zone === 'TOP';
  const bottomHot = zone === 'BOTTOM';

  return (
    <>
      <div
        className={`fixed top-0 left-0 right-0 h-[7vh] z-40 pointer-events-none transition-all duration-200 flex items-start justify-center pt-2 ${
          topHot ? (active ? 'bg-emerald-500/25' : 'bg-cyan-500/10') : 'bg-transparent'
        }`}
        aria-hidden="true"
      >
        <span
          className={`px-3 py-1 rounded-full text-[11px] font-mono font-bold border backdrop-blur-md ${
            topHot
              ? active
                ? 'bg-emerald-950/90 border-emerald-400 text-emerald-200 animate-pulse'
                : 'bg-zinc-950/80 border-cyan-500/50 text-cyan-200'
              : 'bg-zinc-950/40 border-zinc-800 text-zinc-500'
          }`}
        >
          {active && topHot ? '▲ SCROLL UP' : 'BORDE TOP · SCROLL'}
        </span>
      </div>
      <div
        className={`fixed bottom-0 left-0 right-0 h-[7vh] z-40 pointer-events-none transition-all duration-200 flex items-end justify-center pb-2 ${
          bottomHot ? (active ? 'bg-emerald-500/25' : 'bg-cyan-500/10') : 'bg-transparent'
        }`}
        aria-hidden="true"
      >
        <span
          className={`px-3 py-1 rounded-full text-[11px] font-mono font-bold border backdrop-blur-md ${
            bottomHot
              ? active
                ? 'bg-emerald-950/90 border-emerald-400 text-emerald-200 animate-pulse'
                : 'bg-zinc-950/80 border-cyan-500/50 text-cyan-200'
              : 'bg-zinc-950/40 border-zinc-800 text-zinc-500'
          }`}
        >
          {active && bottomHot ? '▼ SCROLL DOWN' : 'BORDE BOTTOM · SCROLL'}
        </span>
      </div>
    </>
  );
}
