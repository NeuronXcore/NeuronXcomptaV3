"""Router pour le rapprochement opérations / justificatifs."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.services import rapprochement_service, justificatif_service

router = APIRouter(prefix="/api/rapprochement", tags=["rapprochement"])


@router.get("/suggestions/operation/{file}/{index}")
def get_suggestions_for_operation(
    file: str,
    index: int,
    ventilation_index: Optional[int] = None,
):
    """Suggestions de justificatifs pour une opération."""
    return rapprochement_service.get_suggestions_for_operation(
        file, index, ventilation_index=ventilation_index,
    )


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


@router.get("/{filename}/{index}/suggestions")
def get_filtered_suggestions(
    filename: str,
    index: int,
    montant_min: Optional[float] = None,
    montant_max: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    ventilation_index: Optional[int] = None,
):
    """Suggestions filtrées de justificatifs pour une opération."""
    return rapprochement_service.get_filtered_suggestions(
        filename, index,
        montant_min=montant_min,
        montant_max=montant_max,
        date_from=date_from,
        date_to=date_to,
        search=search,
        ventilation_index=ventilation_index,
    )


class ManualAssociateRequest(BaseModel):
    justificatif_filename: str
    operation_file: str
    operation_index: int
    rapprochement_score: Optional[float] = None
    ventilation_index: Optional[int] = None


@router.post("/associate-manual")
def associate_manual(req: ManualAssociateRequest):
    """Association manuelle avec métadonnées de rapprochement."""
    success = justificatif_service.associate(
        req.justificatif_filename, req.operation_file, req.operation_index
    )
    if not success:
        raise HTTPException(status_code=400, detail="Échec de l'association")

    if req.ventilation_index is not None:
        # Pour une sous-ligne ventilée : écrire le justificatif dans la sous-ligne
        from backend.services import operation_service
        ops = operation_service.load_operations(req.operation_file)
        if 0 <= req.operation_index < len(ops):
            op = ops[req.operation_index]
            vlines = op.get("ventilation", [])
            if 0 <= req.ventilation_index < len(vlines):
                vlines[req.ventilation_index]["justificatif"] = req.justificatif_filename
            operation_service.save_operations(ops, filename=req.operation_file)

    rapprochement_service.write_rapprochement_metadata(
        req.operation_file,
        req.operation_index,
        req.rapprochement_score or 0.0,
        "manuel",
        ventilation_index=req.ventilation_index,
    )
    return {"success": True}
