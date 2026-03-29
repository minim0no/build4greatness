"""Generate a simulated tornado damage path as GeoJSON."""

import math

# EF scale → (path width in meters, path length in km)
EF_PARAMS = {
    0: {"width_m": 50, "length_km": 2.0},
    1: {"width_m": 100, "length_km": 5.0},
    2: {"width_m": 250, "length_km": 10.0},
    3: {"width_m": 500, "length_km": 18.0},
    4: {"width_m": 800, "length_km": 25.0},
    5: {"width_m": 1500, "length_km": 35.0},
}

# Map EF scale to damage bands for visualization
EF_BAND_MAP = {
    0: "low",
    1: "low",
    2: "medium",
    3: "high",
    4: "extreme",
    5: "extreme",
}


def _offset_point(lat: float, lng: float, bearing_deg: float, distance_km: float) -> tuple[float, float]:
    """Move a point by distance_km along a bearing (degrees from north)."""
    R = 6371.0  # Earth radius km
    bearing = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)

    lat2 = math.asin(
        math.sin(lat1) * math.cos(distance_km / R)
        + math.cos(lat1) * math.sin(distance_km / R) * math.cos(bearing)
    )
    lng2 = lng1 + math.atan2(
        math.sin(bearing) * math.sin(distance_km / R) * math.cos(lat1),
        math.cos(distance_km / R) - math.sin(lat1) * math.sin(lat2),
    )

    return math.degrees(lat2), math.degrees(lng2)


def _make_path_polygon(
    center_lat: float,
    center_lng: float,
    bearing_deg: float,
    length_km: float,
    start_width_m: float,
    end_width_m: float,
) -> list[list[float]]:
    """Create a tapered polygon (wedge) representing the tornado path.

    The path starts narrow at center and widens in the direction of travel.
    Returns list of [lng, lat] coordinate pairs forming a closed polygon.
    """
    # Points along the path centerline
    num_segments = 20
    left_side = []
    right_side = []

    for i in range(num_segments + 1):
        frac = i / num_segments
        dist = frac * length_km
        width_m = start_width_m + (end_width_m - start_width_m) * frac
        width_km = width_m / 1000.0

        # Point on centerline
        clat, clng = _offset_point(center_lat, center_lng, bearing_deg, dist)

        # Offset left and right perpendicular to bearing
        left_bearing = (bearing_deg - 90) % 360
        right_bearing = (bearing_deg + 90) % 360

        llat, llng = _offset_point(clat, clng, left_bearing, width_km / 2)
        rlat, rlng = _offset_point(clat, clng, right_bearing, width_km / 2)

        left_side.append([llng, llat])
        right_side.append([rlng, rlat])

    # Close the polygon: left side forward, right side backward
    coords = left_side + list(reversed(right_side)) + [left_side[0]]
    return coords


def generate_tornado_path(
    center_lng: float,
    center_lat: float,
    ef_scale: int = 3,
    direction_deg: float = 45.0,
) -> tuple[dict, list[float], dict]:
    """Generate tornado path GeoJSON with concentric damage zones.

    Returns (geojson_feature_collection, bbox, stats_dict).
    """
    ef_scale = max(0, min(5, ef_scale))
    params = EF_PARAMS[ef_scale]
    length_km = params["length_km"]
    max_width_m = params["width_m"]

    features = []

    # Generate concentric damage zones (outer = weaker, inner = strongest)
    # Each zone is a fraction of the full path
    zones = [
        {"band": "low", "width_frac": 1.0, "length_frac": 1.0},
        {"band": "medium", "width_frac": 0.7, "length_frac": 0.9},
        {"band": "high", "width_frac": 0.45, "length_frac": 0.75},
        {"band": "extreme", "width_frac": 0.2, "length_frac": 0.5},
    ]

    # Only include zones up to the EF scale severity
    band_cutoff = {"low": 0, "medium": 2, "high": 3, "extreme": 4}
    active_zones = [z for z in zones if ef_scale >= band_cutoff[z["band"]]]

    all_coords = []

    for zone in active_zones:
        zone_width = max_width_m * zone["width_frac"]
        zone_length = length_km * zone["length_frac"]

        # Taper: starts at 30% width, ends at full zone width
        start_w = zone_width * 0.3
        end_w = zone_width

        coords = _make_path_polygon(
            center_lat, center_lng, direction_deg,
            zone_length, start_w, end_w,
        )
        all_coords.extend(coords)

        features.append({
            "type": "Feature",
            "properties": {
                "band": zone["band"],
                "ef_scale": ef_scale,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
        })

    # Calculate bbox from all coordinates
    lngs = [c[0] for c in all_coords]
    lats = [c[1] for c in all_coords]
    bbox = [min(lngs), min(lats), max(lngs), max(lats)]

    # Pad bbox slightly
    pad = 0.01
    bbox = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    affected_area_km2 = round(length_km * (max_width_m / 1000.0) * 0.6, 2)  # rough ellipse area

    stats = {
        "ef_scale": ef_scale,
        "path_length_km": round(length_km, 2),
        "path_width_m": round(max_width_m, 1),
        "affected_area_km2": affected_area_km2,
        "risk_summary": f"EF{ef_scale} tornado, {length_km:.1f} km path, {max_width_m:.0f}m wide",
    }

    return geojson, bbox, stats
