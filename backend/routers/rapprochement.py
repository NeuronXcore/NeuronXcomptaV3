"""Router pour le rapprochement opérations / justificatifs."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.services import rapprochement_service, justificatif_service

router = APIRouter(prefix="/api/rapprochement", tags=["rapprochement"])


@router.get("/suggestions/operation/{file}/{index}")
def get_suggestions_for_operation(file: str, index: int):
    """Suggestions de justificatifs pour une opération."""
    return rapprochement_service.get_suggestions_for_operation(file, index)


@router.get("/suggestions/justificatif/{filename}")
def get_suggestions_for_justificatif(filename: str):
    """Suggestions d'opérations pour un justificatif."""
    return rapprochement_service.get_suggestions_for_justificatif(filename)


@router.post("/run-auto")
def run_auto_rapprochement():
    """Lance le rapprochement automatique et retourne le rapport."""
    return rapprochement_service.run_auto_rapprochement()


@router.get("/unmatched")
def get_unmatched():
    """Compteurs opérations/justificatifs non rapprochés."""
    return rapprochement_service.get_unmatched_summary()


@router.get("/log")
def get_auto_log(limit: int = Query(20, ge=1, le=100)):
    """Dernières associations automatiques."""
    return rapprochement_service.get_auto_log(limit)


@router.get("/batch-hints/{filename}")
def get_batch_hints(filename: str):
    """Best scores par index pour un fichier d'opérations."""
    return rapprochement_service.get_batch_hints(filename)


@router.get("/batch-justificatif-scores")
def get_batch_justificatif_scores():
    """Best score par justificatif en attente."""
    return rapprochement_service.get_batch_justificatif_scores()


class ManualAssociateRequest(BaseModel):
    justificatif_filename: str
    operation_file: str
    operation_index: int
    rapprochement_score: Optional[float] = None


@router.post("/associate-manual")
def associate_manual(req: ManualAssociateRequest):
    """Association manuelle avec métadonnées de rapprochement."""
    success = justificatif_service.associate(
        req.justificatif_filename, req.operation_file, req.operation_index
    )
    if not success:
        raise HTTPException(status_code=400, detail="Échec de l'association")

    rapprochement_service.write_rapprochement_metadata(
        req.operation_file,
        req.operation_index,
        req.rapprochement_score or 0.0,
        "manuel",
    )
    return {"success": True}
