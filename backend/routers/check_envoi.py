"""Router Check d'envoi — 9 endpoints sous prefix /api/check-envoi."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.models.check_envoi import (
    CheckEnvoiInstance,
    CheckItemPatch,
    CheckPeriod,
    CheckReminderStateResponse,
    ReminderDismissRequest,
    ReminderSnoozeRequest,
)
from backend.services import check_envoi_service

router = APIRouter(prefix="/api/check-envoi", tags=["check-envoi"])


def _parse_period(period: str) -> CheckPeriod:
    try:
        return CheckPeriod(period)
    except ValueError:
        raise HTTPException(status_code=400, detail="period doit être 'month' ou 'year'")


# Routes statiques DÉCLARÉES AVANT les paths à params dynamiques pour éviter
# que `/coverage`, `/reminders/...` ou `/notes/...` ne matchent `/{year}/{period}`.


@router.get("/reminders/state", response_model=CheckReminderStateResponse)
def get_reminder_state():
    """État du reminder actif (le plus haut niveau non-snoozé non-dismissé)."""
    return check_envoi_service.get_reminder_state_response()


@router.post("/reminders/snooze")
def snooze(body: ReminderSnoozeRequest):
    """Reporte un reminder à plus tard."""
    return check_envoi_service.snooze_reminder(body.period_key, body.until_iso)


@router.post("/reminders/dismiss")
def dismiss(body: ReminderDismissRequest):
    """Dismiss définitivement (jusqu'à invalidation manuelle)."""
    return check_envoi_service.dismiss_reminder(body.period_key)


@router.get("/notes/{year}/{month}")
def get_notes(year: int, month: int):
    """Retourne le bloc texte des commentaires pour injection dans le mail."""
    notes = check_envoi_service.get_notes_for_email(year, month)
    return {"notes": notes}


@router.get("/{year}/coverage")
def get_coverage(year: int):
    """Retourne `{'01': bool, ..., '12': bool, 'annual': bool}` pour la sidebar."""
    return check_envoi_service.get_coverage(year)


@router.get("/{year}/{period}", response_model=CheckEnvoiInstance)
def get_check_instance(
    year: int,
    period: str,
    month: Optional[int] = Query(None, ge=1, le=12),
):
    """Récupère l'instance pour la période. month requis si period=month."""
    p = _parse_period(period)
    if p == CheckPeriod.MONTH and month is None:
        raise HTTPException(status_code=400, detail="month requis pour period=month")
    try:
        return check_envoi_service.get_instance(year, p, month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{year}/{period}/items/{item_key}", response_model=CheckEnvoiInstance)
def patch_item(
    year: int,
    period: str,
    item_key: str,
    body: CheckItemPatch,
    month: Optional[int] = Query(None, ge=1, le=12),
):
    """Met à jour un item (commentaire libre ou toggle manuel)."""
    p = _parse_period(period)
    if p == CheckPeriod.MONTH and month is None:
        raise HTTPException(status_code=400, detail="month requis pour period=month")
    return check_envoi_service.update_item(
        year, p, month, item_key,
        comment=body.comment,
        manual_ok=body.manual_ok,
    )


@router.post("/{year}/{period}/validate", response_model=CheckEnvoiInstance)
def validate(
    year: int,
    period: str,
    month: Optional[int] = Query(None, ge=1, le=12),
):
    """Marque validated_at = now() si ready_for_send. Sinon HTTP 400."""
    p = _parse_period(period)
    if p == CheckPeriod.MONTH and month is None:
        raise HTTPException(status_code=400, detail="month requis pour period=month")
    try:
        return check_envoi_service.validate_instance(year, p, month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{year}/{period}/unvalidate", response_model=CheckEnvoiInstance)
def unvalidate(
    year: int,
    period: str,
    month: Optional[int] = Query(None, ge=1, le=12),
):
    """Annule la validation."""
    p = _parse_period(period)
    if p == CheckPeriod.MONTH and month is None:
        raise HTTPException(status_code=400, detail="month requis pour period=month")
    return check_envoi_service.unvalidate_instance(year, p, month)
