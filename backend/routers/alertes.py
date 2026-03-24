"""
Router pour le système d'alertes / compte d'attente.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.core.config import IMPORTS_DIR, ensure_directories
from backend.models.alerte import ResolveAlerteBody
from backend.services import alerte_service, operation_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/alertes", tags=["alertes"])


@router.get("/summary")
async def get_alertes_summary():
    """Résumé global des alertes sur tous les fichiers."""
    ensure_directories()

    par_type = {
        "justificatif_manquant": 0,
        "a_categoriser": 0,
        "montant_a_verifier": 0,
        "doublon_suspect": 0,
        "confiance_faible": 0,
    }
    par_fichier = []
    total_en_attente = 0

    if not IMPORTS_DIR.exists():
        return {"total_en_attente": 0, "par_type": par_type, "par_fichier": []}

    for f in sorted(IMPORTS_DIR.iterdir(), reverse=True):
        if f.suffix != ".json":
            continue
        try:
            operations = operation_service.load_operations(f.name)
        except Exception as e:
            logger.warning(f"Impossible de charger {f.name}: {e}")
            continue

        nb_alertes = 0
        for op in operations:
            alertes = op.get("alertes", []) or []
            if op.get("compte_attente"):
                nb_alertes += 1
                total_en_attente += 1
                for a in alertes:
                    if a in par_type:
                        par_type[a] += 1

        if nb_alertes > 0:
            par_fichier.append({
                "filename": f.name,
                "nb_alertes": nb_alertes,
                "nb_operations": len(operations),
            })

    return {
        "total_en_attente": total_en_attente,
        "par_type": par_type,
        "par_fichier": par_fichier,
    }


@router.get("/{filename}")
async def get_alertes_fichier(filename: str):
    """Retourne les opérations en compte d'attente pour un fichier."""
    try:
        operations = operation_service.load_operations(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Fichier {filename} introuvable")

    result = []
    for i, op in enumerate(operations):
        if op.get("compte_attente"):
            op["_index"] = i
            result.append(op)

    return result


@router.post("/{filename}/{index}/resolve")
async def resolve_alerte(filename: str, index: int, body: ResolveAlerteBody):
    """Résout une alerte sur une opération."""
    try:
        operations = operation_service.load_operations(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Fichier {filename} introuvable")

    if index < 0 or index >= len(operations):
        raise HTTPException(status_code=404, detail=f"Index {index} hors limites")

    op = operations[index]
    alertes = op.get("alertes", []) or []
    resolues = op.get("alertes_resolues", []) or []

    alerte_val = body.alerte_type.value
    if alerte_val not in alertes:
        raise HTTPException(
            status_code=400,
            detail=f"L'alerte '{alerte_val}' n'est pas active sur cette opération",
        )

    alertes.remove(alerte_val)
    resolues.append(alerte_val)
    op["alertes"] = alertes
    op["alertes_resolues"] = resolues
    op["compte_attente"] = len(alertes) > 0

    if body.note:
        op["alerte_note"] = body.note

    operation_service.save_operations(operations, filename=filename)

    op["_index"] = index
    return op


@router.post("/{filename}/refresh")
async def refresh_alertes(filename: str):
    """Force le recalcul des alertes pour un fichier."""
    try:
        operations = operation_service.load_operations(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Fichier {filename} introuvable")

    alerte_service.refresh_alertes_fichier(operations)
    operation_service.save_operations(operations, filename=filename)

    nb_alertes = sum(1 for op in operations if op.get("compte_attente"))
    return {"nb_alertes": nb_alertes, "nb_operations": len(operations)}
