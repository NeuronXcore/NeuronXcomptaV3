from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.models.charges_forfaitaires import (
    ApplyVehiculeRequest,
    ApplyVehiculeResponse,
    BlanchissageRequest,
    ForfaitResult,
    GenerateODRequest,
    GenerateODResponse,
    VehiculeRequest,
    VehiculeResult,
)
from backend.services.charges_forfaitaires_service import ChargesForfaitairesService

router = APIRouter(prefix="/api/charges-forfaitaires", tags=["charges-forfaitaires"])
service = ChargesForfaitairesService()


class ConfigUpdate(BaseModel):
    honoraires_liasse: Optional[float] = None
    jours_travailles: Optional[float] = None
    vehicule_distance_km: Optional[float] = None
    vehicule_km_supplementaires: Optional[float] = None
    vehicule_km_totaux_compteur: Optional[float] = None


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
    """Liste les forfaits déjà générés pour l'année (blanchissage OD + véhicule ratio)."""
    results = service.get_forfaits_generes(year)
    vehicule = service.get_vehicule_genere(year)
    if vehicule:
        results.append(vehicule)
    return results


@router.delete("/supprimer/vehicule")
async def supprimer_vehicule(year: int = Query(...)):
    """Supprime le PDF rapport + entrée GED pour pouvoir regénérer."""
    ok = service.supprimer_vehicule(year)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=f"Aucune quote-part véhicule trouvée pour {year}",
        )
    return {"deleted": True}


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


# ── Véhicule ──


@router.post("/calculer/vehicule", response_model=VehiculeResult)
async def calculer_vehicule(request: VehiculeRequest):
    """Calcule le ratio pro sans persister. Retourne aussi le delta avec le poste actuel."""
    return service.calculer_vehicule(request)


@router.post("/appliquer/vehicule", response_model=ApplyVehiculeResponse)
async def appliquer_vehicule(request: ApplyVehiculeRequest):
    """Applique le ratio : met à jour le poste GED + génère PDF rapport + enregistre GED."""
    return service.appliquer_vehicule(request)


@router.post("/regenerer-pdf/vehicule")
async def regenerer_pdf_vehicule(year: int = Query(...)):
    """Regénère uniquement le PDF rapport véhicule avec les dépenses à jour."""
    pdf = service.regenerer_pdf_vehicule(year)
    if not pdf:
        raise HTTPException(status_code=404, detail="Aucune quote-part véhicule à regénérer")
    return {"pdf_filename": pdf}


@router.get("/vehicule/genere")
async def get_vehicule_genere(year: int = Query(...)):
    """Vérifie si la quote-part véhicule a été appliquée pour l'année."""
    return service.get_vehicule_genere(year)
