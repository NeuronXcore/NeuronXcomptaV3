"""Router pour les opérations bancaires."""

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional

from backend.services import operation_service, ml_service, rapprochement_service
from backend.models.operation import CategorizeRequest

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
    )


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
    saved = operation_service.save_operations(operations, filename=filename)
    return {"filename": saved, "count": len(operations)}


@router.delete("/{filename}")
async def delete_operations(filename: str):
    """Supprime un fichier d'opérations."""
    success = operation_service.delete_operation_file(filename)
    if not success:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    return {"deleted": filename}


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
        operations = operation_service.load_operations(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    model = ml_service.load_rules_model()
    modified = 0

    for op in operations:
        libelle = op.get("Libellé", "")
        current_cat = op.get("Catégorie", "")

        # Mode "empty_only" : ne remplit que les vides
        if request.mode == "empty_only" and current_cat and current_cat != "Autres":
            continue

        # Nettoyage du libellé
        clean = ml_service.clean_libelle(libelle)

        # Prédiction : d'abord rules, puis sklearn
        predicted = ml_service.predict_category(clean, model)
        if predicted is None:
            predicted = ml_service.predict_category_sklearn(clean)

        if predicted:
            op["Catégorie"] = predicted
            # Sous-catégorie
            sub = ml_service.predict_subcategory(clean, model)
            if sub:
                op["Sous-catégorie"] = sub
            modified += 1

    # Sauvegarder
    operation_service.save_operations(operations, filename=filename)

    return {"filename": filename, "modified": modified, "total": len(operations)}
