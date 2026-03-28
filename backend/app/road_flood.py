"""Spatial intersection of roads with flood zones to find blocked roads."""

from shapely.geometry import LineString, shape, MultiPolygon
from shapely.ops import unary_union


def find_blocked_roads(
    roads: list[dict],
    flood_geojson: dict,
) -> tuple[list[dict], dict]:
    """
    Intersect road geometries with flood zone polygons.
    Returns (blocked_roads_geojson_features, road_status_summary).

    blocked_roads_geojson_features: list of GeoJSON Feature dicts (LineString)
        with properties: name, road_type, status, flood_band
    road_status_summary: dict with counts and lists for the AI agent
    """
    # Build unified flood polygons by band
    flood_polys_by_band = {"extreme": [], "high": [], "medium": [], "low": []}
    for feature in flood_geojson.get("features", []):
        band = feature.get("properties", {}).get("band", "low")
        try:
            geom = shape(feature["geometry"])
            if geom.is_valid:
                flood_polys_by_band[band].append(geom)
        except Exception:
            continue

    # Merge all flood polygons into one for intersection test
    all_flood_polys = []
    for polys in flood_polys_by_band.values():
        all_flood_polys.extend(polys)

    if not all_flood_polys:
        return [], {"blocked": [], "partial": [], "clear": [r["name"] for r in roads]}

    try:
        flood_union = unary_union(all_flood_polys)
    except Exception:
        return [], {"blocked": [], "partial": [], "clear": [r["name"] for r in roads]}

    # Build band unions for determining worst flood band on a road
    band_unions = {}
    for band in ("extreme", "high", "medium", "low"):
        if flood_polys_by_band[band]:
            try:
                band_unions[band] = unary_union(flood_polys_by_band[band])
            except Exception:
                pass

    blocked_features = []
    summary = {"blocked": [], "partial": [], "clear": []}

    for road in roads:
        coords = road.get("coords", [])
        if len(coords) < 2:
            summary["clear"].append(road["name"])
            continue

        try:
            road_line = LineString(coords)  # coords are [lng, lat]
        except Exception:
            summary["clear"].append(road["name"])
            continue

        if not road_line.is_valid or road_line.is_empty:
            summary["clear"].append(road["name"])
            continue

        try:
            intersection = road_line.intersection(flood_union)
        except Exception:
            summary["clear"].append(road["name"])
            continue

        if intersection.is_empty:
            summary["clear"].append(road["name"])
            continue

        # Calculate overlap ratio
        overlap_ratio = intersection.length / road_line.length if road_line.length > 0 else 0

        if overlap_ratio > 0.5:
            status = "blocked"
        elif overlap_ratio > 0.1:
            status = "partial"
        else:
            summary["clear"].append(road["name"])
            continue

        summary[status].append(road["name"])

        # Determine worst flood band this road crosses
        worst_band = "low"
        band_priority = {"extreme": 4, "high": 3, "medium": 2, "low": 1}
        for band, union_geom in band_unions.items():
            try:
                if road_line.intersects(union_geom):
                    if band_priority[band] > band_priority[worst_band]:
                        worst_band = band
            except Exception:
                continue

        # Build GeoJSON feature for the flooded portion of the road
        try:
            flooded_geom = road_line.intersection(flood_union)
            if flooded_geom.is_empty:
                continue
            # Convert to GeoJSON-compatible geometry
            geom_json = _geometry_to_geojson(flooded_geom)
            if not geom_json:
                continue
        except Exception:
            # Fallback: use the full road line
            geom_json = {"type": "LineString", "coordinates": coords}

        blocked_features.append({
            "type": "Feature",
            "properties": {
                "name": road["name"],
                "road_type": road.get("type", "road"),
                "status": status,
                "flood_band": worst_band,
                "overlap_pct": round(overlap_ratio * 100, 1),
            },
            "geometry": geom_json,
        })

    return blocked_features, summary


def _geometry_to_geojson(geom) -> dict | None:
    """Convert a Shapely geometry to a GeoJSON geometry dict."""
    from shapely.geometry import mapping, GeometryCollection
    if geom.is_empty:
        return None
    mapped = mapping(geom)
    gtype = mapped.get("type", "")
    # We only want line-like geometries
    if gtype in ("LineString", "MultiLineString"):
        return mapped
    if gtype == "GeometryCollection":
        # Extract lines from collection
        lines = []
        for g in geom.geoms:
            if g.geom_type in ("LineString", "MultiLineString"):
                lines.append(g)
        if not lines:
            return None
        if len(lines) == 1:
            return mapping(lines[0])
        merged = unary_union(lines)
        return mapping(merged)
    return None
