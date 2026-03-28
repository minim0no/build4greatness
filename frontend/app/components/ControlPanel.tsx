'use client';

import { useState } from 'react';
import ScenarioSelector from './ScenarioSelector';

interface ControlPanelProps {
  selectedPoint: [number, number] | null;
  onSimulate: (params: {
    severity: number;
    rainfall_mm: number;
    water_source: string;
  }) => void;
  isLoading: boolean;
}

export default function ControlPanel({
  selectedPoint,
  onSimulate,
  isLoading,
}: ControlPanelProps) {
  const [severity, setSeverity] = useState(3);
  const [rainfall, setRainfall] = useState(100);
  const [waterSource, setWaterSource] = useState('N');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const handleSubmit = () => {
    onSimulate({
      severity,
      rainfall_mm: rainfall,
      water_source: waterSource,
    });
  };

  const handlePresetSelect = (params: {
    severity: number;
    rainfall_mm: number;
    water_source: string;
    name: string;
  }) => {
    setSeverity(params.severity);
    setRainfall(params.rainfall_mm);
    setWaterSource(params.water_source);
    setSelectedPreset(params.name);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-white">CrisisPath</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          AI-powered flood simulation & response
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

      {/* Scenario presets */}
      <div className="border-t border-zinc-700 pt-3">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Quick Scenarios
        </h2>
        <ScenarioSelector selectedName={selectedPreset} onSelect={handlePresetSelect} />
      </div>

      {/* Advanced controls */}
      <div className="border-t border-zinc-700 pt-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
        >
          <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>
            &#9654;
          </span>
          Advanced Settings
        </button>

        {showAdvanced && (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Severity: {severity}
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                <span>Minor</span>
                <span>Catastrophic</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Rainfall (mm)</label>
              <input
                type="number"
                min={0}
                max={500}
                value={rainfall}
                onChange={(e) => setRainfall(Number(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-1.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Water Source</label>
              <select
                value={waterSource}
                onChange={(e) => setWaterSource(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-1.5 text-sm text-white"
              >
                <option value="N">North</option>
                <option value="S">South</option>
                <option value="E">East</option>
                <option value="W">West</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!selectedPoint || isLoading}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Simulating...
          </span>
        ) : (
          'Run Simulation'
        )}
      </button>
    </div>
  );
}
