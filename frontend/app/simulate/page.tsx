'use client';

import { useState } from 'react';

import MapView from '../components/MapView';

export default function SimulationPage() {
  const [isMapReady, setIsMapReady] = useState(false);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050814]">
      <div className={`h-full w-full transition-opacity duration-700 ${isMapReady ? 'opacity-100' : 'opacity-0'}`}>
        <MapView onReady={() => setIsMapReady(true)} />
      </div>

      <div
        className={`absolute inset-0 z-50 bg-[#050814] transition-opacity duration-700 ${
          isMapReady ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      />
    </div>
  );
}
