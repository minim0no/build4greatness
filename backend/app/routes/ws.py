import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.agents import run_response_planner, run_simulation_analyst
from app.elevation import fetch_elevation_grid
from app.flood_sim import run_bfs_flood
from app.geo_utils import depth_grid_to_geojson
from app.overpass import fetch_infrastructure

router = APIRouter()

# Shared scenario store (import from simulate for shared access)
from app.routes.simulate import scenarios


async def send_json(ws: WebSocket, data: dict):
    await ws.send_text(json.dumps(data))


@router.websocket("/ws/simulate")
async def ws_simulate(ws: WebSocket):
    await ws.accept()

    try:
        # Receive simulation parameters
        raw = await ws.receive_text()
        params = json.loads(raw)

        scenario_id = str(uuid.uuid4())
        await send_json(ws, {"type": "status", "message": "Fetching elevation data...", "scenario_id": scenario_id})

        # 1. Fetch elevation
        elevation_grid, bbox = await fetch_elevation_grid(
            center_lng=params["center_lng"],
            center_lat=params["center_lat"],
            radius_km=2.0,
            cell_size_m=50.0,
        )

        await send_json(ws, {"type": "status", "message": "Running flood simulation..."})

        # 2. Run flood sim
        depth_grid = run_bfs_flood(
            elevation_grid=elevation_grid,
            source_edge=params.get("water_source", "N"),
            severity=params.get("severity", 3),
            rainfall_mm=params.get("rainfall_mm", 100.0),
        )

        # 3. Convert to GeoJSON
        flood_geojson = depth_grid_to_geojson(depth_grid, bbox)

        # 4. Compute stats
        import numpy as np
        affected = int((depth_grid > 0.05).sum())
        total = depth_grid.size
        cell_area_km2 = (2.0 * 2 / elevation_grid.shape[0]) * (2.0 * 2 / elevation_grid.shape[1])
        area_km2 = affected * cell_area_km2

        stats = {
            "area_km2": round(area_km2, 3),
            "max_depth_m": round(float(depth_grid.max()), 2),
            "affected_cells": affected,
            "total_cells": total,
        }

        # Send flood result
        await send_json(ws, {
            "type": "flood_result",
            "geojson": flood_geojson,
            "stats": stats,
            "bbox": bbox,
        })

        # 5. Fetch infrastructure
        await send_json(ws, {"type": "status", "message": "Fetching infrastructure data..."})
        infrastructure = await fetch_infrastructure(bbox)

        await send_json(ws, {
            "type": "infrastructure",
            "data": infrastructure,
        })

        # 6. Run Agent 1: Simulation Analyst
        await send_json(ws, {"type": "status", "message": "AI analyzing flood impact..."})
        analyst_data = {}

        async for msg_type, content in run_simulation_analyst(stats, infrastructure, bbox):
            if msg_type == "chunk":
                await send_json(ws, {"type": "agent1_chunk", "content": content})
            elif msg_type == "data":
                analyst_data = content
                await send_json(ws, {"type": "agent1_data", "data": content})

        # 7. Run Agent 2: Response Planner
        await send_json(ws, {"type": "status", "message": "AI generating response plan..."})

        async for msg_type, content in run_response_planner(stats, analyst_data, infrastructure, bbox):
            if msg_type == "chunk":
                await send_json(ws, {"type": "agent2_chunk", "content": content})
            elif msg_type == "data":
                await send_json(ws, {"type": "agent2_data", "data": content})

        # Store scenario
        scenarios[scenario_id] = {
            "request": params,
            "flood_geojson": flood_geojson,
            "stats": stats,
            "bbox": bbox,
            "infrastructure": infrastructure,
            "analyst_data": analyst_data,
        }

        await send_json(ws, {"type": "complete", "scenario_id": scenario_id})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await send_json(ws, {"type": "error", "message": str(e)})
        except Exception:
            pass
