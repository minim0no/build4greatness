"""Fetch real flood zone data from FEMA National Flood Hazard Layer (NFHL)."""

import logging
import math

import httpx
from shapely.geometry import Point, shape, mapping
from shapely.ops import unary_union

logger = logging.getLogger(__name__)

FEMA_NFHL_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
)

# FEMA zone -> risk band mapping
ZONE_BAND = {
    "V": "extreme",
    "VE": "extreme",
    "A": "high",
    "AE": "high",
    "AH": "high",
    "AO": "high",
    "AR": "high",
    "A99": "high",
}

BAND_DEPTH_MAX = {
    "extreme": 4.0,
    "high": 2.0,
    "medium": 0.8,
    "low": 0.2,
}

# Rainfall (mm) at which each band reaches full depth
BAND_DEPTH_FULL_AT = {
    "extreme": 300,
    "high": 400,
    "medium": 450,
    "low": 500,
}

# Rainfall thresholds (mm) that activate each flood band
# Light rain only floods the most extreme zones; heavy rain activates more
# Storm condition profiles for reference (24-hr rainfall + surge)
STORM_CONDITIONS = {
    "storm":    {"rainfall_mm": 75,  "surge_m": 0.0},
    "tropical": {"rainfall_mm": 150, "surge_m": 0.3},
    "cat1":     {"rainfall_mm": 225, "surge_m": 1.5},
    "cat3":     {"rainfall_mm": 375, "surge_m": 3.0},
    "cat5":     {"rainfall_mm": 500, "surge_m": 5.5},
}

# Rainfall thresholds (mm) that activate each flood band.
# These are tuned so that a Cat 1 hurricane (~200mm) primarily affects
# coastal/extreme zones and only partially activates 100-year floodplains,
# rather than showing the entire FEMA flood extent as fully flooded.
RAINFALL_BAND_THRESHOLDS = {
    "extreme": 50,    # Coastal V/VE zones — surge-driven, named storms
    "high": 100,      # 100-year floodplain (A/AE zones) — tropical storms+
    "medium": 250,    # 500-year floodplain (X shaded) — Cat 1+ hurricanes
    "low": 400,       # Minimal risk (X unshaded) — Cat 3+ only
}


def _active_bands(rainfall_mm: float) -> set[str]:
    """Return which flood bands are active given the rainfall amount."""
    return {
        band for band, threshold in RAINFALL_BAND_THRESHOLDS.items()
        if rainfall_mm >= threshold
    }


def _scaled_depth(band: str, rainfall_mm: float) -> float:
    """Scale flood depth based on how much rainfall exceeds the band's threshold.

    At threshold, depth starts at 25% of max. Reaches 100% at BAND_DEPTH_FULL_AT.
    """
    threshold = RAINFALL_BAND_THRESHOLDS[band]
    full_at = BAND_DEPTH_FULL_AT[band]
    max_depth = BAND_DEPTH_MAX[band]
    ratio = min(1.0, 0.25 + 0.75 * (rainfall_mm - threshold) / max(1, full_at - threshold))
    return round(max_depth * ratio, 2)


def _classify_zone(fld_zone: str, zone_subty: str = "") -> str:
    """Map a FEMA FLD_ZONE value to a risk band."""
    zone = (fld_zone or "").strip().upper()
    if zone in ZONE_BAND:
        return ZONE_BAND[zone]
    # X zone with FLOODWAY or shaded subtitle = moderate risk
    if zone == "X":
        subty = (zone_subty or "").upper()
        if "0.2" in subty or "500" in subty or "SHADED" in subty:
            return "medium"
        return "low"
    if zone in ("B",):
        return "medium"
    if zone in ("C", "D"):
        return "low"
    return "medium"  # unknown zones default to medium


def _make_circle(center_lng: float, center_lat: float, radius_km: float):
    """Create a Shapely circle polygon in lat/lng coords."""
    lat_deg = radius_km / 111.32
    lng_deg = radius_km / (111.32 * math.cos(math.radians(center_lat)))
    # Ellipse approximation using Point.buffer with scaling
    circle = Point(center_lng, center_lat).buffer(1.0, resolution=64)
    from shapely.affinity import scale
    circle = scale(circle, xfact=lng_deg, yfact=lat_deg)
    return circle


def _clip_feature_to_circle(feature: dict, circle) -> dict | None:
    """Clip a GeoJSON feature's geometry to a circle. Returns None if no overlap."""
    try:
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        clipped = geom.intersection(circle)
        if clipped.is_empty:
            return None
        new_feature = dict(feature)
        new_feature["geometry"] = mapping(clipped)
        return new_feature
    except Exception:
        logger.warning("Failed to clip feature geometry: %s", feature.get("properties", {}).get("FLD_ZONE", "?"))
        return None


