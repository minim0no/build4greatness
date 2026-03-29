import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.agents import run_response_planner, run_simulation_analyst, run_tornado_analyst, run_tornado_planner, run_asteroid_analyst, run_asteroid_planner
from app.fema_flood import fetch_fema_flood_zones, bbox_from_center
from app.overpass import fetch_infrastructure
from app.road_hazard import find_blocked_roads

logger = logging.getLogger(__name__)

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
        disaster_type = params.get("disaster_type", "flood")

        if disaster_type == "flood":
            await _run_flood_pipeline(ws, params, scenario_id)
        elif disaster_type == "tornado":
            await _run_tornado_pipeline(ws, params, scenario_id)
        elif disaster_type == "asteroid":
            await _run_asteroid_pipeline(ws, params, scenario_id)
        else:
            await send_json(ws, {"type": "error", "message": f"Unknown disaster type: {disaster_type}"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("Simulation pipeline error")
        try:
            await send_json(ws, {"type": "error", "message": "An internal error occurred. Please try again."})
        except Exception:
            pass


async def _run_flood_pipeline(ws: WebSocket, params: dict, scenario_id: str):
    center_lat = params["center_lat"]
    center_lng = params["center_lng"]
    radius_km = params.get("radius_km", 3.0)

    await send_json(ws, {"type": "status", "message": "Fetching FEMA flood zone data & infrastructure...", "scenario_id": scenario_id})

    # 1. Fetch FEMA flood zones and infrastructure concurrently
    hazard_task = fetch_fema_flood_zones(
        center_lng=center_lng,
        center_lat=center_lat,
        radius_km=radius_km,
        rainfall_mm=params.get("rainfall_mm", 150.0),
    )
    infra_task = fetch_infrastructure(
        # Use a bbox derived from center/radius for the infra query.
        # The exact bbox comes from FEMA, but for infra we can estimate it.
        bbox_from_center(center_lng, center_lat, radius_km),
        center_lat=center_lat,
        center_lng=center_lng,
        radius_km=radius_km,
    )

    (hazard_geojson, bbox, stats), infrastructure = await asyncio.gather(
        hazard_task, infra_task
    )

    await send_json(ws, {
        "type": "hazard_result",
        "disaster_type": "flood",
        "geojson": hazard_geojson,
        "stats": stats,
        "bbox": bbox,
        "circle": {
            "center": [center_lng, center_lat],
            "radius_km": radius_km,
        },
    })

    await send_json(ws, {
        "type": "infrastructure",
        "data": infrastructure,
    })

    # 3. Spatial intersection: find blocked roads
    await send_json(ws, {"type": "status", "message": "Analyzing road flood intersections..."})
    blocked_features, road_summary = find_blocked_roads(
        infrastructure.get("roads", []), hazard_geojson
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

    # 4. Run Agent 1: Simulation Analyst
    await send_json(ws, {"type": "status", "message": "AI analyzing flood impact..."})
    analyst_data = {}

    async for msg_type, content in run_simulation_analyst(stats, infrastructure, bbox, road_summary):
        if msg_type == "chunk":
            await send_json(ws, {"type": "agent1_chunk", "content": content})
        elif msg_type == "data":
            analyst_data = content
            await send_json(ws, {"type": "agent1_data", "data": content})

    # 5. Run Agent 2: Response Planner
    await send_json(ws, {"type": "status", "message": "AI generating response plan..."})

    async for msg_type, content in run_response_planner(stats, analyst_data, infrastructure, bbox):
        if msg_type == "chunk":
            await send_json(ws, {"type": "agent2_chunk", "content": content})
        elif msg_type == "data":
            await send_json(ws, {"type": "agent2_data", "data": content})

    # Store scenario
    scenarios[scenario_id] = {
        "request": params,
        "disaster_type": "flood",
        "hazard_geojson": hazard_geojson,
        "stats": stats,
        "bbox": bbox,
        "infrastructure": infrastructure,
        "analyst_data": analyst_data,
    }

    await send_json(ws, {"type": "complete", "scenario_id": scenario_id})


async def _run_tornado_pipeline(ws: WebSocket, params: dict, scenario_id: str):
    from app.tornado_sim import generate_tornado_path

    center_lat = params["center_lat"]
    center_lng = params["center_lng"]
    radius_km = params.get("radius_km", 3.0)
    ef_scale = params.get("ef_scale", 3)
    direction_deg = params.get("direction_deg", 45)

    await send_json(ws, {"type": "status", "message": "Simulating tornado path & fetching infrastructure...", "scenario_id": scenario_id})

    # 1. Generate tornado path (sync but fast) then fetch infra concurrently
    hazard_geojson, bbox, stats = generate_tornado_path(
        center_lng=center_lng,
        center_lat=center_lat,
        ef_scale=ef_scale,
        direction_deg=direction_deg,
    )

    # Fetch infrastructure concurrently now that we have the bbox
    infrastructure = await fetch_infrastructure(
        bbox,
        center_lat=center_lat,
        center_lng=center_lng,
        radius_km=radius_km,
    )

    await send_json(ws, {
        "type": "hazard_result",
        "disaster_type": "tornado",
        "geojson": hazard_geojson,
        "stats": stats,
        "bbox": bbox,
        "circle": {
            "center": [center_lng, center_lat],
            "radius_km": radius_km,
        },
    })

    await send_json(ws, {
        "type": "infrastructure",
        "data": infrastructure,
    })

    # 3. Find affected roads
    await send_json(ws, {"type": "status", "message": "Analyzing road damage from tornado path..."})
    blocked_features, road_summary = find_blocked_roads(
        infrastructure.get("roads", []), hazard_geojson
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

    # 4. Run tornado analyst
    await send_json(ws, {"type": "status", "message": "AI analyzing tornado impact..."})
    analyst_data = {}

    async for msg_type, content in run_tornado_analyst(stats, infrastructure, bbox, road_summary):
        if msg_type == "chunk":
            await send_json(ws, {"type": "agent1_chunk", "content": content})
        elif msg_type == "data":
            analyst_data = content
            await send_json(ws, {"type": "agent1_data", "data": content})

    # 5. Run tornado planner
    await send_json(ws, {"type": "status", "message": "AI generating response plan..."})

    async for msg_type, content in run_tornado_planner(stats, analyst_data, infrastructure, bbox):
        if msg_type == "chunk":
            await send_json(ws, {"type": "agent2_chunk", "content": content})
        elif msg_type == "data":
            await send_json(ws, {"type": "agent2_data", "data": content})

    # Store scenario
    scenarios[scenario_id] = {
        "request": params,
        "disaster_type": "tornado",
        "hazard_geojson": hazard_geojson,
        "stats": stats,
        "bbox": bbox,
        "infrastructure": infrastructure,
        "analyst_data": analyst_data,
    }

    await send_json(ws, {"type": "complete", "scenario_id": scenario_id})


async def _run_asteroid_pipeline(ws: WebSocket, params: dict, scenario_id: str):
    from app.asteroid_sim import generate_asteroid_impact

    center_lat = params["center_lat"]
    center_lng = params["center_lng"]
    radius_km = params.get("radius_km", 3.0)
    mass_kg = params.get("mass_kg", 1e6)

    await send_json(ws, {"type": "status", "message": "Simulating asteroid impact & fetching infrastructure...", "scenario_id": scenario_id})

    # 1. Generate impact zones (sync but fast)
    hazard_geojson, bbox, stats = generate_asteroid_impact(
        center_lng=center_lng,
        center_lat=center_lat,
        mass_kg=mass_kg,
    )

    # Skip infrastructure scan for very large impactors (city-killer+)
    # — everything in the blast zone is destroyed, scanning buildings is pointless
    # and the Overpass query would be huge
    max_damage_km = stats.get("max_damage_radius_km", 0)
    skip_infra = mass_kg >= 1e10 or max_damage_km > 50

    if skip_infra:
        infrastructure = {
            "roads": [], "hospitals": [], "schools": [], "shelters": [],
            "fire_stations": [], "police": [], "power": [],
            "query_errors": ["Infrastructure scan skipped — damage radius too large for building-level analysis"],
        }
    else:
        search_radius = max(radius_km, max_damage_km)
        infrastructure = await fetch_infrastructure(
            bbox,
            center_lat=center_lat,
            center_lng=center_lng,
            radius_km=search_radius,
        )

    await send_json(ws, {
        "type": "hazard_result",
        "disaster_type": "asteroid",
        "geojson": hazard_geojson,
        "stats": stats,
        "bbox": bbox,
    })

    await send_json(ws, {
        "type": "infrastructure",
        "data": infrastructure,
    })

    # 3. Find affected roads (skip if infra was skipped)
    road_summary = None
    if not skip_infra:
        await send_json(ws, {"type": "status", "message": "Analyzing road damage from impact..."})
        blocked_features, road_summary = find_blocked_roads(
            infrastructure.get("roads", []), hazard_geojson
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

    # 4. Run asteroid analyst
    await send_json(ws, {"type": "status", "message": "AI analyzing impact damage..."})
    analyst_data = {}

    async for msg_type, content in run_asteroid_analyst(stats, infrastructure, bbox, road_summary):
        if msg_type == "chunk":
            await send_json(ws, {"type": "agent1_chunk", "content": content})
        elif msg_type == "data":
            analyst_data = content
            await send_json(ws, {"type": "agent1_data", "data": content})

    # 5. Run asteroid planner
    await send_json(ws, {"type": "status", "message": "AI generating response plan..."})

    async for msg_type, content in run_asteroid_planner(stats, analyst_data, infrastructure, bbox):
        if msg_type == "chunk":
            await send_json(ws, {"type": "agent2_chunk", "content": content})
        elif msg_type == "data":
            await send_json(ws, {"type": "agent2_data", "data": content})

    # Store scenario
    scenarios[scenario_id] = {
        "request": params,
        "disaster_type": "asteroid",
        "hazard_geojson": hazard_geojson,
        "stats": stats,
        "bbox": bbox,
        "infrastructure": infrastructure,
        "analyst_data": analyst_data,
    }

    await send_json(ws, {"type": "complete", "scenario_id": scenario_id})
