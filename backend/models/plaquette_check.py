"""Modèles Pydantic pour le module Vérification Plaquette Comptable.

Stockage : data/plaquette_check/{year}.json
"""
from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ─── Statuts métier ───
PlaquetteItemStatut = Literal[
    "non_revu",
    "ok",
    "a_challenger",
    "refus_justifie",
    "en_discussion",
    "resolu",
]

ParseStatut = Literal["pending", "parsed", "partial", "manual"]
JournalType = Literal["email_out", "email_in", "note"]


class PlaquetteCheckStatus(str, Enum):
    """Cycle de vie de la vérification plaquette pour un exercice.

    en_cours          : édition libre (items modifiables, journal appendable)
    validation_finale : items verrouillés (read-only), journal appendable, statut réversible
    declare           : exercice figé jusqu'à prescription fiscale (art. L169 LPF, 4 ans)
                        Journal appendable (questions fisc post-déclaration). Statut IRRÉVERSIBLE.
    """

    EN_COURS = "en_cours"
    VALIDATION_FINALE = "validation_finale"
    DECLARE = "declare"


class RisqueNiveau(str, Enum):
    """Niveau de risque fiscal d'un item de la plaquette (Session 39 P2).

    faible   : déduction documentée, pas de catégorie sensible.
    modere   : 1-2 drivers de risque (catégorie sensible OU forfait OU taux justif bas).
    eleve    : 3 drivers OU montant élevé sur catégorie sensible.
    critique : ≥ 4 drivers cumulés.
    """

    FAIBLE = "faible"
    MODERE = "modere"
    ELEVE = "eleve"
    CRITIQUE = "critique"


class OperationRef(BaseModel):
    """Référence légère vers une opération NeuronX pour le drill-down."""
    file: str
    index: int
    date: Optional[str] = None
    libelle: Optional[str] = None
    debit: float = 0.0
    credit: float = 0.0
    categorie: Optional[str] = None
    sous_categorie: Optional[str] = None


class PlaquetteItem(BaseModel):
    """Une ligne de la plaquette comptable face à son équivalent NeuronX."""

    item_id: str  # hash stable compte_pcg + rubrique
    compte_pcg: Optional[str] = None  # ex: "60630000"
    compte_label: str  # ex: "FOURNIT ENTRET ET PETIT EQUIPM"
    rubrique_2035: Optional[str] = None  # ex: "Petit outillage"

    # Montants
    montant_plaquette: Optional[float] = None
    montant_plaquette_n1: Optional[float] = None
    montant_neuronx: Optional[float] = None  # recalculé serveur via mapping
    ecart: Optional[float] = None  # neuronx − plaquette (signé)

    # Mapping snapshot au moment de la dernière maj (audit)
    categories_neuronx: list[str] = Field(default_factory=list)
    sous_categories_neuronx: list[str] = Field(default_factory=list)

    # Workflow
    statut: PlaquetteItemStatut = "non_revu"
    commentaire: str = ""

    # Drill-down ops (non persisté en gros volume — résumé top N)
    nb_ops_neuronx: int = 0

    # Audit
    last_modified_at: str = ""

    # Session 39 P2 — évaluation risque fiscal (None tant que jamais évalué)
    risque_fiscal: Optional[RisqueFiscalEvaluation] = None

    # Session 40 P1 — position de repli (None tant que jamais calculée)
    concession: Optional[ConcessionEvaluation] = None


class RisqueDriver(BaseModel):
    """Un facteur contributif au score de risque fiscal d'un item.

    `delta_score` peut être positif (aggravant) ou négatif (atténuant : référence
    BOI/CGI citée, statut résolu, etc.). Voir `plaquette_risque_service.evaluate_item`.
    """

    code: str  # ex: "categorie_sensible", "forfait_applique", "boi_cgi_cite"
    label: str  # libellé humain pour l'UI
    delta_score: int  # +1 (aggravant) / -1 (atténuant)
    detail: Optional[str] = None  # contexte affichable (ex: "Taux justif Véhicule = 62 %")


class RisqueFiscalEvaluation(BaseModel):
    """Évaluation complète du risque fiscal d'un item (Session 39 P2).

    `score` est le score brut (peut être négatif via drivers atténuants).
    `niveau` est dérivé du score via `SCORE_THRESHOLDS`.
    `overridden_niveau` non-null = override manuel utilisateur (figé jusqu'à reset).
    """

    niveau: RisqueNiveau
    score: int
    drivers: list[RisqueDriver] = Field(default_factory=list)
    pieces_disponibles: list[str] = Field(default_factory=list)  # ex: "13 justifs sur 21 ops"
    auto_calcule: bool = True
    overridden_niveau: Optional[RisqueNiveau] = None
    overridden_motif: Optional[str] = None
    last_evaluated_at: str  # ISO datetime


