from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class AlerteType(str, Enum):
    JUSTIFICATIF_MANQUANT = "justificatif_manquant"
    A_CATEGORISER = "a_categoriser"
    MONTANT_A_VERIFIER = "montant_a_verifier"
    DOUBLON_SUSPECT = "doublon_suspect"
    CONFIANCE_FAIBLE = "confiance_faible"


class ResolveAlerteBody(BaseModel):
    alerte_type: AlerteType
    note: Optional[str] = None


class AlerteExportRequest(BaseModel):
    year: int
    month: Optional[int] = None  # None = année entière
    format: str  # "csv" | "pdf"


class AlerteExportResponse(BaseModel):
    filename: str
    nb_operations: int
    total_debit: float
    total_credit: float
