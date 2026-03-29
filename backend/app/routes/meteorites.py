"""REST endpoint for NASA meteorite landing data."""

import logging

from fastapi import APIRouter, Query

from app.nasa_meteorites import fetch_meteorite_geojson

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/meteorites")
async def get_meteorites(
    limit: int = Query(5000, ge=1, le=50000),
    min_mass_g: float = Query(0, ge=0),
):
    """Return meteorite landings as GeoJSON with computed impact energy."""
    try:
        return await fetch_meteorite_geojson(limit=limit, min_mass_g=min_mass_g)
    except Exception:
        logger.exception("Failed to fetch meteorite data from NASA")
        return {"type": "FeatureCollection", "features": [], "error": "Failed to fetch data from NASA"}
