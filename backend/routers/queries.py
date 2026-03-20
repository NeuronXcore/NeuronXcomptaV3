"""Router pour les requêtes analytiques personnalisées."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services import query_service

router = APIRouter(prefix="/api/analytics", tags=["queries"])


class QueryRequest(BaseModel):
    categories: list[str] = []
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    type: str = "both"  # debit, credit, both
    grouping: str = "category"  # month, quarter, category, month_category


class PresetSave(BaseModel):
    name: str
    filters: dict


@router.post("/query")
async def execute_query(request: QueryRequest):
    """Exécute une requête analytique avec filtres."""
    filters = request.model_dump()
    return query_service.execute_query(filters)


@router.get("/queries")
async def list_queries():
    """Liste les presets sauvegardés + requêtes prédéfinies."""
    saved = query_service.list_presets()
    predefined = query_service.get_predefined_queries()
    return {"saved": saved, "predefined": predefined}


@router.post("/queries")
async def save_query(preset: PresetSave):
    """Sauvegarde un preset de requête."""
    return query_service.save_preset(preset.model_dump())


@router.get("/queries/{preset_id}")
async def load_query(preset_id: str):
    """Charge un preset par ID."""
    # Check predefined first
    for p in query_service.get_predefined_queries():
        if p["id"] == preset_id:
            return p
    result = query_service.load_preset(preset_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Preset non trouvé")
    return result


@router.delete("/queries/{preset_id}")
async def delete_query(preset_id: str):
    """Supprime un preset."""
    if query_service.delete_preset(preset_id):
        return {"message": "Preset supprimé"}
    raise HTTPException(status_code=404, detail="Preset non trouvé")
