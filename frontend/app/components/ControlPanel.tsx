'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
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

const MASS_PRESETS = [
  { label: 'Meteorite', kg: 1e3, desc: 'Small meteorite (1 tonne) — localized damage, small crater' },
  { label: 'Chelyabinsk', kg: 1.2e7, desc: 'Chelyabinsk-class (12,000 tonnes) — airburst, shattered windows across city' },
  { label: 'Tunguska', kg: 1e9, desc: 'Tunguska-class (1M tonnes) — flattens forests, city-destroying airburst' },
  { label: 'City Killer', kg: 1e10, desc: 'City killer (10M tonnes) — regional devastation, firestorm' },
  { label: 'Chicxulub', kg: 1e14, desc: 'Chicxulub-class — extinction-level event, global devastation' },
];

interface NasaMeteorite {
  name: string;
  year: string | null;
  mass_g: number;
  recclass: string;
}

function formatMassShort(g: number): string {
  const kg = g / 1000;
  if (kg >= 1e9) return `${(kg / 1e9).toFixed(1)}B kg`;
  if (kg >= 1e6) return `${(kg / 1e6).toFixed(1)}M kg`;
  if (kg >= 1e3) return `${(kg / 1e3).toFixed(0)}t`;
  if (kg >= 1) return `${kg.toFixed(1)} kg`;
  return `${g.toFixed(0)} g`;
}

interface ControlPanelProps {
  selectedPoint: [number, number] | null;
  radiusKm: number;
  onRadiusKmChange: (km: number) => void;
  onSimulate: (params: {
    radius_km: number;
    disaster_type: DisasterType;
    rainfall_mm?: number;
    ef_scale?: number;
    direction_deg?: number;
    mass_kg?: number;
  }) => void;
  isLoading: boolean;
}

