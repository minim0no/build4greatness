import json
import os
import re
from typing import AsyncGenerator

import anthropic
from openai import AsyncOpenAI


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
    road_summary: dict | None = None,
) -> AsyncGenerator[tuple[str, str | dict], None]:
    """
    Agent 1: Analyze flood simulation results and infrastructure impact.
    Yields (type, content) tuples: ("chunk", text) or ("data", parsed_json).
    """
    system_prompt = """You are a flood risk analyst for CrisisPath, an emergency response platform.
Analyze FEMA National Flood Hazard Layer data and local infrastructure to identify impacts.

You MUST output a JSON block wrapped in ```json ... ``` with this structure:
{
  "risk_zones": [{"level": "high|medium|low", "description": "..."}],
  "affected_roads": [{"name": "...", "status": "blocked|partial|passable"}],
  "at_risk_facilities": [{"name": "...", "type": "hospital|school|shelter", "risk": "high|medium|low"}],
  "blocked_routes": ["description of blocked route"],
  "summary": "2-3 sentence executive summary"
}

After the JSON block, provide a brief markdown narrative (3-5 bullet points) explaining the key findings."""

    user_message = f"""FEMA flood zone data for area {bbox}:

**Flood Risk Statistics:**
- Total flood zone area: {flood_stats.get('total_area_km2', 0)} km²
- High-risk area: {flood_stats.get('high_risk_area_km2', 0)} km²
- FEMA zones found: {flood_stats.get('zone_counts', {})}
- Risk summary: {flood_stats.get('risk_summary', 'N/A')}
- Number of flood zones: {flood_stats.get('num_flood_zones', 0)}

**Infrastructure in area:**
- Roads: {len(infrastructure.get('roads', []))} segments
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Schools: {json.dumps(infrastructure.get('schools', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}

Road names in area: {json.dumps([r['name'] for r in infrastructure.get('roads', [])[:20]])}

**Road Flood Analysis (spatial intersection results):**
- Blocked roads (>50% flooded): {json.dumps(road_summary.get('blocked', []) if road_summary else [])}
- Partially flooded roads (10-50%): {json.dumps(road_summary.get('partial', []) if road_summary else [])}
- Clear roads: {len(road_summary.get('clear', [])) if road_summary else 'unknown'} roads

Use these spatial intersection results for your affected_roads assessment. Roads listed as blocked/partial are confirmed flooded by FEMA zone overlap."""

    full_text = ""
    async for text in _stream_llm_text(system_prompt, user_message):
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

**FEMA Flood Risk Statistics:**
- Total flood zone area: {flood_stats.get('total_area_km2', 0)} km²
- High-risk area: {flood_stats.get('high_risk_area_km2', 0)} km²
- Risk summary: {flood_stats.get('risk_summary', 'N/A')}

**Analyst Assessment:**
{json.dumps(analyst_data, indent=2)}

**Available Infrastructure:**
- Hospitals: {json.dumps(infrastructure.get('hospitals', [])[:10])}
- Shelters: {json.dumps(infrastructure.get('shelters', [])[:10])}
- Fire stations: {json.dumps(infrastructure.get('fire_stations', [])[:5])}
- Police: {json.dumps(infrastructure.get('police', [])[:5])}

Generate an actionable emergency response plan with specific evacuation routes, shelter assignments, and resource deployment recommendations."""

    full_text = ""
    async for text in _stream_llm_text(system_prompt, user_message):
        full_text += text
        yield ("chunk", text)

    # Extract structured data
    parsed = _extract_json_block(full_text)
    if parsed:
        yield ("data", parsed)
    else:
        yield ("data", {"priority_actions": [], "evacuation_routes": [], "shelter_assignments": [], "resource_deployment": [], "action_timeline": []})
