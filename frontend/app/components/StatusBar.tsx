'use client';

import type { SimulationStatus, DisasterType } from '../hooks/useSimulation';

interface StatusBarProps {
  status: SimulationStatus;
  message: string;
  disasterType: DisasterType;
}

const FLOOD_STAGES: { key: SimulationStatus; label: string }[] = [
  { key: 'fetching_hazard_data', label: 'FEMA Data' },
  { key: 'fetching_infrastructure', label: 'Infrastructure' },
  { key: 'analyzing', label: 'AI Analysis' },
  { key: 'planning', label: 'Response Plan' },
  { key: 'complete', label: 'Complete' },
];

const TORNADO_STAGES: { key: SimulationStatus; label: string }[] = [
  { key: 'fetching_hazard_data', label: 'Tornado Path' },
  { key: 'fetching_infrastructure', label: 'Infrastructure' },
  { key: 'analyzing', label: 'AI Analysis' },
  { key: 'planning', label: 'Response Plan' },
  { key: 'complete', label: 'Complete' },
];

const ASTEROID_STAGES: { key: SimulationStatus; label: string }[] = [
  { key: 'fetching_hazard_data', label: 'Impact Sim' },
  { key: 'fetching_infrastructure', label: 'Infrastructure' },
  { key: 'analyzing', label: 'AI Analysis' },
  { key: 'planning', label: 'Response Plan' },
  { key: 'complete', label: 'Complete' },
];

export default function StatusBar({ status, message, disasterType }: StatusBarProps) {
  if (status === 'idle') return null;

  const stages = disasterType === 'asteroid' ? ASTEROID_STAGES : disasterType === 'tornado' ? TORNADO_STAGES : FLOOD_STAGES;

  const stageOrder: Record<string, number> = {};
  stages.forEach((s, i) => {
    stageOrder[s.key] = i;
  });

  const currentIndex = stageOrder[status] ?? -1;

  return (
    <div className="glass-panel px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        {stages.map((stage, i) => {
          const isComplete = i < currentIndex || status === 'complete';
          const isCurrent = i === currentIndex && status !== 'complete';

          return (
            <div key={stage.key} className="flex items-center gap-1.5 flex-1">
              <div
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  isComplete
                    ? disasterType === 'asteroid' ? 'bg-orange-500' : disasterType === 'tornado' ? 'bg-amber-500' : 'bg-blue-500'
                    : isCurrent
                      ? disasterType === 'asteroid' ? 'bg-orange-400 animate-pulse' : disasterType === 'tornado' ? 'bg-amber-400 animate-pulse' : 'bg-blue-400 animate-pulse'
                      : 'bg-white/10'
                }`}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-white/60">
        {status === 'error' ? (
          <span className="text-red-400">{message}</span>
        ) : (
          message
        )}
      </p>
    </div>
  );
}
