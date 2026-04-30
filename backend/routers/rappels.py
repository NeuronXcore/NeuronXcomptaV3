"""Router du module Rappels Dashboard."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models.rappel import RappelsSummary, RuleInfo, SnoozeRequest
from backend.services import rappels_service

router = APIRouter(prefix="/api/rappels", tags=["rappels"])


@router.get("", response_model=RappelsSummary)
def get_rappels() -> RappelsSummary:
    """Retourne tous les rappels actifs (non snoozés, règles activées), triés par
    niveau puis date_detection."""
    return rappels_service.get_all_rappels()


@router.get("/rules", response_model=list[RuleInfo])
def list_rules() -> list[RuleInfo]:
    """Liste toutes les règles enregistrées avec leur état activé/désactivé.

    Consommé par l'UI Settings du bandeau Rappels pour afficher les toggles.
    Le state désactivé vit dans `settings.rappels_disabled_rules`.
    """
    return rappels_service.list_rules()


@router.post("/{rule_id}/snooze")
def snooze(rule_id: str, payload: SnoozeRequest) -> dict[str, str]:
    """Snooze un rappel pour 1, 7 ou 30 jours."""
    if payload.days not in (1, 7, 30):
        raise HTTPException(400, "days must be 1, 7 or 30")
    return rappels_service.snooze_rappel(rule_id, payload.days)


@router.delete("/{rule_id}/snooze")
def unsnooze(rule_id: str) -> dict[str, str]:
    """Retire un snooze actif (no-op si absent)."""
    rappels_service.unsnooze_rappel(rule_id)
    return {"status": "unsnoozed", "rule_id": rule_id}
