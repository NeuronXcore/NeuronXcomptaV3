"""
Modèles Pydantic pour le Livret comptable vivant.

Phase 1 — Fondations + 3 chapitres pilotes (Synthèse, Recettes, Charges pro).
Phase 2 — 6 chapitres complémentaires (04→09).
Phase 3 — Snapshots (HTML autonome + PDF paginé) + manifest + GED.
Phase 4 — Comparaison N-1 (YTD comparable + Année pleine) + deltas par métrique.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, SerializeAsAny


# ─── Graphiques (Phase 5 — charts MVP) ────────────────────────────

ChartType = Literal["bar", "donut", "waterfall", "stacked", "cadence"]


class ChartPoint(BaseModel):
    """Un point de donnée d'une série de graphique."""
    x: Union[str, int]                   # label de catégorie OU index
    y: float
    color: Optional[str] = None          # override couleur du point (waterfall, cellule colorée)
    meta: Optional[dict] = None          # ex: {"category_name": "Véhicule"} pour drill-down React


class ChartSeries(BaseModel):
    """Une série de graphique (sous-ensemble cohérent de points)."""
    name: str
    color: str                           # hex string, consommé tel quel par les 3 renderers
    data: list[ChartPoint]
    stack_id: Optional[str] = None       # pour stacked bar


class ChartConfig(BaseModel):
    """Configuration d'un graphique du livret. Sérialisé identiquement pour les 3 vues
    (React Recharts, HTML SVG inline, PDF matplotlib).

    Le calcul (agrégation, top-N, normalisation) est fait UNE seule fois côté backend
    dans `livret_charts_service`. Les renderers consomment le ChartConfig sans recalcul.
    """
    id: str                              # ex: "donut_charges_categories"
    type: ChartType
    title: str
    subtitle: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    series: list[ChartSeries]
    total: Optional[float] = None        # waterfall : valeur cumulée finale (BNC)
    annotations: Optional[list[dict]] = None
    drill_target: Optional[str] = None   # ex: "category_detail" — déclenche action UI côté React


# ─── Comparaison N-1 (Phase 4) ────────────────────────────────────

CompareMode = Literal["ytd_comparable", "annee_pleine"]


class LivretDelta(BaseModel):
    """Delta N vs N-1 — montant absolu + pourcentage + direction + favorabilité."""
    value_n1: float
    value_diff: float                    # value_n − value_n1
    value_diff_pct: Optional[float]      # None si value_n1 == 0 (évite ÷0 / +∞%)
    direction: Literal["up", "down", "stable"]
    is_favorable: bool                   # vert si True, rouge si False (selon contexte)


# ─── Métadonnées ───────────────────────────────────────────────────

class LivretMetadata(BaseModel):
    year: int
    generated_at: str  # ISO datetime
    as_of_date: str  # date à laquelle "YTD" s'arrête
    months_elapsed: int  # 0..12
    months_remaining: int
    is_live: bool
    snapshot_id: Optional[str] = None  # rempli en Phase 3
    data_sources: dict[str, bool] = Field(default_factory=dict)
    # Phase 4 — comparaison N-1 (None si non demandée)
    compare_mode: Optional[CompareMode] = None
    as_of_date_n1: Optional[str] = None
    has_n1_data: bool = False
    is_year_partial: bool = False  # True si compare_mode=annee_pleine sur exercice en cours


# ─── Synthèse (chapitre 01) ─────────────────────────────────────────

class LivretMetric(BaseModel):
    label: str
    value: float
    unit: Literal["EUR", "PCT", "COUNT"] = "EUR"
    is_projection: bool = False
    delta_n1: Optional[LivretDelta] = None  # Phase 4 — annoté si compare_n1 actif


class LivretMonthPoint(BaseModel):
    month: int  # 1..12
    label: str  # "jan", "fév", ...
    recettes: float
    charges: float
    is_past: bool
    is_current: bool
    is_projection: bool
    # Phase 4 — valeurs N-1 même mois (None si compare_n1 non actif)
    recettes_n1: Optional[float] = None
    charges_n1: Optional[float] = None


class LivretSyntheseChapter(BaseModel):
    metrics: list[LivretMetric]
    cadence_mensuelle: list[LivretMonthPoint]


# ─── Chapitres détaillés (Recettes, Charges pro) ───────────────────

class LivretFlag(BaseModel):
    a_revoir: bool = False
    important: bool = False
    justificatif_manquant: bool = False
    locked: bool = False
    lettre: bool = False
    is_mixte: bool = False  # taux pro < 100%


