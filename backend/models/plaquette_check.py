"""Modèles Pydantic pour le module Vérification Plaquette Comptable.

Stockage : data/plaquette_check/{year}.json
"""
from __future__ import annotations

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
