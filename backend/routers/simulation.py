from __future__ import annotations

from fastapi import APIRouter, Query
from typing import Optional

import logging

from backend.models.simulation import SimulationRequest, UrssafDeductibleRequest, UrssafDeductibleResult
from backend.services import fiscal_service, operation_service

logger = logging.getLogger(__name__)

_URSSAF_KEYWORDS = ("urssaf", "dspamc", "cotis")

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


def _is_urssaf_op(op: dict) -> bool:
    """Détecte une opération URSSAF par libellé ou catégorie."""
    libelle = (op.get("Libellé") or "").lower()
    cat = (op.get("Catégorie") or "").lower()
    sous = (op.get("Sous-catégorie") or "").lower()
    return (
        any(k in libelle for k in _URSSAF_KEYWORDS)
        or ("cotisations" in cat and "urssaf" in sous)
    )


@router.post("/batch-csg-split")
async def batch_csg_split(year: int = Query(...), force: bool = Query(False)):
    """
    Calcule et stocke le split CSG/CRDS pour toutes les opérations URSSAF d'une année.
    - force=False : ne recalcule que les ops sans csg_non_deductible existant
    - force=True  : recalcule toutes les ops URSSAF
    Utilise le BNC historique de l'année comme assiette.
    """
    historique = fiscal_service.get_historical_bnc([year])
    annual = historique.get("annual", [])
    year_data = next((a for a in annual if a["year"] == year), None)
    bnc_estime = abs(year_data["bnc"]) if year_data else 50000.0

    files = operation_service.list_operation_files()
    year_files = [f for f in files if f.get("year") == year]

    updated = 0
    skipped = 0
    total_non_deductible = 0.0

    for finfo in year_files:
        filename = finfo["filename"]
        ops = operation_service.load_operations(filename)
        changed = False
        for op in ops:
            if not _is_urssaf_op(op):
                continue
            if not force and op.get("csg_non_deductible"):
                skipped += 1
                total_non_deductible += op["csg_non_deductible"]
                continue
            montant = abs(op.get("Débit", 0) or 0)
            if montant <= 0:
                continue
            result = fiscal_service.compute_urssaf_deductible(
                montant_brut=montant,
                bnc_estime=bnc_estime,
                year=year,
            )
            op["csg_non_deductible"] = result["part_non_deductible"]
            total_non_deductible += result["part_non_deductible"]
            updated += 1
            changed = True
        if changed:
            operation_service.save_operations(ops, filename=filename)

    return {
        "year": year,
        "bnc_estime": bnc_estime,
        "updated": updated,
        "skipped": skipped,
        "total_non_deductible": round(total_non_deductible, 2),
    }
