from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class Immobilisation(BaseModel):
    """Immobilisation au registre.

    Champs principaux : designation, date_acquisition, base_amortissable, duree, mode, poste.
    Reprise d'exercice antérieur (immo acquise avant utilisation de NeuronX) :
    exercice_entree_neuronx, amortissements_anterieurs, vnc_ouverture.
    """

    id: str
    designation: str
    date_acquisition: str
    base_amortissable: float
    duree: int
    mode: str = "lineaire"
    quote_part_pro: float = 100.0
    poste: Optional[str] = None
    statut: str = "en_cours"

    # Champs cession existants
    date_sortie: Optional[str] = None
    prix_cession: Optional[float] = None
    motif_sortie: Optional[str] = None

    # Champs métier véhicule conservés
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None

    # Reprise d'exercice antérieur
    exercice_entree_neuronx: Optional[int] = None
    amortissements_anterieurs: float = 0.0
    vnc_ouverture: Optional[float] = None

    # Tracking
    operation_source: Optional[dict] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None
    date_mise_en_service: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None

    @field_validator("exercice_entree_neuronx")
    @classmethod
    def validate_exercice_entree(cls, v, info):
        if v is None:
            return v
        date_acq = info.data.get("date_acquisition", "")
        if date_acq and len(date_acq) >= 4:
            try:
                year_acq = int(date_acq[:4])
            except ValueError:
                return v
            if v <= year_acq:
                raise ValueError(
                    f"exercice_entree_neuronx ({v}) doit être > année acquisition ({year_acq})"
                )
        return v

    @field_validator("vnc_ouverture")
    @classmethod
    def validate_vnc_ouverture(cls, v, info):
        if info.data.get("exercice_entree_neuronx") is not None and v is None:
            raise ValueError("vnc_ouverture requise quand exercice_entree_neuronx est défini")
        if v is not None and v < 0:
            raise ValueError("vnc_ouverture ne peut pas être négative")
        return v


class ImmobilisationCreate(BaseModel):
    """Payload de création — sans id / created_at / statut."""

    designation: str
    date_acquisition: str
    base_amortissable: float
    duree: int
    mode: str = "lineaire"
    quote_part_pro: float = 100.0
    poste: Optional[str] = None

    # Véhicule
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None

    # Reprise
    exercice_entree_neuronx: Optional[int] = None
    amortissements_anterieurs: float = 0.0
    vnc_ouverture: Optional[float] = None

    # Tracking
    operation_source: Optional[dict] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None
    date_mise_en_service: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("exercice_entree_neuronx")
    @classmethod
    def validate_exercice(cls, v, info):
        if v is None:
            return v
        date_acq = info.data.get("date_acquisition", "")
        if date_acq and len(date_acq) >= 4:
            try:
                year_acq = int(date_acq[:4])
            except ValueError:
                return v
            if v <= year_acq:
                raise ValueError(
                    f"exercice_entree_neuronx ({v}) doit être > année acquisition ({year_acq})"
                )
        return v

    @field_validator("vnc_ouverture")
    @classmethod
    def validate_vnc_ouverture(cls, v, info):
        if info.data.get("exercice_entree_neuronx") is not None and v is None:
            raise ValueError("vnc_ouverture requise quand exercice_entree_neuronx est défini")
        if v is not None and v < 0:
            raise ValueError("vnc_ouverture ne peut pas être négative")
        return v


class ImmobilisationUpdate(BaseModel):
    designation: Optional[str] = None
    duree: Optional[int] = None
    mode: Optional[str] = None
    poste: Optional[str] = None
    quote_part_pro: Optional[float] = None
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None
    date_sortie: Optional[str] = None
    motif_sortie: Optional[str] = None
    prix_cession: Optional[float] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None
    date_mise_en_service: Optional[str] = None
    exercice_entree_neuronx: Optional[int] = None
    amortissements_anterieurs: Optional[float] = None
    vnc_ouverture: Optional[float] = None


class BackfillComputeRequest(BaseModel):
    """Demande de calcul de la suggestion d'amortissements antérieurs / VNC d'ouverture."""

    date_acquisition: str
    base_amortissable: float
    duree: int
    exercice_entree_neuronx: int
    quote_part_pro: float = 100.0


class BackfillComputeResponse(BaseModel):
    amortissements_anterieurs_theorique: float
    vnc_ouverture_theorique: float
    detail_exercices_anterieurs: list[dict]


class LigneAmortissement(BaseModel):
    """Une ligne du tableau d'amortissement.

    Champs principaux conservés pour compatibilité frontend (vnc, jours, base_amortissable, ...).
    Les champs `libelle` et `vnc_debut` complètent la sémantique pour les lignes backfill.
    `is_backfill=True` marque les lignes récap d'exercices antérieurs (dotation_deductible=0).
    """

    exercice: int
    jours: int = 360
    base_amortissable: float = 0.0
    dotation_brute: float = 0.0
    quote_part_pro: float = 100.0
    dotation_deductible: float = 0.0
    amortissements_cumules: float = 0.0
    vnc: float = 0.0  # alias de vnc_fin
    is_backfill: bool = False

    # Champs descriptifs additionnels (optionnels, surtout utiles pour la branche backfill)
    libelle: Optional[str] = None
    vnc_debut: Optional[float] = None


class DotationImmoRow(BaseModel):
    immobilisation_id: str
    designation: str
    date_acquisition: str
    mode: str
    duree: int
    base_amortissable: float
    vnc_debut: float
    dotation_brute: float
    quote_part_pro: float
    dotation_deductible: float
    vnc_fin: float
    statut: str  # en_cours | complement | derniere | cedee
    poste: Optional[str] = None
    is_reprise: bool = False
    exercice_entree_neuronx: Optional[int] = None


class AmortissementVirtualDetail(BaseModel):
    year: int
    total_brute: float
    total_deductible: float
    nb_immos_actives: int
    immos: list[DotationImmoRow]


class AmortissementConfig(BaseModel):
    """Config minimaliste — strict Matériel + linéaire only.

    Suppression de : methode_par_defaut, categories_immobilisables, exercice_cloture.
    `coefficient_degressif` conservé pour lecture des immos legacy.
    """

    seuil: float = 500.0
    sous_categories_exclues: list[str] = Field(default_factory=list)
    durees_par_defaut: dict[str, int] = Field(default_factory=dict)
    coefficient_degressif: dict[int, float] = Field(default_factory=dict)


class CessionResult(BaseModel):
    vnc_sortie: float
    plus_value: Optional[float] = None
    moins_value: Optional[float] = None
    duree_detention_mois: int
    regime: str  # "court_terme" | "long_terme"
