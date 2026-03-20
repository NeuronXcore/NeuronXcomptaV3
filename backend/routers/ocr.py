"""Router pour les fonctionnalités OCR."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query

from backend.models.ocr import OCRExtractRequest
from backend.services import ocr_service, justificatif_service
from backend.core.config import JUSTIFICATIFS_TEMP_DIR, ensure_directories

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


@router.post("/extract-upload")
async def extract_upload(file: UploadFile = File(...)):
    """Upload un fichier pour test OCR ad-hoc (non sauvegardé dans justificatifs)."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Seuls les fichiers PDF sont acceptés")

    content = await file.read()
    if len(content) < 100:
        raise HTTPException(status_code=400, detail="Fichier trop petit")

    ensure_directories()
    temp_path = JUSTIFICATIFS_TEMP_DIR / f"ocr_test_{file.filename}"

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
