from __future__ import annotations

from typing import Optional, Dict
from pydantic import BaseModel


class Recurrence(BaseModel):
    id: str                         # hash(libelle_normalized)
    libelle_display: str            # Libellé original de la dernière occurrence
    libelle_normalized: str
    periodicite: str                # hebdomadaire | bi_mensuel | mensuel | trimestriel | semestriel | annuel
    montant_moyen: float
    montant_std: float
    derniere_occurrence: str        # ISO date
    nb_occurrences: int
    fiabilite: float                # 0.0 – 1.0
    categorie: Optional[str] = None


class Echeance(BaseModel):
    id: str                         # uuid4
    recurrence_id: str
    date_prevue: str
    date_min: str
    date_max: str
    libelle: str
    montant_prevu: float
    incertitude: float
    periodicite: str
    fiabilite: float
    statut: str = "prevu"           # prevu | realise | annule
    operation_liee: Optional[str] = None  # "filename::index"


class EcheancierStats(BaseModel):
    total: int
    par_periodicite: Dict[str, int]
    montant_mensuel_moyen: float
    nb_alertes_decouvert: int


class ConfirmEcheanceRequest(BaseModel):
    echeance_id: str
    operation_file: str
    operation_index: int


class SoldePrevisionnel(BaseModel):
    date: str
    solde: float
    evenement: str
    montant: float
    alerte: bool
