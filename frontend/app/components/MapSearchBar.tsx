'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface GeocodeFeature {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
}

interface MapSearchBarProps {
  mapRef: RefObject<MapRef | null>;
  onFlyStart: (placeName: string) => void;
  /** Called once when the fly animation settles (then parent may enter 3D, etc.). */
  onFlightComplete: () => void;
  /** Called when a location is selected via search, providing the geocoded name and coords. */
  onLocationSelected?: (locationName: string, coords: [number, number]) => void;
}

export default function MapSearchBar({ mapRef, onFlyStart, onFlightComplete, onLocationSelected }: MapSearchBarProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flyGenerationRef = useRef(0);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!MAPBOX_TOKEN || q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setLoadingSuggestions(true);
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q.trim())}.json`
      );
      url.searchParams.set('access_token', MAPBOX_TOKEN);
      url.searchParams.set('types', 'place');
      url.searchParams.set('limit', '6');
      url.searchParams.set('language', 'en');
      const res = await fetch(url.toString());
      const data = await res.json();
      const feats: GeocodeFeature[] = (data.features || []).map(
        (f: { id: string; place_name: string; text: string; center: [number, number] }) => ({
          id: f.id,
          place_name: f.place_name,
          text: f.text,
          center: f.center,
        })
      );
      setSuggestions(feats);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(query);
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSuggestions]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const flyTo = useCallback(
    (lng: number, lat: number, placeName: string) => {
      const map = mapRef.current?.getMap();
      if (!map) return;

      const gen = ++flyGenerationRef.current;
      onFlyStart(placeName);
      setOpen(false);
      setQuery(placeName.split(',')[0] ?? placeName);
      setSuggestions([]);

      const finish = () => {
        map.off('moveend', finish);
        if (gen === flyGenerationRef.current) onFlightComplete();
      };
      map.once('moveend', finish);
      onLocationSelected?.(placeName, [lng, lat]);

      const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
      map.flyTo({
        center: [lng, lat],
        zoom: 14.5,
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        duration: 2200,
        curve: 1.25,
        easing: easeOutCubic,
        essential: true,
      });
    },
    [mapRef, onFlyStart, onFlightComplete, onLocationSelected]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (suggestions[0]) {
      const f = suggestions[0];
      flyTo(f.center[0], f.center[1], f.place_name);
    }
  };

  if (!MAPBOX_TOKEN) {
    return (
      <div className="glass-panel px-4 py-2.5 text-xs text-amber-200/90 max-w-md w-full text-center">
        Add NEXT_PUBLIC_MAPBOX_TOKEN to search cities
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full max-w-md pointer-events-auto">
      <form onSubmit={onSubmit} className="glass-panel p-1.5 flex items-center gap-2 shadow-xl">
        <span className="pl-2 text-white/50 shrink-0" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.65" y1="16.65" x2="21" y2="21" />
          </svg>
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search cities…"
          className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/35 outline-none py-2 pr-2"
          autoComplete="off"
          aria-label="Search for a city"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setSuggestions([]);
              setOpen(false);
            }}
            className="shrink-0 p-1 rounded-md text-white hover:bg-white/10 transition-colors"
            aria-label="Clear search"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {loadingSuggestions && query.trim().length >= 2 && (
          <span className="mr-2 h-4 w-4 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin shrink-0" />
        )}
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-white/10 hover:bg-white/18 text-white text-xs font-medium px-3 py-2 transition-colors border border-white/10"
        >
          Go
        </button>
      </form>

      {open && suggestions.length > 0 && (
        <ul className="mt-1.5 glass-panel py-1 max-h-56 overflow-y-auto text-sm shadow-xl border border-white/10">
          {suggestions.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => flyTo(f.center[0], f.center[1], f.place_name)}
                className="w-full text-left px-3 py-2.5 text-white/90 hover:bg-white/10 transition-colors"
              >
                <span className="font-medium text-white">{f.text}</span>
                <span className="block text-xs text-white/45 truncate">{f.place_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
