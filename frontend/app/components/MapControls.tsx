'use client';

interface MapControlsProps {
  is3D: boolean;
  isDayMode: boolean;
  onToggle3D: () => void;
  onToggleDayNight: () => void;
}

export default function MapControls({
  is3D,
  isDayMode,
  onToggle3D,
  onToggleDayNight,
}: MapControlsProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* 2D/3D Toggle */}
      <button
        onClick={onToggle3D}
        className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition-all backdrop-blur-md border ${
          is3D
            ? 'bg-white/20 text-white border-white/20 shadow-lg'
            : 'bg-[rgba(15,15,35,0.75)] text-white/80 border-white/15 hover:bg-white/20 hover:text-white shadow-lg'
        }`}
        title={is3D ? 'Switch to 2D view' : 'Switch to 3D view'}
      >
        {is3D ? '3D' : '2D'}
      </button>

      {/* Day/Night Toggle */}
      <button
        onClick={onToggleDayNight}
        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all backdrop-blur-md border ${
          isDayMode
            ? 'bg-white/20 text-white border-white/20 shadow-lg'
            : 'bg-[rgba(15,15,35,0.75)] text-white/80 border-white/15 hover:bg-white/20 hover:text-white shadow-lg'
        }`}
        title={isDayMode ? 'Switch to night' : 'Switch to day'}
      >
        {isDayMode ? (
          // Sun icon
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          // Moon icon
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
    </div>
  );
}
