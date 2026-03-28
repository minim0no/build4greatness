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

    # Fetch FEMA flood zones
    flood_geojson, bbox, raw_stats = await fetch_fema_flood_zones(
        center_lng=request.center_lng,
        center_lat=request.center_lat,
    )

    stats = FloodStats(**raw_stats)

    # Store scenario
    scenarios[scenario_id] = {
        "request": request.model_dump(),
        "flood_geojson": flood_geojson,
        "stats": stats.model_dump(),
        "bbox": bbox,
    }

    return SimulationResponse(
        scenario_id=scenario_id,
        flood_geojson=flood_geojson,
        stats=stats,
        bbox=bbox,
    )
