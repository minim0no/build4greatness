'use client';

import 'mapbox-gl/dist/mapbox-gl.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Source, type MapRef, type MapMouseEvent, type MapEvent } from 'react-map-gl/mapbox';

import { useSimulation, type DisasterType } from '../hooks/useSimulation';
import AnalysisPanel from './AnalysisPanel';
import ControlPanel from './ControlPanel';
import FlyingToBanner from './FlyingToBanner';
import HazardLayer from './HazardLayer';
import MapControls from './MapControls';
import MapSearchBar from './MapSearchBar';
import RainOverlay from './RainOverlay';
import StatusBar from './StatusBar';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

function makeCircleGeoJSON(center: [number, number], radiusKm: number): GeoJSON.FeatureCollection {
  const [lng, lat] = center;
  const points = 64;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    const dy = radiusKm / 111.32;
    coords.push([lng + dx * Math.cos(angle), lat + dy * Math.sin(angle)]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
      },
    ],
  };
}

/** Small square footprint (meters) for 3D extrusion at a POI — reads as a simplified building block. */
function makeSquareFootprint(center: [number, number], halfSideM: number): GeoJSON.Polygon {
  const [lng, lat] = center;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dxDeg = halfSideM / (111_320 * cosLat);
  const dyDeg = halfSideM / 111_320;
  const ring: [number, number][] = [
    [lng + dxDeg, lat + dyDeg],
    [lng + dxDeg, lat - dyDeg],
    [lng - dxDeg, lat - dyDeg],
    [lng - dxDeg, lat + dyDeg],
    [lng + dxDeg, lat + dyDeg],
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

const INFRA_EXTRUSION_HEIGHT_M: Record<string, number> = {
  hospital: 34,
  shelter: 14,
  fire_station: 22,
  police: 24,
  ambulance: 16,
  fuel: 12,
  power: 30,
  disaster_infra: 26,
};

export default function MapView() {
  const mapRef = useRef<MapRef>(null);
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null);
  const [radiusKm, setRadiusKm] = useState(3);
  const [is3D, setIs3D] = useState(false);
  const [isDayMode, setIsDayMode] = useState(true);
  const [flyingToPlace, setFlyingToPlace] = useState<string | null>(null);
  const sim = useSimulation();

  const isLoading = !['idle', 'complete', 'error'].includes(sim.status);

  const floodSessionActive =
    sim.disasterType === 'flood' && sim.status !== 'idle' && sim.status !== 'error';

  const handleMapClick = useCallback((e: MapMouseEvent) => {
    setSelectedPoint([e.lngLat.lng, e.lngLat.lat]);
  }, []);

  const handleSimulate = useCallback(
    (params: {
      radius_km: number;
      disaster_type: DisasterType;
      rainfall_mm?: number;
      ef_scale?: number;
      direction_deg?: number;
    }) => {
      if (!selectedPoint) return;
      sim.startSimulation({
        center_lng: selectedPoint[0],
        center_lat: selectedPoint[1],
        ...params,
      });
    },
    [selectedPoint, sim.startSimulation]
  );

  const easeOutCubic = useCallback((t: number) => 1 - (1 - t) ** 3, []);

  const toggle3D = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (is3D) {
      map.easeTo({ pitch: 0, duration: 1000, easing: easeOutCubic });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setProjection('mercator');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setProjection('globe');
      map.easeTo({ pitch: 60, duration: 1000, easing: easeOutCubic });
    }
    setIs3D((prev) => !prev);
  }, [is3D, easeOutCubic]);

  const toggleDayNight = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const newMode = !isDayMode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).setConfigProperty('basemap', 'lightPreset', newMode ? 'day' : 'night');
    setIsDayMode(newMode);
  }, [isDayMode]);

  /** After search fly ends: hide banner and ease into globe + tilted 3D view. */
  const completeSearchFlight = useCallback(() => {
    setFlyingToPlace(null);
    const map = mapRef.current?.getMap();
    if (!map) return;

    setIs3D(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).setProjection('globe');

    const pitch = map.getPitch();

    map.easeTo({
      pitch: 60,
      duration: pitch >= 55 ? 1200 : 3400,
      easing: easeOutCubic,
    });
  }, [easeOutCubic]);

  // Fit map to bbox when hazard result arrives
  const prevBbox = useRef<string | null>(null);
  useEffect(() => {
    if (!sim.bbox) return;
    const bboxKey = sim.bbox.join(',');
    if (bboxKey === prevBbox.current) return;
    prevBbox.current = bboxKey;
    mapRef.current?.fitBounds(
      [
        [sim.bbox[0], sim.bbox[1]],
        [sim.bbox[2], sim.bbox[3]],
      ],
      { padding: 50, duration: 1000 }
    );
  }, [sim.bbox]);

  type InfraMarker = {
    name: string;
    lat: number;
    lon: number;
    type:
      | 'hospital'
      | 'shelter'
      | 'fire_station'
      | 'police'
      | 'ambulance'
      | 'fuel'
      | 'power'
      | 'disaster_infra';
    color: string;
  };

  const infrastructureMarkers: InfraMarker[] = useMemo(() => {
    if (!sim.infrastructure) return [];
    return [
      ...((sim.infrastructure.hospitals as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'hospital' as const,
        color: '#ef4444',
      })),
      ...((sim.infrastructure.shelters as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'shelter' as const,
        color: '#22c55e',
      })),
      ...((sim.infrastructure.fire_stations as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'fire_station' as const,
        color: '#f97316',
      })),
      ...((sim.infrastructure.police as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'police' as const,
        color: '#a855f7',
      })),
      ...((sim.infrastructure.ambulance_stations as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'ambulance' as const,
        color: '#f43f5e',
      })),
      ...((sim.infrastructure.fuel_stations as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'fuel' as const,
        color: '#eab308',
      })),
      ...((sim.infrastructure.power as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'power' as const,
        color: '#f59e0b',
      })),
      ...((sim.infrastructure.disaster_infrastructure as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
        ...f,
        type: 'disaster_infra' as const,
        color: '#06b6d4',
      })),
    ];
  }, [sim.infrastructure]);

  const infrastructureExtrusionsGeoJSON = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!infrastructureMarkers.length) return null;
    const halfFootprintM = 18;
    return {
      type: 'FeatureCollection',
      features: infrastructureMarkers.map((m, i) => ({
        type: 'Feature',
        id: i,
        properties: {
          infra_type: m.type,
          height: INFRA_EXTRUSION_HEIGHT_M[m.type] ?? 20,
          color: m.color,
          name: m.name,
        },
        geometry: makeSquareFootprint([m.lon, m.lat], halfFootprintM),
      })),
    };
  }, [infrastructureMarkers]);

  // Dynamic stats based on disaster type
  const renderStats = () => {
    if (!sim.stats) return null;

    if (sim.disasterType === 'tornado') {
      const stats = sim.stats as { ef_scale: number; path_length_km: number; path_width_m: number; affected_area_km2: number };
      return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-white/50">EF Scale:</span>
          <span className="font-mono">EF{stats.ef_scale}</span>
          <span className="text-white/50">Path length:</span>
          <span className="font-mono">{stats.path_length_km} km</span>
          <span className="text-white/50">Path width:</span>
          <span className="font-mono">{stats.path_width_m} m</span>
          <span className="text-white/50">Affected area:</span>
          <span className="font-mono">{stats.affected_area_km2} km2</span>
        </div>
      );
    }

    const stats = sim.stats as {
      num_flood_zones: number;
      search_area_km2: number;
      total_area_km2: number;
      high_risk_area_km2: number;
      flood_coverage_pct: number;
    };
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-white/50">Flood zones:</span>
        <span className="font-mono">{stats.num_flood_zones}</span>
        <span className="text-white/50">Search area:</span>
        <span className="font-mono">{stats.search_area_km2} km²</span>
        <span className="text-white/50">Flooded area:</span>
        <span className="font-mono">{stats.total_area_km2} km² ({stats.flood_coverage_pct}%)</span>
        <span className="text-white/50">High-risk:</span>
        <span className="font-mono">{stats.high_risk_area_km2} km²</span>
      </div>
    );
  };

  // Dynamic infrastructure legend
  const disasterInfraLabel = sim.disasterType === 'tornado' ? 'Storm Shelters' : 'Dams/Dykes';

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#0b0b19' }}>
      {/* Full-screen Map */}
      <div className="absolute inset-0 z-10">
        <Map
          ref={mapRef}
          initialViewState={{
            longitude: 0,
            latitude: 18,
            zoom: 1.35,
            pitch: 0,
            bearing: 0,
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/standard"
          mapboxAccessToken={MAPBOX_TOKEN}
          projection={{ name: 'globe' }}
          onClick={handleMapClick}
          onLoad={(e: MapEvent) => {
            const map = e.target;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (map as any).setFog({
              color: 'rgb(186, 210, 235)',
              'high-color': 'rgb(36, 92, 223)',
              'horizon-blend': 0.02,
              'space-color': 'rgb(11, 11, 25)',
              'star-intensity': 0.6,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (map as any).setConfigProperty('basemap', 'lightPreset', 'day');
          }}
        >
          {/* Scan radius preview (replaces pin) */}
          {selectedPoint && (
            <Source
              id="selection-radius-source"
              type="geojson"
              data={makeCircleGeoJSON(selectedPoint, radiusKm)}
            >
              <Layer
                id="selection-radius-fill"
                type="fill"
                paint={{
                  'fill-color': '#3b82f6',
                  'fill-opacity': 0.12,
                }}
              />
              <Layer
                id="selection-radius-line"
                type="line"
                paint={{
                  'line-color': '#60a5fa',
                  'line-width': 2.5,
                  'line-opacity': 0.95,
                  'line-dasharray': [4, 3],
                }}
              />
            </Source>
          )}

          <HazardLayer geojson={sim.hazardGeoJSON} disasterType={sim.disasterType} />

          {/* Analysis circle boundary (flood only) */}
          {sim.circle && sim.disasterType === 'flood' && (
            <Source
              id="analysis-circle-source"
              type="geojson"
              data={makeCircleGeoJSON(sim.circle.center, sim.circle.radius_km)}
            >
              <Layer
                id="analysis-circle-fill"
                type="fill"
                paint={{
                  'fill-color': '#67e8f9',
                  'fill-opacity': 0.15,
                }}
              />
              <Layer
                id="analysis-circle-border"
                type="line"
                paint={{
                  'line-color': '#a5f3fc',
                  'line-width': 3.5,
                  'line-opacity': 1,
                  'line-dasharray': [3, 2],
                }}
              />
              <Layer
                id="analysis-circle-glow"
                type="line"
                paint={{
                  'line-color': '#67e8f9',
                  'line-width': 12,
                  'line-opacity': 0.45,
                  'line-blur': 6,
                }}
              />
            </Source>
          )}

          {/* Blocked roads layer */}
          {sim.blockedRoadsGeoJSON && sim.blockedRoadsGeoJSON.features.length > 0 && (
            <Source id="blocked-roads-source" type="geojson" data={sim.blockedRoadsGeoJSON}>
              <Layer
                id="blocked-roads-line"
                type="line"
                paint={{
                  'line-color': [
                    'match',
                    ['get', 'status'],
                    'blocked', '#ef4444',
                    'partial', '#f59e0b',
                    '#ef4444',
                  ],
                  'line-width': 4,
                  'line-opacity': 0.9,
                }}
              />
              <Layer
                id="blocked-roads-dash"
                type="line"
                paint={{
                  'line-color': '#ffffff',
                  'line-width': 1,
                  'line-opacity': 0.5,
                  'line-dasharray': [2, 4],
                }}
              />
            </Source>
          )}

          {/* Infrastructure as colored 3D extrusions (footprints at POI coordinates) */}
          {infrastructureExtrusionsGeoJSON && (
            <Source id="infrastructure-extrusions-source" type="geojson" data={infrastructureExtrusionsGeoJSON}>
              <Layer
                id="infrastructure-extrusions"
                type="fill-extrusion"
                paint={{
                  'fill-extrusion-color': ['get', 'color'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': 0,
                  'fill-extrusion-opacity': 0.94,
                  'fill-extrusion-vertical-gradient': true,
                }}
              />
            </Source>
          )}
        </Map>
      </div>

      <RainOverlay active={floodSessionActive} />

      {/* City search — top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[25] w-[min(100%-2rem,28rem)] flex flex-col items-stretch gap-2 pointer-events-none">
        <MapSearchBar mapRef={mapRef} onFlyStart={setFlyingToPlace} onFlightComplete={completeSearchFlight} />
        <FlyingToBanner placeName={flyingToPlace} />
      </div>

      {/* Left column: Control Panel + Status (top) / Stats (bottom) */}
      <div className="absolute top-4 bottom-4 left-4 z-20 w-80 flex flex-col gap-3 pointer-events-none">
        <div className="flex flex-col gap-3 pointer-events-auto overflow-y-auto min-h-0">
          {sim.status !== 'idle' && (
            <StatusBar status={sim.status} message={sim.statusMessage} disasterType={sim.disasterType} />
          )}
          <ControlPanel
            selectedPoint={selectedPoint}
            radiusKm={radiusKm}
            onRadiusKmChange={setRadiusKm}
            onSimulate={handleSimulate}
            isLoading={isLoading}
          />
        </div>
        <div className="flex-1" />
        {sim.stats && (
          <div className="glass-panel p-3 text-sm text-white pointer-events-auto flex-shrink-0">
            {renderStats()}
          </div>
        )}
      </div>

      {/* Right column: Analysis Panel (top) / Legend + Controls (bottom) */}
      <div className="absolute top-4 bottom-4 right-4 z-20 w-96 flex flex-col gap-3 pointer-events-none">
        <div className="min-h-0 overflow-y-auto pointer-events-auto">
          <AnalysisPanel
            agent1Text={sim.agent1Text}
            agent1Data={sim.agent1Data}
            agent2Text={sim.agent2Text}
            agent2Data={sim.agent2Data}
            isStreaming={isLoading}
            disasterType={sim.disasterType}
          />
        </div>
        <div className="flex-1" />
        <div className="flex flex-col items-end gap-2 pointer-events-auto flex-shrink-0">
          {infrastructureMarkers.length > 0 && (
            <div className="glass-panel p-3 text-xs text-white">
              <p className="font-semibold mb-1.5">Infrastructure</p>
              <div className="space-y-1">
                {[
                  { color: '#ef4444', label: 'Hospitals' },
                  { color: '#22c55e', label: 'Shelters' },
                  { color: '#f97316', label: 'Fire Stations' },
                  { color: '#a855f7', label: 'Police' },
                  { color: '#f43f5e', label: 'Ambulance' },
                  { color: '#eab308', label: 'Fuel Stations' },
                  { color: '#f59e0b', label: 'Power' },
                  { color: '#06b6d4', label: disasterInfraLabel },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-white/70">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <MapControls
            is3D={is3D}
            isDayMode={isDayMode}
            onToggle3D={toggle3D}
            onToggleDayNight={toggleDayNight}
          />
        </div>
      </div>
    </div>
  );
}
