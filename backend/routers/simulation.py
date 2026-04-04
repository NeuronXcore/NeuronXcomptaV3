from __future__ import annotations

from fastapi import APIRouter, Query
from typing import Optional

from backend.models.simulation import SimulationRequest
from backend.services import fiscal_service

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


@router.get("/baremes")
async def get_baremes(year: int = Query(2024)):
    return fiscal_service.load_all_baremes(year)


@router.get("/baremes/{type_bareme}")
async def get_bareme(type_bareme: str, year: int = Query(2024)):
    return fiscal_service.load_bareme(type_bareme, year)


@router.put("/baremes/{type_bareme}")
async def update_bareme(type_bareme: str, data: dict, year: int = Query(2024)):
    fiscal_service.save_bareme(type_bareme, year, data)
    return {"status": "saved"}


@router.post("/calculate")
async def calculate(req: SimulationRequest):
    return fiscal_service.simulate_multi(
        req.bnc_actuel, req.year, req.parts, req.leviers.dict()
    )


@router.get("/taux-marginal")
async def taux_marginal(bnc: float, year: int = 2024, parts: float = 1.0):
    return fiscal_service.calculate_taux_marginal(bnc, year, parts)


@router.get("/seuils")
async def seuils(year: int = 2024, parts: float = 1.0):
    return fiscal_service.find_seuils_critiques(year, parts)


@router.get("/historique")
async def historique(years: Optional[str] = None):
    year_list = [int(y) for y in years.split(",")] if years else None
    return fiscal_service.get_historical_bnc(year_list)


@router.get("/previsions")
async def previsions(horizon: int = 12, methode: str = "saisonnier"):
    return fiscal_service.forecast_bnc(horizon, methode)
