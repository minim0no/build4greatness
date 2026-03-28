from fastapi import APIRouter, HTTPException

from app.routes.simulate import scenarios

router = APIRouter(prefix="/api")


@router.get("/scenarios")
async def list_scenarios():
    return [
        {
            "scenario_id": sid,
            "request": data.get("request"),
            "stats": data.get("stats"),
        }
        for sid, data in scenarios.items()
    ]


@router.get("/scenarios/{scenario_id}")
async def get_scenario(scenario_id: str):
    if scenario_id not in scenarios:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenarios[scenario_id]
