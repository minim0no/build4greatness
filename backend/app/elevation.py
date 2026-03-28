import math
import os
from functools import lru_cache
from io import BytesIO

import httpx
import numpy as np
from PIL import Image


MAPBOX_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN", "")

# Cache decoded tile elevations (key: (z, x, y) -> flattened array + shape)
_tile_cache: dict[tuple[int, int, int], np.ndarray] = {}


def lng_lat_to_tile(lng: float, lat: float, zoom: int) -> tuple[int, int]:
    """Convert lng/lat to tile x, y at given zoom level."""
    n = 2**zoom
    x = int((lng + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def tile_to_lng_lat(x: int, y: int, zoom: int) -> tuple[float, float]:
    """Convert tile x, y to lng/lat of the NW corner."""
    n = 2**zoom
    lng = x / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    lat = math.degrees(lat_rad)
    return lng, lat


def decode_terrain_rgb(img: Image.Image) -> np.ndarray:
    """Decode Mapbox terrain-rgb PNG to elevation array in meters."""
    arr = np.array(img, dtype=np.float64)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    elevation = -10000.0 + ((r * 256.0 * 256.0 + g * 256.0 + b) * 0.1)
    return elevation


async def fetch_tile(client: httpx.AsyncClient, z: int, x: int, y: int) -> np.ndarray | None:
    """Fetch a single terrain-rgb tile and decode to elevation. Cached."""
    cache_key = (z, x, y)
    if cache_key in _tile_cache:
        return _tile_cache[cache_key]

    url = (
        f"https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}@2x.pngraw"
        f"?access_token={MAPBOX_TOKEN}"
    )
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code != 200:
            return None
        img = Image.open(BytesIO(resp.content))
        result = decode_terrain_rgb(img)
        # Cache (limit to 100 tiles to prevent memory issues)
        if len(_tile_cache) < 100:
            _tile_cache[cache_key] = result
        return result
    except Exception:
        return None


async def fetch_elevation_grid(
    center_lng: float,
    center_lat: float,
    radius_km: float = 2.0,
    cell_size_m: float = 50.0,
) -> tuple[np.ndarray, list[float]]:
    """
    Fetch elevation data for an area around center point.
    Returns (elevation_grid, [min_lng, min_lat, max_lng, max_lat]).
    """
    # Calculate bounding box
    deg_per_km_lat = 1.0 / 111.0
    deg_per_km_lng = 1.0 / (111.0 * math.cos(math.radians(center_lat)))

    min_lat = center_lat - radius_km * deg_per_km_lat
    max_lat = center_lat + radius_km * deg_per_km_lat
    min_lng = center_lng - radius_km * deg_per_km_lng
    max_lng = center_lng + radius_km * deg_per_km_lng

    bbox = [min_lng, min_lat, max_lng, max_lat]

    # Grid dimensions
    grid_rows = min(int(radius_km * 2 * 1000 / cell_size_m), 100)
    grid_cols = min(int(radius_km * 2 * 1000 / cell_size_m), 100)

    # Use zoom 14 (~10m/pixel at equator with @2x = 512px tiles)
    zoom = 14

    # Determine which tiles we need
    tile_min_x, tile_max_y = lng_lat_to_tile(min_lng, min_lat, zoom)
    tile_max_x, tile_min_y = lng_lat_to_tile(max_lng, max_lat, zoom)

    # Fetch all needed tiles
    tile_elevations: dict[tuple[int, int], np.ndarray] = {}
    async with httpx.AsyncClient() as client:
        for tx in range(tile_min_x, tile_max_x + 1):
            for ty in range(tile_min_y, tile_max_y + 1):
                elev = await fetch_tile(client, zoom, tx, ty)
                if elev is not None:
                    tile_elevations[(tx, ty)] = elev

    if not tile_elevations:
        # Fallback: synthetic gentle slope with noise
        base = 50.0 + np.random.rand(grid_rows, grid_cols) * 5.0
        slope = np.linspace(0, 10, grid_rows).reshape(-1, 1)
        return base + slope, bbox

    # Sample elevation at each grid cell
    elevation_grid = np.zeros((grid_rows, grid_cols), dtype=np.float64)
    n = 2**zoom

    for r in range(grid_rows):
        lat = max_lat - (r / grid_rows) * (max_lat - min_lat)
        for c in range(grid_cols):
            lng = min_lng + (c / grid_cols) * (max_lng - min_lng)

            # Find which tile and pixel
            fx = (lng + 180.0) / 360.0 * n
            lat_rad = math.radians(lat)
            fy = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n

            tx, ty = int(fx), int(fy)
            tile = tile_elevations.get((tx, ty))

            if tile is not None:
                tile_size = tile.shape[0]  # 512 for @2x
                px = int((fx - tx) * tile_size) % tile_size
                py = int((fy - ty) * tile_size) % tile_size
                elevation_grid[r, c] = tile[py, px]
            else:
                elevation_grid[r, c] = 0.0

    return elevation_grid, bbox
