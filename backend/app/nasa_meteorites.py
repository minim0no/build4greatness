"""Fetch NASA Meteorite Landings and compute impact energy / damage radius.

Data source: NASA Open Data Portal – The Meteoritical Society
API: https://data.nasa.gov/resource/gh4g-9sfh.json (Socrata, no key required)
"""

import logging
import math
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NASA_JSON_URL = "https://data.nasa.gov/docs/legacy/meteorite_landings/Meteorite_Landings.json"

# In-memory cache: (timestamp, geojson_dict)
_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL_S = 3600  # 1 hour


# ---------------------------------------------------------------------------
# Physics helpers
# ---------------------------------------------------------------------------

def _estimate_impact_velocity(mass_kg: float) -> float:
    """Estimate ground-impact velocity (m/s) based on meteorite mass.

    Small meteorites are fully decelerated by the atmosphere to terminal
    velocity (~100-300 m/s).  Large impactors punch through and retain
    most of their cosmic velocity (~15-20 km/s).
    """
    if mass_kg < 1:
        return 200.0
    elif mass_kg < 10_000:
        t = math.log10(mass_kg) / math.log10(10_000)
        return 200.0 + t * 14_800.0
    else:
        return 15_000.0 + min(mass_kg / 1e6, 1.0) * 5_000.0


def _joules_to_megatons(joules: float) -> float:
    return joules / 4.184e15


# Cube-root scaling reference radii (km) at 1 megaton
_REF_RADII = {"extreme": 3.2, "high": 8.0, "medium": 17.0, "low": 30.0}


def _damage_radius_km(megatons: float) -> float:
    """Max damage radius (low band) using cube-root scaling."""
    return max(0.05, _REF_RADII["low"] * (megatons / 1.0) ** (1.0 / 3.0))


def _compute_impact_props(mass_g: float) -> dict[str, Any]:
    """Derive impact energy and damage radius from mass in grams."""
    mass_kg = mass_g / 1000.0
    v = _estimate_impact_velocity(mass_kg)
    energy_j = 0.5 * mass_kg * v * v
    energy_mt = _joules_to_megatons(energy_j)
    radius_km = _damage_radius_km(energy_mt) if energy_mt > 1e-12 else 0.0
    return {
        "mass_kg": round(mass_kg, 3),
        "velocity_ms": round(v, 1),
        "energy_joules": energy_j,
        "energy_megatons": energy_mt,
        "damage_radius_km": round(radius_km, 4),
    }


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

async def fetch_meteorite_geojson(
    limit: int = 5000,
    min_mass_g: float = 0,
) -> dict:
    """Fetch meteorite landings from NASA and return as GeoJSON FeatureCollection.

    Each feature includes computed impact properties.
    The NASA legacy JSON is a Socrata export with meta/data arrays — rows are
    positional with columns at fixed indices:
      8=name, 9=id, 11=recclass, 12=mass(g), 13=fall, 14=year, 15=reclat, 16=reclong
    """
    cache_key = f"{limit}:{min_mass_g}"
    now = time.time()
    if cache_key in _cache:
        ts, data = _cache[cache_key]
        if now - ts < CACHE_TTL_S:
            return data

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        resp = await client.get(NASA_JSON_URL)
        resp.raise_for_status()
        payload = resp.json()

    rows = payload.get("data", [])

    # Parse rows and filter/sort
    parsed = []
    for row in rows:
        try:
            mass_g = float(row[12]) if row[12] else 0
            lat = float(row[15]) if row[15] else 0
            lng = float(row[16]) if row[16] else 0
        except (TypeError, ValueError, IndexError):
            continue

        if mass_g < min_mass_g or (lat == 0 and lng == 0):
            continue

        year_raw = row[14] or ""
        year = year_raw[:4] if year_raw else None

        parsed.append((mass_g, lat, lng, row[8], row[9], row[11], row[13], year))

    # Sort by mass descending, then take limit
    parsed.sort(key=lambda x: x[0], reverse=True)
    parsed = parsed[:limit]

    features = []
    for mass_g, lat, lng, name, rec_id, recclass, fall, year in parsed:
        impact = _compute_impact_props(mass_g)
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lng, lat],
            },
            "properties": {
                "name": name or "Unknown",
                "id": rec_id,
                "recclass": recclass or "",
                "mass_g": mass_g,
                "fall": fall or "",
                "year": year,
                **impact,
            },
        })

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    _cache[cache_key] = (now, geojson)
    logger.info("Fetched %d meteorite records from NASA", len(features))
    return geojson
