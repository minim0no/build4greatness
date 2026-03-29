'use client';

import { useCallback, useRef, useState } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_API_URL?.replace('http', 'ws') || 'ws://localhost:8000';

export type DisasterType = 'flood' | 'tornado' | 'asteroid';

export type SimulationStatus =
  | 'idle'
  | 'connecting'
  | 'fetching_hazard_data'
  | 'fetching_infrastructure'
  | 'analyzing'
  | 'planning'
  | 'complete'
  | 'error';

export interface FloodStats {
  search_area_km2: number;
  total_area_km2: number;
  high_risk_area_km2: number;
  flood_coverage_pct: number;
  zone_counts: Record<string, number>;
  risk_summary: string;
  num_flood_zones: number;
}

export interface TornadoStats {
  ef_scale: number;
  path_length_km: number;
  path_width_m: number;
  affected_area_km2: number;
  risk_summary: string;
}

export interface AsteroidStats {
  mass_kg: number;
  energy_megatons: number;
  crater_diameter_km: number;
  max_damage_radius_km: number;
  affected_area_km2: number;
  risk_summary: string;
}

export interface AnalysisCircle {
  center: [number, number];
  radius_km: number;
}

export interface SimulationState {
  disasterType: DisasterType;
  status: SimulationStatus;
  statusMessage: string;
  hazardGeoJSON: GeoJSON.FeatureCollection | null;
  blockedRoadsGeoJSON: GeoJSON.FeatureCollection | null;
  stats: FloodStats | TornadoStats | AsteroidStats | null;
  bbox: number[] | null;
  circle: AnalysisCircle | null;
  infrastructure: Record<string, unknown[]> | null;
  agent1Text: string;
  agent1Data: Record<string, unknown> | null;
  agent2Text: string;
  agent2Data: Record<string, unknown> | null;
  scenarioId: string | null;
  error: string | null;
}

const initialState: SimulationState = {
  disasterType: 'flood',
  status: 'idle',
  statusMessage: '',
  hazardGeoJSON: null,
  blockedRoadsGeoJSON: null,
  stats: null,
  bbox: null,
  circle: null,
  infrastructure: null,
  agent1Text: '',
  agent1Data: null,
  agent2Text: '',
  agent2Data: null,
  scenarioId: null,
  error: null,
};

export function useSimulation() {
  const [state, setState] = useState<SimulationState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);

  const startSimulation = useCallback(
    (params: {
      center_lng: number;
      center_lat: number;
      radius_km: number;
      disaster_type: DisasterType;
      // Location context for LLM agents
      location_name?: string;
      // Flood params
      rainfall_mm?: number;
      // Tornado params
      ef_scale?: number;
      direction_deg?: number;
      // Asteroid params
      mass_kg?: number;
    }) => {
      // Reset state
      setState({
        ...initialState,
        disasterType: params.disaster_type,
        status: 'connecting',
        statusMessage: 'Connecting...',
      });

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(`${WS_URL}/ws/simulate`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify(params));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'status':
            setState((prev) => {
              let status: SimulationStatus = prev.status;
              const message = msg.message as string;
              if (
                message.includes('FEMA') ||
                message.includes('flood zone') ||
                message.includes('tornado path') ||
                message.includes('asteroid impact') ||
                message.includes('Simulating')
              )
                status = 'fetching_hazard_data';
              else if (message.includes('infrastructure')) status = 'fetching_infrastructure';
              else if (message.includes('analyzing') || message.includes('impact')) status = 'analyzing';
              else if (message.includes('response plan') || message.includes('generating')) status = 'planning';
              return { ...prev, status, statusMessage: message, scenarioId: msg.scenario_id || prev.scenarioId };
            });
            break;

          case 'hazard_result':
            setState((prev) => ({
              ...prev,
              hazardGeoJSON: msg.geojson,
              stats: msg.stats,
              bbox: msg.bbox,
              circle: msg.circle || null,
            }));
            break;

          case 'infrastructure':
            setState((prev) => ({
              ...prev,
              infrastructure: msg.data,
            }));
            break;

          case 'blocked_roads':
            setState((prev) => ({
              ...prev,
              blockedRoadsGeoJSON: msg.geojson,
            }));
            break;

          case 'agent1_chunk':
            setState((prev) => ({
              ...prev,
              status: 'analyzing',
              agent1Text: prev.agent1Text + msg.content,
            }));
            break;

          case 'agent1_data':
            setState((prev) => ({
              ...prev,
              agent1Data: msg.data,
            }));
            break;

          case 'agent2_chunk':
            setState((prev) => ({
              ...prev,
              status: 'planning',
              agent2Text: prev.agent2Text + msg.content,
            }));
            break;

          case 'agent2_data':
            setState((prev) => ({
              ...prev,
              agent2Data: msg.data,
            }));
            break;

          case 'complete':
            setState((prev) => ({
              ...prev,
              status: 'complete',
              statusMessage: 'Analysis complete',
              scenarioId: msg.scenario_id,
            }));
            break;

          case 'error':
            setState((prev) => ({
              ...prev,
              status: 'error',
              error: msg.message,
              statusMessage: `Error: ${msg.message}`,
            }));
            break;
        }
      };

      ws.onerror = () => {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'WebSocket connection failed',
          statusMessage: 'Connection error',
        }));
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    },
    []
  );

  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setState(initialState);
  }, []);

  return { ...state, startSimulation, reset };
}
