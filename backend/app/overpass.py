import asyncio
import logging
import math

import httpx

logger = logging.getLogger(__name__)


OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# Overpass API allows ~2 concurrent requests per IP
_overpass_semaphore = asyncio.Semaphore(1)


def _is_within_circle(lat: float, lon: float, center_lat: float, center_lng: float, radius_km: float) -> bool:
    """Check if a point is within radius_km of center."""
    dlat = (lat - center_lat) * 111.32
    dlng = (lon - center_lng) * 111.32 * math.cos(math.radians(center_lat))
    return (dlat * dlat + dlng * dlng) <= radius_km * radius_km


async def _run_overpass_query(client: httpx.AsyncClient, query: str, label: str) -> tuple[list[dict], str | None]:
    """Execute an Overpass query, trying multiple mirrors on failure."""
    last_err = None
    for url in OVERPASS_URLS:
        try:
            async with _overpass_semaphore:
                resp = await client.post(
                    url,
                    data={"data": query},
                    timeout=30.0,
                )
            if resp.status_code == 429:
                logger.warning("Overpass %s 429 from %s, trying next mirror", label, url)
                await asyncio.sleep(1)
                continue
            if resp.status_code != 200:
                last_err = f"HTTP {resp.status_code} from {url}"
                logger.warning("Overpass %s — %s", label, last_err)
                continue
            return resp.json().get("elements", []), None
        except Exception as e:
            last_err = f"{type(e).__name__} from {url}"
            logger.warning("Overpass %s — %s", label, last_err)
            continue

    err = f"{label} query failed: all mirrors exhausted ({last_err})"
    logger.error("Overpass %s", err)
    return [], err


async def fetch_infrastructure(bbox: list[float], center_lat: float = None, center_lng: float = None, radius_km: float = None) -> dict:
    """
    Fetch roads, hospitals, schools, fire stations, shelters from Overpass API.
    Splits into parallel queries to reduce per-request load.
    bbox: [min_lng, min_lat, max_lng, max_lat]
    """
    min_lng, min_lat, max_lng, max_lat = bbox
    bbox_str = f"{min_lat},{min_lng},{max_lat},{max_lng}"

    # Only major roads — residential roads bloat the response massively
    # (20K+ segments in dense areas) and cause Overpass timeouts.
    road_types = "primary|secondary|tertiary|trunk|motorway"

    # For large areas, restrict roads further to avoid Overpass timeouts.
    # A 10km+ bbox can return thousands of road ways with full geometry.
    bbox_area_deg2 = abs(max_lat - min_lat) * abs(max_lng - min_lng)
    if bbox_area_deg2 > 0.1:
        road_types = "primary|trunk|motorway"

    # Roads: out skel geom (geometry without tags — lighter than out body geom).
    # POIs: wrapped in union so all results go into one set, then out body.
    query = f"""
    [out:json][timeout:20][maxsize:5242880];
    way["highway"~"{road_types}"]({bbox_str});
    out skel geom;
    (
      node["amenity"~"hospital|clinic|fire_station|police|shelter"]({bbox_str});
      node["emergency"="ambulance_station"]({bbox_str});
    );
    out body;
    """

    async with httpx.AsyncClient() as client:
        all_elements, query_err = await _run_overpass_query(client, query, "infrastructure")

    result = _empty_result()

    if query_err:
        result["query_errors"] = [query_err]

    for element in all_elements:
        tags = element.get("tags", {})
        lat, lon = _extract_coords(element)
        if lat is None:
            continue
        name = tags.get("name", "Unknown")

        if tags.get("highway"):
            geometry = element.get("geometry", [])
            coords = [[pt["lon"], pt["lat"]] for pt in geometry] if geometry else [[lon, lat]]
            result["roads"].append({
                "name": name,
                "type": tags["highway"],
                "coords": coords,
                "lat": lat,
                "lon": lon,
            })
        elif tags.get("amenity") in ("hospital", "clinic"):
            result["hospitals"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "fire_station":
            result["fire_stations"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "shelter":
            result["shelters"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "police":
            result["police"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("emergency") == "ambulance_station":
            result["ambulance_stations"].append({"name": name, "lat": lat, "lon": lon})

    # Filter all features to within the analysis circle
    if center_lat is not None and center_lng is not None and radius_km is not None:
        for key in result:
            if key == "query_errors":
                continue
            if key == "roads":
                result["roads"] = [
                    r for r in result["roads"]
                    if _is_within_circle(r["lat"], r["lon"], center_lat, center_lng, radius_km)
                ]
            else:
                result[key] = [
                    item for item in result[key]
                    if _is_within_circle(item["lat"], item["lon"], center_lat, center_lng, radius_km)
                ]

    return result


def _extract_coords(element: dict) -> tuple[float | None, float | None]:
    """Extract lat/lon from an Overpass element."""
    etype = element.get("type")
    if etype == "node":
        return element.get("lat"), element.get("lon")
    if "center" in element:
        return element["center"]["lat"], element["center"]["lon"]
    if "geometry" in element and element["geometry"]:
        pts = element["geometry"]
        mid = pts[len(pts) // 2]
        return mid["lat"], mid["lon"]
    return None, None


def _empty_result() -> dict:
    return {
        "roads": [],
        "hospitals": [],
        "fire_stations": [],
        "shelters": [],
        "police": [],
        "ambulance_stations": [],
    }
