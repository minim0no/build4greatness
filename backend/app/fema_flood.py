"""Fetch real flood zone data from FEMA National Flood Hazard Layer (NFHL)."""

import math

import httpx

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

BAND_DEPTH = {
    "extreme": 4.0,
    "high": 2.0,
    "medium": 0.8,
    "low": 0.2,
}

# Rainfall thresholds (mm) that activate each flood band
# Light rain only floods the most extreme zones; heavy rain activates more
RAINFALL_BAND_THRESHOLDS = {
    "extreme": 25,    # Coastal V zones flood with minimal rainfall/storm surge
    "high": 75,       # 100-year floodplain (A zones) needs moderate rain
    "medium": 200,    # 500-year floodplain (X shaded) needs heavy rain
    "low": 400,       # Outside floodplain only in catastrophic events
}


def _active_bands(rainfall_mm: float) -> set[str]:
    """Return which flood bands are active given the rainfall amount."""
    return {
        band for band, threshold in RAINFALL_BAND_THRESHOLDS.items()
        if rainfall_mm >= threshold
    }


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


def _bbox_from_center(center_lng: float, center_lat: float, radius_km: float) -> list[float]:
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
    """Rough area estimate from bbox of each feature. Good enough for stats."""
    total = 0.0
    for feature in geojson.get("features", []):
        geom = feature.get("geometry", {})
        coords = geom.get("coordinates", [])
        if not coords:
            continue
        # Flatten all rings to get bbox
        all_pts = []
        if geom["type"] == "Polygon":
            for ring in coords:
                all_pts.extend(ring)
        elif geom["type"] == "MultiPolygon":
            for poly in coords:
                for ring in poly:
                    all_pts.extend(ring)
        if not all_pts:
            continue
        lngs = [p[0] for p in all_pts]
        lats = [p[1] for p in all_pts]
        dlat = max(lats) - min(lats)
        dlng = max(lngs) - min(lngs)
        avg_lat = (max(lats) + min(lats)) / 2
        area = dlat * 111.32 * dlng * 111.32 * math.cos(math.radians(avg_lat))
        # Polygon is roughly 60-70% of bbox area
        total += area * 0.65
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
    bbox = _bbox_from_center(center_lng, center_lat, radius_km)

    params = {
        "where": "1=1",
        "geometry": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FLD_ZONE,ZONE_SUBTY,STATIC_BFE,DFIRM_ID",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "maxAllowableOffset": "0.0001",
        "resultRecordCount": "500",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(FEMA_NFHL_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    all_features = data.get("features", [])
    active = _active_bands(rainfall_mm)

    # Enrich and filter features by active bands
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

        props["band"] = band
        props["depth"] = BAND_DEPTH[band]

        zone_counts[fld_zone] = zone_counts.get(fld_zone, 0) + 1
        band_counts[band] += 1
        features.append(feature)

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

    stats = {
        "total_area_km2": total_area,
        "high_risk_area_km2": high_risk_area,
        "zone_counts": zone_counts,
        "risk_summary": risk_summary,
        "num_flood_zones": len(features),
    }

    return geojson, bbox, stats
