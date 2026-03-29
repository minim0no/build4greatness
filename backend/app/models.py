from typing import Literal

from pydantic import BaseModel, Field

DisasterType = Literal["flood", "tornado", "asteroid"]


class SimulationRequest(BaseModel):
    center_lng: float
    center_lat: float
    disaster_type: DisasterType = "flood"
    radius_km: float = Field(default=3.0, ge=0.5, le=20.0)
    # Flood params
    rainfall_mm: float = Field(default=150.0, ge=0, le=1000)
    # Tornado params
    ef_scale: int = Field(default=3, ge=0, le=5)
    direction_deg: float = Field(default=45.0, ge=0, lt=360)
    # Asteroid params
    mass_kg: float = Field(default=1e6, ge=1, le=1e12)


class FloodStats(BaseModel):
    search_area_km2: float
    total_area_km2: float
    high_risk_area_km2: float
    flood_coverage_pct: float
    zone_counts: dict[str, int]
    risk_summary: str
    num_flood_zones: int


class TornadoStats(BaseModel):
    ef_scale: int
    path_length_km: float
    path_width_m: float
    affected_area_km2: float
    risk_summary: str


class AsteroidStats(BaseModel):
    mass_kg: float
    energy_megatons: float
    crater_diameter_km: float
    max_damage_radius_km: float
    affected_area_km2: float
    risk_summary: str


class SimulationResponse(BaseModel):
    scenario_id: str
    disaster_type: DisasterType = "flood"
    hazard_geojson: dict
    stats: FloodStats | TornadoStats | AsteroidStats
    bbox: list[float]  # [min_lng, min_lat, max_lng, max_lat]
