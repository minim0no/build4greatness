'use client';

interface Preset {
  name: string;
  severity: number;
  rainfall_mm: number;
  water_source: string;
  description: string;
  icon: string;
}

const presets: Preset[] = [
  {
    name: 'Flash Flood',
    severity: 4,
    rainfall_mm: 200,
    water_source: 'N',
    description: 'Sudden intense rainfall causing rapid water rise',
    icon: '\u26A1',
  },
  {
    name: 'Hurricane',
    severity: 5,
    rainfall_mm: 350,
    water_source: 'S',
    description: 'Category 3+ storm surge with heavy rain',
    icon: '\uD83C\uDF00',
  },
  {
    name: 'River Overflow',
    severity: 3,
    rainfall_mm: 150,
    water_source: 'W',
    description: 'Gradual river level rise from sustained rain',
    icon: '\uD83C\uDF0A',
  },
  {
    name: 'Dam Break',
    severity: 5,
    rainfall_mm: 50,
    water_source: 'N',
    description: 'Catastrophic dam failure releasing stored water',
    icon: '\uD83D\uDEA8',
  },
];

interface ScenarioSelectorProps {
  selectedName: string | null;
  onSelect: (params: { severity: number; rainfall_mm: number; water_source: string; name: string }) => void;
}

export default function ScenarioSelector({ selectedName, onSelect }: ScenarioSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {presets.map((preset) => {
        const isSelected = selectedName === preset.name;
        return (
          <button
            key={preset.name}
            onClick={() =>
              onSelect({
                severity: preset.severity,
                rainfall_mm: preset.rainfall_mm,
                water_source: preset.water_source,
                name: preset.name,
              })
            }
            className={`rounded-lg p-2.5 text-left transition-colors border ${
              isSelected
                ? 'bg-blue-900/40 border-blue-500 ring-1 ring-blue-500/50'
                : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-600 hover:border-blue-500'
            }`}
          >
            <div className="text-lg mb-1">{preset.icon}</div>
            <p className={`text-xs font-medium ${isSelected ? 'text-blue-300' : 'text-zinc-200'}`}>
              {preset.name}
            </p>
            <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
              {preset.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
