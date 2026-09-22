import React from 'react';
import BeforeAfterSlider from '../components/BeforeAfterSlider.jsx';

export { APP_PAGES, PAGE_META } from './pages.js';

export function HomePage() {
  return (
    <div className="max-w-4xl w-full">
      <p className="text-xs font-mono text-emerald-400 mb-2">PÁGINA · INICIO</p>
      <h1 className="text-6xl md:text-8xl font-black mb-8 bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500 bg-clip-text text-transparent leading-tight pb-2">
        Gestos en Vivo
      </h1>
      <p className="text-2xl text-zinc-400 mb-16 leading-relaxed max-w-3xl">
        1. <strong className="text-white bg-white/10 px-2 py-1 rounded">Muestra tu seña custom mapeada</strong> para abrir o cerrar el Modal, y usa <strong className="text-white bg-white/10 px-2 py-1 rounded">Pinch 🤏</strong> para pulsar sus pestañas y botones.<br /><br />
        2. Lleva la mano al <strong className="text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-1 rounded font-bold">borde TOP o BOTTOM</strong> para scroll, o asigna tus señas de scroll arriba/abajo en el Modal.<br /><br />
        3. Une tu <strong className="text-white bg-white/10 px-2 py-1 rounded">Pulgar e Índice (Pinch)</strong> para hacer Touch/Click en las tarjetas.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-32">
        {[1, 2, 3, 4].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => alert(`¡Éxito! Hiciste Touch en la Tarjeta ${i}`)}
            className="group relative bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-emerald-500/50 transition-all p-12 rounded-3xl text-left cursor-pointer overflow-hidden isolate"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
            <h3 className="text-3xl font-bold text-white mb-2">Tarjeta Interactiva {i}</h3>
            <p className="text-zinc-400">Haz Pinch aquí para interactuar</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function StudioPage() {
  return (
    <div className="max-w-4xl w-full">
      <p className="text-xs font-mono text-fuchsia-400 mb-2">PÁGINA · ESTUDIO</p>
      <h1 className="text-6xl md:text-8xl font-black mb-8 bg-gradient-to-r from-fuchsia-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent leading-tight pb-2">
        Estudio
      </h1>
      <p className="text-2xl text-zinc-400 mb-12 leading-relaxed max-w-3xl">
        Mueve el divisor del comparador con el cursor o haz pinch sobre la imagen para fijar la posición.
      </p>
      <div className="mb-32">
        <BeforeAfterSlider />
      </div>
      <div className="h-96 w-full rounded-3xl bg-gradient-to-br from-indigo-950 to-zinc-900 border border-indigo-500/20 flex flex-col items-center justify-center p-12 text-center mb-32">
        <h2 className="text-5xl font-bold mb-4 text-indigo-200">Sigue bajando...</h2>
        <p className="text-xl text-zinc-400">Usa el borde TOP o BOTTOM para scroll</p>
      </div>
    </div>
  );
}

export function InfoPage() {
  return (
    <div className="max-w-4xl w-full">
      <p className="text-xs font-mono text-cyan-400 mb-2">PÁGINA · INFO</p>
      <h1 className="text-6xl md:text-8xl font-black mb-8 bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent leading-tight pb-2">
        Info
      </h1>
      <p className="text-2xl text-zinc-400 mb-12 leading-relaxed max-w-3xl">
        Prototipo de control por gestos con MediaPipe: modos exclusivos, scroll por bordes y click por pinch.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-32">
        {[
          ['🤏', 'Pinch', 'Click izquierdo donde apunta el cursor'],
          ['▼▲', 'Bordes', 'Scroll continuo top / bottom'],
          ['🤟', 'Custom', 'Tu seña abre el modal'],
        ].map(([icon, title, desc]) => (
          <div key={title} className="p-8 rounded-3xl bg-zinc-800 border border-zinc-700 text-center">
            <p className="text-4xl mb-3">{icon}</p>
            <h3 className="text-xl font-bold text-white mb-1">{title}</h3>
            <p className="text-zinc-400 text-sm">{desc}</p>
          </div>
        ))}
      </div>
      <div className="h-[400px] w-full rounded-3xl bg-gradient-to-tl from-cyan-950 to-zinc-900 border border-cyan-500/20 flex flex-col items-center justify-center p-12 text-center shadow-2xl mb-16">
        <h2 className="text-5xl font-black mb-6 bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">¡Llegaste al final!</h2>
        <p className="text-xl text-zinc-400 max-w-lg">Navega con el modal a otra página.</p>
      </div>
    </div>
  );
}
