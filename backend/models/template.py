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
    is_blank_template: bool = False  # True = créé depuis un PDF de fond vierge (pas d'OCR)
    page_width_pt: Optional[float] = None  # dimension page 0 en points PDF (pour click-to-position)
    page_height_pt: Optional[float] = None
    taux_tva: float = 10.0  # taux TVA par défaut (%) — utilisé pour ventiler TTC/HT/TVA au fac-similé


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
    is_blank_template: Optional[bool] = None  # préservé si fourni (création from-blank), ignoré sinon
    taux_tva: Optional[float] = None  # persisté si fourni via PUT /templates/{id}


class TemplateSuggestion(BaseModel):
    template_id: str
    vendor: str
    match_score: float
    matched_alias: str
    fields_count: int


# ──── Batch models ────


class BatchCandidatesRequest(BaseModel):
    template_id: str
    year: int


class BatchCandidate(BaseModel):
    operation_file: str
    operation_index: int
    date: str
    libelle: str
    montant: float
    mois: int
    categorie: str = ""
    sous_categorie: str = ""


class BatchCandidatesResponse(BaseModel):
    template_id: str
    vendor: str
    year: int
    candidates: list[BatchCandidate]
    total: int


class BatchGenerateRequest(BaseModel):
    template_id: str
    operations: list[dict]


class BatchGenerateResult(BaseModel):
    operation_file: str
    operation_index: int
    filename: Optional[str] = None
    associated: bool = False
    error: Optional[str] = None


class BatchGenerateResponse(BaseModel):
    generated: int
    errors: int
    total: int
    results: list[BatchGenerateResult]


class OpsGroup(BaseModel):
    category: str
    sous_categorie: str
    count: int
    total_montant: float
    suggested_template_id: Optional[str] = None
    suggested_template_vendor: Optional[str] = None
    operations: list[BatchCandidate]


class OpsWithoutJustificatifResponse(BaseModel):
    year: int
    total: int
    groups: list[OpsGroup]


# ──── Batch suggest models ────


class BatchSuggestOperation(BaseModel):
    operation_file: str
    operation_index: int


class BatchSuggestRequest(BaseModel):
    operations: list[BatchSuggestOperation]


class BatchSuggestGroup(BaseModel):
    template_id: str
    template_vendor: str
    operations: list[dict]


class BatchSuggestResponse(BaseModel):
    groups: list[BatchSuggestGroup]
    unmatched: list[dict]


# ──── GED ────


class GedTemplateItem(BaseModel):
    id: str
    vendor: str
    vendor_aliases: list[str]
    category: Optional[str] = None
    sous_categorie: Optional[str] = None
    is_blank_template: bool = False
    fields_count: int = 0
    thumbnail_url: Optional[str] = None
    created_at: Optional[str] = None
    usage_count: int = 0
    facsimiles_generated: int = 0


class GedTemplateFacsimile(BaseModel):
    """Un fac-similé généré à partir d'un template (lien dans le drawer de détail)."""
    filename: str
    generated_at: Optional[str] = None
    best_amount: Optional[float] = None
    best_date: Optional[str] = None
    operation_ref: Optional[dict] = None


class GedTemplateDetail(GedTemplateItem):
    facsimiles: list[GedTemplateFacsimile] = []
