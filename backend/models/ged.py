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
