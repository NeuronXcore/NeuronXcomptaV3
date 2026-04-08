"""Router pour l'export comptable."""
from __future__ import annotations

import mimetypes
from typing import Optional, List

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


class GenerateMonthRequest(BaseModel):
    year: int
    month: int
    format: str = "pdf"
    report_filenames: Optional[List[str]] = None


class GenerateBatchRequest(BaseModel):
    year: int
    months: List[int]
    format: str = "pdf"


@router.get("/periods")
async def get_periods():
    """Retourne les périodes disponibles avec leur statut."""
    return export_service.get_available_periods()


@router.get("/list")
async def list_exports():
    """Liste tous les exports générés."""
    return export_service.list_exports()


@router.get("/status/{year}")
async def get_export_status(year: int):
    """Retourne le statut des exports pour chaque mois de l'année."""
    return export_service.get_month_export_status(year)


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


@router.get("/available-reports/{year}/{month}")
async def get_available_reports(year: int, month: int):
    """Retourne les rapports disponibles pour inclusion dans un export mensuel."""
    return export_service.get_available_reports_for_month(year, month)


@router.post("/generate-month")
async def generate_month_export(request: GenerateMonthRequest):
    """Génère un export unitaire (PDF ou CSV) pour un mois donné."""
    if request.format not in ("pdf", "csv"):
        raise HTTPException(status_code=400, detail="Format doit être 'pdf' ou 'csv'")
    try:
        result = export_service.generate_single_export(
            year=request.year,
            month=request.month,
            fmt=request.format,
            report_filenames=request.report_filenames,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@router.post("/generate-batch")
async def generate_batch_export(request: GenerateBatchRequest):
    """Génère un lot d'exports et retourne un ZIP."""
    if request.format not in ("pdf", "csv"):
        raise HTTPException(status_code=400, detail="Format doit être 'pdf' ou 'csv'")
    try:
        result = export_service.generate_batch_export(
            year=request.year,
            months=request.months,
            fmt=request.format,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur batch: {str(e)}")


@router.get("/contents/{filename}")
async def get_export_contents(filename: str):
    """Liste les fichiers contenus dans un ZIP d'export."""
    contents = export_service.list_zip_contents(filename)
    if contents is None:
        raise HTTPException(status_code=404, detail="Export non trouvé")
    return {"filename": filename, "files": contents}


@router.get("/download/{filename}")
async def download_export(filename: str):
    """Télécharge un export (ZIP, PDF ou CSV)."""
    path = export_service.get_export_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail="Export non trouvé")

    media_type, _ = mimetypes.guess_type(filename)
    if not media_type:
        media_type = "application/octet-stream"

    return FileResponse(
        path=str(path),
        media_type=media_type,
        filename=filename,
    )


@router.delete("/{filename}")
async def delete_export(filename: str):
    """Supprime un export."""
    if not export_service.delete_export(filename):
        raise HTTPException(status_code=404, detail="Export non trouvé")
    return {"deleted": filename}
