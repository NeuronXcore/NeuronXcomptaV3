"""
Router Sandbox — SSE events + gestion du dossier sandbox.
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.services.sandbox_service import (
    delete_sandbox_file,
    list_sandbox_files,
    sandbox_event_queue,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _sse_generator():
    """Générateur SSE avec keepalive ping toutes les 30s."""
    # Envoyer un event initial pour flush la connexion et confirmer le statut
    yield f"data: {json.dumps({'status': 'connected', 'timestamp': ''})}\n\n"
    try:
        while True:
            try:
                event = await asyncio.wait_for(sandbox_event_queue.get(), timeout=30.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                # Keepalive ping
                yield ": ping\n\n"
    except asyncio.CancelledError:
        logger.info("SSE sandbox: client déconnecté")


@router.get("/events")
async def sandbox_events():
    """Stream SSE des événements sandbox (nouveau fichier traité)."""
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
    """Liste les PDF actuellement dans le dossier sandbox."""
    return list_sandbox_files()


@router.delete("/{filename}")
async def sandbox_delete(filename: str):
    """Supprime un fichier du sandbox sans le traiter."""
    if not delete_sandbox_file(filename):
        raise HTTPException(status_code=404, detail=f"Fichier '{filename}' non trouvé dans le sandbox")
    return {"status": "deleted", "filename": filename}
