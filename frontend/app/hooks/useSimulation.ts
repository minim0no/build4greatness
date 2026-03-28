'use client';

import { useCallback, useRef, useState } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_API_URL?.replace('http', 'ws') || 'ws://localhost:8000';

export type SimulationStatus =
  | 'idle'
  | 'connecting'
  | 'fetching_elevation'
  | 'simulating'
  | 'fetching_infrastructure'
  | 'analyzing'
  | 'planning'
  | 'complete'
  | 'error';

export interface FloodStats {
  area_km2: number;
  max_depth_m: number;
  affected_cells: number;
  total_cells: number;
}

export interface SimulationState {
  status: SimulationStatus;
  statusMessage: string;
  floodGeoJSON: GeoJSON.FeatureCollection | null;
  stats: FloodStats | null;
  bbox: number[] | null;
  infrastructure: Record<string, unknown[]> | null;
  agent1Text: string;
  agent1Data: Record<string, unknown> | null;
  agent2Text: string;
  agent2Data: Record<string, unknown> | null;
  scenarioId: string | null;
  error: string | null;
}

const initialState: SimulationState = {
  status: 'idle',
  statusMessage: '',
  floodGeoJSON: null,
  stats: null,
  bbox: null,
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
      severity: number;
      rainfall_mm: number;
      water_source: string;
    }) => {
      // Reset state
      setState({ ...initialState, status: 'connecting', statusMessage: 'Connecting...' });

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
              if (message.includes('elevation')) status = 'fetching_elevation';
              else if (message.includes('simulation')) status = 'simulating';
              else if (message.includes('infrastructure')) status = 'fetching_infrastructure';
              else if (message.includes('analyzing') || message.includes('impact')) status = 'analyzing';
              else if (message.includes('response plan') || message.includes('generating')) status = 'planning';
              return { ...prev, status, statusMessage: message, scenarioId: msg.scenario_id || prev.scenarioId };
            });
            break;

          case 'flood_result':
            setState((prev) => ({
              ...prev,
              floodGeoJSON: msg.geojson,
              stats: msg.stats,
              bbox: msg.bbox,
            }));
            break;

          case 'infrastructure':
            setState((prev) => ({
              ...prev,
              infrastructure: msg.data,
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
