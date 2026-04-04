"""Router des dotations aux amortissements."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.models.amortissement import ImmobilisationCreate, ImmobilisationUpdate
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
    return amortissement_service.get_dotations_exercice(year)


@router.get("/projections")
async def get_projections(years: int = Query(5)):
    return amortissement_service.get_projections(years)


@router.get("/tableau/{immo_id}")
async def get_tableau(immo_id: str):
    immo = amortissement_service.get_immobilisation(immo_id)
    if not immo:
        raise HTTPException(404, "Immobilisation non trouvée")
    return amortissement_service.calc_tableau_amortissement(immo)


@router.get("/{immo_id}")
async def get_immobilisation(immo_id: str):
    immo = amortissement_service.get_immobilisation(immo_id)
    if not immo:
        raise HTTPException(404, "Immobilisation non trouvée")
    return immo


@router.post("/")
async def create_immobilisation(data: ImmobilisationCreate):
    return amortissement_service.create_immobilisation(data.model_dump())


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
    immo = amortissement_service.create_immobilisation(data.model_dump())
    if data.operation_source:
        try:
            amortissement_service.link_operation_to_immobilisation(
                data.operation_source.file, data.operation_source.index, immo["id"]
            )
        except Exception as e:
            logger_msg = f"Lien opération échoué: {e}"
            import logging
            logging.getLogger(__name__).warning(logger_msg)
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
