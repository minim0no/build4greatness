import uuid

from fastapi import APIRouter

from app.fema_flood import fetch_fema_flood_zones
from app.models import FloodStats, SimulationRequest, SimulationResponse

router = APIRouter(prefix="/api")

# In-memory scenario storage
scenarios: dict[str, dict] = {}


@router.post("/simulate", response_model=SimulationResponse)
async def simulate(request: SimulationRequest):
    scenario_id = str(uuid.uuid4())

    if request.disaster_type == "flood":
        # Fetch FEMA flood zones
        flood_geojson, bbox, raw_stats = await fetch_fema_flood_zones(
            center_lng=request.center_lng,
            center_lat=request.center_lat,
            radius_km=request.radius_km,
            rainfall_mm=request.rainfall_mm,
        )

        stats = FloodStats(**raw_stats)

        # Store scenario
        scenarios[scenario_id] = {
            "request": request.model_dump(),
            "hazard_geojson": flood_geojson,
            "stats": stats.model_dump(),
            "bbox": bbox,
        }

        return SimulationResponse(
            scenario_id=scenario_id,
            disaster_type="flood",
            hazard_geojson=flood_geojson,
            stats=stats,
            bbox=bbox,
        )
    else:
        # Tornado and other types use the WebSocket pipeline
        from app.tornado_sim import generate_tornado_path
        from app.models import TornadoStats

        tornado_geojson, bbox, raw_stats = generate_tornado_path(
            center_lng=request.center_lng,
            center_lat=request.center_lat,
            ef_scale=request.ef_scale,
            direction_deg=request.direction_deg,
        )

        stats = TornadoStats(**raw_stats)

        scenarios[scenario_id] = {
            "request": request.model_dump(),
            "hazard_geojson": tornado_geojson,
            "stats": stats.model_dump(),
            "bbox": bbox,
        }

        return SimulationResponse(
            scenario_id=scenario_id,
            disaster_type=request.disaster_type,
            hazard_geojson=tornado_geojson,
            stats=stats,
            bbox=bbox,
        )
