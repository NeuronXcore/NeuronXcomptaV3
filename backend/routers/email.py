"""Router pour l'envoi d'emails comptables."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.core.config import SETTINGS_FILE
from backend.models.email import (
    EmailHistoryEntry, EmailPreviewRequest, EmailSendRequest, EmailSendResponse,
    EmailTestResponse, ManualPrep, ManualPrepRequest,
)
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
async def preview_email(request: EmailPreviewRequest):
    """Génère une prévisualisation du mail (objet + corps plain + corps HTML)."""
    settings = _load_settings()
    nom = settings.get("email_default_nom")
    destinataires = settings.get("email_comptable_destinataires", [])
    return {
        "destinataires": destinataires,
        "objet": email_service.generate_email_subject(request.documents, nom),
        "corps": email_service.generate_email_body_plain(request.documents, nom),
        "corps_html": email_service.generate_email_html(request.documents, nom, for_preview=True),
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


# ─── Mode envoi manuel ─────────────────────────────────────────────────────


@router.post("/prepare-manual", response_model=ManualPrep)
async def prepare_manual(req: ManualPrepRequest):
    """Génère un ZIP persistant pour envoi manuel + retourne objet/corps pré-remplis."""
    if not req.documents:
        raise HTTPException(status_code=400, detail="Aucun document sélectionné")
    if not req.destinataires:
        raise HTTPException(status_code=400, detail="Aucun destinataire renseigné")
    try:
        return email_service.prepare_manual_zip(req)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur préparation : {e}")


@router.get("/manual-zips", response_model=list[ManualPrep])
async def list_manual_zips():
    """Liste les ZIPs préparés non encore envoyés (auto-purge des entrées orphelines)."""
    return email_service.list_manual_zips()


# Routes statiques (cleanup, stats) déclarées AVANT les paramétriques /{zip_id}
# pour éviter toute ambiguïté de matching FastAPI.
@router.post("/manual-zips/cleanup")
async def cleanup_manual_zips(max_age_days: int = Query(30, ge=0)):
    """Supprime les ZIPs non envoyés > max_age_days (0 = tout supprimer)."""
    removed = email_service.cleanup_old_manual_zips(max_age_days=max_age_days)
    return {"removed": removed, "max_age_days": max_age_days}


@router.get("/manual-zips/stats")
async def get_manual_zips_stats():
    """Retourne les métriques d'usage des ZIPs préparés (pour Paramètres > Stockage)."""
    return email_service.get_manual_zips_stats()


@router.post("/manual-zips/{zip_id}/open-native")
async def open_manual_zip(zip_id: str):
    """Ouvre le Finder sur le ZIP préparé (révèle le fichier)."""
    try:
        email_service.open_manual_zip_in_finder(zip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "opened"}


@router.post("/manual-zips/{zip_id}/mark-sent", response_model=EmailHistoryEntry)
async def mark_manual_sent(zip_id: str):
    """Marque le ZIP comme envoyé manuellement et journalise dans email_history.json."""
    try:
        return email_service.mark_manual_zip_sent(zip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/manual-zips/{zip_id}")
async def delete_manual_zip(zip_id: str):
    """Supprime le ZIP physique et son entrée dans l'index."""
    try:
        email_service.delete_manual_zip(zip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "deleted"}
