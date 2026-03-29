import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.routes.simulate import router as simulate_router
from app.routes.ws import router as ws_router
from app.routes.scenarios import router as scenarios_router
from app.routes.meteorites import router as meteorites_router

app = FastAPI(title="CrisisPath API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(simulate_router)
app.include_router(ws_router)
app.include_router(scenarios_router)
app.include_router(meteorites_router)


@app.get("/")
async def root():
    return {
        "name": "CrisisPath API",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "health": "/api/health",
    }


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "mapbox_configured": bool(os.getenv("MAPBOX_ACCESS_TOKEN")),
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
    }