# ─── Session 40 P1 : position de repli (concession) ───

ConcessionSource = Literal["auto", "manual"]
ConcessionTone = Literal["ferme", "equilibre", "conciliant"]


class ConcessionEvaluation(BaseModel):
    """Position de repli calibrée par item : % maintenu + ton + argumentation.

    `montant_maintenu` et `montant_concede` sont des valeurs absolues calculées à
    partir de `ecart_signed = montant_neuronx − montant_plaquette` :
      - `montant_maintenu = montant_plaquette + ecart_signed * pct_maintenu / 100`
      - `montant_concede  = ecart_signed * (1 − pct_maintenu / 100)`

    `source == "manual"` fige les valeurs (slider/tone/argumentation édités) et
    empêche `evaluate_all_concessions` de les écraser au prochain refresh.
    """

    pct_maintenu: float = Field(ge=0.0, le=100.0)
    montant_maintenu: float
    montant_concede: float
    source: ConcessionSource = "auto"
    tone: ConcessionTone
    force_score: float = Field(ge=0.0, le=1.0)
    argumentation: str
    auto_argumentation: str  # texte avant override (preview reset)
    last_updated_at: str  # ISO datetime
    drivers_used: list[str] = Field(default_factory=list)


class NegociationSynthesis(BaseModel):
    """Vue agrégée de la position de repli pour le bandeau du sous-drawer."""

    year: int
    nb_items_total: int  # items à challenger ayant `concession`
    nb_items_maintenus: int  # pct == 100
    nb_items_en_discussion: int  # 0 < pct < 100
    nb_items_concedes: int  # pct == 0
    concession_totale: float  # € en valeur absolue
    bnc_neuronx_initial: float
    bnc_simule: float
    ir_projete_actuel: Optional[float] = None
    ir_projete_simule: Optional[float] = None
    economie_ir: Optional[float] = None


class ConcessionOverridePayload(BaseModel):
    """Body PATCH /items/{item_id}/concession — au moins un champ requis."""

    pct_maintenu: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    tone: Optional[ConcessionTone] = None
    argumentation: Optional[str] = Field(default=None, max_length=800)


class JournalAttachment(BaseModel):
    """Pièce jointe attachée à une entrée du journal d'échanges.

    Stockage physique : data/plaquette_check/{year}/journal_attachments/{filename}
    Validation mime (whitelist) et taille (≤ 10 Mo) côté service.
    """

    filename: str
    storage_path: str  # relatif à data/plaquette_check/{year}/journal_attachments/
    size_bytes: int
    mime_type: str
    uploaded_at: str  # ISO datetime


class JournalEntry(BaseModel):
    """Une entrée du journal d'échanges plaquette ↔ comptable."""

    entry_id: str
    timestamp: str  # ISO
    type: JournalType
    subject: Optional[str] = None
    body_excerpt: str = ""
    related_item_ids: list[str] = Field(default_factory=list)
    ged_email_history_id: Optional[str] = None
    author: Optional[str] = None  # "user" | "comptable" | None
    attachments: list[JournalAttachment] = Field(default_factory=list)


class PlaquetteUpload(BaseModel):
    """Une version uploadée du PDF plaquette (audit trail multi-versions)."""

    upload_id: str
    uploaded_at: str
    ged_doc_id: str  # ex "2025/12/PLAQUETTE CECCOLI 2025.pdf"
    cabinet_template: str = "sygnatures_marenco"
    parse_status: ParseStatut = "pending"
    parse_confidence: float = 0.0
    parse_warnings: list[str] = Field(default_factory=list)


