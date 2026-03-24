from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException, Query

from backend.models.echeancier import (
    Recurrence,
    Echeance,
    EcheancierStats,
    ConfirmEcheanceRequest,
    SoldePrevisionnel,
)
from backend.services import echeancier_service

router = APIRouter(prefix="/api/echeancier", tags=["echeancier"])


@router.get("/recurrences", response_model=List[Recurrence])
def get_recurrences():
    """Détecte les paiements récurrents depuis tous les fichiers d'opérations."""
    return echeancier_service.detect_recurrences()


@router.get("/calendar", response_model=List[Echeance])
def get_calendar(horizon: int = Query(default=6, ge=1, le=24)):
    """Génère l'échéancier projeté sur N mois."""
    recurrences = echeancier_service.detect_recurrences()
    return echeancier_service.generate_echeancier(recurrences, horizon_mois=horizon)


@router.get("/stats", response_model=EcheancierStats)
def get_stats(horizon: int = Query(default=6, ge=1, le=24)):
    """Statistiques de l'échéancier."""
    recurrences = echeancier_service.detect_recurrences()
    echeances = echeancier_service.generate_echeancier(recurrences, horizon_mois=horizon)
    return echeancier_service.get_echeancier_stats(echeances)


@router.get("/solde-previsionnel", response_model=List[SoldePrevisionnel])
def get_solde_previsionnel(
    solde_actuel: float = Query(default=0.0),
    horizon: int = Query(default=6, ge=1, le=24),
):
    """Calcule le solde prévisionnel sur N mois."""
    recurrences = echeancier_service.detect_recurrences()
    echeances = echeancier_service.generate_echeancier(recurrences, horizon_mois=horizon)
    return echeancier_service.compute_solde_previsionnel(solde_actuel, echeances)


@router.put("/{echeance_id}/confirm", response_model=Echeance)
def confirm(echeance_id: str, req: ConfirmEcheanceRequest):
    """Confirme une échéance comme réalisée."""
    result = echeancier_service.confirm_echeance(
        echeance_id, req.operation_file, req.operation_index
    )
    if not result:
        raise HTTPException(status_code=404, detail="Échéance non trouvée")
    return result


@router.put("/{echeance_id}/annuler", response_model=Echeance)
def annuler(echeance_id: str):
    """Annule une échéance prévue."""
    result = echeancier_service.annuler_echeance(echeance_id)
    if not result:
        raise HTTPException(status_code=404, detail="Échéance non trouvée")
    return result
