'use client';

import type { SimulationStatus } from '../hooks/useSimulation';

interface StatusBarProps {
  status: SimulationStatus;
  message: string;
}

const stages: { key: SimulationStatus; label: string }[] = [
  { key: 'fetching_elevation', label: 'Elevation' },
  { key: 'simulating', label: 'Simulation' },
  { key: 'fetching_infrastructure', label: 'Infrastructure' },
  { key: 'analyzing', label: 'AI Analysis' },
  { key: 'planning', label: 'Response Plan' },
  { key: 'complete', label: 'Complete' },
];

const stageOrder: Record<string, number> = {};
stages.forEach((s, i) => {
  stageOrder[s.key] = i;
});

export default function StatusBar({ status, message }: StatusBarProps) {
  if (status === 'idle') return null;

  const currentIndex = stageOrder[status] ?? -1;

  return (
    <div className="px-4 py-3 border-b border-zinc-700">
      <div className="flex items-center gap-1.5 mb-2">
        {stages.map((stage, i) => {
          const isComplete = i < currentIndex || status === 'complete';
          const isCurrent = i === currentIndex && status !== 'complete';

          return (
            <div key={stage.key} className="flex items-center gap-1.5 flex-1">
              <div
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  isComplete
                    ? 'bg-blue-500'
                    : isCurrent
                      ? 'bg-blue-400 animate-pulse'
                      : 'bg-zinc-700'
                }`}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-zinc-400">
        {status === 'error' ? (
          <span className="text-red-400">{message}</span>
        ) : (
          message
        )}
      </p>
    </div>
  );
}
