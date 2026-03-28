import uuid

from fastapi import APIRouter

from app.elevation import fetch_elevation_grid
from app.flood_sim import run_bfs_flood
from app.geo_utils import depth_grid_to_geojson
from app.models import FloodStats, SimulationRequest, SimulationResponse

router = APIRouter(prefix="/api")

# In-memory scenario storage
scenarios: dict[str, dict] = {}


@router.post("/simulate", response_model=SimulationResponse)
async def simulate(request: SimulationRequest):
    scenario_id = str(uuid.uuid4())

    # 1. Fetch elevation data
    elevation_grid, bbox = await fetch_elevation_grid(
        center_lng=request.center_lng,
        center_lat=request.center_lat,
        radius_km=2.0,
        cell_size_m=50.0,
    )

    # 2. Run BFS flood simulation
    depth_grid = run_bfs_flood(
        elevation_grid=elevation_grid,
        source_edge=request.water_source,
        severity=request.severity,
        rainfall_mm=request.rainfall_mm,
    )

    # 3. Convert to GeoJSON
    flood_geojson = depth_grid_to_geojson(depth_grid, bbox)

    # 4. Compute stats
    affected = int((depth_grid > 0.05).sum())
    total = depth_grid.size
    cell_area_km2 = (2.0 * 2 / elevation_grid.shape[0]) * (2.0 * 2 / elevation_grid.shape[1])
    area_km2 = affected * cell_area_km2

    stats = FloodStats(
        area_km2=round(area_km2, 3),
        max_depth_m=round(float(depth_grid.max()), 2),
        affected_cells=affected,
        total_cells=total,
    )

    # 5. Store scenario
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
