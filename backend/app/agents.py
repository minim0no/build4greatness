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
    system_prompt = f"""You are a flood risk analyst for CrisisPath, an emergency response platform.
Analyze FEMA National Flood Hazard Layer data and local infrastructure to identify impacts.

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
    system_prompt = f"""You are an emergency response planner for CrisisPath.
Given a flood analysis, generate actionable evacuation and deployment plans.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_PLANNER_JSON_SCHEMA}

After the JSON block, provide a clear markdown narrative with the top 5 priority actions for emergency responders."""

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

Generate an actionable emergency response plan with specific evacuation routes, shelter assignments, and resource deployment recommendations."""

    async for item in _run_agent(system_prompt, user_message, _PLANNER_FALLBACK):
        yield item


async def run_tornado_analyst(
    tornado_stats: dict,
    infrastructure: dict,
    bbox: list[float],
    road_summary: dict | None = None,
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """Analyze tornado simulation results and infrastructure impact."""
    system_prompt = f"""You are a tornado damage analyst for CrisisPath, an emergency response platform.
Analyze tornado path simulation data and local infrastructure to identify impacts.

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
    system_prompt = f"""You are an emergency response planner for CrisisPath specializing in tornado events.
Given a tornado damage analysis, generate actionable shelter-in-place and response plans.

Key tornado-specific considerations:
- Shelter-in-place vs evacuation (basements, interior rooms, storm cellars)
- Debris clearance and search & rescue priorities
- Power restoration and gas leak containment
- Hospital surge capacity for trauma injuries

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{_PLANNER_JSON_SCHEMA}

After the JSON block, provide a clear markdown narrative with the top 5 priority actions for emergency responders."""

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

Generate an actionable emergency response plan focusing on search & rescue, debris clearance, shelter operations, and utility restoration."""

    async for item in _run_agent(system_prompt, user_message, _PLANNER_FALLBACK):
        yield item
