import React, { useEffect, useState, useRef } from 'react';
import GestureCursor from './components/GestureCursor';
import BeforeAfterSlider from './components/BeforeAfterSlider';
import HistoryAside from './components/HistoryAside';
import ModalNavbar from './components/ModalNavbar';
import GestureEngine from './gesture-engine/index.js';
import MockGestureDriver from './gesture-engine/MockGestureDriver.js';
import gestureEventBus from './events/GestureEventBus.js';

import './App.css'; // Mantenemos el estilo base si hay, aunque los componentes tienen Tailwind

function App() {
  const [engineState, setEngineState] = useState('initializing'); // 'initializing', 'ready', 'error'
  const engineRef = useRef(null);
  const driverRef = useRef(null);

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
          engineRef.current = new GestureEngine({ eventBus: gestureEventBus });
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
      if (driverRef.current) {
        // Asumiendo que MockGestureDriver tiene un método stop o dispose
        if (typeof driverRef.current.stop === 'function') driverRef.current.stop();
      }
      if (engineRef.current) {
        engineRef.current.cleanup();
      }
    };
  }, []);

  return (
    <div className="w-screen h-screen bg-gray-900 text-white overflow-hidden relative font-sans">
      {/* UI Components Overlay */}
      <ModalNavbar />
      
      {/* Main Content Area */}
      <main className="w-full h-full flex flex-col items-center justify-center pt-16">
        {engineState === 'initializing' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-fuchsia-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-lg font-medium text-gray-200">Initializing Gesture Engine...</p>
            </div>
          </div>
        )}
        
        {engineState === 'error' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
            <div className="text-center bg-red-900/50 p-6 rounded-lg border border-red-500">
              <p className="text-xl font-bold text-red-400 mb-2">Failed to start Vision Engine</p>
              <p className="text-sm text-gray-300">Check webcam permissions or try setting VITE_SIMULATE_GESTURES=true in .env</p>
            </div>
          </div>
        )}

        {/* Demo Content */}
        <div className="relative w-full max-w-5xl h-[600px] flex items-center justify-center p-8">
          <BeforeAfterSlider />
        </div>
      </main>

      {/* Slide-out History */}
      <HistoryAside />
      
      {/* Cinematic Virtual Cursor */}
      <GestureCursor />
    </div>
  );
}

export default App;
