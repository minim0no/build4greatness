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
        "ambulance_stations": [],
        "fuel_stations": [],
        "power": [],
        "flood_infrastructure": [],
    }

    for element in data.get("elements", []):
        tags = element.get("tags", {})
        etype = element.get("type")

        # Get coordinates
        if etype == "node":
            lat, lon = element.get("lat"), element.get("lon")
        elif "center" in element:
            lat, lon = element["center"]["lat"], element["center"]["lon"]
        elif "geometry" in element and element["geometry"]:
            # out body geom: ways have geometry array but no center
            pts = element["geometry"]
            mid = pts[len(pts) // 2]
            lat, lon = mid["lat"], mid["lon"]
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
        elif tags.get("emergency") == "ambulance_station":
            result["ambulance_stations"].append({"name": name, "lat": lat, "lon": lon})
        elif tags.get("amenity") == "fuel":
            result["fuel_stations"].append({"name": name, "lat": lat, "lon": lon, "operator": tags.get("operator", "")})
        elif tags.get("power") in ("substation", "plant", "generator"):
            result["power"].append({"name": name, "type": tags["power"], "lat": lat, "lon": lon})
        elif tags.get("waterway") in ("dam", "weir") or tags.get("man_made") in ("dyke", "pumping_station", "storage_tank", "reservoir_covered"):
            ftype = tags.get("waterway") or tags.get("man_made")
            result["flood_infrastructure"].append({"name": name, "type": ftype, "lat": lat, "lon": lon})

    return result


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
        "flood_infrastructure": [],
    }
