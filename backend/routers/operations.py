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


class CreateEmptyMonthRequest(BaseModel):
    year: int
    month: int  # 1..12


@router.post("/create-empty")
async def create_empty_month(request: CreateEmptyMonthRequest):
    """Crée un fichier d'opérations vide pour un mois donné (saisie manuelle NDF, forfaits, etc.).

    Utile quand aucun relevé PDF n'a été importé pour ce mois mais que l'utilisateur veut
    déjà logger des opérations (typiquement une note de frais CB perso).
    """
    try:
        filename = operation_service.create_empty_file(request.year, request.month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"filename": filename, "year": request.year, "month": request.month}


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

    # Auto-pointage des opérations complètes
    auto_pointed = operation_service.maybe_auto_lettre(operations)

    # GED V2: charger les anciennes opérations AVANT le save pour détecter les changements
    try:
        old_ops = operation_service.load_operations(filename)
    except Exception:
        old_ops = []

    saved = operation_service.save_operations(operations, filename=filename)

    # GED V2: propager les changements de catégorie aux justificatifs liés
    try:
        from backend.services import ged_service
        for idx, op in enumerate(operations):
            if idx < len(old_ops):
                old_cat = old_ops[idx].get("Catégorie", "")
                new_cat = op.get("Catégorie", "")
                if old_cat != new_cat and op.get("Lien justificatif"):
                    ged_service.propagate_category_change(
                        operation_file=filename,
                        operation_index=idx,
                        new_categorie=new_cat,
                        new_sous_categorie=op.get("Sous-catégorie", ""),
                    )
    except Exception:
        pass  # Ne jamais bloquer le save

    return {"filename": saved, "count": len(operations), "auto_pointed": auto_pointed}


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


class CsgSplitUpdate(BaseModel):
    csg_non_deductible: Optional[float] = None


@router.patch("/{filename}/{index}/csg-split")
async def update_csg_split(filename: str, index: int, body: CsgSplitUpdate):
    """
    Stocke (ou efface) la part CSG/CRDS non déductible calculée sur une opération.
    """
    ops = operation_service.load_operations(filename)
    if index < 0 or index >= len(ops):
        raise HTTPException(status_code=404, detail="Opération introuvable")
    if body.csg_non_deductible is None:
        ops[index].pop("csg_non_deductible", None)
    else:
        ops[index]["csg_non_deductible"] = body.csg_non_deductible
    operation_service.save_operations(ops, filename=filename)
    return {"ok": True, "csg_non_deductible": body.csg_non_deductible}


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

    # Déclencher le rapprochement auto en arrière-plan, scopé sur le mois
    # dominant des ops importées (perf : ~0.2s scope mois vs 1-2s global).
    # Permet aux justifs scannés AVANT l'import (en_attente/) de s'auto-associer
    # immédiatement aux nouvelles ops bancaires.
    dominant_year: Optional[int] = None
    dominant_month: Optional[int] = None
    month_counts: dict[str, int] = {}
    for op in operations:
        d = (op.get("Date") or "")
        if len(d) >= 7:
            month_counts[d[:7]] = month_counts.get(d[:7], 0) + 1
    if month_counts:
        dominant_ym = max(month_counts.items(), key=lambda x: x[1])[0]
        try:
            yyyy, mm = dominant_ym.split("-")
            dominant_year = int(yyyy)
            dominant_month = int(mm)
        except (ValueError, IndexError):
            pass
    if dominant_year and dominant_month:
        background_tasks.add_task(
            rapprochement_service.run_auto_rapprochement,
            dominant_year,
            dominant_month,
        )
    else:
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


class LockRequest(BaseModel):
    locked: bool


class BulkLockItem(BaseModel):
    filename: str
    index: int
    locked: bool


class BulkLockRequest(BaseModel):
    items: list[BulkLockItem]


class BulkLockResultItem(BaseModel):
    filename: str
    index: int
    locked: bool
    locked_at: Optional[str] = None
    error: Optional[str] = None


class BulkLockResponse(BaseModel):
    results: list[BulkLockResultItem]
    success_count: int
    error_count: int


@router.patch("/bulk-lock", response_model=BulkLockResponse)
async def bulk_lock(body: BulkLockRequest):
    """Verrouille/déverrouille N opérations en masse, groupées par fichier pour minimiser les I/O."""
    from datetime import datetime
    from itertools import groupby

    now = datetime.now().isoformat(timespec="seconds")
    results: list[BulkLockResultItem] = []

    sorted_items = sorted(body.items, key=lambda i: i.filename)
    for filename, group in groupby(sorted_items, key=lambda i: i.filename):
        group_items = list(group)
        try:
            ops = operation_service.load_operations(filename)
        except FileNotFoundError:
            for it in group_items:
                results.append(BulkLockResultItem(
                    filename=it.filename, index=it.index, locked=it.locked,
                    locked_at=None, error="Fichier non trouvé",
                ))
            continue

        dirty = False
        for it in group_items:
            if not (0 <= it.index < len(ops)):
                results.append(BulkLockResultItem(
                    filename=it.filename, index=it.index, locked=it.locked,
                    locked_at=None, error="Opération introuvable",
                ))
                continue
            op = ops[it.index]
            op["locked"] = it.locked
            op["locked_at"] = now if it.locked else None
            dirty = True
            results.append(BulkLockResultItem(
                filename=it.filename, index=it.index, locked=it.locked,
                locked_at=op["locked_at"], error=None,
            ))

        if dirty:
            operation_service.save_operations(ops, filename=filename)

    success = sum(1 for r in results if r.error is None)
    return BulkLockResponse(
        results=results,
        success_count=success,
        error_count=len(results) - success,
    )


@router.patch("/{filename}/{index}/lock")
async def toggle_lock(filename: str, index: int, body: LockRequest):
    """Verrouille ou déverrouille une opération (protège l'association justificatif contre l'auto-rapprochement)."""
    from datetime import datetime

    try:
        ops = operation_service.load_operations(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    if not (0 <= index < len(ops)):
        raise HTTPException(status_code=404, detail="Opération introuvable")

    op = ops[index]
    op["locked"] = body.locked
    op["locked_at"] = datetime.now().isoformat(timespec="seconds") if body.locked else None
    operation_service.save_operations(ops, filename=filename)
    return {"locked": op["locked"], "locked_at": op.get("locked_at")}
