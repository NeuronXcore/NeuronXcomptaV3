"""Schemas Pydantic pour le module Rappels Dashboard."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


RappelLevel = Literal["critical", "warning", "info"]
RappelCategory = Literal["fiscal", "comptable", "scp", "patrimoine", "tresorerie"]


class RappelCTA(BaseModel):
    label: str
    route: str  # ex: "/justificatifs?filter=sans_justif"


class Rappel(BaseModel):
    id: str                       # stable, sert de clé snooze
    niveau: RappelLevel
    categorie: RappelCategory
    titre: str
    message: str
    cta: Optional[RappelCTA] = None
    snoozable: bool = True
    date_detection: str           # ISO date


class RappelsSummary(BaseModel):
    rappels: list[Rappel]
    counts: dict[RappelLevel, int]  # {"critical": 2, "warning": 3, "info": 0}
    total: int


class SnoozeRequest(BaseModel):
    days: int = 7  # 1, 7, 30


class RuleInfo(BaseModel):
    """Description d'une règle pour l'UI Settings (toggle on/off)."""
    rule_id: str
    label: str
    description: str
    enabled: bool
