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
