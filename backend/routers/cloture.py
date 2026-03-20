"""Router pour la clôture comptable."""
from __future__ import annotations

from fastapi import APIRouter

from backend.services import cloture_service

router = APIRouter(prefix="/api/cloture", tags=["cloture"])


@router.get("/years")
async def get_years():
    """Retourne les années disponibles."""
    return cloture_service.get_available_years()


@router.get("/{year}")
async def get_annual_status(year: int):
    """Retourne le statut de clôture des 12 mois d'une année."""
    return cloture_service.get_annual_status(year)