class LivretOperation(BaseModel):
    """Une ligne unitaire affichée dans une sous-catégorie.

    En mode éclaté, peut représenter une sous-ligne de ventilation
    (operation_index + ventilation_index). En mode groupé, représente
    l'opération mère et inclut ses sous-lignes en arborescence (sub_lines).
    """
    operation_file: str
    operation_index: int
    ventilation_index: Optional[int] = None
    date: str  # ISO date YYYY-MM-DD
    libelle: str
    libelle_meta: Optional[str] = None  # ex: "mixte 70%", "Forfait barème"
    montant: float  # déjà ajusté en mode éclaté ; brut en mode groupé
    montant_brut: Optional[float] = None  # mixte : montant total avant taux pro
    taux_pro: Optional[float] = None  # 0..100
    flags: LivretFlag = Field(default_factory=LivretFlag)
    sub_lines: Optional[list["LivretOperation"]] = None  # mode groupé arborescence


class LivretSubcategory(BaseModel):
    name: str
    total_ytd: float
    total_projected_annual: Optional[float] = None
    nb_operations: int
    nb_a_revoir: int
    nb_justif_manquant: int
    nb_mixte: int
    operations: list[LivretOperation]
    # Phase 4 — delta sur total_ytd (None si compare_n1 non actif)
    delta_n1: Optional[LivretDelta] = None
    # True si la sous-cat existe en N-1 mais plus en N (ligne fantôme avec total=0)
    is_orphan_from_n1: bool = False


class LivretChapter(BaseModel):
    number: str  # "01", "02", "03"
    title: str
    tag: Optional[str] = None  # ex: "Ventilation éclatée", "YTD au 30 avril"
    ventilation_mode: Literal["eclate", "groupe", "none"]
    total_ytd: float
    total_projected_annual: Optional[float] = None
    subcategories: list[LivretSubcategory] = Field(default_factory=list)
    # Phase 4 — delta sur total_ytd (None si compare_n1 non actif). Pas de delta sur le 09 Annexes.
    delta_n1: Optional[LivretDelta] = None
    # Phase 5 — graphiques attachés au chapitre (donut, waterfall, cadence...)
    charts: list[ChartConfig] = Field(default_factory=list)


class LivretSynthese(LivretChapter):
    """Le chapitre 01 a une structure spéciale (metrics + cadence) en plus des subcategories vides."""
    synthese: LivretSyntheseChapter


# ─── Chapitres Phase 2 — variantes spécialisées ───────────────────

class LivretBncFormulaLine(BaseModel):
    """Une ligne de la formule BNC (chapitre 08) : label + montant + opérateur."""
    label: str
    amount: float
    operator: Literal["plus", "minus", "equals"]
    note: Optional[str] = None


class LivretBncProjection(BaseModel):
    """Projection fiscale annuelle (chapitre 08)."""
    bnc_projete_annuel: float
    ir_estime: float
    urssaf_estime: float
    carmf_estime: float
    odm_estime: float
    total_charges_sociales_estime: float
    revenu_net_apres_charges: float


class LivretBncChapter(LivretChapter):
    """Chapitre 08 — synthèse fiscale du BNC."""
    formula: list[LivretBncFormulaLine]
    formula_comment: str
    projection: LivretBncProjection
    sources: dict[str, str]  # {"recettes": "liasse" | "bancaire", ...}


class LivretAmortissementImmo(BaseModel):
    """Une ligne du registre des immobilisations (chapitre 06)."""
    nom: str
    poste: str
    valeur_origine: float
    date_acquisition: str
    duree_amortissement: int
    dotation_annuelle: float
    cumul_amortissement: float
    vnc: float
    is_backfill: bool = False


class LivretAmortissementsChapter(LivretChapter):
    """Chapitre 06 — Amortissements."""
    immobilisations: list[LivretAmortissementImmo]
    total_dotations_annuelles: float


class LivretAnnexeBareme(BaseModel):
    """Un barème fiscal annuel listé dans le chapitre 09."""
    nom: str  # ex: "URSSAF 2026"
    file: str
    last_updated: Optional[str] = None
    summary: dict


class LivretAnnexeJustifEntry(BaseModel):
    """Une entrée d'index justificatif → opération(s) (chapitre 09)."""
    filename: str
    montant: Optional[float] = None
    date: Optional[str] = None
    fournisseur: Optional[str] = None
    operation_file: Optional[str] = None
    operation_index: Optional[int] = None
    libelle_op: Optional[str] = None
    is_facsimile: bool = False


class LivretAnnexeChapter(LivretChapter):
    """Chapitre 09 — Annexes (justifs index + barèmes + glossaire + méthodologie)."""
    justificatifs_index: list[LivretAnnexeJustifEntry]
    baremes_appliques: list[LivretAnnexeBareme]
    glossaire: list[dict[str, str]]  # [{"term": "BNC", "definition": "..."}]
    methodologie: str  # markdown bref


class LivretProvisionGauge(BaseModel):
    """Jauge cumul vs cible pour une provision (chapitre 07)."""
    name: str  # "Provision IR", "Provision Charges sociales", "Coussin"
    cumul_ytd: float
    cible_estimee: float  # cible annuelle (depuis projection fiscale)
    ratio: float  # cumul / cible (clamped 0..1.5)


