"""
Modèles Pydantic pour les templates de justificatifs.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class FieldCoordinates(BaseModel):
    x: float       # position X en points PDF (origine bas-gauche)
    y: float       # position Y en points PDF (origine bas-gauche)
    w: float       # largeur de la zone
    h: float       # hauteur de la zone
    page: int = 0  # page (0-indexed)


class TemplateField(BaseModel):
    key: str
    label: str
    type: str  # text, date, currency, number, percent, select
    source: str  # operation, ocr, manual, computed, fixed
    required: bool = False
    default: Optional[float] = None
    formula: Optional[str] = None
    options: Optional[list[str]] = None
    ocr_confidence: Optional[float] = None
    coordinates: Optional[FieldCoordinates] = None  # position dans le PDF source pour fac-simile


class JustificatifTemplate(BaseModel):
    id: str
    vendor: str
    vendor_aliases: list[str]
    category: Optional[str] = None
    sous_categorie: Optional[str] = None
    source_justificatif: Optional[str] = None
    fields: list[TemplateField]
    created_at: str
    created_from: str  # "scan" ou "manual"
    usage_count: int = 0


class TemplateStore(BaseModel):
    version: int = 1
    templates: list[JustificatifTemplate] = []


class ExtractFieldsRequest(BaseModel):
    filename: str


class GenerateRequest(BaseModel):
    template_id: str
    operation_file: str
    operation_index: int
    field_values: dict = {}
    auto_associate: bool = False


class TemplateCreateRequest(BaseModel):
    vendor: str
    vendor_aliases: list[str]
    category: Optional[str] = None
    sous_categorie: Optional[str] = None
    source_justificatif: Optional[str] = None
    fields: list[TemplateField]


class TemplateSuggestion(BaseModel):
    template_id: str
    vendor: str
    match_score: float
    matched_alias: str
    fields_count: int
