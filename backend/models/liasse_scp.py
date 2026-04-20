from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class LiasseScpCreate(BaseModel):
    """Payload pour upsert d'une liasse fiscale SCP."""
    year: int = Field(..., ge=2000, le=2100)
    ca_declare: float = Field(..., gt=0, description="CA déclaré quote-part (ligne AG du 2035)")
    ged_document_id: Optional[str] = None
    note: Optional[str] = None


class LiasseScp(BaseModel):
    """Liasse fiscale SCP stockée."""
    year: int
    ca_declare: float
    ged_document_id: Optional[str] = None
    note: Optional[str] = None
    saved_at: str


class LiasseComparator(BaseModel):
    """Comparateur CA liasse vs honoraires bancaires crédités."""
    year: int
    ca_liasse: float
    honoraires_bancaires: float
    ecart_absolu: float
    ecart_pct: float
