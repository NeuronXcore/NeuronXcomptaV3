from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, field_validator


class TypeForfait(str, Enum):
    BLANCHISSAGE = "blanchissage"
    VEHICULE = "vehicule"


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


# ── Véhicule (quote-part professionnelle) ──


class VehiculeRequest(BaseModel):
    year: int
    distance_domicile_clinique_km: float
    jours_travailles: float
    km_supplementaires: float = 0
    km_totaux_compteur: float

    @field_validator("km_totaux_compteur")
    @classmethod
    def km_totaux_positif(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("km_totaux_compteur doit être > 0")
        return v


class VehiculeResult(BaseModel):
    type_forfait: TypeForfait = TypeForfait.VEHICULE
    year: int
    distance_domicile_clinique_km: float
    jours_travailles: float
    km_trajet_habituel: float
    km_supplementaires: float
    km_pro_total: float
    km_totaux_compteur: float
    ratio_pro: float
    ratio_perso: float
    ancien_ratio: Optional[float] = None
    delta_ratio: Optional[float] = None


class ApplyVehiculeRequest(BaseModel):
    year: int
    distance_domicile_clinique_km: float
    jours_travailles: float
    km_supplementaires: float = 0
    km_totaux_compteur: float


class ApplyVehiculeResponse(BaseModel):
    ratio_pro: float
    ancien_ratio: float
    pdf_filename: str
    ged_doc_id: str
    poste_updated: bool
