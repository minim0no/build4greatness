import asyncio
import logging
import math

import httpx

logger = logging.getLogger(__name__)


OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Overpass API allows ~2 concurrent requests per IP
_overpass_semaphore = asyncio.Semaphore(1)


def _is_within_circle(lat: float, lon: float, center_lat: float, center_lng: float, radius_km: float) -> bool:
    """Check if a point is within radius_km of center."""
    dlat = (lat - center_lat) * 111.32
    dlng = (lon - center_lng) * 111.32 * math.cos(math.radians(center_lat))
    return (dlat * dlat + dlng * dlng) <= radius_km * radius_km


async def _run_overpass_query(client: httpx.AsyncClient, query: str, label: str) -> tuple[list[dict], str | None]:
    """Execute a single Overpass query with retry on 429. Returns (elements, error_or_none)."""
    for attempt in range(3):
        try:
            async with _overpass_semaphore:
                resp = await client.post(
                    OVERPASS_URL,
                    data={"data": query},
                    timeout=30.0,
                )
            if resp.status_code == 429:
                wait = 2 * (attempt + 1)
                logger.warning("Overpass %s 429 rate-limited, retrying in %ds (attempt %d/3)", label, wait, attempt + 1)
                await asyncio.sleep(wait)
                continue
            if resp.status_code != 200:
                err = f"{label} query failed: HTTP {resp.status_code}"
                logger.error("Overpass %s — %s", err, resp.text[:200])
                return [], err
            return resp.json().get("elements", []), None
        except Exception as e:
            err = f"{label} query failed: {type(e).__name__}"
            logger.exception("Overpass %s", err)
            return [], err
    err = f"{label} query failed: rate-limited after 3 retries"
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

    # For large radii, drop residential roads to keep payload manageable.
    # A 10km bbox in Houston returns 20K+ residential road segments.
    if radius_km is not None and radius_km > 5:
        road_types = "primary|secondary|tertiary|trunk|motorway"
    else:
        road_types = "primary|secondary|tertiary|residential|trunk|motorway"

    # Single combined query — the public Overpass API rate-limits by slot, so
    # one large query is cheaper on quota than three separate requests.
    query = f"""
    [out:json][timeout:15];
    (
      way["highway"~"{road_types}"]({bbox_str});
      node["amenity"~"hospital|clinic"]({bbox_str});
      node["amenity"~"school"]({bbox_str});
      node["amenity"~"fire_station"]({bbox_str});
      node["amenity"~"police"]({bbox_str});
      node["amenity"~"shelter"]({bbox_str});
      node["building"~"public|civic"]({bbox_str});
      node["emergency"="ambulance_station"]({bbox_str});
      way["emergency"="ambulance_station"]({bbox_str});
      node["amenity"="fuel"]({bbox_str});
      way["amenity"="fuel"]({bbox_str});
      node["power"~"substation|plant|generator"]({bbox_str});
      way["power"~"substation|plant|generator"]({bbox_str});
      node["waterway"~"dam|weir"]({bbox_str});
      way["waterway"~"dam|weir"]({bbox_str});
      node["man_made"~"dyke|pumping_station|storage_tank|reservoir_covered"]({bbox_str});
      way["man_made"~"dyke|pumping_station|storage_tank|reservoir_covered"]({bbox_str});
    );
    out body geom;
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
        elif tags.get("amenity") == "school":
            result["schools"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "fire_station":
            result["fire_stations"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "shelter" or tags.get("building") in ("public", "civic"):
            result["shelters"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "police":
            result["police"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("emergency") == "ambulance_station":
            result["ambulance_stations"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "fuel":
            result["fuel_stations"].append({"name": name, "lat": lat, "lon": lon, "operator": tags.get("operator", "")})
        elif tags.get("power") in ("substation", "plant", "generator"):
            result["power"].append({"name": name, "type": tags["power"], "lat": lat, "lon": lon})
        elif tags.get("waterway") in ("dam", "weir") or tags.get("man_made") in ("dyke", "pumping_station", "storage_tank", "reservoir_covered"):
            ftype = tags.get("waterway") or tags.get("man_made")
            result["disaster_infrastructure"].append({"name": name, "type": ftype, "lat": lat, "lon": lon})

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
        "schools": [],
        "fire_stations": [],
        "shelters": [],
        "police": [],
        "ambulance_stations": [],
        "fuel_stations": [],
        "power": [],
        "disaster_infrastructure": [],
    }
