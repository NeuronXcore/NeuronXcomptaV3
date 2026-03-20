"""Schemas Pydantic pour les opérations."""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class Operation(BaseModel):
    Date: str
    Libelle: str = Field(alias="Libellé")
    Debit: float = Field(0.0, alias="Débit")
    Credit: float = Field(0.0, alias="Crédit")
    Categorie: Optional[str] = Field(None, alias="Catégorie")
    Sous_categorie: Optional[str] = Field(None, alias="Sous-catégorie")
    Justificatif: bool = False
    Lien_justificatif: Optional[str] = Field(None, alias="Lien justificatif")
    Important: bool = False
    A_revoir: bool = False
    lettre: bool = False
    Commentaire: Optional[str] = None
    rapprochement_score: Optional[float] = None
    rapprochement_mode: Optional[str] = None
    rapprochement_date: Optional[str] = None

    model_config = {"populate_by_name": True}


class OperationFile(BaseModel):
    filename: str
    month: Optional[str] = None
    year: Optional[int] = None
    count: int = 0
    total_debit: float = 0.0
    total_credit: float = 0.0


class ImportResponse(BaseModel):
    filename: str
    operations_count: int
    pdf_hash: str
    message: str


class CategorizeRequest(BaseModel):
    mode: str = "empty_only"  # "empty_only" ou "all"
