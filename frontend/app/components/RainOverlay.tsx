'use client';

/**
 * Atmospheric rain when a flood simulation is active (in progress or showing results).
 */
export default function RainOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="rain-overlay pointer-events-none absolute inset-0 z-[15] overflow-hidden" aria-hidden>
      <div className="rain-overlay__layer" />
      <div className="rain-overlay__layer rain-overlay__layer--slow" />
      <div className="rain-overlay__layer rain-overlay__layer--fast" />
    </div>
  );
}
