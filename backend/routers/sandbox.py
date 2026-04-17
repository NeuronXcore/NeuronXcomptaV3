"""
Router Sandbox — SSE events + gestion du dossier sandbox (inbox justificatifs).

Endpoints :
- GET  /events                     — SSE stream (scanning / processed / arrived / error)
- GET  /list                       — liste enrichie (is_canonical, arrived_at, auto_deadline)
- POST /{filename}/rename          — rename inplace (avant OCR)
- POST /{filename}/process         — déclenche OCR + rapprochement unitaire
- GET  /{filename}/thumbnail       — vignette PNG (cache séparé, hors GED)
- DELETE /{filename}               — supprime sans traiter
- POST /process-all                — traite tous les fichiers présents (ex `/process`)
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from backend.services.sandbox_service import (
    delete_sandbox_file,
    get_recent_events,
    get_sandbox_path,
    get_sandbox_thumbnail_path,
    list_sandbox_files,
    process_existing_files,
    process_sandbox_file,
    rename_in_sandbox,
    sandbox_event_queue,
)
from backend.services import sandbox_service

logger = logging.getLogger(__name__)

router = APIRouter()


class SandboxRenameRequest(BaseModel):
    new_filename: str


async def _sse_generator():
    """Générateur SSE avec keepalive ping toutes les 30s."""
    yield f"data: {json.dumps({'status': 'connected', 'timestamp': ''})}\n\n"
    for ev in get_recent_events():
        yield f"data: {json.dumps({**ev, 'replayed': True})}\n\n"
    try:
        while True:
            try:
                event = await asyncio.wait_for(sandbox_event_queue.get(), timeout=30.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    except asyncio.CancelledError:
        logger.info("SSE sandbox: client déconnecté")


@router.get("/events")
async def sandbox_events():
    """Stream SSE des événements sandbox (scanning / processed / arrived / error)."""
    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/list")
async def sandbox_list():
    """Liste des fichiers sandbox avec méta enrichies (is_canonical, arrived_at,
    auto_deadline)."""
    return list_sandbox_files()


@router.post("/process-all")
async def sandbox_process_all():
    """Déclenche le traitement de TOUS les fichiers canoniques présents dans sandbox/.
    Les non-canoniques restent en place (comportement watchdog conditionnel).
    """
    files = list_sandbox_files()
    if not files:
        return {"status": "empty", "count": 0}
    thread = threading.Thread(target=process_existing_files, daemon=True)
    thread.start()
    return {"status": "started", "count": len(files)}


@router.post("/{filename}/rename")
async def sandbox_rename(filename: str, body: SandboxRenameRequest):
    """Renomme un fichier INPLACE dans sandbox/ (avant OCR).

    Ne déclenche PAS l'OCR automatiquement — seul `POST /{filename}/process` ou
    l'auto-processor (mode auto) le font. Retourne `{old, new, is_canonical}`.
    """
    return rename_in_sandbox(filename, body.new_filename)


@router.post("/{filename}/process")
async def sandbox_process_one(filename: str):
    """Déclenche OCR + rapprochement pour un fichier de sandbox (à la demande).

    Move → en_attente, OCR, auto-rename post-OCR, auto-rapprochement. Exécuté
    dans un thread background — l'endpoint retourne immédiatement (`status: "started"`)
    pour éviter les timeouts HTTP (EasyOCR peut prendre 10-30s au premier chargement).
    Le frontend suit la progression via les events SSE `scanning` puis `processed`.
    """
    # Validation + sécurité : vérifier que le fichier existe AVANT de lancer le thread
    if sandbox_service.get_sandbox_path(filename) is None:
        raise HTTPException(404, f"Fichier '{filename}' introuvable dans sandbox/")

    def _run_background():
        try:
            process_sandbox_file(filename)
        except Exception as e:
            logger.error("Sandbox process %s: %s", filename, e)

    thread = threading.Thread(target=_run_background, daemon=True)
    thread.start()
    return {"status": "started", "filename": filename}


@router.get("/{filename}/thumbnail")
async def sandbox_thumbnail(filename: str):
    """Retourne la vignette PNG d'un fichier sandbox (cache séparé hors GED)."""
    thumb_path = get_sandbox_thumbnail_path(filename)
    if not thumb_path:
        raise HTTPException(404, f"Thumbnail indisponible pour '{filename}'")
    return FileResponse(thumb_path, media_type="image/png")


@router.get("/{filename}/preview")
async def sandbox_preview(filename: str):
    """Stream inline du PDF sandbox pour aperçu dans un iframe / object."""
    src = get_sandbox_path(filename)
    if src is None:
        raise HTTPException(404, f"Fichier '{filename}' introuvable dans sandbox/")
    return FileResponse(
        str(src),
        media_type="application/pdf",
        content_disposition_type="inline",
    )


@router.delete("/{filename}")
async def sandbox_delete(filename: str):
    """Supprime un fichier du sandbox sans le traiter."""
    if not delete_sandbox_file(filename):
        raise HTTPException(status_code=404, detail=f"Fichier '{filename}' non trouvé dans le sandbox")
    return {"status": "deleted", "filename": filename}
