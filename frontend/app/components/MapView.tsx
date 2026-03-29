'use client';

import 'mapbox-gl/dist/mapbox-gl.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import Map, { Layer, Marker, Source, type MapRef, type MapMouseEvent, type MapEvent } from 'react-map-gl/mapbox';

import { useSimulation, type DisasterType } from '../hooks/useSimulation';
import AnalysisPanel from './AnalysisPanel';
import ControlPanel from './ControlPanel';
import HazardLayer from './HazardLayer';
import MapControls from './MapControls';
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

export default function MapView() {
  const mapRef = useRef<MapRef>(null);
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null);
  const [is3D, setIs3D] = useState(true);
  const [isDayMode, setIsDayMode] = useState(false);
  const sim = useSimulation();

  const isLoading = !['idle', 'complete', 'error'].includes(sim.status);

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

  const toggle3D = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (is3D) {
      map.easeTo({ pitch: 0, duration: 1000 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setProjection('mercator');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setProjection('globe');
      map.easeTo({ pitch: 60, duration: 1000 });
    }
    setIs3D((prev) => !prev);
  }, [is3D]);

  const toggleDayNight = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const newMode = !isDayMode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).setConfigProperty('basemap', 'lightPreset', newMode ? 'day' : 'night');
    setIsDayMode(newMode);
  }, [isDayMode]);

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

  // Build infrastructure GeoJSON for markers
  const infrastructureMarkers = sim.infrastructure
    ? [
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
      ]
    : [];

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
            longitude: -95.37,
            latitude: 29.76,
            zoom: 12,
            pitch: 45,
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
            (map as any).setConfigProperty('basemap', 'lightPreset', 'night');
          }}
        >
          {selectedPoint && (
            <Marker longitude={selectedPoint[0]} latitude={selectedPoint[1]} color="#ef4444" />
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

          {/* Infrastructure markers */}
          {infrastructureMarkers.map((marker, i) => (
            <Marker
              key={`${marker.type}-${i}`}
              longitude={marker.lon}
              latitude={marker.lat}
              color={marker.color}
              scale={0.7}
            />
          ))}
        </Map>
      </div>

      {/* Left column: Control Panel + Status (top) / Stats (bottom) */}
      <div className="absolute top-4 bottom-4 left-4 z-20 w-80 flex flex-col gap-3 pointer-events-none">
        <div className="flex flex-col gap-3 pointer-events-auto overflow-y-auto min-h-0">
          {sim.status !== 'idle' && (
            <StatusBar status={sim.status} message={sim.statusMessage} disasterType={sim.disasterType} />
          )}
          <ControlPanel
            selectedPoint={selectedPoint}
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
