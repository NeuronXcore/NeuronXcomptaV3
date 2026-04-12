from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SimulationLeviers(BaseModel):
    madelin: float = 0
    per: float = 0
    carmf_classe: str = "M"
    investissement: float = 0
    investissement_duree: int = 5
    investissement_prorata_mois: int = 6
    formation_dpc: float = 0
    remplacement: float = 0
    depense_pro: float = 0
    depenses_detail: Optional[dict] = None


class SimulationRequest(BaseModel):
    bnc_actuel: float
    year: int
    parts: float = 1.0
    leviers: SimulationLeviers


class UrssafDeductibleRequest(BaseModel):
    montant_brut: float
    bnc_estime: float
    year: int = 2024
    cotisations_sociales_estime: Optional[float] = None


class UrssafDeductibleResult(BaseModel):
    year: int
    montant_brut: float
    assiette_csg_crds: float
    assiette_mode: str
    taux_non_deductible: float
    part_non_deductible: float
    part_deductible: float
    ratio_non_deductible: float
    bnc_estime_utilise: float
    cotisations_sociales_utilisees: Optional[float]
