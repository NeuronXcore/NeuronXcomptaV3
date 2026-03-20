"""Modèles Pydantic pour les justificatifs."""
from __future__ import annotations

from typing import Optional, List

from pydantic import BaseModel


class JustificatifInfo(BaseModel):
    filename: str
    original_name: str
    date: str
    size: int
    size_human: str
    status: str  # "en_attente" ou "traites"
    linked_operation: Optional[str] = None


class JustificatifStats(BaseModel):
    en_attente: int
    traites: int
    total: int


class JustificatifUploadResult(BaseModel):
    filename: str
    original_name: str
    size: int
    success: bool
    error: Optional[str] = None


class AssociateRequest(BaseModel):
    justificatif_filename: str
    operation_file: str
    operation_index: int


class DissociateRequest(BaseModel):
    operation_file: str
    operation_index: int


class OperationSuggestion(BaseModel):
    operation_file: str
    operation_index: int
    date: str
    libelle: str
    debit: float
    credit: float
    categorie: Optional[str] = None
    score: float
    score_detail: str
