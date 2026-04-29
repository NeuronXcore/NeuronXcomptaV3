from __future__ import annotations

from fastapi import APIRouter, Query
from typing import Optional

import logging

from backend.models.simulation import SimulationRequest, UrssafDeductibleRequest, UrssafDeductibleResult
from backend.services import fiscal_service, urssaf_provisional_service

logger = logging.getLogger(__name__)

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


@router.post("/urssaf-deductible", response_model=UrssafDeductibleResult)
async def compute_urssaf_deductible_endpoint(body: UrssafDeductibleRequest):
    """
    Calcule la part déductible et non déductible d'une cotisation URSSAF brute.
    Utilise les barèmes versionnés. Aucun effet de bord.
    """
    return fiscal_service.compute_urssaf_deductible(
        montant_brut=body.montant_brut,
        bnc_estime=body.bnc_estime,
        year=body.year,
        cotisations_sociales_estime=body.cotisations_sociales_estime,
    )


@router.post("/batch-csg-split")
async def batch_csg_split(year: int = Query(...), force: bool = Query(False)):
    """
    Calcule et stocke le split CSG/CRDS pour toutes les opérations URSSAF d'une année.
    - force=False : ne recalcule que les ops sans csg_non_deductible existant
    - force=True  : recalcule toutes les ops URSSAF
    Utilise le BNC historique de l'année comme assiette.
    """
    return fiscal_service.run_batch_csg_split(year=year, force=force)


@router.get("/urssaf-regul/{year}")
async def urssaf_regul(year: int):
    """Estime la régularisation URSSAF de l'année N (à payer ou remboursement)
    en comparant l'URSSAF dû sur le BNC réel de N à ce qui a été payé en cash."""
    return urssaf_provisional_service.compute_urssaf_regul_estimate(year)


@router.get("/urssaf-acompte-theorique/{year}")
async def urssaf_acompte_theorique(year: int):
    """Calcule l'acompte URSSAF théorique de l'année N basé sur BNC N-2."""
    return urssaf_provisional_service.compute_acompte_theorique(year)


@router.get("/urssaf-projection")
async def urssaf_projection(start_year: int = Query(...), horizon: int = Query(5)):
    """Projette URSSAF dû / acompte / régul sur `horizon` années à partir de
    `start_year`. Utilise BNC réel quand disponible, forecast sinon."""
    return urssaf_provisional_service.project_cotisations_multi_years(start_year, horizon)
