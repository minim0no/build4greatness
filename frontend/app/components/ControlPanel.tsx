'use client';

import { useState } from 'react';
import type { DisasterType } from '../hooks/useSimulation';

const RAIN_PRESETS = [
  { label: 'Storm', mm: 75, desc: 'Heavy rain — minor street flooding in low-lying areas' },
  { label: 'Tropical Storm', mm: 150, desc: 'Tropical storm — coastal surge zones flood, localized ponding' },
  { label: 'Category 1', mm: 225, desc: 'Cat 1 — Coastal + low-lying floodplains near waterways' },
  { label: 'Category 3', mm: 375, desc: 'Cat 3 — 500-year zones flood, widespread road closures' },
  { label: 'Category 5', mm: 500, desc: 'Cat 5 — All flood zones active, catastrophic inland flooding' },
];

const EF_PRESETS = [
  { label: 'EF0', scale: 0, desc: 'Light damage — broken branches, shallow-rooted trees toppled' },
  { label: 'EF1', scale: 1, desc: 'Moderate damage — roof surfaces peeled, mobile homes overturned' },
  { label: 'EF2', scale: 2, desc: 'Significant damage — roofs torn off, large trees snapped' },
  { label: 'EF3', scale: 3, desc: 'Severe damage — entire stories destroyed, heavy cars thrown' },
  { label: 'EF4', scale: 4, desc: 'Devastating damage — well-built homes leveled, structures blown away' },
  { label: 'EF5', scale: 5, desc: 'Incredible damage — strong frame houses swept away, high-rise damage' },
];

const DIRECTION_PRESETS = [
  { label: 'NE', deg: 45 },
  { label: 'E', deg: 90 },
  { label: 'SE', deg: 135 },
  { label: 'SW', deg: 225 },
];

interface ControlPanelProps {
  selectedPoint: [number, number] | null;
  onSimulate: (params: {
    radius_km: number;
    disaster_type: DisasterType;
    rainfall_mm?: number;
    ef_scale?: number;
    direction_deg?: number;
  }) => void;
  isLoading: boolean;
}

export default function ControlPanel({
  selectedPoint,
  onSimulate,
  isLoading,
}: ControlPanelProps) {
  const [disasterType, setDisasterType] = useState<DisasterType>('flood');
  const [radiusKm, setRadiusKm] = useState(3);
  // Flood
  const [rainfallMm, setRainfallMm] = useState(150);
  // Tornado
  const [efScale, setEfScale] = useState(3);
  const [directionDeg, setDirectionDeg] = useState(45);

  const handleSubmit = () => {
    if (disasterType === 'flood') {
      onSimulate({ radius_km: radiusKm, disaster_type: 'flood', rainfall_mm: rainfallMm });
    } else {
      onSimulate({ radius_km: radiusKm, disaster_type: 'tornado', ef_scale: efScale, direction_deg: directionDeg });
    }
  };

  // Flood storm description
  let stormDesc: string;
  if (rainfallMm < 75) stormDesc = 'Light rain — minimal flooding risk';
  else if (rainfallMm < 150) stormDesc = 'Heavy storm — minor street flooding in low-lying areas';
  else if (rainfallMm < 225) stormDesc = 'Tropical storm — coastal surge zones, localized ponding';
  else if (rainfallMm < 375) stormDesc = 'Cat 1-2 — Coastal + floodplains near waterways activate';
  else if (rainfallMm < 500) stormDesc = 'Cat 3-4 — 500-year zones flood, widespread road closures';
  else stormDesc = 'Cat 5 — All flood zones active, catastrophic inland flooding';

  const currentEfPreset = EF_PRESETS.find((p) => p.scale === efScale);

  return (
    <div className="glass-panel p-4 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-white">Atlas</h1>
        <p className="text-xs text-white/60 mt-0.5">
          AI-powered disaster risk analysis & response
        </p>
      </div>

      {/* Disaster Type Selector */}
      <div className="border-t border-white/10 pt-3">
        <h2 className="text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
          Disaster Type
        </h2>
        <div className="flex gap-1.5">
          {(['flood', 'tornado'] as DisasterType[]).map((type) => (
            <button
              key={type}
              onClick={() => setDisasterType(type)}
              className={`flex-1 text-xs py-1.5 px-2 rounded transition-colors capitalize ${
                disasterType === type
                  ? type === 'flood' ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 pt-3">
        <h2 className="text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
          Location
        </h2>
        {selectedPoint ? (
          <p className="text-sm text-white font-mono">
            {selectedPoint[1].toFixed(4)}, {selectedPoint[0].toFixed(4)}
          </p>
        ) : (
          <p className="text-xs text-white/60 italic">
            Click on the map to select a location
          </p>
        )}
      </div>

      {/* Scan Radius */}
      <div className="border-t border-white/10 pt-3">
        <label className="block text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
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
        <div className="flex justify-between text-[10px] text-white/50 mt-0.5">
          <span>1 km</span>
          <span>10 km</span>
        </div>
      </div>

      {/* Disaster-specific controls */}
      {disasterType === 'flood' ? (
        <>
          {/* Rainfall / Storm Intensity */}
          <div className="border-t border-white/10 pt-3">
            <label className="block text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
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
            <div className="flex justify-between text-[10px] text-white/50 mt-0.5">
              <span>Drizzle</span>
              <span>Cat 5</span>
            </div>
            <p className="text-[11px] text-white/60 mt-1.5">{stormDesc}</p>
          </div>

          {/* Storm category presets */}
          <div className="grid grid-cols-3 gap-1.5">
            {RAIN_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setRainfallMm(preset.mm)}
                className={`text-[11px] py-1.5 px-2 rounded transition-colors ${
                  rainfallMm === preset.mm
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* EF Scale */}
          <div className="border-t border-white/10 pt-3">
            <label className="block text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
              EF Scale: EF{efScale}
            </label>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={efScale}
              onChange={(e) => setEfScale(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="flex justify-between text-[10px] text-white/50 mt-0.5">
              <span>EF0</span>
              <span>EF5</span>
            </div>
            {currentEfPreset && (
              <p className="text-[11px] text-white/60 mt-1.5">{currentEfPreset.desc}</p>
            )}
          </div>

          {/* Direction */}
          <div className="border-t border-white/10 pt-3">
            <label className="block text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
              Direction of Travel
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {DIRECTION_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setDirectionDeg(preset.deg)}
                  className={`text-[11px] py-1.5 px-2 rounded transition-colors ${
                    directionDeg === preset.deg
                      ? 'bg-amber-600 text-white'
                      : 'bg-white/10 text-white/80 hover:bg-white/20'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* EF presets */}
          <div className="grid grid-cols-3 gap-1.5">
            {EF_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setEfScale(preset.scale)}
                className={`text-[11px] py-1.5 px-2 rounded transition-colors ${
                  efScale === preset.scale
                    ? 'bg-amber-600 text-white'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </>
      )}

      <button
        onClick={handleSubmit}
        disabled={!selectedPoint || isLoading}
        className={`w-full ${
          disasterType === 'tornado'
            ? 'bg-amber-600 hover:bg-amber-500'
            : 'bg-blue-600 hover:bg-blue-500'
        } disabled:bg-white/10 disabled:text-white/40 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Analyzing...
          </span>
        ) : disasterType === 'flood' ? (
          'Analyze Flood Risk'
        ) : (
          'Analyze Tornado Risk'
        )}
      </button>
    </div>
  );
}
