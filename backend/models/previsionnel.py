"""
Modeles Pydantic pour le module Previsionnel.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


# Types de cotisation URSSAF — voir urssaf_provisional_service pour la logique :
# - "urssaf_acompte" : 12 prélèvements/an basés sur BNC N-2 (provisionnel)
# - "urssaf_regul"   : régul N-1 versée typiquement en novembre N
# - None             : provider standard à montant_estime fixe
TypeCotisation = Literal["urssaf_acompte", "urssaf_regul"]


# ─── Providers (configuration fournisseurs recurrents) ───

class PrevProvider(BaseModel):
    id: str
    fournisseur: str
    label: str
    mode: str = "facture"  # "facture" ou "echeancier"
    periodicite: str  # mensuel, bimestriel, trimestriel, semestriel, annuel
    mois_attendus: list[int]
    jour_attendu: int
    delai_retard_jours: int
    montant_estime: Optional[float] = None
    categorie: Optional[str] = None
    keywords_ocr: list[str] = []
    keywords_operations: list[str] = []
    tolerance_montant: float = 5.0
    poste_comptable: Optional[str] = None
    actif: bool = True
    type_cotisation: Optional[TypeCotisation] = None


class PrevProviderCreate(BaseModel):
    fournisseur: str
    label: str
    mode: str = "facture"
    periodicite: str
    mois_attendus: list[int]
    jour_attendu: int = 15
    delai_retard_jours: int = 15
    montant_estime: Optional[float] = None
    categorie: Optional[str] = None
    keywords_ocr: list[str] = []
    keywords_operations: list[str] = []
    tolerance_montant: float = 5.0
    poste_comptable: Optional[str] = None
    actif: bool = True
    type_cotisation: Optional[TypeCotisation] = None


class PrevProviderUpdate(BaseModel):
    fournisseur: Optional[str] = None
    label: Optional[str] = None
    mode: Optional[str] = None
    periodicite: Optional[str] = None
    mois_attendus: Optional[list[int]] = None
    jour_attendu: Optional[int] = None
    delai_retard_jours: Optional[int] = None
    montant_estime: Optional[float] = None
    categorie: Optional[str] = None
    keywords_ocr: Optional[list[str]] = None
    keywords_operations: Optional[list[str]] = None
    tolerance_montant: Optional[float] = None
    poste_comptable: Optional[str] = None
    actif: Optional[bool] = None
    type_cotisation: Optional[TypeCotisation] = None


# ─── Prelevements (mode echeancier) ───

class PrelevementLine(BaseModel):
    mois: int
    montant: float
    jour: Optional[int] = None
    ocr_confidence: Optional[float] = None


class OcrExtractionResult(BaseModel):
    success: bool
    nb_lignes_extraites: int
    lignes: list[PrelevementLine]
    raw_text_snippet: str = ""
    warnings: list[str] = []


class PrevPrelevement(BaseModel):
    mois: int
    mois_label: str
    montant_attendu: float
    date_prevue: str
    statut: str  # attendu, verifie, ecart, non_preleve, manuel
    source: str = "manuel"  # ocr ou manuel
    ocr_confidence: Optional[float] = None
    operation_file: Optional[str] = None
    operation_index: Optional[int] = None
    operation_libelle: Optional[str] = None
    operation_date: Optional[str] = None
    montant_reel: Optional[float] = None
    ecart: Optional[float] = None
    match_auto: bool = False


class PrelevementsInput(BaseModel):
    prelevements: list[PrelevementLine]


# ─── Echeances (instances par periode) ───

class PrevEcheance(BaseModel):
    id: str
    provider_id: str
    periode_label: str
    date_attendue: str
    statut: str  # attendu, recu, en_retard, non_applicable
    date_reception: Optional[str] = None
    document_ref: Optional[str] = None
    document_source: Optional[str] = None
    montant_reel: Optional[float] = None
    match_score: Optional[float] = None
    match_auto: bool = False
    note: str = ""
    prelevements: list[PrevPrelevement] = []
    nb_prelevements_verifies: int = 0
    nb_prelevements_total: int = 0
    ocr_extraction: Optional[OcrExtractionResult] = None


class LinkBody(BaseModel):
    document_ref: str
    document_source: str
    montant_reel: Optional[float] = None


# ─── Timeline (vue calendrier) ───

class TimelinePoste(BaseModel):
    id: str
    label: str
    montant: float
    source: str  # provider, moyenne_n1, realise, projete, override
    statut: str  # verifie, attendu, ecart, estime, realise, projete
    provider_id: Optional[str] = None
    document_ref: Optional[str] = None
    confidence: Optional[float] = None
    type_cotisation: Optional[TypeCotisation] = None  # pour rendu badge URSSAF


class TimelineMois(BaseModel):
    mois: int
    label: str
    statut_mois: str  # futur, en_cours, clos
    charges: list[TimelinePoste]
    charges_total: float
    recettes: list[TimelinePoste]
    recettes_total: float
    solde: float
    solde_cumule: float


class TimelineResponse(BaseModel):
    year: int
    mois: list[TimelineMois]
    charges_annuelles: float
    recettes_annuelles: float
    solde_annuel: float
    taux_verification: float


# ─── Parametres ───

class PrevSettings(BaseModel):
    seuil_montant: float = 200.0
    categories_exclues: list[str] = []
    categories_recettes: list[str] = []
    annees_reference: list[int] = []
    overrides_mensuels: dict[str, float] = {}


# ─── Dashboard ───

class PrevDashboard(BaseModel):
    total_echeances: int
    recues: int
    en_attente: int
    en_retard: int
    non_applicable: int
    taux_completion: float
    montant_total_estime: float
    montant_total_reel: float
    prelevements_verifies: int
    prelevements_total: int
    prelevements_en_ecart: int
    taux_prelevements: float
