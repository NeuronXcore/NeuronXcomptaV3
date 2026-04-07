"""Router pour les rapports V2."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from typing import Optional, List
from fastapi import Query
from pydantic import BaseModel

from backend.models.report import ReportGenerateRequest, ReportUpdateRequest, CompareRequest
from backend.services import report_service


class ExportZipRequest(BaseModel):
    filenames: List[str]

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


@router.post("/regenerate-all")
async def regenerate_all_reports():
    """Régénère tous les rapports existants (met à jour logo, format, etc.)."""
    gallery = report_service.get_gallery()
    reports = gallery.get("reports", [])
    regenerated = 0
    errors = 0
    for r in reports:
        try:
            report_service.regenerate_report(r["filename"])
            regenerated += 1
        except Exception:
            errors += 1
    return {"regenerated": regenerated, "errors": errors, "total": len(reports)}


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


@router.post("/export-zip")
async def export_reports_zip(request: ExportZipRequest):
    """Crée un ZIP contenant les rapports sélectionnés pour envoi au comptable."""
    import io
    import zipfile
    from datetime import datetime
    from fastapi.responses import StreamingResponse

    if not request.filenames:
        raise HTTPException(status_code=400, detail="Aucun rapport sélectionné")

    buffer = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in request.filenames:
            path = report_service.get_report_path(fname)
            if path and path.exists():
                zf.write(str(path), arcname=fname)
                added += 1

    if added == 0:
        raise HTTPException(status_code=404, detail="Aucun rapport trouvé")

    buffer.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"Rapports_Comptable_{ts}.zip"
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.post("/{filename}/open-native")
async def open_report_native(filename: str):
    """Ouvre le rapport dans l'application native (Aperçu/Numbers/Excel)."""
    import subprocess
    path = report_service.get_report_path(filename)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Rapport introuvable")
    subprocess.Popen(["open", str(path)])
    return {"status": "opened"}


@router.delete("/all")
async def delete_all_reports():
    """Supprime tous les rapports."""
    gallery = report_service.get_gallery()
    reports = gallery.get("reports", [])
    deleted = 0
    for r in reports:
        try:
            report_service.delete_report(r["filename"])
            # GED V2: remove from GED metadata
            try:
                from backend.services import ged_service
                ged_service.remove_document(r["filename"])
            except Exception:
                pass
            deleted += 1
        except Exception:
            pass
    return {"deleted": deleted, "total": len(reports)}


@router.delete("/{filename}")
async def delete_report(filename: str):
    success = report_service.delete_report(filename)
    if not success:
        raise HTTPException(status_code=404, detail="Rapport non trouvé")

    # GED V2: remove from GED metadata
    try:
        from backend.services import ged_service
        ged_service.remove_document(filename)
    except Exception:
        pass

    return {"success": True, "message": "Rapport supprimé"}
