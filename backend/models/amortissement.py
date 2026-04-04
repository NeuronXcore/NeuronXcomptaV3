from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional


class OperationSource(BaseModel):
    file: str
    index: int


class Immobilisation(BaseModel):
    id: str                                  # "immo_YYYYMMDD_XXXX"
    libelle: str
    date_acquisition: str                    # YYYY-MM-DD
    valeur_origine: float
    duree_amortissement: int                 # années
    methode: str = "lineaire"                # "lineaire" | "degressif"
    poste_comptable: str                     # id du poste GED
    date_mise_en_service: Optional[str] = None
    date_sortie: Optional[str] = None
    motif_sortie: Optional[str] = None       # "cession" | "rebut" | "vol"
    prix_cession: Optional[float] = None
    quote_part_pro: int = 100                # % usage professionnel
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None

    operation_source: Optional[OperationSource] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None

    created_at: str = ""
    statut: str = "en_cours"                 # "en_cours" | "amorti" | "sorti"
    notes: Optional[str] = None


class ImmobilisationCreate(BaseModel):
    libelle: str
    date_acquisition: str
    valeur_origine: float
    duree_amortissement: int
    methode: str = "lineaire"
    poste_comptable: str
    date_mise_en_service: Optional[str] = None
    quote_part_pro: int = 100
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None
    operation_source: Optional[OperationSource] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None
    notes: Optional[str] = None


class ImmobilisationUpdate(BaseModel):
    libelle: Optional[str] = None
    duree_amortissement: Optional[int] = None
    methode: Optional[str] = None
    poste_comptable: Optional[str] = None
    date_mise_en_service: Optional[str] = None
    quote_part_pro: Optional[int] = None
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None
    date_sortie: Optional[str] = None
    motif_sortie: Optional[str] = None
    prix_cession: Optional[float] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None


class LigneAmortissement(BaseModel):
    exercice: int
    jours: int
    base_amortissable: float
    dotation_brute: float
    quote_part_pro: int
    dotation_deductible: float
    amortissements_cumules: float
    vnc: float


class AmortissementConfig(BaseModel):
    seuil_immobilisation: int = 500
    durees_par_defaut: dict = Field(default_factory=dict)
    methode_par_defaut: str = "lineaire"
    categories_immobilisables: list[str] = Field(default_factory=list)
    sous_categories_exclues: list[str] = Field(default_factory=list)
    exercice_cloture: str = "12-31"


class CessionResult(BaseModel):
    vnc_sortie: float
    plus_value: Optional[float] = None
    moins_value: Optional[float] = None
    duree_detention_mois: int
    regime: str   # "court_terme" | "long_terme"
