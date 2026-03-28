import numpy as np
from shapely.geometry import box, mapping
from shapely.ops import unary_union


def depth_grid_to_geojson(
    depth_grid: np.ndarray,
    bbox: list[float],
    threshold: float = 0.05,
) -> dict:
    """
    Convert depth grid to GeoJSON FeatureCollection.
    Merges adjacent cells at same depth band for fewer features.

    Args:
        depth_grid: 2D array of flood depth in meters
        bbox: [min_lng, min_lat, max_lng, max_lat]
        threshold: minimum depth to include

    Returns:
        GeoJSON FeatureCollection
    """
    rows, cols = depth_grid.shape
    min_lng, min_lat, max_lng, max_lat = bbox

    cell_w = (max_lng - min_lng) / cols
    cell_h = (max_lat - min_lat) / rows

    # Depth bands for grouping: 0-0.5m, 0.5-1.5m, 1.5-3m, 3m+
    bands = [
        (threshold, 0.5, "low"),
        (0.5, 1.5, "medium"),
        (1.5, 3.0, "high"),
        (3.0, float("inf"), "extreme"),
    ]

    features = []

    for band_min, band_max, label in bands:
        cells = []
        depths = []

        for r in range(rows):
            for c in range(cols):
                d = depth_grid[r, c]
                if band_min <= d < band_max:
                    # Cell bounding box (note: row 0 is north/max_lat)
                    cell_min_lng = min_lng + c * cell_w
                    cell_max_lng = cell_min_lng + cell_w
                    cell_max_lat = max_lat - r * cell_h
                    cell_min_lat = cell_max_lat - cell_h
                    cells.append(box(cell_min_lng, cell_min_lat, cell_max_lng, cell_max_lat))
                    depths.append(d)

        if cells:
            # Merge adjacent cells into larger polygons
            merged = unary_union(cells)
            avg_depth = float(np.mean(depths))

            # Handle both Polygon and MultiPolygon
            geom = mapping(merged)
            features.append({
                "type": "Feature",
                "properties": {
                    "depth": round(avg_depth, 2),
                    "band": label,
                    "cell_count": len(cells),
                },
                "geometry": geom,
            })

    return {
        "type": "FeatureCollection",
        "features": features,
    }
