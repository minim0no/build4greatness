'use client';

import { Layer, Source } from 'react-map-gl/mapbox';

interface FloodLayerProps {
  geojson: GeoJSON.FeatureCollection | null;
}

export default function FloodLayer({ geojson }: FloodLayerProps) {
  if (!geojson || geojson.features.length === 0) return null;

  return (
    <Source id="flood-source" type="geojson" data={geojson}>
      <Layer
        id="flood-fill"
        type="fill"
        paint={{
          'fill-color': [
            'match',
            ['get', 'band'],
            'low', '#93c5fd',
            'medium', '#3b82f6',
            'high', '#1d4ed8',
            'extreme', '#1e3a5f',
            '#3b82f6',
          ],
          'fill-opacity': [
            'match',
            ['get', 'band'],
            'low', 0.3,
            'medium', 0.5,
            'high', 0.7,
            'extreme', 0.85,
            0.5,
          ],
        }}
      />
      <Layer
        id="flood-outline"
        type="line"
        paint={{
          'line-color': '#1e40af',
          'line-width': 1,
          'line-opacity': 0.6,
        }}
      />
    </Source>
  );
}
