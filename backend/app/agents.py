import json
import os
import re
from typing import AsyncGenerator

import anthropic


ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = "claude-sonnet-4-20250514"


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


async def run_simulation_analyst(
    flood_stats: dict,
    infrastructure: dict,
    bbox: list[float],
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """
    Agent 1: Analyze flood simulation results and infrastructure impact.
    Yields (type, content) tuples: ("chunk", text) or ("data", parsed_json).
    """
    system_prompt = """You are a flood simulation analyst for CrisisPath, an emergency response platform.
Analyze the flood data and infrastructure to identify impacts.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{
  "risk_zones": [{"level": "high|medium|low", "description": "..."}],
  "affected_roads": [{"name": "...", "status": "blocked|partial|passable"}],
  "at_risk_facilities": [{"name": "...", "type": "hospital|school|shelter", "risk": "high|medium|low"}],
  "blocked_routes": ["description of blocked route"],
  "summary": "2-3 sentence executive summary"
}

After the JSON block, provide a brief markdown narrative (3-5 bullet points) explaining the key findings."""

    user_message = f"""Flood simulation results for area {bbox}:

**Flood Statistics:**
- Flooded area: {flood_stats.get('area_km2', 0)} km²
- Maximum depth: {flood_stats.get('max_depth_m', 0)} m
- Affected cells: {flood_stats.get('affected_cells', 0)} / {flood_stats.get('total_cells', 0)}

**Infrastructure in area:**
- Roads: {len(infrastructure.get('roads', []))} segments
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Schools: {json.dumps(infrastructure.get('schools', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}

Road names in area: {json.dumps([r['name'] for r in infrastructure.get('roads', [])[:20]])}

Analyze the flood impact on this infrastructure and provide your assessment."""

    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    full_text = ""

    async with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        async for text in stream.text_stream:
            full_text += text
            yield ("chunk", text)

    # Extract structured data
    parsed = _extract_json_block(full_text)
    if parsed:
        yield ("data", parsed)
    else:
        yield ("data", {"summary": full_text[:500], "risk_zones": [], "affected_roads": [], "at_risk_facilities": [], "blocked_routes": []})


async def run_response_planner(
    flood_stats: dict,
    analyst_data: dict,
    infrastructure: dict,
    bbox: list[float],
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """
    Agent 2: Generate actionable evacuation and response plan.
    Yields (type, content) tuples: ("chunk", text) or ("data", parsed_json).
    """
    system_prompt = """You are an emergency response planner for CrisisPath.
Given a flood analysis, generate actionable evacuation and deployment plans.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
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
}

After the JSON block, provide a clear markdown narrative with the top 5 priority actions for emergency responders."""

    user_message = f"""Flood area: {bbox}

**Flood Statistics:**
- Flooded area: {flood_stats.get('area_km2', 0)} km²
- Maximum depth: {flood_stats.get('max_depth_m', 0)} m

**Analyst Assessment:**
{json.dumps(analyst_data, indent=2)}

**Available Infrastructure:**
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}

Generate an actionable emergency response plan with specific evacuation routes, shelter assignments, and resource deployment recommendations."""

    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    full_text = ""

    async with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        async for text in stream.text_stream:
            full_text += text
            yield ("chunk", text)

    # Extract structured data
    parsed = _extract_json_block(full_text)
    if parsed:
        yield ("data", parsed)
    else:
        yield ("data", {"priority_actions": [], "evacuation_routes": [], "shelter_assignments": [], "resource_deployment": [], "action_timeline": []})
