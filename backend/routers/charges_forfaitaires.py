from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.models.charges_forfaitaires import (
    BlanchissageRequest,
    ForfaitResult,
    GenerateODRequest,
    GenerateODResponse,
)
from backend.services.charges_forfaitaires_service import ChargesForfaitairesService

router = APIRouter(prefix="/api/charges-forfaitaires", tags=["charges-forfaitaires"])
service = ChargesForfaitairesService()


class ConfigUpdate(BaseModel):
    honoraires_liasse: Optional[float] = None
    jours_travailles: Optional[float] = None


@router.post("/calculer/blanchissage", response_model=ForfaitResult)
async def calculer_blanchissage(request: BlanchissageRequest):
    """Calcule le montant déductible sans générer d'OD."""
    try:
        return service.calculer_blanchissage(request)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/generer", response_model=GenerateODResponse)
async def generer_od(request: GenerateODRequest):
    """Génère l'OD + PDF reconstitué + enregistrement GED."""
    try:
        return service.generer_od(request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/generes")
async def get_forfaits_generes(year: int = Query(...)):
    """Liste les forfaits déjà générés pour l'année."""
    return service.get_forfaits_generes(year)


@router.delete("/supprimer/{type_forfait}")
async def supprimer_forfait(type_forfait: str, year: int = Query(...)):
    """Supprime l'OD + PDF + entrée GED pour pouvoir regénérer."""
    ok = service.supprimer_forfait(type_forfait, year)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Aucun forfait {type_forfait} trouvé pour {year}")
    return {"deleted": True}


@router.get("/config")
async def get_config(year: int = Query(...)):
    """Retourne la config persistée pour l'année (honoraires liasse, jours)."""
    return service.get_config(year)


@router.put("/config")
async def update_config(data: ConfigUpdate, year: int = Query(...)):
    """Met à jour la config persistée pour l'année."""
    return service.update_config(year, data.model_dump(exclude_none=True))
