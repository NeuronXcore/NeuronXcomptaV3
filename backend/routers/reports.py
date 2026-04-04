"""Router pour les rapports V2."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from typing import Optional
from fastapi import Query

from backend.models.report import ReportGenerateRequest, ReportUpdateRequest, CompareRequest
from backend.services import report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/gallery")
async def get_gallery():
    return report_service.get_gallery()


@router.get("/tree")
async def get_report_tree():
    return report_service.get_report_tree()


@router.get("/pending")
async def get_pending_reports(year: Optional[int] = Query(None)):
    from datetime import datetime
    if year is None:
        year = datetime.now().year
    return report_service.get_pending_reports(year)


@router.get("/templates")
async def get_templates():
    return report_service.get_templates()


@router.post("/generate")
async def generate_report(request: ReportGenerateRequest):
    try:
        result = report_service.generate_report(request.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{filename}/favorite")
async def toggle_favorite(filename: str):
    result = report_service.toggle_favorite(filename)
    if not result:
        raise HTTPException(status_code=404, detail="Rapport non trouvé")
    return result


@router.post("/compare")
async def compare_reports(request: CompareRequest):
    try:
        return report_service.compare_reports(request.filename_a, request.filename_b)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{filename}/regenerate")
async def regenerate_report(filename: str):
    try:
        return report_service.regenerate_report(filename)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/{filename}")
async def update_report(filename: str, request: ReportUpdateRequest):
    updated = report_service.update_report_metadata(filename, request.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(status_code=404, detail="Rapport non trouvé")
    return updated


@router.get("/preview/{filename}")
async def preview_report(filename: str):
    path = report_service.get_report_path(filename)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Rapport introuvable")
    media_type = {
        ".pdf": "application/pdf",
        ".csv": "text/csv",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }.get(path.suffix, "application/octet-stream")
    return FileResponse(str(path), media_type=media_type, headers={
        "Content-Disposition": f'inline; filename="{filename}"'
    })


@router.get("/download/{filename}")
async def download_report(filename: str):
    path = report_service.get_report_path(filename)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Rapport introuvable")
    return FileResponse(str(path), filename=filename, headers={
        "Content-Disposition": f'attachment; filename="{filename}"'
    })


@router.delete("/{filename}")
async def delete_report(filename: str):
    success = report_service.delete_report(filename)
    if not success:
        raise HTTPException(status_code=404, detail="Rapport non trouvé")
    return {"success": True, "message": "Rapport supprimé"}
