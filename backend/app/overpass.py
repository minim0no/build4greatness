import httpx


OVERPASS_URL = "https://overpass-api.de/api/interpreter"


async def fetch_infrastructure(bbox: list[float]) -> dict:
    """
    Fetch roads, hospitals, schools, fire stations, shelters from Overpass API.
    bbox: [min_lng, min_lat, max_lng, max_lat]
    Returns structured dict of infrastructure features.
    """
    min_lng, min_lat, max_lng, max_lat = bbox
    # Overpass uses (south, west, north, east)
    bbox_str = f"{min_lat},{min_lng},{max_lat},{max_lng}"

    query = f"""
    [out:json][timeout:10];
    (
      way["highway"~"primary|secondary|tertiary|residential|trunk|motorway"]({bbox_str});
      node["amenity"~"hospital|clinic"]({bbox_str});
      node["amenity"~"school"]({bbox_str});
      node["amenity"~"fire_station"]({bbox_str});
      node["amenity"~"police"]({bbox_str});
      node["amenity"~"shelter"]({bbox_str});
      node["building"~"public|civic"]({bbox_str});
    );
    out center body;
    """

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=15.0,
            )
            if resp.status_code != 200:
                return _empty_result()
            data = resp.json()
    except Exception:
        return _empty_result()

    result = {
        "roads": [],
        "hospitals": [],
        "schools": [],
        "fire_stations": [],
        "shelters": [],
        "police": [],
    }

    for element in data.get("elements", []):
        tags = element.get("tags", {})
        etype = element.get("type")

        # Get coordinates
        if etype == "node":
            lat, lon = element.get("lat"), element.get("lon")
        elif "center" in element:
            lat, lon = element["center"]["lat"], element["center"]["lon"]
        else:
            continue

        name = tags.get("name", "Unknown")

        if tags.get("highway"):
            road_type = tags["highway"]
            # Extract road geometry if available
            geometry = element.get("geometry", [])
            coords = [[pt["lon"], pt["lat"]] for pt in geometry] if geometry else [[lon, lat]]
            result["roads"].append({
                "name": name,
                "type": road_type,
                "coords": coords,
                "lat": lat,
                "lon": lon,
            })
        elif tags.get("amenity") == "hospital" or tags.get("amenity") == "clinic":
            result["hospitals"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "school":
            result["schools"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "fire_station":
            result["fire_stations"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "shelter" or tags.get("building") in ("public", "civic"):
            result["shelters"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "police":
            result["police"].append({"name": name, "lat": lat, "lon": lon})

    return result


def _empty_result() -> dict:
    return {
        "roads": [],
        "hospitals": [],
        "schools": [],
        "fire_stations": [],
        "shelters": [],
        "police": [],
    }
