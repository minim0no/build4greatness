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
    (params: { severity: number; rainfall_mm: number; water_source: string }) => {
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
      ]
    : [];

  // Build blocked roads GeoJSON from agent analysis
  const blockedRoadsGeoJSON: GeoJSON.FeatureCollection | null =
    sim.agent1Data && Array.isArray((sim.agent1Data as Record<string, unknown[]>).affected_roads)
      ? {
          type: 'FeatureCollection',
          features: (
            (sim.agent1Data as Record<string, unknown[]>).affected_roads as Array<{
              name: string;
              status: string;
            }>
          )
            .filter((r) => r.status === 'blocked')
            .slice(0, 5)
            .map((road, i) => ({
              type: 'Feature' as const,
              properties: { name: road.name, status: road.status },
              geometry: { type: 'Point' as const, coordinates: [0, 0] }, // placeholder
              id: i,
            })),
        }
      : null;

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
              <span className="text-zinc-400">Flooded area:</span>
              <span className="font-mono">{sim.stats.area_km2} km2</span>
              <span className="text-zinc-400">Max depth:</span>
              <span className="font-mono">{sim.stats.max_depth_m} m</span>
              <span className="text-zinc-400">Affected cells:</span>
              <span className="font-mono">
                {sim.stats.affected_cells} / {sim.stats.total_cells}
              </span>
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
