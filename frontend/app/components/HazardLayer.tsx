'use client';

import { Layer, Source } from 'react-map-gl/mapbox';
import type { DisasterType } from '../hooks/useSimulation';

interface HazardLayerProps {
  geojson: GeoJSON.FeatureCollection | null;
  disasterType: DisasterType;
}

const FLOOD_FILL_COLORS: [string, string][] = [
  ['low', '#22d3ee'],
  ['medium', '#facc15'],
  ['high', '#f97316'],
  ['extreme', '#ef4444'],
];

const TORNADO_FILL_COLORS: [string, string][] = [
  ['low', '#c084fc'],
  ['medium', '#facc15'],
  ['high', '#f97316'],
  ['extreme', '#ef4444'],
];

const FLOOD_OUTLINE_COLORS: [string, string][] = [
  ['low', '#67e8f9'],
  ['medium', '#fde047'],
  ['high', '#fb923c'],
  ['extreme', '#fca5a5'],
];

const TORNADO_OUTLINE_COLORS: [string, string][] = [
  ['low', '#d8b4fe'],
  ['medium', '#fde047'],
  ['high', '#fb923c'],
  ['extreme', '#fca5a5'],
];

function buildMatchExpr(colors: [string, string][], fallback: string): unknown[] {
  const expr: unknown[] = ['match', ['get', 'band']];
  for (const [band, color] of colors) {
    expr.push(band, color);
  }
  expr.push(fallback);
  return expr;
}

export default function HazardLayer({ geojson, disasterType }: HazardLayerProps) {
  if (!geojson || geojson.features.length === 0) return null;

  const fillColors = disasterType === 'tornado' ? TORNADO_FILL_COLORS : FLOOD_FILL_COLORS;
  const outlineColors = disasterType === 'tornado' ? TORNADO_OUTLINE_COLORS : FLOOD_OUTLINE_COLORS;
  const defaultFill = disasterType === 'tornado' ? '#c084fc' : '#22d3ee';
  const defaultOutline = disasterType === 'tornado' ? '#d8b4fe' : '#67e8f9';

  return (
    <Source id="hazard-source" type="geojson" data={geojson}>
      <Layer
        id="hazard-fill"
        type="fill"
        paint={{
          'fill-color': buildMatchExpr(fillColors, defaultFill) as unknown as string,
          'fill-opacity': [
            'match',
            ['get', 'band'],
            'low', 0.5,
            'medium', 0.6,
            'high', 0.7,
            'extreme', 0.8,
            0.55,
          ],
        }}
      />
      <Layer
        id="hazard-outline"
        type="line"
        paint={{
          'line-color': buildMatchExpr(outlineColors, defaultOutline) as unknown as string,
          'line-width': 2,
          'line-opacity': 0.9,
        }}
      />
    </Source>
  );
}
