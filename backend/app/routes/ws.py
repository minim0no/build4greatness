import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.agents import run_response_planner, run_simulation_analyst
from app.fema_flood import fetch_fema_flood_zones
from app.overpass import fetch_infrastructure
from app.road_flood import find_blocked_roads

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
        await send_json(ws, {"type": "status", "message": "Fetching FEMA flood zone data...", "scenario_id": scenario_id})

        # 1. Fetch FEMA flood zones
        flood_geojson, bbox, stats = await fetch_fema_flood_zones(
            center_lng=params["center_lng"],
            center_lat=params["center_lat"],
            radius_km=params.get("radius_km", 3.0),
            rainfall_mm=params.get("rainfall_mm", 150.0),
        )

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

        # 5b. Spatial intersection: find blocked roads
        await send_json(ws, {"type": "status", "message": "Analyzing road flood intersections..."})
        blocked_features, road_summary = find_blocked_roads(
            infrastructure.get("roads", []), flood_geojson
        )
        blocked_roads_geojson = {
            "type": "FeatureCollection",
            "features": blocked_features,
        }
        await send_json(ws, {
            "type": "blocked_roads",
            "geojson": blocked_roads_geojson,
            "summary": road_summary,
        })

        # 6. Run Agent 1: Simulation Analyst
        await send_json(ws, {"type": "status", "message": "AI analyzing flood impact..."})
        analyst_data = {}

        async for msg_type, content in run_simulation_analyst(stats, infrastructure, bbox, road_summary):
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
