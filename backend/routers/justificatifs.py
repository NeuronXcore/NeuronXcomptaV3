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


@router.get("/{filename}/thumbnail")
async def thumbnail_justificatif(filename: str):
    """Sert la thumbnail PNG d'un justificatif en résolvant automatiquement
    sa location (en_attente ou traites). Délègue à ged_service qui génère la
    thumbnail à la volée via pdf2image + cache.

    Créé pour fixer le bug du drawer Rapprochement qui hard-codait le chemin
    `en_attente/` — un justificatif déjà associé et déplacé vers `traites/`
    retournait alors 404 et affichait une page blanche dans la preview.
    """
    filepath = justificatif_service.get_justificatif_path(filename)
    if not filepath:
        raise HTTPException(status_code=404, detail="Justificatif non trouvé")

    # Construire le doc_id relatif (ged_service s'attend à un chemin relatif depuis BASE_DIR)
    from backend.core.config import BASE_DIR
    from backend.services import ged_service
    try:
        doc_id = str(filepath.relative_to(BASE_DIR))
    except ValueError:
        raise HTTPException(status_code=500, detail="Chemin hors du repo")

    thumb_path = ged_service.get_thumbnail_path(doc_id)
    if not thumb_path:
        raise HTTPException(status_code=404, detail="Thumbnail non disponible")
    return FileResponse(thumb_path, media_type="image/png")


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
    # Garde lock : empêche la dissociation d'une op verrouillée
    try:
        from backend.services import operation_service as _op_svc_guard
        _ops_guard = _op_svc_guard.load_operations(request.operation_file)
        if 0 <= request.operation_index < len(_ops_guard) and _ops_guard[request.operation_index].get("locked"):
            raise HTTPException(
                status_code=423,
                detail="Opération verrouillée — déverrouillez avant de dissocier.",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # erreur de chargement → laisser le service gérer

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


@router.post("/scan-rename")
async def scan_rename(
    apply: bool = Query(False, description="Appliquer les renames (défaut: dry-run)"),
    apply_ocr: bool = Query(False, description="Inclure les renames basés sur l'OCR"),
    scope: str = Query("both", description="Dossiers à scanner : en_attente, traites, both"),
):
    """Scanne les justificatifs, plan les renames filename-first, applique si demandé.

    - `scope=both` (défaut) : scanne en_attente/ ET traites/
    - `scope=en_attente` : uniquement les justificatifs non encore associés
    - `scope=traites` : uniquement les justificatifs associés à une opération
    - `apply=false` (défaut) : dry-run, renvoie juste le plan
    - `apply=true` : applique les renames SAFE (parsés depuis le filename)
    - `apply=true&apply_ocr=true` : applique aussi les renames basés sur l'OCR
    """
    from backend.services import rename_service
    from backend.core.config import JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR

    if scope not in ("en_attente", "traites", "both"):
        raise HTTPException(400, f"scope invalide: {scope}")

    # Directories à scanner
    dirs = []
    if scope in ("en_attente", "both"):
        dirs.append(JUSTIFICATIFS_EN_ATTENTE_DIR)
    if scope in ("traites", "both"):
        dirs.append(JUSTIFICATIFS_TRAITES_DIR)

    # Fusion des plans des différents dossiers
    merged = {
        "scanned": 0,
        "already_canonical": 0,
        "to_rename_from_name": [],
        "to_rename_from_ocr": [],
        "skipped_no_ocr": [],
        "skipped_bad_supplier": [],
        "skipped_no_date_amount": [],
    }
    for directory in dirs:
        plan = rename_service.scan_and_plan_renames(directory)
        merged["scanned"] += plan["scanned"]
        merged["already_canonical"] += plan["already_canonical"]
        merged["to_rename_from_name"].extend(plan["to_rename_from_name"])
        merged["to_rename_from_ocr"].extend(plan["to_rename_from_ocr"])
        merged["skipped_no_ocr"].extend(plan["skipped_no_ocr"])
        merged["skipped_bad_supplier"].extend(plan["skipped_bad_supplier"])
        merged["skipped_no_date_amount"].extend(plan["skipped_no_date_amount"])

    response: dict = {
        "scope": scope,
        "scanned": merged["scanned"],
        "already_canonical": merged["already_canonical"],
        "to_rename_safe": merged["to_rename_from_name"],
        "to_rename_ocr": merged["to_rename_from_ocr"],
        "skipped": {
            "no_ocr": merged["skipped_no_ocr"],
            "bad_supplier": merged["skipped_bad_supplier"],
            "no_date_amount": merged["skipped_no_date_amount"],
        },
    }

    if not apply:
        return response

    to_apply: list = list(merged["to_rename_from_name"])
    if apply_ocr:
        to_apply += merged["to_rename_from_ocr"]

    ok_list: list = []
    errors: list = []
    for item in to_apply:
        try:
            result = justificatif_service.rename_justificatif(item["old"], item["new"])
            ok_list.append(result)
        except Exception as e:
            errors.append({"old": item["old"], "new": item["new"], "error": str(e)})
            logger.warning("scan-rename échoué pour %s → %s : %s", item["old"], item["new"], e)

    # Chaînage auto-rapprochement : après les renames, les fichiers sont en
    # nommage canonique → le moteur de scoring v2 matche bien mieux. On lance
    # l'auto-association (≥ 0.80 + match unique) pour fermer le workflow en
    # un seul clic : tous les justifs évidents sont déplacés vers traites/ et
    # associés à leur opération, les autres restent en en_attente/ visibles
    # dans le widget Pipeline.
    auto_assoc_summary: dict = {}
    if ok_list:
        try:
            from backend.services import rapprochement_service
            auto_assoc_summary = rapprochement_service.run_auto_rapprochement()
        except Exception as e:
            logger.warning("auto-rapprochement post-scan-rename échoué : %s", e)
            auto_assoc_summary = {"error": str(e)}

    response["applied"] = {
        "ok": len(ok_list),
        "errors": errors,
        "renamed": ok_list,
        "auto_associated": auto_assoc_summary.get("associations_auto", 0),
        "strong_suggestions": auto_assoc_summary.get("suggestions_fortes", 0),
    }
    return response


@router.get("/scan-links")
async def scan_links():
    """Dry-run : liste les incohérences disque ↔ opérations sans rien modifier.

    Catégories détectées :
    - `duplicates_to_delete_attente` : fichier référencé par une op, présent en
      double dans en_attente/ ET traites/ avec hashes identiques (copie fantôme)
    - `misplaced_to_move_to_traites` : fichier référencé par une op, présent
      uniquement dans en_attente/ (doit être déplacé)
    - `orphans_to_delete_traites` / `orphans_to_move_to_attente` : fichiers
      dans traites/ sans op qui les référence
    - `hash_conflicts` : duplicatas aux hashes différents (skippés à l'apply)
    - `ghost_refs` : liens pointant vers un fichier absent des deux dossiers
    """
    return justificatif_service.scan_link_issues()


@router.post("/repair-links")
async def repair_links():
    """Apply : répare les incohérences détectées par scan-links.

    Skippe systématiquement les conflits de hash (inspection manuelle requise).
    """
    return justificatif_service.apply_link_repair()


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
    """Supprime un justificatif avec nettoyage complet (PDF, OCR, thumbnail, GED, liens ops)."""
    result = justificatif_service.delete_justificatif(filename)
    if result:
        return result
    raise HTTPException(status_code=404, detail="Justificatif non trouvé")
