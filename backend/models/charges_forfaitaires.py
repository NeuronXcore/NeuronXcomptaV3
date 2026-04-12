from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class TypeForfait(str, Enum):
    BLANCHISSAGE = "blanchissage"
    VEHICULE = "vehicule"  # prévu, pas implémenté


class ModeBlanchissage(str, Enum):
    DOMICILE = "domicile"
    PRESSING = "pressing"


class ArticleBlanchissage(BaseModel):
    type: str
    tarif_pressing: float
    quantite_jour: int


class BaremeBlanchissage(BaseModel):
    annee: int
    reference_legale: str
    mode_defaut: str
    decote_domicile: float
    articles: list[ArticleBlanchissage]


class BlanchissageRequest(BaseModel):
    year: int
    jours_travailles: float
    mode: ModeBlanchissage = ModeBlanchissage.DOMICILE
    honoraires_liasse: Optional[float] = None  # total honoraires liasse fiscale SCP


class ArticleDetail(BaseModel):
    type: str
    tarif_pressing: float
    montant_unitaire: float  # après décote éventuelle
    quantite_jour: int
    jours: float
    sous_total: float


class ForfaitResult(BaseModel):
    type_forfait: TypeForfait
    year: int
    montant_total: float
    montant_deductible: float
    detail: list[ArticleDetail]
    reference_legale: str
    mode: str
    decote: float  # 0.30 ou 0.0
    jours_travailles: float
    cout_jour: float
    honoraires_liasse: Optional[float] = None


class GenerateODRequest(BaseModel):
    type_forfait: TypeForfait
    year: int
    jours_travailles: float
    mode: ModeBlanchissage = ModeBlanchissage.DOMICILE
    honoraires_liasse: Optional[float] = None
    date_ecriture: str = ""  # défaut : 31/12/{year}


class GenerateODResponse(BaseModel):
    od_filename: str
    od_index: int
    pdf_filename: str
    ged_doc_id: str
    montant: float
