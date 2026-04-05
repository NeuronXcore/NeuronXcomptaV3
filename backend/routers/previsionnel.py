"""
Router API pour le module Previsionnel.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.models.previsionnel import (
    PrevProviderCreate,
    PrevProviderUpdate,
    LinkBody,
    PrelevementsInput,
    PrevSettings,
)
from backend.services import previsionnel_service

router = APIRouter(prefix="/api/previsionnel", tags=["previsionnel"])


# ─── Timeline ───

@router.get("/timeline")
async def get_timeline(year: int = Query(...)):
    return previsionnel_service.get_timeline(year)


# ─── Providers ───

@router.get("/providers")
async def list_providers():
    return previsionnel_service.get_providers()


@router.post("/providers")
async def create_provider(req: PrevProviderCreate):
    return previsionnel_service.add_provider(req)


@router.put("/providers/{provider_id}")
async def update_provider(provider_id: str, req: PrevProviderUpdate):
    result = previsionnel_service.update_provider(provider_id, req)
    if not result:
        raise HTTPException(status_code=404, detail="Provider non trouvé")
    return result


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str):
    if not previsionnel_service.delete_provider(provider_id):
        raise HTTPException(status_code=404, detail="Provider non trouvé")
    return {"success": True}


# ─── Echeances ───

@router.get("/echeances")
async def list_echeances(year: Optional[int] = None, statut: Optional[str] = None):
    return previsionnel_service.get_echeances(year, statut)


@router.get("/dashboard")
async def get_dashboard(year: int = Query(...)):
    return previsionnel_service.get_dashboard(year)


@router.post("/scan")
async def scan_documents():
    return previsionnel_service.scan_matching()


@router.post("/refresh")
async def refresh_echeances(year: int = Query(...)):
    return previsionnel_service.refresh_echeances(year)


@router.post("/echeances/{echeance_id}/link")
async def link_echeance(echeance_id: str, body: LinkBody):
    result = previsionnel_service.link_echeance(echeance_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Echéance non trouvée")
    return result


@router.post("/echeances/{echeance_id}/unlink")
async def unlink_echeance(echeance_id: str):
    result = previsionnel_service.unlink_echeance(echeance_id)
    if not result:
        raise HTTPException(status_code=404, detail="Echéance non trouvée")
    return result


@router.post("/echeances/{echeance_id}/dismiss")
async def dismiss_echeance(echeance_id: str, body: dict = {}):
    result = previsionnel_service.dismiss_echeance(echeance_id, body.get("note", ""))
    if not result:
        raise HTTPException(status_code=404, detail="Echéance non trouvée")
    return result


# ─── Prelevements ───

@router.post("/echeances/{echeance_id}/prelevements")
async def set_prelevements(echeance_id: str, body: PrelevementsInput):
    previsionnel_service.set_prelevements(echeance_id, body.prelevements)
    return {"success": True}


@router.post("/echeances/{echeance_id}/auto-populate")
async def auto_populate_ocr(echeance_id: str):
    result = previsionnel_service.auto_populate_from_ocr(echeance_id)
    if not result:
        raise HTTPException(status_code=404, detail="Echéance non trouvée ou pas de document lié")
    return result


@router.post("/echeances/{echeance_id}/scan-prelevements")
async def scan_prelevements(echeance_id: str):
    return previsionnel_service.scan_prelevements(echeance_id)


@router.post("/echeances/{echeance_id}/prelevements/{mois}/verify")
async def verify_prelevement(echeance_id: str, mois: int, body: dict = {}):
    previsionnel_service.verify_prelevement(
        echeance_id, mois,
        operation_file=body.get("operation_file"),
        operation_index=body.get("operation_index"),
        montant_reel=body.get("montant_reel"),
    )
    return {"success": True}


@router.post("/echeances/{echeance_id}/prelevements/{mois}/unverify")
async def unverify_prelevement(echeance_id: str, mois: int):
    previsionnel_service.unverify_prelevement(echeance_id, mois)
    return {"success": True}


# ─── Settings ───

@router.get("/settings")
async def get_settings():
    return previsionnel_service.get_settings()


@router.put("/settings")
async def update_settings(body: PrevSettings):
    return previsionnel_service.update_settings(body)
