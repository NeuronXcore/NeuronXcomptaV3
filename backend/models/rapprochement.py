"""Schemas Pydantic pour le rapprochement opérations / justificatifs."""
from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class ScoreDetail(BaseModel):
    montant: float
    date: float
    fournisseur: float


class MatchScore(BaseModel):
    total: float
    detail: ScoreDetail
    confidence_level: str  # "fort" | "probable" | "possible" | "faible"


class RapprochementSuggestion(BaseModel):
    justificatif_filename: str
    operation_file: str
    operation_index: int
    operation_libelle: str
    operation_date: str
    operation_montant: float
    score: MatchScore


class AutoRapprochementReport(BaseModel):
    total_justificatifs_traites: int
    associations_auto: int
    suggestions_fortes: int
    sans_correspondance: int
    ran_at: str


class UnmatchedSummary(BaseModel):
    operations_sans_justificatif: int
    justificatifs_en_attente: int
