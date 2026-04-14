from __future__ import annotations

"""Router pour la ventilation d'opérations."""

from typing import Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from backend.services import ventilation_service, rapprochement_service

router = APIRouter(prefix="/api/ventilation", tags=["ventilation"])


class VentilationLineInput(BaseModel):
    montant: float
    categorie: str = ""
    sous_categorie: str = ""
    libelle: str = ""
    justificatif: Optional[str] = None
    lettre: bool = False


class SetVentilationRequest(BaseModel):
    lines: list[VentilationLineInput]


class UpdateLineRequest(BaseModel):
    montant: Optional[float] = None
    categorie: Optional[str] = None
    sous_categorie: Optional[str] = None
    libelle: Optional[str] = None
    justificatif: Optional[str] = None
    lettre: Optional[bool] = None


@router.put("/{filename}/{op_index}")
def set_ventilation(
    filename: str,
    op_index: int,
    req: SetVentilationRequest,
    background_tasks: BackgroundTasks,
):
    """Créer ou remplacer la ventilation d'une opération."""
    lines = [line.model_dump() for line in req.lines]

    if len(lines) < 2:
        raise HTTPException(status_code=422, detail="Au moins 2 lignes requises")

    for i, line in enumerate(lines):
        if line["montant"] <= 0:
            raise HTTPException(
                status_code=422,
                detail=f"Ligne {i}: le montant doit être > 0",
            )

    try:
        op = ventilation_service.set_ventilation(filename, op_index, lines)
        # Auto-rapprochement en arrière-plan pour les sous-lignes créées
        background_tasks.add_task(rapprochement_service.run_auto_rapprochement)
        return op
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except IndexError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.delete("/{filename}/{op_index}")
def remove_ventilation(filename: str, op_index: int):
    """Supprimer la ventilation d'une opération."""
    try:
        op = ventilation_service.remove_ventilation(filename, op_index)
        return op
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except IndexError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/{filename}/{op_index}/{line_index}")
def update_ventilation_line(
    filename: str, op_index: int, line_index: int, req: UpdateLineRequest
):
    """Modifier une sous-ligne de ventilation."""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=422, detail="Aucun champ à mettre à jour")

    try:
        op = ventilation_service.update_ventilation_line(
            filename, op_index, line_index, updates
        )
        return op
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except IndexError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
