"""Router des dotations aux amortissements."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.models.amortissement import (
    AmortissementVirtualDetail,
    BackfillComputeRequest,
    BackfillComputeResponse,
    ImmobilisationCreate,
    ImmobilisationUpdate,
)
from backend.services import amortissement_service

router = APIRouter(prefix="/api/amortissements", tags=["amortissements"])


@router.get("/")
async def list_immobilisations(
    statut: Optional[str] = Query(None),
    poste: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
):
    return amortissement_service.get_all_immobilisations(statut, poste, year)


@router.get("/kpis")
async def get_kpis(year: Optional[int] = Query(None)):
    return amortissement_service.get_kpis(year)


@router.get("/candidates")
async def get_candidates():
    return amortissement_service.get_all_candidates()


@router.get("/config")
async def get_config():
    return amortissement_service._load_config()


@router.put("/config")
async def save_config(config: dict):
    amortissement_service._save_config(config)
    return {"success": True}


@router.get("/dotations/{year}")
async def get_dotations(year: int):
    return amortissement_service.get_dotations(year)


@router.get("/projections")
async def get_projections(years: int = Query(5)):
    return amortissement_service.get_projections(years)


@router.get("/virtual-detail", response_model=AmortissementVirtualDetail)
async def get_virtual_detail(year: int = Query(...)):
    """Détail des dotations annuelles pour le `DotationsVirtualDrawer` (Prompt A2)."""
    return amortissement_service.get_virtual_detail(year)


@router.get("/dotation-ref/{year}")
async def get_dotation_ref(year: int):
    """Trouve l'OD dotation dans les opérations de décembre (Prompt B). Retourne null si absent."""
    return amortissement_service.find_dotation_operation(year)


@router.post("/compute-backfill", response_model=BackfillComputeResponse)
async def compute_backfill(req: BackfillComputeRequest):
    """Calcule la suggestion d'amortissements antérieurs + VNC d'ouverture pour une reprise.

    Linéaire pur, pro rata temporis année 1. Éditable côté UI si valeurs réelles différentes.
    """
    return amortissement_service.compute_backfill_suggestion(req)


@router.get("/tableau/{immo_id}")
async def get_tableau(immo_id: str):
    immo = amortissement_service.get_immobilisation(immo_id)
    if not immo:
        raise HTTPException(404, "Immobilisation non trouvée")
    return amortissement_service.compute_tableau(immo)


@router.get("/{immo_id}")
async def get_immobilisation(immo_id: str):
    immo = amortissement_service.get_immobilisation(immo_id)
    if not immo:
        raise HTTPException(404, "Immobilisation non trouvée")
    return immo


@router.post("/")
async def create_immobilisation(data: ImmobilisationCreate):
    try:
        return amortissement_service.create_immobilisation(data.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/{immo_id}")
async def update_immobilisation(immo_id: str, data: ImmobilisationUpdate):
    result = amortissement_service.update_immobilisation(immo_id, data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(404, "Immobilisation non trouvée")
    return result


@router.delete("/{immo_id}")
async def delete_immobilisation(immo_id: str):
    if not amortissement_service.delete_immobilisation(immo_id):
        raise HTTPException(404, "Immobilisation non trouvée")
    return {"success": True}


@router.post("/candidates/ignore")
async def ignore_candidate(body: dict):
    try:
        return amortissement_service.ignore_candidate(body["filename"], body["index"])
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))


@router.post("/candidates/immobiliser")
async def immobiliser_candidate(data: ImmobilisationCreate):
    try:
        immo = amortissement_service.create_immobilisation(data.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))
    if data.operation_source:
        try:
            src = data.operation_source
            file_ref = src.get("file") if isinstance(src, dict) else getattr(src, "file", None)
            index_ref = src.get("index") if isinstance(src, dict) else getattr(src, "index", None)
            if file_ref is not None and index_ref is not None:
                amortissement_service.link_operation_to_immobilisation(
                    file_ref, int(index_ref), immo["id"]
                )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Lien opération échoué: {e}")
    return immo


@router.post("/cession/{immo_id}")
async def cession(immo_id: str, body: dict):
    try:
        result = amortissement_service.calculer_cession(
            immo_id, body["date_sortie"], body.get("prix_cession", 0)
        )
        # Update the immobilisation
        amortissement_service.update_immobilisation(immo_id, {
            "date_sortie": body["date_sortie"],
            "motif_sortie": body.get("motif_sortie", "cession"),
            "prix_cession": body.get("prix_cession"),
            "statut": "sorti",
        })
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))
