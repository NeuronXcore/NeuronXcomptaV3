"""Schemas Pydantic pour le module Check d'envoi.

Une instance de check existe par période (mois ou année) et matérialise un rituel
de pré-vol récurrent : items audités automatiquement via les services existants
+ commentaires libres injectés ensuite dans le mail au comptable.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class CheckSource(str, Enum):
    AUTO = "auto"      # statut dérivé d'un endpoint/service existant
    MANUAL = "manual"  # case à cocher utilisateur


class CheckStatus(str, Enum):
    AUTO_OK = "auto_ok"
    AUTO_WARNING = "auto_warning"
    MANUAL_OK = "manual_ok"
    BLOCKING = "blocking"
    PENDING = "pending"  # auto non encore évalué OU manual non coché


class CheckPeriod(str, Enum):
    MONTH = "month"
    YEAR = "year"


class CheckEnvoiItem(BaseModel):
    """Un sous-item dans une section (ex. 'Relevé Boursorama importé')."""
    key: str
    label: str
    source: CheckSource
    status: CheckStatus = CheckStatus.PENDING
    detail: Optional[str] = None
    comment: Optional[str] = None
    requires_comment: bool = False
    last_evaluated_at: Optional[datetime] = None


class CheckEnvoiSection(BaseModel):
    """Une section (8 par vue mensuelle, 8 par vue annuelle)."""
    key: str
    label: str
    items: list[CheckEnvoiItem]


class CheckEnvoiInstance(BaseModel):
    """Une instance de check pour un mois ou l'année entière."""
    period: CheckPeriod
    year: int
    month: Optional[int] = None
    sections: list[CheckEnvoiSection]
    validated_at: Optional[datetime] = None
    validated_by: str = "user"
    ready_for_send: bool = False
    counts: dict[str, int] = Field(default_factory=dict)


class ReminderState(BaseModel):
    """Persisté dans `data/check_envoi/reminders.json` pour gérer snooze/dismiss."""
    period_key: str  # "2026-01" ou "2026-annual"
    level: Literal[1, 2, 3]
    last_shown_at: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    dismissed_for_period: bool = False


class CheckItemPatch(BaseModel):
    """Body PATCH /items/{item_key}."""
    comment: Optional[str] = None
    manual_ok: Optional[bool] = None


class ReminderSnoozeRequest(BaseModel):
    period_key: str
    until_iso: str


class ReminderDismissRequest(BaseModel):
    period_key: str


class CheckReminderStateResponse(BaseModel):
    """Retour de GET /reminders/state."""
    should_show: bool
    level: Optional[Literal[1, 2, 3]] = None
    period_key: Optional[str] = None
    message: Optional[str] = None
