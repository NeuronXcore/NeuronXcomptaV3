from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class MoisOverview(BaseModel):
    mois: int
    label: str
    has_releve: bool
    nb_operations: int
    taux_lettrage: float
    taux_justificatifs: float
    taux_categorisation: float
    taux_rapprochement: float
    has_export: bool
    total_credit: float
    total_debit: float
    # BNC mensuel — exclut perso (règle fiscale unique)
    bnc_recettes_pro: Optional[float] = 0
    bnc_charges_pro: Optional[float] = 0
    bnc_solde: Optional[float] = 0
    filename: Optional[str] = None


class KPIs(BaseModel):
    total_recettes: float
    total_charges: float
    bnc_estime: float
    nb_operations: int
    nb_mois_actifs: int
    bnc_mensuel: list[float]
    # Source du CA retenu pour `total_recettes` : "liasse" (définitif) ou "bancaire" (provisoire)
    base_recettes: Optional[str] = "bancaire"
    # CA liasse SCP si saisi pour l'exercice, sinon None
    ca_liasse: Optional[float] = None
    # Recettes pro calculées depuis les crédits bancaires — toujours exposé pour comparaison
    recettes_pro_bancaires: Optional[float] = 0


class DeltaN1(BaseModel):
    prev_total_recettes: float
    prev_total_charges: float
    prev_bnc: float
    delta_recettes_pct: float
    delta_charges_pct: float
    delta_bnc_pct: float


class AlerteDashboard(BaseModel):
    type: str
    mois: int
    year: int
    impact: int
    message: str
    detail: str
    count: int


class ProgressionExercice(BaseModel):
    globale: float
    criteres: dict[str, float]


class ActiviteRecente(BaseModel):
    type: str
    message: str
    timestamp: str
    detail: str


class YearOverviewResponse(BaseModel):
    year: int
    mois: list[MoisOverview]
    kpis: KPIs
    delta_n1: Optional[DeltaN1] = None
    alertes: list[AlerteDashboard]
    progression: ProgressionExercice
    activite_recente: list[ActiviteRecente]
