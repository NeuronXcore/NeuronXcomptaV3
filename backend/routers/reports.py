"""Router pour la génération et gestion des rapports."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from backend.services import report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


class GenerateRequest(BaseModel):
    source_files: list[str]
    format: str = "csv"  # "csv", "pdf", "xlsx"
    title: Optional[str] = None
    filters: Optional[dict] = None


@router.get("/gallery")
async def list_reports():
    """Liste tous les rapports générés."""
    return {"reports": report_service.list_report_files()}


@router.post("/generate")
async def generate_report(request: GenerateRequest):
    """Génère un rapport (CSV, PDF ou Excel)."""
    try:
        result = report_service.generate_report(
            source_files=request.source_files,
            format=request.format,
            filters=request.filters,
            title=request.title,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de génération: {str(e)}")


@router.get("/download/{filename}")
async def download_report(filename: str):
    """Télécharge un rapport généré."""
    path = report_service.get_report_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail="Rapport non trouvé")

    media_types = {
        ".csv": "text/csv",
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    media_type = media_types.get(path.suffix, "application/octet-stream")

    return FileResponse(
        path=str(path),
        media_type=media_type,
        filename=filename,
    )


@router.delete("/{filename}")
async def delete_report(filename: str):
    """Supprime un rapport."""
    if not report_service.delete_report(filename):
        raise HTTPException(status_code=404, detail="Rapport non trouvé")
    return {"deleted": filename}
