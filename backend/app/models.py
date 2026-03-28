from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    center_lng: float
    center_lat: float


class FloodStats(BaseModel):
    total_area_km2: float
    high_risk_area_km2: float
    zone_counts: dict[str, int]
    risk_summary: str
    num_flood_zones: int


class SimulationResponse(BaseModel):
    scenario_id: str
    flood_geojson: dict
    stats: FloodStats
    bbox: list[float]  # [min_lng, min_lat, max_lng, max_lat]