class LivretProvisionsChapter(LivretChapter):
    """Chapitre 07 — Provisions & coussin."""
    gauges: list[LivretProvisionGauge]


class LivretForfaitDecomposition(BaseModel):
    """Décomposition d'un forfait pour expansion UI (chapitre 04)."""
    type_forfait: Literal["blanchissage", "repas", "vehicule"]
    montant: float
    date_ecriture: Optional[str] = None
    pdf_filename: Optional[str] = None
    ged_doc_id: Optional[str] = None
    # Champs spécifiques selon le type
    jours: Optional[int] = None
    articles: Optional[list[dict]] = None  # blanchissage : [{type, tarif, qte_jour}]
    forfait_jour: Optional[float] = None  # repas
    seuil_repas_maison: Optional[float] = None
    plafond_repas_restaurant: Optional[float] = None
    ratio_pro_pct: Optional[float] = None  # vehicule
    distance_km: Optional[float] = None
    km_supplementaires: Optional[float] = None
    km_totaux_compteur: Optional[float] = None
    reference_legale: Optional[str] = None


class LivretForfaitairesChapter(LivretChapter):
    """Chapitre 04 — Charges forfaitaires.
    Conserve les sous-cat (Blanchissage / Repas / Véhicule) + un index dédié de
    décompositions pour expansion UI riche."""
    decompositions: list[LivretForfaitDecomposition]


# ─── Réponse principale ────────────────────────────────────────────

class TocEntry(BaseModel):
    number: str
    title: str


# ─── Phase 3 — Snapshots ──────────────────────────────────────────

class SnapshotType(str, Enum):
    """Type de snapshot d'un livret figé."""
    AUTO_MONTHLY = "auto_monthly"
    CLOTURE = "cloture"
    MANUAL = "manual"


SnapshotTrigger = Literal["scheduler", "cloture_hook", "manual_user"]


class LivretSnapshotMetadata(BaseModel):
    """Métadonnées d'un snapshot enregistré dans `manifest.json`."""
    id: str  # ex: "2026_2026-04-01_auto_monthly"
    year: int
    snapshot_date: str  # ISO date de figeage
    type: SnapshotType
    trigger: SnapshotTrigger
    as_of_date: str  # date d'arrêt YTD au moment du figeage
    html_filename: str
    pdf_filename: str
    html_size: int  # octets
    pdf_size: int
    comment: Optional[str] = None
    data_sources: dict[str, bool] = Field(default_factory=dict)
    ytd_metrics: dict[str, float] = Field(default_factory=dict)
    created_at: str  # ISO datetime de création
    ged_document_ids: dict[str, Optional[str]] = Field(
        default_factory=lambda: {"html": None, "pdf": None},
    )
    large: bool = False  # True si HTML > 5 MB (warning, accepté quand même)
    # Phase 4 — mode comparaison embarqué dans le snapshot (None si pas inclus)
    comparison_mode: Optional[CompareMode] = None


class CreateSnapshotRequest(BaseModel):
    """Body pour POST /api/livret/snapshots/{year}."""
    snapshot_type: SnapshotType = SnapshotType.MANUAL
    as_of_date: Optional[str] = None  # défaut côté service = hier
    comment: Optional[str] = None
    # Phase 4 — embarquer la comparaison N-1 dans le HTML/PDF généré
    include_comparison: Optional[CompareMode] = None


class SnapshotsListResponse(BaseModel):
    """Réponse paginée pour GET /api/livret/snapshots."""
    snapshots: list[LivretSnapshotMetadata]


class Livret(BaseModel):
    """Livret comptable complet.

    `chapters` est typé via `SerializeAsAny[LivretChapter]` pour que Pydantic v2
    sérialise chaque chapitre avec sa **vraie classe runtime** (et non le parent
    LivretChapter de la déclaration). Sans ça, les champs spécifiques aux sous-classes
    (`formula` du LivretBncChapter, `decompositions` du LivretForfaitairesChapter,
    `immobilisations` du LivretAmortissementsChapter, etc.) seraient silencieusement
    droppés à la sérialisation JSON.
    """
    metadata: LivretMetadata
    chapters: dict[str, SerializeAsAny[LivretChapter]]
    toc: list[TocEntry]


# ─── ProjectionService ─────────────────────────────────────────────

class ProjectionResult(BaseModel):
    year: int
    as_of_date: str
    monthly_recettes: dict[int, float]  # {1: 45000.0, ...}
    monthly_charges: dict[int, float]
    annual_recettes_projected: float
    annual_charges_projected: float
    bnc_projected_annual: float
    source: Literal["previsionnel", "fallback_ytd_extrapolation", "empty"]
    confidence: Literal["high", "medium", "low"]


# Forward refs
LivretOperation.model_rebuild()
