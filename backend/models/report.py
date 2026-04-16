from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class ReportFilters(BaseModel):
    categories: Optional[list[str]] = None
    subcategories: Optional[list[str]] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    year: Optional[int] = None
    quarter: Optional[int] = None
    month: Optional[int] = None
    type: Optional[str] = None          # "debit" | "credit" | "all"
    source: Optional[str] = None        # "note_de_frais" | "bancaire" | None (= tous)
    important_only: bool = False
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None


class ReportGenerateRequest(BaseModel):
    format: str = "pdf"                  # "pdf" | "csv" | "excel"
    title: Optional[str] = None          # auto-généré si absent
    description: Optional[str] = None
    filters: ReportFilters = ReportFilters()
    template_id: Optional[str] = None    # si basé sur un template


class ReportUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class ReportMetadata(BaseModel):
    filename: str
    title: str
    description: Optional[str] = None
    format: str                          # "pdf" | "csv" | "excel"
    generated_at: str                    # ISO datetime
    filters: ReportFilters = ReportFilters()
    template_id: Optional[str] = None
    nb_operations: int = 0
    total_debit: float = 0.0
    total_credit: float = 0.0
    file_size: int = 0
    file_size_human: str = ""
    year: Optional[int] = None
    quarter: Optional[int] = None
    month: Optional[int] = None
    favorite: bool = False
    categories_label: Optional[str] = None


class ReportTemplate(BaseModel):
    id: str
    label: str
    description: str
    icon: str                            # nom icône Lucide
    format: str
    filters: ReportFilters


class GalleryResponse(BaseModel):
    reports: list[ReportMetadata]
    available_years: list[int]
    total_count: int


class PendingReport(BaseModel):
    type: str               # "mensuel" | "trimestriel"
    period: str             # "Janvier 2025", "T1 2025"
    message: str
    year: int
    month: Optional[int] = None
    quarter: Optional[int] = None


class ReportComparison(BaseModel):
    report_a: ReportMetadata
    report_b: ReportMetadata
    delta_debit: float
    delta_credit: float
    delta_ops: int
    delta_debit_pct: float
    delta_credit_pct: float


class CompareRequest(BaseModel):
    filename_a: str
    filename_b: str
