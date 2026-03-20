"""Router pour l'export comptable."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.services import export_service

router = APIRouter(prefix="/api/exports", tags=["exports"])


class GenerateExportRequest(BaseModel):
    year: int
    month: int
    include_csv: bool = True
    include_pdf: bool = False
    include_excel: bool = False
    include_bank_statement: bool = True
    include_justificatifs: bool = True
    include_reports: bool = False


@router.get("/periods")
async def get_periods():
    """Retourne les périodes disponibles avec leur statut."""
    return export_service.get_available_periods()


@router.get("/list")
async def list_exports():
    """Liste tous les exports générés."""
    return export_service.list_exports()


@router.post("/generate")
async def generate_export(request: GenerateExportRequest):
    """Génère un export ZIP pour un mois donné."""
    try:
        result = export_service.generate_export(
            year=request.year,
            month=request.month,
            include_csv=request.include_csv,
            include_pdf=request.include_pdf,
            include_excel=request.include_excel,
            include_bank_statement=request.include_bank_statement,
            include_justificatifs=request.include_justificatifs,
            include_reports=request.include_reports,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de génération: {str(e)}")


@router.get("/download/{filename}")
async def download_export(filename: str):
    """Télécharge un export ZIP."""
    path = export_service.get_export_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail="Export non trouvé")
    return FileResponse(
        path=str(path),
        media_type="application/zip",
        filename=filename,
    )


@router.delete("/{filename}")
async def delete_export(filename: str):
    """Supprime un export."""
    if not export_service.delete_export(filename):
        raise HTTPException(status_code=404, detail="Export non trouvé")
    return {"deleted": filename}
