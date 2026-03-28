'use client';

import 'mapbox-gl/dist/mapbox-gl.css';

import { useCallback, useRef } from 'react';
import Map, { Layer, Marker, Source, type MapRef, type MapMouseEvent, type MapEvent } from 'react-map-gl/mapbox';
import { useState } from 'react';

import { useSimulation } from '../hooks/useSimulation';
import AnalysisPanel from './AnalysisPanel';
import ControlPanel from './ControlPanel';
import FloodLayer from './FloodLayer';
import StatusBar from './StatusBar';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export default function MapView() {
  const mapRef = useRef<MapRef>(null);
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null);
  const sim = useSimulation();

  const isLoading = !['idle', 'complete', 'error'].includes(sim.status);

  const handleMapClick = useCallback((e: MapMouseEvent) => {
    setSelectedPoint([e.lngLat.lng, e.lngLat.lat]);
  }, []);

  const handleSimulate = useCallback(
    (params: { radius_km: number; rainfall_mm: number }) => {
      if (!selectedPoint) return;
      sim.startSimulation({
        center_lng: selectedPoint[0],
        center_lat: selectedPoint[1],
        ...params,
      });
    },
    [selectedPoint, sim.startSimulation]
  );

  // Fit map to bbox when flood result arrives
  const prevBbox = useRef<number[] | null>(null);
  if (sim.bbox && sim.bbox !== prevBbox.current) {
    prevBbox.current = sim.bbox;
    if (mapRef.current) {
      mapRef.current.fitBounds(
        [
          [sim.bbox[0], sim.bbox[1]],
          [sim.bbox[2], sim.bbox[3]],
        ],
        { padding: 50, duration: 1000 }
      );
    }
  }

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
        ...((sim.infrastructure.flood_infrastructure as Array<{ name: string; lat: number; lon: number }>) || []).map((f) => ({
          ...f,
          type: 'flood_infra' as const,
          color: '#06b6d4',
        })),
      ]
    : [];

  return (
    <div className="flex h-full w-full">
      {/* Map */}
      <div className="flex-1 relative">
        <Map
          ref={mapRef}
          initialViewState={{
            longitude: -95.37,
            latitude: 29.76,
            zoom: 12,
            pitch: 45,
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onClick={handleMapClick}
          onLoad={(e: MapEvent) => {
            const map = e.target;
            // Add 3D buildings layer
            const layers = map.getStyle().layers;
            // Find the first symbol layer to insert buildings below labels
            let labelLayerId: string | undefined;
            for (const layer of layers || []) {
              if (layer.type === 'symbol' && (layer as { layout?: { 'text-field'?: unknown } }).layout?.['text-field']) {
                labelLayerId = layer.id;
                break;
              }
            }
            if (!map.getLayer('3d-buildings')) {
              map.addLayer(
                {
                  id: '3d-buildings',
                  source: 'composite',
                  'source-layer': 'building',
                  filter: ['==', 'extrude', 'true'],
                  type: 'fill-extrusion',
                  minzoom: 12,
                  paint: {
                    'fill-extrusion-color': '#1e293b',
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'min_height'],
                    'fill-extrusion-opacity': 0.7,
                  },
                },
                labelLayerId
              );
            }
          }}
        >
          {selectedPoint && (
            <Marker longitude={selectedPoint[0]} latitude={selectedPoint[1]} color="#ef4444" />
          )}

          <FloodLayer geojson={sim.floodGeoJSON} />

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

        {/* Stats overlay */}
        {sim.stats && (
          <div className="absolute bottom-4 left-4 bg-zinc-900/90 backdrop-blur rounded-lg p-3 text-sm text-white">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-zinc-400">Flood zones:</span>
              <span className="font-mono">{sim.stats.num_flood_zones}</span>
              <span className="text-zinc-400">Total area:</span>
              <span className="font-mono">{sim.stats.total_area_km2} km2</span>
              <span className="text-zinc-400">High-risk area:</span>
              <span className="font-mono">{sim.stats.high_risk_area_km2} km2</span>
            </div>
          </div>
        )}

        {/* Infrastructure legend */}
        {infrastructureMarkers.length > 0 && (
          <div className="absolute top-4 left-4 bg-zinc-900/90 backdrop-blur rounded-lg p-3 text-xs text-white">
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
                { color: '#06b6d4', label: 'Dams/Dykes' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-zinc-300">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-96 bg-zinc-900 border-l border-zinc-700 flex-shrink-0 flex flex-col h-full">
        <StatusBar status={sim.status} message={sim.statusMessage} />

        <div className="flex-shrink-0">
          <ControlPanel
            selectedPoint={selectedPoint}
            onSimulate={handleSimulate}
            isLoading={isLoading}
          />
        </div>

        <AnalysisPanel
          agent1Text={sim.agent1Text}
          agent1Data={sim.agent1Data}
          agent2Text={sim.agent2Text}
          agent2Data={sim.agent2Data}
          isStreaming={isLoading}
        />
      </div>
    </div>
  );
}
