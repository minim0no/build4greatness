"""Generate simulated asteroid impact damage zones as GeoJSON.

Uses energy-based scaling to create concentric damage rings:
  - Fireball (extreme): thermal radiation zone
  - Blast (high): overpressure structural damage
  - Shockwave (medium): windows shattered, light structural
  - Tremor (low): ground shaking, minor damage
"""

import math

# Mass presets → approximate energy in megatons TNT equivalent
# Using simplified kinetic energy: KE = 0.5 * m * v^2
# Typical asteroid velocity ~20 km/s
ASTEROID_VELOCITY_KMS = 20.0  # km/s

# Damage zone radii scale with energy^(1/3) (cube-root scaling)
# Reference: 1 megaton → ~3.2 km fireball, ~8 km blast, ~17 km shockwave, ~30 km tremor
REFERENCE_MT = 1.0  # megaton
REFERENCE_RADII = {
    "extreme": 3.2,   # km - fireball / vaporization
    "high": 8.0,      # km - severe blast damage
    "medium": 17.0,   # km - moderate damage
    "low": 30.0,      # km - light damage / broken windows
}


def _mass_to_megatons(mass_kg: float) -> float:
    """Convert impactor mass to energy in megatons TNT equivalent."""
    v_ms = ASTEROID_VELOCITY_KMS * 1000.0  # m/s
    energy_joules = 0.5 * mass_kg * v_ms * v_ms
    mt_in_joules = 4.184e15  # 1 megaton TNT in joules
    return energy_joules / mt_in_joules


def _scale_radius(reference_km: float, megatons: float) -> float:
    """Scale damage radius using cube-root law."""
    return reference_km * (megatons / REFERENCE_MT) ** (1.0 / 3.0)


def _make_circle_polygon(
    center_lat: float,
    center_lng: float,
    radius_km: float,
    num_points: int = 64,
) -> list[list[float]]:
    """Create a circle polygon as [lng, lat] coordinates."""
    coords = []
    for i in range(num_points + 1):
        angle = (i / num_points) * 2 * math.pi
        # Approximate offset in degrees
        dlat = (radius_km / 111.32) * math.sin(angle)
        dlng = (radius_km / (111.32 * math.cos(math.radians(center_lat)))) * math.cos(angle)
        coords.append([center_lng + dlng, center_lat + dlat])
    return coords


def generate_asteroid_impact(
    center_lng: float,
    center_lat: float,
    mass_kg: float = 1e6,
) -> tuple[dict, list[float], dict]:
    """Generate asteroid impact GeoJSON with concentric damage zones.

    Args:
        center_lng: Impact longitude
        center_lat: Impact latitude
        mass_kg: Impactor mass in kilograms (default 1e6 = 1000 tonnes)

    Returns (geojson_feature_collection, bbox, stats_dict).
    """
    mass_kg = max(1.0, mass_kg)
    megatons = _mass_to_megatons(mass_kg)

    features = []
    max_radius_km = 0.0

    # Generate zones from outermost (low) to innermost (extreme)
    # so the fill layers stack correctly
    zones = [
        ("low", REFERENCE_RADII["low"]),
        ("medium", REFERENCE_RADII["medium"]),
        ("high", REFERENCE_RADII["high"]),
        ("extreme", REFERENCE_RADII["extreme"]),
    ]

    for band, ref_radius in zones:
        radius_km = _scale_radius(ref_radius, megatons)

        # Clamp minimum visible radius
        radius_km = max(0.05, radius_km)
        max_radius_km = max(max_radius_km, radius_km)

        coords = _make_circle_polygon(center_lat, center_lng, radius_km)

        features.append({
            "type": "Feature",
            "properties": {
                "band": band,
                "radius_km": round(radius_km, 3),
                "energy_mt": round(megatons, 6),
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
        })

    # Calculate bbox from max radius
    pad_km = max_radius_km * 1.2
    dlat = pad_km / 111.32
    dlng = pad_km / (111.32 * math.cos(math.radians(center_lat)))
    bbox = [
        center_lng - dlng,
        center_lat - dlat,
        center_lng + dlng,
        center_lat + dlat,
    ]

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    # Crater diameter approximation (Holsapple scaling)
    crater_diameter_km = 0.07 * (megatons ** 0.29) if megatons > 0.001 else 0.0
    affected_area_km2 = round(math.pi * max_radius_km ** 2, 2)

    stats = {
        "mass_kg": mass_kg,
        "energy_megatons": round(megatons, 6),
        "crater_diameter_km": round(crater_diameter_km, 3),
        "max_damage_radius_km": round(max_radius_km, 2),
        "affected_area_km2": affected_area_km2,
        "risk_summary": (
            f"{_format_mass(mass_kg)} impactor, "
            f"{megatons:.4g} MT energy, "
            f"{max_radius_km:.1f} km damage radius"
        ),
    }

    return geojson, bbox, stats


def _format_mass(mass_kg: float) -> str:
    """Human-readable mass string."""
    if mass_kg >= 1e9:
        return f"{mass_kg / 1e9:.1f}B kg"
    if mass_kg >= 1e6:
        return f"{mass_kg / 1e6:.1f}M kg"
    if mass_kg >= 1e3:
        return f"{mass_kg / 1e3:.1f}K kg"
    return f"{mass_kg:.0f} kg"
