"""Modèles Pydantic pour l'OCR."""
from __future__ import annotations

from typing import Optional, List

from pydantic import BaseModel


class OCRExtractedData(BaseModel):
    dates: List[str] = []
    amounts: List[float] = []
    supplier: Optional[str] = None
    best_date: Optional[str] = None
    best_amount: Optional[float] = None


class OCRResult(BaseModel):
    filename: str
    processed_at: str
    status: str  # "success", "error", "no_text"
    processing_time_ms: int
    raw_text: str
    extracted_data: OCRExtractedData
    page_count: int
    confidence: float


class OCRExtractRequest(BaseModel):
    filename: str


class OCRStatus(BaseModel):
    reader_loaded: bool
    easyocr_available: bool
    poppler_available: bool
    total_extractions: int


class OCRSummary(BaseModel):
    best_date: Optional[str] = None
    best_amount: Optional[float] = None
    supplier: Optional[str] = None
    processed: bool = False


class OcrManualEdit(BaseModel):
    best_amount: Optional[float] = None
    best_date: Optional[str] = None
    supplier: Optional[str] = None
    # Hints catégorie / sous-catégorie : stockés au top-level du .ocr.json
    # (pas dans extracted_data, pour ne pas polluer les arrays OCR).
    # Utilisés pour pré-remplir les éditeurs + potentiellement améliorer
    # le rapprochement automatique en filtrant par catégorie d'opération.
    category_hint: Optional[str] = None
    sous_categorie_hint: Optional[str] = None
