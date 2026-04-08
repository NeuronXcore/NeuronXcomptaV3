"""Router pour l'envoi d'emails comptables."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.core.config import SETTINGS_FILE
from backend.models.email import EmailSendRequest, EmailSendResponse, EmailTestResponse, EmailHistoryEntry
from backend.services import email_service, email_history_service

router = APIRouter(prefix="/api/email", tags=["email"])


def _load_settings() -> dict:
    """Charge les settings depuis le fichier JSON."""
    if not SETTINGS_FILE.exists():
        return {}
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


@router.post("/test-connection", response_model=EmailTestResponse)
async def test_connection():
    """Test la connexion SMTP avec les credentials settings."""
    settings = _load_settings()
    smtp_user = settings.get("email_smtp_user")
    smtp_password = settings.get("email_smtp_app_password")
    if not smtp_user or not smtp_password:
        raise HTTPException(status_code=400, detail="Email non configuré dans les paramètres")
    return email_service.test_smtp_connection(smtp_user, smtp_password)


@router.get("/documents")
async def list_documents(
    type: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    """Liste les documents disponibles pour envoi."""
    return email_service.list_available_documents(doc_type=type, year=year, month=month)


@router.post("/preview")
async def preview_email(request: EmailSendRequest):
    """Génère une prévisualisation du mail (objet + corps)."""
    settings = _load_settings()
    nom = settings.get("email_default_nom")
    destinataires = settings.get("email_comptable_destinataires", [])
    return {
        "destinataires": destinataires,
        "objet": email_service.generate_email_subject(request.documents, nom),
        "corps": email_service.generate_email_body(request.documents, nom),
    }


@router.post("/send", response_model=EmailSendResponse)
async def send_email(request: EmailSendRequest):
    """Envoie des documents comptables par email."""
    settings = _load_settings()
    smtp_user = settings.get("email_smtp_user")
    smtp_password = settings.get("email_smtp_app_password")
    if not smtp_user or not smtp_password:
        raise HTTPException(status_code=400, detail="Email non configuré dans les paramètres")

    nom = settings.get("email_default_nom")
    objet = request.objet or email_service.generate_email_subject(request.documents, nom)
    corps = request.corps or email_service.generate_email_body(request.documents, nom)

    result = email_service.send_email(
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        nom_expediteur=nom,
        destinataires=request.destinataires,
        objet=objet,
        corps=corps,
        documents=request.documents,
    )

    # Log dans l'historique (succès et échecs)
    entry = EmailHistoryEntry(
        id=uuid.uuid4().hex[:8],
        sent_at=datetime.now().isoformat(),
        destinataires=request.destinataires,
        objet=objet,
        documents=request.documents,
        nb_documents=len(request.documents),
        taille_totale_mo=result.taille_totale_mo,
        success=result.success,
        error_message=None if result.success else result.message,
    )
    email_history_service.log_send(entry)

    return result


@router.get("/history")
async def get_history(
    year: Optional[int] = Query(None),
    limit: int = Query(50),
):
    """Retourne l'historique des envois email."""
    return email_history_service.get_history(year=year, limit=limit)


@router.get("/coverage/{year}")
async def get_coverage(year: int):
    """Retourne la couverture d'envoi par mois pour une année."""
    return email_history_service.get_send_coverage(year)
