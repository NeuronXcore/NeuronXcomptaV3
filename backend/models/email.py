"""Modèles Pydantic pour l'envoi d'emails."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


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
