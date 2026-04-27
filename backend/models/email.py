"""Modèles Pydantic pour l'envoi d'emails."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


EmailMode = Literal["smtp", "manual"]


class DocumentRef(BaseModel):
    """Référence à un document à joindre."""
    type: str        # "export" | "rapport" | "releve" | "justificatif" | "ged"
    filename: str


class DocumentInfo(BaseModel):
    """Document disponible pour envoi."""
    type: str
    filename: str
    display_name: str
    size_bytes: int
    date: Optional[str] = None
    category: Optional[str] = None


class EmailPreviewRequest(BaseModel):
    """Requête de prévisualisation email (documents uniquement)."""
    documents: list[DocumentRef]


class EmailSendRequest(BaseModel):
    """Requête d'envoi d'email avec documents."""
    documents: list[DocumentRef]
    destinataires: list[str]
    objet: Optional[str] = None
    corps: Optional[str] = None


class EmailSendResponse(BaseModel):
    """Réponse après envoi."""
    success: bool
    message: str
    destinataires: list[str]
    fichiers_envoyes: list[str]
    taille_totale_mo: float


class EmailTestResponse(BaseModel):
    """Réponse test connexion SMTP."""
    success: bool
    message: str


class EmailHistoryEntry(BaseModel):
    """Entrée d'historique d'envoi."""
    id: str
    sent_at: str
    destinataires: list[str]
    objet: str
    documents: list[DocumentRef]
    nb_documents: int
    taille_totale_mo: float
    success: bool
    error_message: Optional[str] = None
    mode: EmailMode = "smtp"


class ManualPrep(BaseModel):
    """Métadonnées d'un ZIP préparé pour envoi manuel."""
    id: str
    zip_filename: str
    zip_path: str
    taille_mo: float
    contenu_tree: list[str]
    documents: list[DocumentRef]
    objet: str
    corps_plain: str
    destinataires: list[str]
    prepared_at: str  # ISO 8601
    sent: bool = False


class ManualPrepRequest(BaseModel):
    """Requête de préparation d'un envoi manuel (génère le ZIP, ne l'envoie pas)."""
    documents: list[DocumentRef]
    destinataires: list[str]
    objet: Optional[str] = None
    corps: Optional[str] = None
