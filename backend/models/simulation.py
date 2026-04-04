from __future__ import annotations

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
