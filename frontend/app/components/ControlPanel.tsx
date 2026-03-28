'use client';

import { useState } from 'react';

const RAIN_PRESETS = [
  { label: 'Tropical Storm', mm: 75, desc: 'Cat TS — Coastal surge zones flood, minor street flooding' },
  { label: 'Category 1', mm: 150, desc: 'Cat 1 — 100-year floodplain activates, low-lying roads impassable' },
  { label: 'Category 3', mm: 275, desc: 'Cat 3 — 500-year zones flood, widespread road closures' },
  { label: 'Category 5', mm: 450, desc: 'Cat 5 — All flood zones active, catastrophic inland flooding' },
];

interface ControlPanelProps {
  selectedPoint: [number, number] | null;
  onSimulate: (params: { radius_km: number; rainfall_mm: number }) => void;
  isLoading: boolean;
}

export default function ControlPanel({
  selectedPoint,
  onSimulate,
  isLoading,
}: ControlPanelProps) {
  const [radiusKm, setRadiusKm] = useState(3);
  const [rainfallMm, setRainfallMm] = useState(150);

  const handleSubmit = () => {
    onSimulate({ radius_km: radiusKm, rainfall_mm: rainfallMm });
  };

  // Match current rainfall to storm category description
  let stormDesc: string;
  if (rainfallMm < 75) stormDesc = 'Minor flooding — only extreme-risk coastal zones';
  else if (rainfallMm < 150) stormDesc = 'Cat TS — Coastal surge zones flood, minor street flooding';
  else if (rainfallMm < 275) stormDesc = 'Cat 1-2 — 100-year floodplain activates, low-lying roads impassable';
  else if (rainfallMm < 450) stormDesc = 'Cat 3-4 — 500-year zones flood, widespread road closures';
  else stormDesc = 'Cat 5 — All flood zones active, catastrophic inland flooding';

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-white">CrisisPath</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          AI-powered flood risk analysis & response
        </p>
      </div>

      <div className="border-t border-zinc-700 pt-3">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Location
        </h2>
        {selectedPoint ? (
          <p className="text-sm text-zinc-300 font-mono">
            {selectedPoint[1].toFixed(4)}, {selectedPoint[0].toFixed(4)}
          </p>
        ) : (
          <p className="text-xs text-zinc-500 italic">
            Click on the map to select a location
          </p>
        )}
      </div>

      {/* Scan Radius */}
      <div className="border-t border-zinc-700 pt-3">
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Scan Radius: {radiusKm} km
        </label>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
          <span>1 km</span>
          <span>10 km</span>
        </div>
      </div>

      {/* Rainfall / Storm Intensity */}
      <div className="border-t border-zinc-700 pt-3">
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Rainfall: {rainfallMm} mm
        </label>
        <input
          type="range"
          min={10}
          max={500}
          step={10}
          value={rainfallMm}
          onChange={(e) => setRainfallMm(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
          <span>Drizzle</span>
          <span>Cat 5</span>
        </div>
        <p className="text-[11px] text-zinc-500 mt-1.5">{stormDesc}</p>
      </div>

      {/* Storm category presets */}
      <div className="grid grid-cols-2 gap-1.5">
        {RAIN_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => setRainfallMm(preset.mm)}
            className={`text-[11px] py-1.5 px-2 rounded transition-colors ${
              rainfallMm === preset.mm
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!selectedPoint || isLoading}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Analyzing...
          </span>
        ) : (
          'Analyze Flood Risk'
        )}
      </button>
    </div>
  );
}