export default function ControlPanel({
  selectedPoint,
  radiusKm,
  onRadiusKmChange,
  onSimulate,
  isLoading,
}: ControlPanelProps) {
  const [disasterType, setDisasterType] = useState<DisasterType>('flood');
  // Flood
  const [rainfallMm, setRainfallMm] = useState(150);
  // Tornado
  const [efScale, setEfScale] = useState(3);
  const [directionDeg, setDirectionDeg] = useState(45);
  // Asteroid
  const [massKg, setMassKg] = useState(1.2e7);
  // NASA meteorite data
  const [nasaMeteorites, setNasaMeteorites] = useState<NasaMeteorite[]>([]);
  const [meteoritesLoading, setMeteoritesLoading] = useState(false);
  const [meteoritesError, setMeteoritesError] = useState<string | null>(null);

  // Fetch NASA meteorites when asteroid tab is selected
  useEffect(() => {
    if (disasterType !== 'asteroid' || nasaMeteorites.length > 0) return;
    let cancelled = false;
    setMeteoritesLoading(true);
    fetch('http://localhost:8000/api/meteorites?limit=1000&min_mass_g=100')
      .then((r) => r.json())
      .then((geojson) => {
        if (cancelled) return;
        const items: NasaMeteorite[] = (geojson.features || []).map(
          (f: { properties: Record<string, unknown> }) => ({
            name: f.properties.name as string,
            year: f.properties.year as string | null,
            mass_g: f.properties.mass_g as number,
            recclass: f.properties.recclass as string,
          }),
        );
        setNasaMeteorites(items);
        setMeteoritesError(null);
      })
      .catch(() => {
        if (!cancelled) setMeteoritesError('Failed to load NASA data');
      })
      .finally(() => {
        if (!cancelled) setMeteoritesLoading(false);
      });
    return () => { cancelled = true; };
  }, [disasterType, nasaMeteorites.length]);

  const handleSubmit = () => {
    if (disasterType === 'flood') {
      onSimulate({ radius_km: radiusKm, disaster_type: 'flood', rainfall_mm: rainfallMm });
    } else if (disasterType === 'tornado') {
      onSimulate({ radius_km: radiusKm, disaster_type: 'tornado', ef_scale: efScale, direction_deg: directionDeg });
    } else {
      onSimulate({ radius_km: radiusKm, disaster_type: 'asteroid', mass_kg: massKg });
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
        <Image
          src="/logo.png"
          alt="CrisisPath"
          width={200}
          height={48}
          priority
          className="h-10 w-auto max-w-full object-contain object-left"
        />
        <p className="text-xs text-white/60 mt-2">
          AI-powered disaster risk analysis & response
        </p>
      </div>

      {/* Disaster Type Selector */}
      <div className="border-t border-white/10 pt-3">
        <h2 className="text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
          Disaster Type
        </h2>
        <div className="flex gap-1.5">
          {(['flood', 'tornado', 'asteroid'] as DisasterType[]).map((type) => {
            const activeColor = type === 'flood' ? 'bg-blue-600' : type === 'tornado' ? 'bg-amber-600' : 'bg-orange-600';
            return (
              <button
                key={type}
                onClick={() => setDisasterType(type)}
                className={`flex-1 text-xs py-1.5 px-2 rounded transition-colors capitalize ${
                  disasterType === type
                    ? `${activeColor} text-white`
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {type}
              </button>
            );
          })}
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

      {/* Scan Radius — hidden for asteroid (damage radius is the scan area) */}
      {disasterType !== 'asteroid' && (
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
            onChange={(e) => onRadiusKmChange(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-[10px] text-white/50 mt-0.5">
            <span>1 km</span>
            <span>10 km</span>
          </div>
        </div>
      )}

      {/* Disaster-specific controls */}
      {disasterType === 'asteroid' ? (
        <>
          {/* Mass selector */}
          <div className="border-t border-white/10 pt-3">
            <label className="block text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
              Impactor Mass: {massKg >= 1e9 ? `${(massKg / 1e9).toFixed(1)}B kg` : massKg >= 1e6 ? `${(massKg / 1e6).toFixed(1)}M kg` : `${(massKg / 1e3).toFixed(0)}K kg`}
            </label>
            <input
              type="range"
              min={3}
              max={14}
              step={0.5}
              value={Math.log10(massKg)}
              onChange={(e) => setMassKg(Math.pow(10, Number(e.target.value)))}
              className="w-full accent-orange-500"
            />
            <div className="flex justify-between text-[10px] text-white/50 mt-0.5">
              <span>1 tonne</span>
              <span>100T tonnes</span>
            </div>
            <p className="text-[11px] text-white/60 mt-1.5">
              {MASS_PRESETS.find((p) => Math.abs(Math.log10(p.kg) - Math.log10(massKg)) < 0.5)?.desc || 'Custom impactor mass'}
            </p>
          </div>

          {/* Mass presets */}
          <div className="grid grid-cols-3 gap-1.5">
            {MASS_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setMassKg(preset.kg)}
                className={`text-[11px] py-1.5 px-2 rounded transition-colors ${
                  Math.abs(Math.log10(massKg) - Math.log10(preset.kg)) < 0.3
                    ? 'bg-orange-600 text-white'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* NASA real meteorite selector */}
          <div className="border-t border-white/10 pt-3">
            <label className="block text-xs font-semibold text-white/80 uppercase tracking-wide mb-2">
              Real Meteorite Data (NASA)
            </label>
            {meteoritesLoading ? (
              <div className="flex items-center gap-2 text-xs text-white/50">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Loading NASA data...
              </div>
            ) : meteoritesError ? (
              <p className="text-xs text-red-400">{meteoritesError}</p>
            ) : (
              <select
                className="w-full bg-white/10 text-white text-xs rounded px-2 py-2 border border-white/15 focus:border-orange-500 focus:outline-none appearance-none cursor-pointer"
                defaultValue=""
                onChange={(e) => {
                  const m = nasaMeteorites[Number(e.target.value)];
                  if (m) setMassKg(m.mass_g / 1000);
                }}
              >
                <option value="" disabled className="bg-[#1a1a2e]">
                  Select a real meteorite...
                </option>
                {nasaMeteorites.map((m, i) => (
                  <option key={`${m.name}-${i}`} value={i} className="bg-[#1a1a2e]">
                    {m.name} {m.year ? `(${m.year})` : ''} — {formatMassShort(m.mass_g)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      ) : disasterType === 'flood' ? (
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
            : disasterType === 'asteroid'
              ? 'bg-orange-600 hover:bg-orange-500'
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
        ) : disasterType === 'tornado' ? (
          'Analyze Tornado Risk'
        ) : (
          'Simulate Impact'
        )}
      </button>
    </div>
  );
}
