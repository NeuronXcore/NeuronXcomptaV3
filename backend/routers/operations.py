"""Router pour les opérations bancaires."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from backend.services import operation_service, ml_service, rapprochement_service, ml_monitoring_service
from backend.models.operation import CategorizeRequest


class RenameRequest(BaseModel):
    new_filename: str

router = APIRouter(prefix="/api/operations", tags=["operations"])


@router.get("/files")
async def list_files():
    """Liste tous les fichiers d'opérations disponibles."""
    return operation_service.list_operation_files()


@router.get("/{filename}/has-pdf")
async def has_pdf(filename: str):
    """Vérifie si le PDF source existe pour ce fichier d'opérations."""
    pdf_path = operation_service.get_pdf_path(filename)
    return {
        "has_pdf": pdf_path is not None,
        "pdf_filename": pdf_path.name if pdf_path else None,
    }


@router.get("/{filename}/pdf")
async def get_pdf(filename: str):
    """Sert le PDF source pour preview/téléchargement."""
    pdf_path = operation_service.get_pdf_path(filename)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF source non trouvé")
    return FileResponse(
        str(pdf_path),
        media_type="application/pdf",
        filename=pdf_path.name,
        content_disposition_type="inline",
    )


@router.post("/{filename}/pdf/open-native")
async def open_pdf_native(filename: str):
    """Ouvre le PDF source dans l'application native (Aperçu sur macOS)."""
    import subprocess
    pdf_path = operation_service.get_pdf_path(filename)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF source non trouvé")
    subprocess.Popen(["open", str(pdf_path)])
    return {"status": "opened"}


@router.get("/{filename}")
async def get_operations(filename: str):
    """Charge les opérations d'un fichier."""
    try:
        return operation_service.load_operations(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Fichier {filename} non trouvé")


@router.put("/{filename}")
async def save_operations(filename: str, operations: list[dict]):
    """Sauvegarde les opérations modifiées."""
    # Detect corrections before saving
    try:
        corrections = ml_monitoring_service.detect_corrections(filename, operations)
        if corrections:
            ml_monitoring_service.log_corrections(filename, corrections)
    except Exception:
        pass  # Monitoring failure should not block save

    # Auto-alimentation ML depuis les catégorisations manuelles
    try:
        _EXCLUDED_CATS = {"", "Autres", "Ventilé"}
        learnable = []
        for op in operations:
            cat = (op.get("Catégorie") or "").strip()
            if cat in _EXCLUDED_CATS:
                continue
            raw_libelle = op.get("Libellé", "")
            clean = ml_service.clean_libelle(raw_libelle)
            if not clean:
                continue
            learnable.append({
                "libelle": clean,
                "categorie": cat,
                "sous_categorie": (op.get("Sous-catégorie") or "").strip(),
            })
        if learnable:
            ml_service.add_training_examples_batch(learnable)
            ml_service.update_rules_from_operations(learnable)
    except Exception:
        pass  # Ne jamais bloquer le save

    saved = operation_service.save_operations(operations, filename=filename)
    return {"filename": saved, "count": len(operations)}


@router.delete("/{filename}")
async def delete_operations(filename: str):
    """Supprime un fichier d'opérations."""
    success = operation_service.delete_operation_file(filename)
    if not success:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    return {"deleted": filename}


@router.delete("/pdf/{pdf_filename}")
async def delete_pdf_file(pdf_filename: str):
    """Supprime un PDF source et le JSON d'opérations associé (bidirectionnel)."""
    success = operation_service.delete_pdf_with_json(pdf_filename)
    if not success:
        raise HTTPException(status_code=404, detail="PDF non trouvé")
    return {"deleted": pdf_filename}


@router.patch("/{filename}/rename")
async def rename_operation_file(filename: str, body: RenameRequest):
    """Renomme un fichier d'opérations JSON (et son PDF associé si présent)."""
    return operation_service.rename_file(filename, body.new_filename)


@router.post("/import")
async def import_pdf(file: UploadFile = File(...), background_tasks: BackgroundTasks = BackgroundTasks()):
    """Importe un PDF bancaire : extraction + preview."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Seuls les fichiers PDF sont acceptés")

    pdf_bytes = await file.read()
    if len(pdf_bytes) < 100:
        raise HTTPException(status_code=400, detail="Fichier PDF trop petit ou invalide")

    # Vérifier les doublons
    pdf_hash = operation_service.calculate_pdf_hash(pdf_bytes)
    if operation_service.check_pdf_duplicate(pdf_hash):
        raise HTTPException(status_code=409, detail="Ce PDF a déjà été importé")

    # Extraire les opérations
    operations = operation_service.extract_operations_from_pdf(pdf_bytes)
    if not operations:
        raise HTTPException(status_code=422, detail="Aucune opération trouvée dans le PDF")

    # Sauvegarder
    filename = operation_service.save_operations(
        operations, pdf_bytes=pdf_bytes, pdf_hash=pdf_hash
    )

    # Déclencher le rapprochement auto en arrière-plan
    background_tasks.add_task(rapprochement_service.run_auto_rapprochement)

    return {
        "filename": filename,
        "operations_count": len(operations),
        "pdf_hash": pdf_hash,
        "operations": operations,
    }


@router.post("/{filename}/categorize")
async def categorize_operations(filename: str, request: CategorizeRequest):
    """Auto-catégorise les opérations d'un fichier via IA."""
    try:
        return operation_service.categorize_file(filename, request.mode)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
