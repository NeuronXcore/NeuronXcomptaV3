"""Router pour la gestion des justificatifs comptables."""
from __future__ import annotations

import asyncio
import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse

from backend.models.justificatif import AssociateRequest, DissociateRequest, RenameRequest
from backend.services import justificatif_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/justificatifs", tags=["justificatifs"])


@router.get("/")
async def list_justificatifs(
    status: str = Query("all", description="all, en_attente, traites"),
    search: str = Query("", description="Recherche par nom"),
    year: Optional[int] = Query(None, description="Filtrer par année"),
    month: Optional[int] = Query(None, description="Filtrer par mois"),
    sort_by: str = Query("date", description="date, name, size"),
    sort_order: str = Query("desc", description="asc, desc"),
):
    """Liste tous les justificatifs avec filtres."""
    return justificatif_service.list_justificatifs(
        status=status,
        search=search,
        year=year,
        month=month,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/stats")
async def get_stats():
    """Statistiques des justificatifs."""
    return justificatif_service.get_stats()


@router.post("/upload")
async def upload_justificatifs(files: List[UploadFile] = File(...)):
    """Upload un ou plusieurs fichiers PDF."""
    files_data = []
    for upload_file in files:
        if not upload_file.filename:
            continue
        content = await upload_file.read()
        files_data.append((upload_file.filename, content))

    if not files_data:
        raise HTTPException(status_code=400, detail="Aucun fichier fourni")

    results = justificatif_service.upload_justificatifs(files_data)

    # Trigger OCR en arrière-plan pour chaque fichier uploadé avec succès
    loop = asyncio.get_event_loop()
    for r in results:
        if r.get("success") and r.get("filename"):
            loop.run_in_executor(None, _run_ocr_background, r["filename"])

    return results


def _run_ocr_background(filename: str):
    """Lance l'OCR en background pour un justificatif uploadé, puis auto-rename + rapprochement."""
    try:
        from backend.services import ocr_service, rapprochement_service
        filepath = justificatif_service.get_justificatif_path(filename)
        if filepath:
            ocr_service.extract_or_cached(filepath)
            logger.info(f"OCR background terminé: {filename}")

            # Auto-rename post-OCR
            ocr_cached = ocr_service.get_cached_result(filepath)
            if ocr_cached and ocr_cached.get("status") == "success":
                new_name = justificatif_service.auto_rename_from_ocr(
                    filename, ocr_cached.get("extracted_data", {})
                )
                if new_name:
                    logger.info(f"Auto-rename background: {filename} → {new_name}")

            # Auto-rapprochement après OCR
            result = rapprochement_service.run_auto_rapprochement()
            if result.get("associations_auto", 0) > 0:
                logger.info(f"Auto-rapprochement: {result['associations_auto']} associations")
    except Exception as e:
        logger.warning(f"OCR/rapprochement background échoué pour {filename}: {e}")


@router.get("/reverse-lookup/{filename:path}")
async def reverse_lookup_justificatif(filename: str):
    """Trouve les opérations associées à un justificatif donné."""
    return justificatif_service.find_operations_by_justificatif(filename)


@router.get("/{filename}/preview")
async def preview_justificatif(filename: str):
    """Sert le fichier PDF pour preview dans iframe."""
    filepath = justificatif_service.get_justificatif_path(filename)
    if not filepath:
        raise HTTPException(status_code=404, detail="Justificatif non trouvé")
    return FileResponse(
        str(filepath),
        media_type="application/pdf",
        filename=filename,
        content_disposition_type="inline",
    )


@router.post("/{filename}/open-native")
async def open_native(filename: str):
    """Ouvre le justificatif dans l'application native (Aperçu macOS)."""
    import subprocess
    filepath = justificatif_service.get_justificatif_path(filename)
    if not filepath:
        raise HTTPException(status_code=404, detail="Justificatif non trouvé")
    try:
        subprocess.Popen(["open", str(filepath)])
        return {"status": "opened"}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible d'ouvrir le fichier")


@router.get("/{filename}/suggestions")
async def get_suggestions(filename: str):
    """Retourne les suggestions d'association pour un justificatif."""
    return justificatif_service.suggest_operations(filename)


@router.post("/associate")
async def associate_justificatif(request: AssociateRequest):
    """Associe un justificatif à une opération."""
    success = justificatif_service.associate(
        request.justificatif_filename,
        request.operation_file,
        request.operation_index,
    )
    if not success:
        raise HTTPException(status_code=400, detail="Échec de l'association")

    # Auto-pointage après association
    try:
        from backend.services import operation_service
        ops = operation_service.load_operations(request.operation_file)
        pointed = operation_service.maybe_auto_lettre(ops)
        if pointed > 0:
            operation_service.save_operations(ops, filename=request.operation_file)
    except Exception:
        pass

    return {"success": True, "message": "Justificatif associé"}


@router.post("/dissociate")
async def dissociate_justificatif(request: DissociateRequest):
    """Dissocie un justificatif d'une opération."""
    # GED V2: capture justificatif filename before dissociation clears the link
    justif_filename_for_ged = None
    try:
        from backend.services import operation_service
        ops = operation_service.load_operations(request.operation_file)
        if 0 <= request.operation_index < len(ops):
            lien = ops[request.operation_index].get("Lien justificatif", "")
            if lien:
                from pathlib import Path as _Path
                justif_filename_for_ged = _Path(lien).name
    except Exception:
        pass

    success = justificatif_service.dissociate(
        request.operation_file,
        request.operation_index,
    )
    if not success:
        raise HTTPException(status_code=400, detail="Échec de la dissociation")

    # GED V2: clear enriched metadata
    if justif_filename_for_ged:
        try:
            from backend.services import ged_service
            ged_service.clear_metadata_on_dissociation(justif_filename_for_ged)
        except Exception:
            pass

    return {"success": True, "message": "Justificatif dissocié"}


@router.post("/{filename}/rename")
async def rename_justificatif(filename: str, body: RenameRequest):
    """Renomme un justificatif. Met à jour PDF, .ocr.json, associations et GED."""
    import re as _re
    if not body.new_filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Le nom doit se terminer par .pdf")
    if _re.search(r'[<>:"/\\|?*]', body.new_filename):
        raise HTTPException(400, "Caractères interdits dans le nom de fichier")
    return justificatif_service.rename_justificatif(filename, body.new_filename)


@router.delete("/{filename}")
async def delete_justificatif(filename: str):
    """Supprime un justificatif."""
    if justificatif_service.delete_justificatif(filename):
        return {"deleted": filename}
    raise HTTPException(status_code=404, detail="Justificatif non trouvé")
