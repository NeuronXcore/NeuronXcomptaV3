"""Router pour le lettrage comptable."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from backend.services import operation_service

router = APIRouter(prefix="/api/lettrage", tags=["lettrage"])


class BulkLettrageRequest(BaseModel):
    indices: List[int]
    lettre: bool


@router.get("/{filename}/stats")
async def lettrage_stats(filename: str):
    """Retourne les statistiques de lettrage d'un fichier."""
    try:
        return operation_service.get_lettrage_stats(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")


@router.post("/{filename}/{index}")
async def toggle_lettrage(filename: str, index: int):
    """Toggle le lettrage d'une opération."""
    try:
        new_value = operation_service.toggle_lettrage(filename, index)
        return {"lettre": new_value, "index": index}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    except IndexError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{filename}/bulk")
async def bulk_lettrage(filename: str, request: BulkLettrageRequest):
    """Applique le lettrage en masse."""
    try:
        count = operation_service.bulk_lettrage(filename, request.indices, request.lettre)
        return {"modified": count, "lettre": request.lettre}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
