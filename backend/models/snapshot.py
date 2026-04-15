"""Modèles pour les snapshots d'opérations (sélections nommées réutilisables)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SnapshotOpRef(BaseModel):
    """Référence à une opération : (fichier, index)."""
    file: str
    index: int


class Snapshot(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    name: str
    description: Optional[str] = None
    color: Optional[str] = None  # hex ou nom de tailwind, optionnel
    ops_refs: list[SnapshotOpRef] = Field(default_factory=list)
    # Contexte au moment de la création (pour info)
    context_year: Optional[int] = None
    context_month: Optional[int] = None
    context_filters: Optional[dict] = None  # snapshot des filtres actifs
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    updated_at: Optional[str] = None


class SnapshotCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    ops_refs: list[SnapshotOpRef]
    context_year: Optional[int] = None
    context_month: Optional[int] = None
    context_filters: Optional[dict] = None


class SnapshotUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    ops_refs: Optional[list[SnapshotOpRef]] = None
