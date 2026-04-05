"""Router pour les fonctionnalités OCR."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Query

from backend.models.ocr import OCRExtractRequest
from backend.services import ocr_service, justificatif_service
from backend.core.config import (
    JUSTIFICATIFS_TEMP_DIR,
    ALLOWED_JUSTIFICATIF_EXTENSIONS,
    IMAGE_EXTENSIONS,
    ensure_directories,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ocr", tags=["ocr"])


@router.get("/status")
async def get_status():
    """Statut du système OCR."""
    return ocr_service.get_ocr_status()


@router.get("/history")
async def get_history(limit: int = Query(20, ge=1, le=100)):
    """Historique des extractions OCR."""
    return ocr_service.get_extraction_history(limit)


@router.get("/result/{filename}")
async def get_result(filename: str):
    """Résultat OCR caché pour un justificatif."""
    path = justificatif_service.get_justificatif_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    cached = ocr_service.get_cached_result(path)
    if not cached:
        raise HTTPException(status_code=404, detail="Pas de résultat OCR pour ce fichier")
    return cached


@router.post("/extract")
async def extract(request: OCRExtractRequest):
    """Extraction OCR manuelle sur un justificatif existant."""
    path = justificatif_service.get_justificatif_path(request.filename)
    if not path:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    # Supprimer le cache pour forcer re-extraction
    ocr_service.delete_cached_result(path)
    result = ocr_service.extract_from_pdf(path)
    return result


@router.post("/batch-upload")
async def batch_upload(files: List[UploadFile] = File(...)):
    """Upload multiple PDFs, save as justificatifs, run OCR on each."""
    files_data = []
    for upload_file in files:
        if not upload_file.filename:
            continue
        if Path(upload_file.filename).suffix.lower() not in ALLOWED_JUSTIFICATIF_EXTENSIONS:
            continue
        content = await upload_file.read()
        files_data.append((upload_file.filename, content))

    if not files_data:
        raise HTTPException(status_code=400, detail="Aucun fichier valide fourni (PDF, JPG, PNG)")

    # 1. Save all files as justificatifs (en_attente/)
    upload_results = justificatif_service.upload_justificatifs(files_data)

    # 2. Run OCR synchronously on each successful upload
    results = []
    for r in upload_results:
        if not r.get("success") or not r.get("filename"):
            results.append({
                "filename": r.get("filename", ""),
                "original_name": r.get("original_name", ""),
                "success": False,
                "error": r.get("error", "Upload échoué"),
                "ocr_data": None,
            })
            continue

        filename = r["filename"]
        filepath = justificatif_service.get_justificatif_path(filename)

        ocr_data = None
        ocr_success = False
        ocr_error = None

        if filepath:
            try:
                ocr_result = ocr_service.extract_or_cached(filepath)
                if ocr_result and ocr_result.get("status") == "success":
                    ocr_data = ocr_result.get("extracted_data", {})
                    ocr_success = True
                else:
                    ocr_error = "OCR: pas de données extraites"
            except Exception as e:
                logger.warning(f"OCR échoué pour {filename}: {e}")
                ocr_error = str(e)

        results.append({
            "filename": filename,
            "original_name": r.get("original_name", ""),
            "success": True,
            "ocr_success": ocr_success,
            "ocr_data": ocr_data,
            "ocr_error": ocr_error,
        })

        # Hook previsionnel — check document matching
        if ocr_success and filename:
            try:
                from backend.services import previsionnel_service
                previsionnel_service.check_single_document(filename, "justificatif")
            except Exception:
                pass

    return results


@router.post("/extract-upload")
async def extract_upload(file: UploadFile = File(...)):
    """Upload un fichier pour test OCR ad-hoc (non sauvegardé dans justificatifs)."""
    if not file.filename or Path(file.filename).suffix.lower() not in ALLOWED_JUSTIFICATIF_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Formats acceptés : PDF, JPG, PNG")

    content = await file.read()
    if len(content) < 100:
        raise HTTPException(status_code=400, detail="Fichier trop petit")

    # Convertir image → PDF si nécessaire
    ext = Path(file.filename).suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        try:
            content = justificatif_service._convert_image_to_pdf(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Erreur conversion image : {e}")

    ensure_directories()
    temp_path = JUSTIFICATIFS_TEMP_DIR / f"ocr_test_{Path(file.filename).stem}.pdf"

    try:
        with open(temp_path, "wb") as f:
            f.write(content)

        result = ocr_service.extract_from_pdf(temp_path)
        return result
    finally:
        # Nettoyer le fichier temporaire et son cache
        if temp_path.exists():
            temp_path.unlink()
        cache = temp_path.with_suffix(".ocr.json")
        if cache.exists():
            cache.unlink()


@router.delete("/cache/{filename}")
async def delete_cache(filename: str):
    """Supprime le cache OCR pour forcer re-extraction."""
    path = justificatif_service.get_justificatif_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    if ocr_service.delete_cached_result(path):
        return {"deleted": filename}
    raise HTTPException(status_code=404, detail="Pas de cache OCR à supprimer")
