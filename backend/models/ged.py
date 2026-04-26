from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class PosteComptable(BaseModel):
    id: str
    label: str
    deductible_pct: int  # 0-100, pas de 5
    categories_associees: list[str]  # catégories ML liées
    notes: str = ""
    is_system: bool = True  # False pour les postes custom


class PostesConfig(BaseModel):
    version: int = 1
    exercice: int
    postes: list[PosteComptable]


class PeriodInfo(BaseModel):
    year: int
    month: Optional[int] = None
    quarter: Optional[int] = None


class RapportMeta(BaseModel):
    template_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    filters: Optional[dict] = None
    format: Optional[str] = None  # pdf, csv, xlsx
    favorite: bool = False
    generated_at: Optional[str] = None
    can_regenerate: bool = True
    can_compare: bool = True


class GedDocument(BaseModel):
    doc_id: str  # chemin relatif = clé unique
    type: str  # "releve", "justificatif", "rapport", "document_libre"
    year: Optional[int] = None
    month: Optional[int] = None
    poste_comptable: Optional[str] = None  # id du poste
    categorie: Optional[str] = None  # catégorie comptable
    sous_categorie: Optional[str] = None  # sous-catégorie comptable
    montant_brut: Optional[float] = None
    deductible_pct_override: Optional[int] = None  # surcharge du % poste, null = hérite
    tags: list[str] = []
    notes: str = ""
    added_at: str = ""
    original_name: Optional[str] = None
    ocr_file: Optional[str] = None
    # Champs enrichis GED V2
    fournisseur: Optional[str] = None
    date_document: Optional[str] = None
    date_operation: Optional[str] = None
    period: Optional[PeriodInfo] = None
    montant: Optional[float] = None
    ventilation_index: Optional[int] = None
    is_reconstitue: bool = False
    operation_ref: Optional[dict] = None  # {"file": "...", "index": 5, "ventilation_index": null}
    # Rapport metadata
    rapport_meta: Optional[RapportMeta] = None


class GedMetadata(BaseModel):
    version: int = 1
    documents: dict[str, GedDocument] = {}


class GedTreeNode(BaseModel):
    id: str
    label: str
    count: int = 0
    children: list[GedTreeNode] = []
    icon: Optional[str] = None  # nom icône Lucide


class GedUploadRequest(BaseModel):
    type: str = "document_libre"
    year: Optional[int] = None
    month: Optional[int] = None
    poste_comptable: Optional[str] = None
    categorie: Optional[str] = None
    sous_categorie: Optional[str] = None
    tags: list[str] = []
    notes: str = ""


class GedDocumentUpdate(BaseModel):
    type: Optional[str] = None
    poste_comptable: Optional[str] = None
    categorie: Optional[str] = None
    sous_categorie: Optional[str] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None
    montant_brut: Optional[float] = None
    deductible_pct_override: Optional[int] = None


class GedSearchResult(BaseModel):
    doc_id: str
    document: GedDocument
    match_context: str = ""  # extrait OCR ou nom fichier
    score: float = 0.0
