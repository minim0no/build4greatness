import json
import logging
import os
import re
from typing import AsyncGenerator

import anthropic
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
ANTHROPIC_MODEL = "claude-sonnet-4-20250514"


def _llm_backend() -> tuple[str, str]:
    """Prefer OpenAI (sk-...) when OPENAI_API_KEY is set; else Anthropic."""
    if OPENAI_API_KEY:
        return "openai", OPENAI_API_KEY
    if ANTHROPIC_API_KEY:
        return "anthropic", ANTHROPIC_API_KEY
    raise RuntimeError(
        "No LLM API key configured. Set OPENAI_API_KEY (OpenAI) or ANTHROPIC_API_KEY."
    )


async def _stream_llm_text(system_prompt: str, user_message: str) -> AsyncGenerator[str, None]:
    backend, api_key = _llm_backend()
    if backend == "openai":
        client = AsyncOpenAI(api_key=api_key)
        stream = await client.chat.completions.create(
            model=OPENAI_MODEL,
            max_tokens=2048,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            stream=True,
        )
        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if not choice:
                continue
            delta = choice.delta.content
            if delta:
                yield delta
        return

    client = anthropic.AsyncAnthropic(api_key=api_key)
    async with client.messages.stream(
        model=ANTHROPIC_MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        async for text in stream.text_stream:
            yield text


def _data_warnings(infrastructure: dict) -> str:
    """Build a warning string if any infrastructure queries failed."""
    errors = infrastructure.get("query_errors", [])
    if not errors:
        return ""
    return (
        "\n\n**WARNING — INCOMPLETE DATA:** Some infrastructure queries failed: "
        + "; ".join(errors)
        + ". Data below may be missing categories. Do NOT assume absence of data means absence of risk. "
        "Explicitly note which data is unavailable and recommend ground-truth verification.\n"
    )


def _extract_json_block(text: str) -> dict | None:
    """Extract first JSON block from markdown-formatted text."""
    pattern = r"```json\s*([\s\S]*?)\s*```"
    match = re.search(pattern, text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            return None
    # Try parsing the whole thing as JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


_ANALYST_JSON_SCHEMA = """\
{
  "risk_zones": [{"level": "high|medium|low", "description": "..."}],
  "affected_roads": [{"name": "...", "status": "blocked|partial|passable"}],
  "at_risk_facilities": [{"name": "...", "type": "hospital|school|shelter", "risk": "high|medium|low"}],
  "blocked_routes": ["description of blocked route"],
  "summary": "2-3 sentence executive summary"
}"""

_PLANNER_JSON_SCHEMA = """\
{
  "priority_actions": [
    {"rank": 1, "action": "...", "reason": "...", "urgency": "immediate|within_1hr|within_2hr"}
  ],
  "evacuation_routes": [
    {"from": "zone description", "to": "shelter/safe area", "via": "route description", "status": "recommended|alternative"}
  ],
  "shelter_assignments": [
    {"facility": "name", "capacity_note": "...", "priority_populations": "..."}
  ],
  "resource_deployment": [
    {"resource": "...", "location": "...", "purpose": "..."}
  ],
  "action_timeline": [
    {"timeframe": "0-30 min", "actions": ["..."]}
  ]
}"""

_ANALYST_FALLBACK = {"summary": "", "risk_zones": [], "affected_roads": [], "at_risk_facilities": [], "blocked_routes": []}
_PLANNER_FALLBACK = {"priority_actions": [], "evacuation_routes": [], "shelter_assignments": [], "resource_deployment": [], "action_timeline": []}


async def _run_agent(
    system_prompt: str,
    user_message: str,
    fallback: dict,
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Generic agent runner. Streams text chunks, then yields parsed JSON data."""
    chunks: list[str] = []
    async for text in _stream_llm_text(system_prompt, user_message):
        chunks.append(text)
        yield ("chunk", text)

    full_text = "".join(chunks)
    parsed = _extract_json_block(full_text)
    if parsed:
        yield ("data", parsed)
    else:
        fallback_with_summary = dict(fallback)
        if "summary" in fallback_with_summary:
            fallback_with_summary["summary"] = full_text[:500]
        yield ("data", fallback_with_summary)


def _format_infrastructure_block(infrastructure: dict) -> str:
    return f"""- Roads: {len(infrastructure.get('roads', []))} segments
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Schools: {json.dumps(infrastructure.get('schools', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}"""


def _format_road_summary_block(road_summary: dict | None) -> str:
    if not road_summary:
        return "- No road analysis available"
    return f"""- Blocked roads (>50% affected): {json.dumps(road_summary.get('blocked', []))}
- Partially affected roads (10-50%): {json.dumps(road_summary.get('partial', []))}
- Clear roads: {len(road_summary.get('clear', []))} roads"""


async def run_simulation_analyst(
    flood_stats: dict,
    infrastructure: dict,
    bbox: list[float],
    road_summary: dict | None = None,
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Agent 1: Analyze flood simulation results and infrastructure impact."""
    system_prompt = f"""You are a flood risk analyst for CrisisPath, an educational disaster simulation tool.
Analyze FEMA National Flood Hazard Layer data and local infrastructure to identify potential impacts.

Keep your analysis grounded and proportional to the data:
- FEMA flood zones show *potential* risk areas, not active flooding. Frame findings as "areas within flood zones" not "flooded areas."
- Be specific about what the data actually shows vs. what you're inferring.
- Don't dramatize — a 5% flood coverage area is low risk, not a catastrophe.
- Focus on practical awareness: which roads/facilities are in flood zones, not Hollywood disaster scenarios.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_ANALYST_JSON_SCHEMA}

After the JSON block, provide a brief markdown narrative (3-5 bullet points) explaining the key findings."""

    user_message = f"""{_data_warnings(infrastructure)}FEMA flood zone data for area {bbox}:

**Flood Risk Statistics:**
- Search area: {flood_stats.get('search_area_km2', 0)} km²
- Total flood zone area: {flood_stats.get('total_area_km2', 0)} km²
- High-risk area: {flood_stats.get('high_risk_area_km2', 0)} km²
- Flood coverage: {flood_stats.get('flood_coverage_pct', 0)}% of search area
- FEMA zones found: {flood_stats.get('zone_counts', {})}
- Risk summary: {flood_stats.get('risk_summary', 'N/A')}
- Number of flood zones: {flood_stats.get('num_flood_zones', 0)}

IMPORTANT: Use the flood_coverage_pct above as the actual flood coverage percentage. Do NOT say "100% coverage" unless the data shows 100%.

**Infrastructure in area:**
{_format_infrastructure_block(infrastructure)}

Road names in area: {json.dumps([r['name'] for r in infrastructure.get('roads', [])[:20]])}

**Road Flood Analysis (spatial intersection results):**
{_format_road_summary_block(road_summary)}

Use these spatial intersection results for your affected_roads assessment. Roads listed as blocked/partial are confirmed flooded by FEMA zone overlap."""

    async for item in _run_agent(system_prompt, user_message, _ANALYST_FALLBACK):
        yield item


async def run_response_planner(
    flood_stats: dict,
    analyst_data: dict,
    infrastructure: dict,
    bbox: list[float],
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Agent 2: Generate actionable evacuation and response plan."""
    system_prompt = f"""You are a preparedness planner for CrisisPath, an educational disaster simulation tool.
Given a flood risk analysis, suggest practical preparedness and response ideas.

Keep recommendations realistic and proportional:
- This is a planning tool, not an active emergency. Frame suggestions as "if flooding occurs" preparedness steps.
- Suggest things normal people and local agencies can actually do: check evacuation routes, know shelter locations, avoid low-lying roads, sign up for alerts.
- Do NOT suggest deploying rescue boats, mobilizing the National Guard, or other large-scale operations that are beyond the scope of local planning.
- Focus on awareness and preparedness: "residents near X should know their evacuation route" not "deploy search and rescue teams to X."
- Keep it calm and helpful, not alarmist.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_PLANNER_JSON_SCHEMA}

After the JSON block, provide a clear markdown narrative with the top 5 practical preparedness steps."""

    user_message = f"""{_data_warnings(infrastructure)}Flood area: {bbox}

**FEMA Flood Risk Statistics:**
- Search area: {flood_stats.get('search_area_km2', 0)} km²
- Total flood zone area: {flood_stats.get('total_area_km2', 0)} km²
- High-risk area: {flood_stats.get('high_risk_area_km2', 0)} km²
- Flood coverage: {flood_stats.get('flood_coverage_pct', 0)}% of search area
- Risk summary: {flood_stats.get('risk_summary', 'N/A')}

**Analyst Assessment:**
{json.dumps(analyst_data, indent=2)}

**Available Infrastructure:**
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}

Suggest practical preparedness steps: evacuation route awareness, nearby shelter locations, and what residents in flood zones should keep in mind."""

    async for item in _run_agent(system_prompt, user_message, _PLANNER_FALLBACK):
        yield item


async def run_tornado_analyst(
    tornado_stats: dict,
    infrastructure: dict,
    bbox: list[float],
    road_summary: dict | None = None,
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Analyze tornado simulation results and infrastructure impact."""
    system_prompt = f"""You are a tornado risk analyst for CrisisPath, an educational disaster simulation tool.
Analyze a simulated tornado path and local infrastructure to identify potential impacts.

Keep your analysis grounded and proportional:
- This is a simulation, not a real tornado. Frame findings as "if a tornado followed this path" scenarios.
- Be specific about what's actually in the path vs. nearby.
- Focus on practical awareness: which buildings and roads would be affected, not worst-case destruction fantasies.
- Scale your concern to the EF rating — an EF1 is not the same as an EF5.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_ANALYST_JSON_SCHEMA}

After the JSON block, provide a brief markdown narrative (3-5 bullet points) explaining the key findings."""

    user_message = f"""{_data_warnings(infrastructure)}Tornado path data for area {bbox}:

**Tornado Statistics:**
- EF Scale: EF{tornado_stats.get('ef_scale', 0)}
- Path length: {tornado_stats.get('path_length_km', 0)} km
- Path width: {tornado_stats.get('path_width_m', 0)} m
- Affected area: {tornado_stats.get('affected_area_km2', 0)} km²
- Summary: {tornado_stats.get('risk_summary', 'N/A')}

**Infrastructure in area:**
{_format_infrastructure_block(infrastructure)}
- Power: {json.dumps(infrastructure.get('power', [])[:5])}

Road names in area: {json.dumps([r['name'] for r in infrastructure.get('roads', [])[:20]])}

**Road Damage Analysis (spatial intersection with tornado path):**
{_format_road_summary_block(road_summary)}

Tornado damage differs from flooding: structures may be completely destroyed, debris blocks roads, power lines down, gas leaks possible. Prioritize shelter-in-place vs evacuation decisions."""

    async for item in _run_agent(system_prompt, user_message, _ANALYST_FALLBACK):
        yield item


async def run_tornado_planner(
    tornado_stats: dict,
    analyst_data: dict,
    infrastructure: dict,
    bbox: list[float],
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Generate actionable tornado response and shelter plan."""
    system_prompt = f"""You are a preparedness planner for CrisisPath, an educational disaster simulation tool.
Given a simulated tornado analysis, suggest practical preparedness and shelter recommendations.

Keep recommendations realistic and proportional:
- This is a simulation for planning purposes. Frame suggestions as "if a tornado strikes this area" preparedness steps.
- Focus on things people can actually do: know where to shelter (basements, interior rooms), identify safe rooms, know evacuation routes away from the path.
- Do NOT suggest large-scale military-style operations, deploying heavy equipment fleets, or other unrealistic responses.
- Practical tips: know your nearest shelter, have an emergency kit, avoid areas with downed power lines, check on neighbors.
- Scale recommendations to the EF rating — don't treat every tornado like it's the end of the world.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_PLANNER_JSON_SCHEMA}

After the JSON block, provide a clear markdown narrative with the top 5 practical preparedness steps."""

    user_message = f"""{_data_warnings(infrastructure)}Tornado area: {bbox}

**Tornado Statistics:**
- EF Scale: EF{tornado_stats.get('ef_scale', 0)}
- Path length: {tornado_stats.get('path_length_km', 0)} km
- Path width: {tornado_stats.get('path_width_m', 0)} m
- Affected area: {tornado_stats.get('affected_area_km2', 0)} km²

**Analyst Assessment:**
{json.dumps(analyst_data, indent=2)}

**Available Infrastructure:**
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}

Suggest practical preparedness steps: where to shelter, routes to avoid, nearby safe locations, and what residents in the path should keep in mind."""

    async for item in _run_agent(system_prompt, user_message, _PLANNER_FALLBACK):
        yield item


async def run_asteroid_analyst(
    asteroid_stats: dict,
    infrastructure: dict,
    bbox: list[float],
    road_summary: dict | None = None,
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Analyze asteroid impact simulation results and infrastructure damage."""
    system_prompt = f"""You are an asteroid impact analyst for CrisisPath, an educational disaster simulation tool.
Analyze a hypothetical asteroid impact simulation and local infrastructure to identify potential damage zones.

This is a fun "what-if" scenario tool. Keep the tone informative but not alarming:
- Frame everything as "in this simulation" or "hypothetically."
- Describe damage zones clearly (fireball, blast, shockwave, tremor) but don't write like a disaster movie script.
- Focus on which infrastructure falls in which zone — keep it factual.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_ANALYST_JSON_SCHEMA}

After the JSON block, provide a brief markdown narrative (3-5 bullet points) explaining the key findings."""

    user_message = f"""{_data_warnings(infrastructure)}Asteroid impact data for area {bbox}:

**Impact Statistics:**
- Impactor mass: {asteroid_stats.get('mass_kg', 0)} kg
- Energy: {asteroid_stats.get('energy_megatons', 0)} megatons TNT equivalent
- Estimated crater diameter: {asteroid_stats.get('crater_diameter_km', 0)} km
- Maximum damage radius: {asteroid_stats.get('max_damage_radius_km', 0)} km
- Total affected area: {asteroid_stats.get('affected_area_km2', 0)} km²
- Summary: {asteroid_stats.get('risk_summary', 'N/A')}

**Infrastructure in area:**
{_format_infrastructure_block(infrastructure)}
- Power: {json.dumps(infrastructure.get('power', [])[:5])}

Road names in area: {json.dumps([r['name'] for r in infrastructure.get('roads', [])[:20]])}

**Road Damage Analysis (spatial intersection with impact zones):**
{_format_road_summary_block(road_summary)}

Asteroid impacts cause simultaneous thermal, blast, and seismic damage. Infrastructure in the extreme/high zones is likely destroyed. Focus on what survives in the medium/low zones for response planning."""

    async for item in _run_agent(system_prompt, user_message, _ANALYST_FALLBACK):
        yield item


async def run_asteroid_planner(
    asteroid_stats: dict,
    analyst_data: dict,
    infrastructure: dict,
    bbox: list[float],
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Generate actionable asteroid impact response and evacuation plan."""
    system_prompt = f"""You are a preparedness planner for CrisisPath, an educational disaster simulation tool.
Given a hypothetical asteroid impact analysis, suggest what preparedness would look like for this scenario.

This is a "what-if" educational tool — keep it interesting but grounded:
- Frame as "in this scenario" — nobody is actually deploying anything.
- For inner zones: acknowledge these are total loss areas in the simulation. Focus on outer zones where preparation matters.
- Suggest realistic awareness steps: know evacuation routes, understand blast radius distances, identify which shelters are outside the impact zone.
- Don't suggest things like "mobilize FEMA" or "deploy military assets" — focus on what individuals and communities can learn from the simulation.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_PLANNER_JSON_SCHEMA}

After the JSON block, provide a clear markdown narrative with the top 5 takeaways from this simulation."""

    user_message = f"""{_data_warnings(infrastructure)}Impact area: {bbox}

**Asteroid Impact Statistics:**
- Impactor mass: {asteroid_stats.get('mass_kg', 0)} kg
- Energy: {asteroid_stats.get('energy_megatons', 0)} megatons TNT equivalent
- Crater diameter: {asteroid_stats.get('crater_diameter_km', 0)} km
- Max damage radius: {asteroid_stats.get('max_damage_radius_km', 0)} km
- Affected area: {asteroid_stats.get('affected_area_km2', 0)} km²

**Analyst Assessment:**
{json.dumps(analyst_data, indent=2)}

**Available Infrastructure (outside destruction zone):**
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}

What can we learn from this simulation? Highlight which areas would be most affected, where the nearest safe zones are, and what general preparedness lessons apply."""

    async for item in _run_agent(system_prompt, user_message, _PLANNER_FALLBACK):
        yield item