class PlaquetteCheck(BaseModel):
    """État complet de la vérification d'une plaquette pour une année donnée."""

    version: int = 1
    year: int
    cabinet_template: str = "sygnatures_marenco"
    ged_doc_id: Optional[str] = None  # PDF de référence (dernier upload ou liaison manuelle)

    # Historique uploads + items + journal
    uploads: list[PlaquetteUpload] = Field(default_factory=list)
    items: list[PlaquetteItem] = Field(default_factory=list)
    journal: list[JournalEntry] = Field(default_factory=list)

    # Totaux saisis depuis la plaquette (cadre haut de la 2035)
    totaux_plaquette: dict = Field(default_factory=dict)
    # ex: {"recettes": 412470, "depenses": 154722, "benefice": 252279,
    #      "recettes_n1": 409784, "depenses_n1": 139676, "benefice_n1": 288817}

    # ─── Cycle de vie (Session 39 P1) ───
    status: PlaquetteCheckStatus = PlaquetteCheckStatus.EN_COURS
    validated_at: Optional[str] = None  # ISO, timestamp passage en validation_finale
    declared_at: Optional[str] = None  # ISO, timestamp passage en declare
    declaration_ref: Optional[str] = None  # ex. "2042 N° 0123456789012 télédéclaré le 15/04/2026"
    final_snapshot_ged_doc_id: Optional[str] = None  # doc_id du PDF figé en GED

    # ─── Évaluation risque fiscal (Session 39 P2) ───
    # Moyenne pondérée par montant_neuronx, niveau → poids (faible=0, modere=1, eleve=2, critique=3).
    # Score normalisé sur 3. None tant que jamais évalué.
    risque_score_global: Optional[float] = None

    created_at: str = ""
    updated_at: str = ""


# ─── Payloads API ───


class PlaquetteItemPatch(BaseModel):
    """Édition d'un item (montant + workflow)."""
    montant_plaquette: Optional[float] = None
    montant_plaquette_n1: Optional[float] = None
    compte_pcg: Optional[str] = None
    compte_label: Optional[str] = None
    rubrique_2035: Optional[str] = None
    statut: Optional[PlaquetteItemStatut] = None
    commentaire: Optional[str] = None


class PlaquetteItemCreate(BaseModel):
    """Ajout manuel d'un item."""
    compte_pcg: Optional[str] = None
    compte_label: str
    rubrique_2035: Optional[str] = None
    montant_plaquette: Optional[float] = None
    montant_plaquette_n1: Optional[float] = None


class PlaquetteTotauxPatch(BaseModel):
    """Édition des totaux de la plaquette (cadre haut 2035)."""
    recettes: Optional[float] = None
    depenses: Optional[float] = None
    benefice: Optional[float] = None
    recettes_n1: Optional[float] = None
    depenses_n1: Optional[float] = None
    benefice_n1: Optional[float] = None


class JournalEntryCreate(BaseModel):
    """Ajout d'une entrée journal."""
    type: JournalType
    subject: Optional[str] = None
    body_excerpt: str = ""
    related_item_ids: list[str] = Field(default_factory=list)
    ged_email_history_id: Optional[str] = None
    author: Optional[str] = None


class ItemStatusUpdate(BaseModel):
    """Mise à jour ciblée d'un item dans le cadre d'une réponse comptable."""
    item_id: str
    new_statut: PlaquetteItemStatut
    appended_comment: Optional[str] = None


class ComptableResponseRequest(BaseModel):
    """Payload pour logger une réponse du comptable + basculer N items."""
    subject: Optional[str] = "Réponse plaquette comptable"
    body_excerpt: str
    received_at: Optional[str] = None  # ISO, défaut = now
    items_updates: list[ItemStatusUpdate] = Field(default_factory=list)


class ComptableResponseResult(BaseModel):
    journal_entry_id: str
    updated_items_count: int
    updated_item_ids: list[str]


class GenerateChallengeEmailResponse(BaseModel):
    """Réponse du endpoint generate-challenge-email."""
    subject: str
    body: str
    related_item_ids: list[str]
    nb_items: int


class PlaquetteCheckSetRefRequest(BaseModel):
    """Lier la plaquette à un doc GED existant (sans upload)."""
    ged_doc_id: str
    cabinet_template: Optional[str] = None


# ─── Session 39 P1 : cycle de vie ───


class PlaquetteStatusUpdate(BaseModel):
    """Transition de statut (hors finalisation — passer par /finalize pour →DECLARE)."""
    new_status: PlaquetteCheckStatus
    declaration_ref: Optional[str] = None  # ignoré si new_status != DECLARE


class FinalizePlaquetteRequest(BaseModel):
    """Payload pour finaliser et déclarer la plaquette (transition atomique →DECLARE)."""
    declaration_ref: str  # obligatoire — référence officielle de la 2042
    declared_at: Optional[str] = None  # ISO, défaut = now()


# ─── Session 39 P2 : override manuel du niveau de risque ───


class RisqueOverrideRequest(BaseModel):
    """Forcer le niveau de risque d'un item avec un motif obligatoire (traçabilité)."""
    niveau: RisqueNiveau
    motif: str  # obligatoire — pourquoi l'utilisateur override le calcul auto