def bbox_from_center(center_lng: float, center_lat: float, radius_km: float) -> list[float]:
    """Compute [min_lng, min_lat, max_lng, max_lat] from center + radius."""
    lat_deg = radius_km / 111.32
    lng_deg = radius_km / (111.32 * math.cos(math.radians(center_lat)))
    return [
        center_lng - lng_deg,
        center_lat - lat_deg,
        center_lng + lng_deg,
        center_lat + lat_deg,
    ]


def _estimate_area_km2(geojson: dict) -> float:
    """Estimate area in km² using Shapely geometry area with a lat/lng scaling factor."""
    total = 0.0
    for feature in geojson.get("features", []):
        try:
            geom = shape(feature["geometry"])
            if geom.is_empty or not geom.is_valid:
                continue
            # geom.area is in degrees². Convert using local scale factors.
            centroid = geom.centroid
            lat_scale = 111.32  # km per degree latitude
            lng_scale = 111.32 * math.cos(math.radians(centroid.y))
            total += geom.area * lat_scale * lng_scale
        except Exception:
            continue
    return round(total, 3)


async def fetch_fema_flood_zones(
    center_lng: float,
    center_lat: float,
    radius_km: float = 3.0,
    rainfall_mm: float = 150.0,
) -> tuple[dict, list[float], dict]:
    """
    Fetch FEMA NFHL flood zone polygons for area around center point.
    Filters to only zones that would be active at the given rainfall level.
    Returns (geojson_feature_collection, bbox, stats_dict).
    """
    bbox = bbox_from_center(center_lng, center_lat, radius_km)

    page_size = 500
    # maxAllowableOffset simplifies geometries server-side to reduce payload.
    # 0.0005° ≈ 55m — plenty accurate for flood zone display while cutting
    # response size by ~60% vs 0.0001.
    base_params = {
        "where": "1=1",
        "geometry": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FLD_ZONE,ZONE_SUBTY,STATIC_BFE,DFIRM_ID",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "maxAllowableOffset": "0.0005",
        "resultRecordCount": str(page_size),
    }

    all_features = []
    async with httpx.AsyncClient(timeout=45.0) as client:
        offset = 0
        while True:
            params = {**base_params, "resultOffset": str(offset)}
            try:
                resp = await client.get(FEMA_NFHL_URL, params=params)
                resp.raise_for_status()
            except httpx.TimeoutException:
                logger.error("FEMA query timed out at offset %d for bbox %s", offset, bbox)
                break
            except httpx.HTTPStatusError as e:
                logger.error("FEMA query HTTP %d at offset %d: %s", e.response.status_code, offset, e.response.text[:200])
                break
            data = resp.json()
            page_features = data.get("features", [])
            all_features.extend(page_features)
            if len(page_features) < page_size or not data.get("exceededTransferLimit", False):
                break
            offset += page_size
            if offset > 5000:
                logger.warning("FEMA query hit 5000-feature safety cap for bbox %s", bbox)
                break
    active = _active_bands(rainfall_mm)

    # Build analysis circle for clipping
    circle = _make_circle(center_lng, center_lat, radius_km)

    # Enrich, filter by active bands, and clip to circle
    features = []
    zone_counts: dict[str, int] = {}
    band_counts: dict[str, int] = {"extreme": 0, "high": 0, "medium": 0, "low": 0}

    for feature in all_features:
        props = feature.get("properties", {})
        fld_zone = props.get("FLD_ZONE", "")
        zone_subty = props.get("ZONE_SUBTY", "")
        band = _classify_zone(fld_zone, zone_subty)

        if band not in active:
            continue

        # Clip geometry to the analysis circle
        clipped = _clip_feature_to_circle(feature, circle)
        if clipped is None:
            continue

        clipped_props = clipped.get("properties", {})
        clipped_props["band"] = band
        clipped_props["depth"] = _scaled_depth(band, rainfall_mm)

        zone_counts[fld_zone] = zone_counts.get(fld_zone, 0) + 1
        band_counts[band] += 1
        features.append(clipped)

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    total_area = _estimate_area_km2(geojson)
    high_risk_features = {
        "type": "FeatureCollection",
        "features": [f for f in features if f["properties"]["band"] in ("high", "extreme")],
    }
    high_risk_area = _estimate_area_km2(high_risk_features)

    # Build risk summary
    parts = []
    for band_name in ("extreme", "high", "medium", "low"):
        if band_counts[band_name] > 0:
            parts.append(f"{band_counts[band_name]} {band_name}-risk zones")
    risk_summary = ", ".join(parts) if parts else "No flood zones found"

    search_area_km2 = round(math.pi * radius_km ** 2, 3)
    flood_pct = round(total_area / search_area_km2 * 100, 1) if search_area_km2 > 0 else 0

    stats = {
        "search_area_km2": search_area_km2,
        "total_area_km2": total_area,
        "high_risk_area_km2": high_risk_area,
        "flood_coverage_pct": flood_pct,
        "zone_counts": zone_counts,
        "risk_summary": risk_summary,
        "num_flood_zones": len(features),
    }

    return geojson, bbox, stats
