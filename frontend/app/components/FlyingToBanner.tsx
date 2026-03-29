'use client';

import { useEffect, useState } from 'react';

interface FlyingToBannerProps {
  placeName: string | null;
}

const DOTS = ['', '.', '..', '...'];

export default function FlyingToBanner({ placeName }: FlyingToBannerProps) {
  const [dotIndex, setDotIndex] = useState(0);

  useEffect(() => {
    if (!placeName) return;
    const id = setInterval(() => {
      setDotIndex((i) => (i + 1) % DOTS.length);
    }, 420);
    return () => clearInterval(id);
  }, [placeName]);

  if (!placeName) return null;

  const short =
    placeName.length > 42 ? `${placeName.slice(0, 40)}…` : placeName;

  return (
    <div className="glass-panel px-5 py-3 flex items-center gap-3 shadow-xl border border-cyan-500/20 max-w-md w-full overflow-hidden">
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/25 to-blue-600/20 border border-cyan-400/30"
        aria-hidden
      >
        <svg
          className="flying-plane-icon h-4 w-4 text-cyan-200"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium tracking-wide">
          <span className="flying-to-shimmer">Flying to {short}</span>
          <span className="inline-block w-6 tabular-nums text-cyan-200/90 align-top">{DOTS[dotIndex]}</span>
        </p>
      </div>
    </div>
  );
}
