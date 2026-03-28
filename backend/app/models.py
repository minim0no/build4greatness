from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    center_lng: float
    center_lat: float
    severity: int = Field(ge=1, le=5, default=3)
    rainfall_mm: float = Field(ge=0, default=100.0)
    water_source: str = Field(default="N", pattern="^(N|S|E|W)$")


class FloodStats(BaseModel):
    area_km2: float
    max_depth_m: float
    affected_cells: int
    total_cells: int


class SimulationResponse(BaseModel):
    scenario_id: str
    flood_geojson: dict
    stats: FloodStats
    bbox: list[float]  # [min_lng, min_lat, max_lng, max_lat]
