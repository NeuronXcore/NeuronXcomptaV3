"""
Service pour la gestion des justificatifs comptables.
Upload, galerie, association aux opérations, suggestions automatiques.
"""
from __future__ import annotations

import io
import json
import logging
import re
import shutil
import time as _time
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from PIL import Image

from fastapi import HTTPException

from backend.core.config import (
    BASE_DIR,
    JUSTIFICATIFS_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    ALLOWED_JUSTIFICATIF_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MAGIC_BYTES,
    GED_DIR,
    IMPORTS_OPERATIONS_DIR,
    ensure_directories,
)
from backend.services import operation_service
from backend.services.naming_service import build_convention_filename, deduplicate_filename

logger = logging.getLogger(__name__)


def _format_size(size_bytes: int) -> str:
    """Formate une taille en Ko/Mo."""
    if size_bytes < 1024:
        return f"{size_bytes} o"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.0f} Ko"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} Mo"


def _extract_date_from_filename(filename: str) -> str:
    """Extrait la date ISO depuis le nom de fichier justificatif_YYYYMMDD_*."""
    match = re.search(r"justificatif_(\d{8})_", filename)
    if match:
        raw = match.group(1)
        try:
            dt = datetime.strptime(raw, "%Y%m%d")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Fallback: date de modification du fichier
    return ""


def _extract_original_name(filename: str) -> str:
    """Extrait le nom original depuis justificatif_YYYYMMDD_HHMMSS_originalname.pdf."""
    match = re.match(r"justificatif_\d{8}_\d{6}_(.+)$", filename)
    if match:
        return match.group(1)
    return filename


def _get_justificatif_info(filepath: Path, status: str) -> dict:
    """Construit les métadonnées d'un justificatif."""
    filename = filepath.name
    size = filepath.stat().st_size
    date = _extract_date_from_filename(filename)
    if not date:
        # Fallback: date de modification
        mtime = filepath.stat().st_mtime
        date = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")

    info = {
        "filename": filename,
        "original_name": _extract_original_name(filename),
        "date": date,
        "size": size,
        "size_human": _format_size(size),
        "status": status,
        "linked_operation": None,
    }

    # Si traité, chercher l'opération liée
    if status == "traites":
        linked = _find_linked_operation(filename)
        if linked:
            info["linked_operation"] = linked

    # Ajouter données OCR si disponibles
    try:
        from backend.services import ocr_service
        ocr_summary = ocr_service.get_ocr_summary(filepath)
        info["ocr_data"] = ocr_summary
        if ocr_summary:
            info["ocr_amount"] = ocr_summary.get("best_amount")
            info["ocr_date"] = ocr_summary.get("best_date")
            info["ocr_supplier"] = ocr_summary.get("supplier")
        else:
            info["ocr_amount"] = None
            info["ocr_date"] = None
            info["ocr_supplier"] = None

        # Traçabilité renommage + hints cat/sous-cat (top-level du .ocr.json)
        ocr_cached = ocr_service.get_cached_result(filepath)
        if ocr_cached:
            info["original_filename"] = ocr_cached.get("original_filename") or ocr_cached.get("renamed_from")
            info["auto_renamed"] = bool(ocr_cached.get("renamed_from"))
            info["category_hint"] = ocr_cached.get("category_hint")
            info["sous_categorie_hint"] = ocr_cached.get("sous_categorie_hint")
        else:
            info["original_filename"] = None
            info["auto_renamed"] = False
            info["category_hint"] = None
            info["sous_categorie_hint"] = None
    except Exception:
        info["ocr_data"] = None
        info["ocr_amount"] = None
        info["ocr_date"] = None
        info["ocr_supplier"] = None
        info["original_filename"] = None
        info["auto_renamed"] = False
        info["category_hint"] = None
        info["sous_categorie_hint"] = None

    return info


def _find_linked_operation(justificatif_filename: str) -> Optional[str]:
    """Trouve le libellé de l'opération liée à un justificatif."""
    files = operation_service.list_operation_files()
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            for op in ops:
                lien = op.get("Lien justificatif", "")
                if lien and justificatif_filename in lien:
                    return op.get("Libellé", "Opération inconnue")
        except Exception:
            continue
    return None


def find_operations_by_justificatif(justificatif_filename: str) -> list[dict]:
    """Parcourt tous les fichiers d'opérations pour trouver ceux liés au justificatif."""
    results = []
    basename = justificatif_filename.split("/")[-1]

    for file_info in operation_service.list_operation_files():
        try:
            ops = operation_service.load_operations(file_info["filename"])
        except Exception:
            continue
        for idx, op in enumerate(ops):
            lien = op.get("Lien justificatif", "") or ""
            if lien and lien.split("/")[-1] == basename:
                results.append({
                    "operation_file": file_info["filename"],
                    "operation_index": idx,
                    "date": op.get("Date", ""),
                    "libelle": op.get("Libellé", ""),
                    "debit": op.get("Débit", 0) or 0,
                    "credit": op.get("Crédit", 0) or 0,
                    "categorie": op.get("Catégorie", ""),
                    "sous_categorie": op.get("Sous-catégorie", ""),
                    "ventilation_index": None,
                })
            for vl_idx, vl in enumerate(op.get("ventilation", []) or []):
                vl_lien = vl.get("justificatif", "") or ""
                if vl_lien and vl_lien.split("/")[-1] == basename:
                    results.append({
                        "operation_file": file_info["filename"],
                        "operation_index": idx,
                        "date": op.get("Date", ""),
                        "libelle": vl.get("libelle", op.get("Libellé", "")),
                        "debit": vl.get("montant", 0) if op.get("Débit") else 0,
                        "credit": vl.get("montant", 0) if op.get("Crédit") else 0,
                        "categorie": vl.get("categorie", ""),
                        "sous_categorie": vl.get("sous_categorie", ""),
                        "ventilation_index": vl_idx,
                    })
    return results


# ─── Listing ───

def list_justificatifs(
    status: str = "all",
    search: str = "",
    year: Optional[int] = None,
    month: Optional[int] = None,
    sort_by: str = "date",
    sort_order: str = "desc",
) -> list:
    """Liste tous les justificatifs avec filtres."""
    ensure_directories()
    results = []

    dirs_to_scan = []
    if status in ("all", "en_attente"):
        dirs_to_scan.append(("en_attente", JUSTIFICATIFS_EN_ATTENTE_DIR))
    if status in ("all", "traites"):
        dirs_to_scan.append(("traites", JUSTIFICATIFS_TRAITES_DIR))

    for status_name, dir_path in dirs_to_scan:
        if not dir_path.exists():
            continue
        for filepath in dir_path.glob("*.pdf"):
            info = _get_justificatif_info(filepath, status_name)
            results.append(info)

    # Exclure les justificatifs déjà référencés par une opération (drawer recherche libre)
    if status == "en_attente":
        referenced = get_all_referenced_justificatifs()
        results = [r for r in results if r["filename"] not in referenced]

    # Filtre recherche
    if search:
        q = search.lower()
        results = [r for r in results if q in r["filename"].lower() or q in r["original_name"].lower()]

    # Filtre année
    if year:
        results = [r for r in results if r["date"].startswith(str(year))]

    # Filtre mois
    if month:
        month_str = f"-{month:02d}-"
        results = [r for r in results if month_str in r["date"]]

    # Tri
    reverse = sort_order == "desc"
    if sort_by == "date":
        results.sort(key=lambda r: r["date"], reverse=reverse)
    elif sort_by == "name":
        results.sort(key=lambda r: r["original_name"].lower(), reverse=reverse)
    elif sort_by == "size":
        results.sort(key=lambda r: r["size"], reverse=reverse)

    return results


def get_stats() -> dict:
    """Retourne les statistiques des justificatifs."""
    ensure_directories()
    en_attente = len(list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf")))
    traites = len(list(JUSTIFICATIFS_TRAITES_DIR.glob("*.pdf")))
    return {
        "en_attente": en_attente,
        "traites": traites,
        "total": en_attente + traites,
    }


# ─── Conversion image → PDF ───

def _convert_image_to_pdf(image_bytes: bytes) -> bytes:
    """Convertit des bytes image (JPG/PNG) en bytes PDF via Pillow."""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")
    pdf_buffer = io.BytesIO()
    img.save(pdf_buffer, format="PDF", resolution=150.0)
    return pdf_buffer.getvalue()


# ─── Upload ───

def upload_justificatifs(files_data: list) -> list:
    """
    Upload et sauvegarde plusieurs justificatifs.
    files_data: liste de tuples (original_filename, file_bytes)
    """
    ensure_directories()
    results = []

    for original_filename, file_bytes in files_data:
        try:
            ext = Path(original_filename).suffix.lower()

            # Valider l'extension
            if ext not in ALLOWED_JUSTIFICATIF_EXTENSIONS:
                results.append({
                    "filename": "",
                    "original_name": original_filename,
                    "size": len(file_bytes),
                    "success": False,
                    "error": "Format non supporté. Acceptés : PDF, JPG, PNG",
                })
                continue

            # Valider les magic bytes
            expected_magic = MAGIC_BYTES.get(ext, b"")
            if expected_magic and not file_bytes[:len(expected_magic)] == expected_magic:
                results.append({
                    "filename": "",
                    "original_name": original_filename,
                    "size": len(file_bytes),
                    "success": False,
                    "error": "Le contenu du fichier ne correspond pas à son extension",
                })
                continue

            # Limiter la taille (10 Mo)
            if len(file_bytes) > 10 * 1024 * 1024:
                results.append({
                    "filename": "",
                    "original_name": original_filename,
                    "size": len(file_bytes),
                    "success": False,
                    "error": "Le fichier dépasse 10 Mo",
                })
                continue

            # Convertir image → PDF si nécessaire
            if ext in IMAGE_EXTENSIONS:
                try:
                    file_bytes = _convert_image_to_pdf(file_bytes)
                except Exception as e:
                    results.append({
                        "filename": "",
                        "original_name": original_filename,
                        "size": 0,
                        "success": False,
                        "error": f"Erreur conversion image : {e}",
                    })
                    continue

            # Nettoyer le nom de fichier (stem uniquement, toujours .pdf)
            clean_stem = re.sub(r"[^\w\-]", "_", Path(original_filename).stem)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            new_filename = f"justificatif_{timestamp}_{clean_stem}.pdf"

            filepath = JUSTIFICATIFS_EN_ATTENTE_DIR / new_filename
            with open(filepath, "wb") as f:
                f.write(file_bytes)

            results.append({
                "filename": new_filename,
                "original_name": original_filename,
                "size": len(file_bytes),
                "success": True,
                "error": None,
            })
            logger.info(f"Justificatif uploadé: {new_filename}")

        except Exception as e:
            logger.error(f"Erreur upload {original_filename}: {e}")
            results.append({
                "filename": "",
                "original_name": original_filename,
                "size": 0,
                "success": False,
                "error": str(e),
            })

    return results


# ─── Delete ───

def delete_justificatif(filename: str) -> Optional[dict]:
    """Supprime un justificatif et nettoie toute trace résiduelle :
    PDF, .ocr.json, thumbnail GED, metadata GED, liens opérations (+ ventilations).
    Retourne un dict détaillé ou None si le fichier n'existe pas.
    """
    filepath = get_justificatif_path(filename)
    if not filepath:
        return None

    # 1. Nettoyer les liens dans les opérations (parentes + ventilations)
    ops_unlinked = _clean_operation_link(filename)

    # 2. Supprimer la thumbnail GED
    thumbnail_deleted = False
    try:
        _invalidate_thumbnail_for_path(filepath)
        thumbnail_deleted = True
    except Exception:
        pass

    # 3. Supprimer la metadata GED
    ged_cleaned = False
    try:
        from backend.services import ged_service
        doc_id = str(filepath.relative_to(BASE_DIR))
        ged_service.remove_document(doc_id)
        ged_cleaned = True
    except Exception:
        pass

    # 4. Supprimer le cache OCR associé
    ocr_cache_deleted = False
    try:
        from backend.services import ocr_service
        ocr_service.delete_ocr_cache_for(filepath)
        ocr_cache_deleted = True
    except Exception:
        pass

    # 5. Supprimer le PDF
    filepath.unlink()

    # 6. Invalider le cache des justificatifs référencés
    invalidate_referenced_cache()

    logger.info(f"Justificatif supprimé (full cleanup): {filename}")
    return {
        "deleted": filename,
        "ops_unlinked": ops_unlinked,
        "thumbnail_deleted": thumbnail_deleted,
        "ged_cleaned": ged_cleaned,
        "ocr_cache_deleted": ocr_cache_deleted,
    }


def _clean_operation_link(justificatif_filename: str) -> list:
    """Nettoie le lien justificatif dans les opérations (+ sous-lignes ventilées).
    Retourne la liste des opérations délinkées [{file, libelle, index}]."""
    unlinked: list = []
    files = operation_service.list_operation_files()
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            modified = False
            for i, op in enumerate(ops):
                # Lien parente
                lien = op.get("Lien justificatif", "")
                if lien and justificatif_filename in lien:
                    op["Justificatif"] = False
                    op["Lien justificatif"] = ""
                    modified = True
                    unlinked.append({
                        "file": f["filename"],
                        "libelle": op.get("Libellé", ""),
                        "index": i,
                    })
                # Sous-lignes ventilées
                for vl in op.get("ventilation", []):
                    vl_justif = vl.get("justificatif", "")
                    if vl_justif and justificatif_filename in vl_justif:
                        vl["justificatif"] = ""
                        modified = True
                        if not any(u["file"] == f["filename"] and u["index"] == i for u in unlinked):
                            unlinked.append({
                                "file": f["filename"],
                                "libelle": op.get("Libellé", ""),
                                "index": i,
                            })
            if modified:
                operation_service.save_operations(ops, filename=f["filename"])
                logger.info(f"Lien justificatif nettoyé dans {f['filename']}")
        except Exception as e:
            logger.warning(f"Erreur nettoyage lien dans {f['filename']}: {e}")
    return unlinked


# ─── Path resolution ───

def get_justificatif_path(filename: str) -> Optional[Path]:
    """Résout le chemin d'un justificatif dans en_attente ou traites."""
    for dir_path in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        filepath = dir_path / filename
        if filepath.exists():
            return filepath
    return None


# ─── Thumbnail invalidation ───

def _invalidate_thumbnail_for_path(abs_path: Path) -> None:
    """Supprime la thumbnail GED associée au chemin absolu d'un justificatif.

    À appeler AVANT toute opération qui change le doc_id (rename, move
    en_attente↔traites) : la vignette est clé-hashée sur le doc_id (chemin
    relatif depuis BASE_DIR), donc un changement de chemin laisse l'ancienne
    vignette orpheline dans `data/ged/thumbnails/`.
    """
    try:
        doc_id = str(abs_path.relative_to(BASE_DIR))
    except ValueError:
        return
    try:
        from backend.services import ged_service
        ged_service.delete_thumbnail_for_doc_id(doc_id)
    except Exception as e:
        logger.warning("Erreur invalidation thumbnail pour %s: %s", abs_path.name, e)


# ─── Association ───

def associate(justificatif_filename: str, operation_file: str, operation_index: int) -> bool:
    """Associe un justificatif à une opération."""
    # 1. Vérifier que le justificatif existe en attente
    src = JUSTIFICATIFS_EN_ATTENTE_DIR / justificatif_filename
    if not src.exists():
        # Peut-être déjà traité
        src = JUSTIFICATIFS_TRAITES_DIR / justificatif_filename
        if not src.exists():
            logger.error(f"Justificatif non trouvé: {justificatif_filename}")
            return False

    # 2. Déplacer vers traités (PDF + cache OCR)
    dst = JUSTIFICATIFS_TRAITES_DIR / justificatif_filename
    if src != dst:
        _invalidate_thumbnail_for_path(src)
        shutil.move(str(src), str(dst))
        try:
            from backend.services import ocr_service
            ocr_service.move_ocr_cache(src.parent, dst.parent, justificatif_filename)
        except Exception:
            pass
        _update_ged_metadata_location(justificatif_filename, "traites")

    # 3. Mettre à jour l'opération
    try:
        ops = operation_service.load_operations(operation_file)
        if 0 <= operation_index < len(ops):
            ops[operation_index]["Justificatif"] = True
            ops[operation_index]["Lien justificatif"] = f"traites/{justificatif_filename}"
            operation_service.save_operations(ops, filename=operation_file)
            logger.info(f"Association: {justificatif_filename} → {operation_file}[{operation_index}]")

            # 3b. Auto-hint cat/sous-cat dans le .ocr.json à partir de l'opération associée.
            # Écrit UNIQUEMENT si l'op a une catégorie exploitable (pas vide, pas Autres,
            # pas Ventilé). Ne jamais bloquer l'association en cas d'erreur.
            try:
                _EXCLUDED = {"", "Autres", "Ventilé"}
                op = ops[operation_index]
                cat = (op.get("Catégorie") or "").strip()
                subcat = (op.get("Sous-catégorie") or "").strip()
                if cat and cat not in _EXCLUDED:
                    from backend.services import ocr_service
                    ocr_service.update_extracted_data(
                        justificatif_filename,
                        {
                            "category_hint": cat,
                            "sous_categorie_hint": subcat,
                        },
                    )
                    logger.info(
                        f"Auto-hint: {justificatif_filename} ← {cat}/{subcat}"
                    )
            except Exception as e:
                logger.warning(f"Auto-hint échoué pour {justificatif_filename}: {e}")

            invalidate_referenced_cache()
            return True
        else:
            logger.error(f"Index opération invalide: {operation_index}")
            return False
    except Exception as e:
        logger.error(f"Erreur association: {e}")
        # Rollback: remettre en attente
        if dst.exists() and src != dst:
            shutil.move(str(dst), str(src))
        return False


def dissociate(operation_file: str, operation_index: int) -> bool:
    """Dissocie un justificatif d'une opération."""
    try:
        ops = operation_service.load_operations(operation_file)
        if not (0 <= operation_index < len(ops)):
            return False

        op = ops[operation_index]
        lien = op.get("Lien justificatif", "")
        if not lien:
            return False

        # Extraire le nom de fichier du lien
        justificatif_filename = Path(lien).name

        # Déplacer vers en_attente (PDF + cache OCR)
        src = JUSTIFICATIFS_TRAITES_DIR / justificatif_filename
        dst = JUSTIFICATIFS_EN_ATTENTE_DIR / justificatif_filename
        if src.exists():
            _invalidate_thumbnail_for_path(src)
            shutil.move(str(src), str(dst))
            try:
                from backend.services import ocr_service
                ocr_service.move_ocr_cache(src.parent, dst.parent, justificatif_filename)
            except Exception:
                pass
            _update_ged_metadata_location(justificatif_filename, "en_attente")

        # Mettre à jour l'opération
        op["Justificatif"] = False
        op["Lien justificatif"] = ""
        operation_service.save_operations(ops, filename=operation_file)
        logger.info(f"Dissociation: {justificatif_filename} ← {operation_file}[{operation_index}]")

        # Effacer les category hints pour ne pas biaiser les futurs rapprochements
        try:
            from backend.services import ocr_service
            ocr_service.update_extracted_data(
                justificatif_filename,
                {"category_hint": None, "sous_categorie_hint": None},
            )
        except Exception:
            pass  # hints non critiques
        invalidate_referenced_cache()
        return True

    except Exception as e:
        logger.error(f"Erreur dissociation: {e}")
        return False


# ─── Suggestions ───

def suggest_operations(justificatif_filename: str, max_results: int = 5) -> list:
    """Suggère des opérations à associer basé sur la date, le montant et l'OCR."""
    # 1. Données depuis le filename
    just_date_str = _extract_date_from_filename(justificatif_filename)
    just_amount = _extract_amount_from_filename(justificatif_filename)
    just_supplier = None

    # 2. Enrichir avec l'OCR si disponible
    try:
        from backend.services import ocr_service
        filepath = get_justificatif_path(justificatif_filename)
        if filepath:
            ocr_data = ocr_service.get_cached_result(filepath)
            if ocr_data and ocr_data.get("status") == "success":
                ed = ocr_data.get("extracted_data", {})
                # OCR date prend priorité sur filename date
                if ed.get("best_date"):
                    just_date_str = ed["best_date"]
                # OCR montant prend priorité sur filename montant
                if ed.get("best_amount") and ed["best_amount"] > 0:
                    just_amount = ed["best_amount"]
                # Fournisseur OCR
                if ed.get("supplier"):
                    just_supplier = ed["supplier"].lower()
    except Exception:
        pass

    just_date = None
    if just_date_str:
        try:
            just_date = datetime.strptime(just_date_str, "%Y-%m-%d")
        except ValueError:
            pass

    # Scanner toutes les opérations
    suggestions = []
    files = operation_service.list_operation_files()

    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            for idx, op in enumerate(ops):
                # Ignorer les opérations déjà liées
                lien_op = (op.get("Lien justificatif") or "").strip()
                if lien_op and Path(lien_op).name != justificatif_filename:
                    # Op liée à un AUTRE justificatif → skip
                    continue
                if op.get("Justificatif") and not lien_op:
                    # Marquée justifiée sans lien (ex: perso) → skip
                    continue

                score = 0.0
                details = []

                # Poids : 0.5 date, 0.3 montant, 0.2 fournisseur
                # Score de proximité de date
                if just_date:
                    op_date_str = op.get("Date", "")
                    try:
                        op_date = datetime.strptime(op_date_str[:10], "%Y-%m-%d")
                        days_diff = abs((just_date - op_date).days)
                        date_score = max(0.0, 1.0 - days_diff / 30.0)
                        score += 0.5 * date_score
                        if days_diff == 0:
                            details.append("Même jour")
                        else:
                            details.append(f"{days_diff}j d'écart")
                    except (ValueError, TypeError):
                        pass

                # Score de correspondance de montant
                if just_amount and just_amount > 0:
                    op_debit = float(op.get("Débit", 0) or 0)
                    op_credit = float(op.get("Crédit", 0) or 0)
                    op_amount = op_debit if op_debit > 0 else op_credit

                    if op_amount > 0:
                        ratio = min(just_amount, op_amount) / max(just_amount, op_amount)
                        if ratio > 0.95:
                            score += 0.3 * 1.0
                            details.append("Montant exact")
                        elif ratio > 0.85:
                            score += 0.3 * 0.5
                            details.append("Montant proche")

                # Score de correspondance fournisseur (OCR)
                if just_supplier:
                    libelle = op.get("Libellé", "").lower()
                    supplier_words = [w for w in just_supplier.split() if len(w) > 3]
                    if supplier_words:
                        matches = sum(1 for w in supplier_words if w in libelle)
                        if matches > 0:
                            supplier_score = min(1.0, matches / len(supplier_words))
                            score += 0.2 * supplier_score
                            if supplier_score >= 0.8:
                                details.append("Fournisseur OCR")
                            else:
                                details.append("Fournisseur partiel")

                if score > 0.1:
                    suggestions.append({
                        "operation_file": f["filename"],
                        "operation_index": idx,
                        "date": op.get("Date", "")[:10],
                        "libelle": op.get("Libellé", ""),
                        "debit": float(op.get("Débit", 0) or 0),
                        "credit": float(op.get("Crédit", 0) or 0),
                        "categorie": op.get("Catégorie"),
                        "score": round(score, 2),
                        "score_detail": ", ".join(details) if details else "Correspondance faible",
                    })

        except Exception:
            continue

    # Trier par score décroissant et limiter
    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return suggestions[:max_results]


def _extract_amount_from_filename(filename: str) -> Optional[float]:
    """Tente d'extraire un montant depuis le nom de fichier."""
    # Patterns: 245.00, 245,00, 245_00, 1234.56
    patterns = [
        r"(\d+)[.,_](\d{2})(?:€|e|eur)?",  # 245.00 ou 245,00
        r"(\d+)(?:€|e|eur)",  # 245€
    ]
    clean = filename.lower().replace("justificatif_", "")
    for pattern in patterns:
        match = re.search(pattern, clean)
        if match:
            groups = match.groups()
            if len(groups) == 2:
                return float(f"{groups[0]}.{groups[1]}")
            elif len(groups) == 1:
                return float(groups[0])
    return None


# ─── Renommage ───


def rename_justificatif(old_filename: str, new_filename: str) -> dict:
    """Renomme un justificatif (PDF + .ocr.json) dans en_attente/ ou traites/.

    Met à jour :
    1. Le fichier PDF
    2. Le .ocr.json associé (+ champ renamed_from pour traçabilité)
    3. Les associations dans les fichiers d'opérations (Lien justificatif + ventilation)
    4. Les metadata GED si existantes

    Retourne {"old": old_filename, "new": final_filename, "location": "en_attente"|"traites"}
    Raise HTTPException 404 si fichier introuvable, 409 si new_filename existe déjà.
    """
    # 1. Idempotence : rename vers soi-même = no-op
    src_path = get_justificatif_path(old_filename)
    if src_path is None:
        raise HTTPException(404, f"Justificatif {old_filename} introuvable")
    location = "en_attente" if src_path.parent == JUSTIFICATIFS_EN_ATTENTE_DIR else "traites"

    if new_filename == old_filename:
        return {"old": old_filename, "new": old_filename, "location": location}

    pdf_path = src_path
    target_dir = pdf_path.parent

    # 2. Collision cross-location (en_attente OU traites)
    existing_target = get_justificatif_path(new_filename)
    if existing_target is not None and existing_target != src_path:
        try:
            same_hash = _md5_file(src_path) == _md5_file(existing_target)
        except Exception:
            same_hash = False

        existing_location = (
            "en_attente"
            if existing_target.parent == JUSTIFICATIFS_EN_ATTENTE_DIR
            else "traites"
        )

        if same_hash:
            # Cas A : doublon strict → supprime la source + son .ocr.json + thumbnail
            try:
                _invalidate_thumbnail_for_path(src_path)
                old_ocr = src_path.with_name(Path(old_filename).with_suffix(".ocr.json").name)
                if old_ocr.exists():
                    old_ocr.unlink()
                src_path.unlink()
            except Exception as e:
                logger.warning("Erreur suppression doublon %s: %s", old_filename, e)
            invalidate_referenced_cache()
            logger.info(
                "Rename dédupliqué (même hash) : %s supprimé, %s conservé",
                old_filename, new_filename,
            )
            return {
                "old": old_filename,
                "new": new_filename,
                "location": existing_location,
                "status": "deduplicated",
            }

        # Cas B : hash différent → 409 avec structure typée
        # Suggestion cross-location : incrémente tant que le nom existe dans l'un des 2 dossiers
        try:
            stem = Path(new_filename).stem
            ext = Path(new_filename).suffix or ".pdf"
            suggestion = new_filename
            counter = 2
            while get_justificatif_path(suggestion) is not None:
                suggestion = f"{stem}_{counter}{ext}"
                counter += 1
                if counter > 99:
                    break
        except Exception:
            suggestion = new_filename

        raise HTTPException(
            status_code=409,
            detail={
                "error": "rename_collision",
                "message": f"Un fichier '{new_filename}' existe déjà avec un contenu différent.",
                "existing_location": existing_location,
                "suggestion": suggestion,
            },
        )

    # 3. Renommer PDF (invalider la thumbnail AVANT pour capturer l'ancien doc_id)
    new_pdf_path = target_dir / new_filename
    _invalidate_thumbnail_for_path(pdf_path)
    pdf_path.rename(new_pdf_path)

    # 4. Renommer + mettre à jour .ocr.json
    # IMPORTANT : str.replace remplace TOUTES les occurrences de `.pdf`, ce qui
    # casse les noms historiques à double extension (`udemy_*.pdf.pdf`). On utilise
    # `with_suffix` qui ne remplace QUE le dernier suffix.
    old_ocr = pdf_path.with_name(Path(old_filename).with_suffix(".ocr.json").name)
    if old_ocr.exists():
        new_ocr = new_pdf_path.with_name(Path(new_filename).with_suffix(".ocr.json").name)
        try:
            ocr_data = json.loads(old_ocr.read_text(encoding="utf-8"))
            ocr_data["renamed_from"] = old_filename
            ocr_data["original_filename"] = ocr_data.get("original_filename", old_filename)
            ocr_data["filename"] = new_filename
            new_ocr.write_text(json.dumps(ocr_data, ensure_ascii=False, indent=2), encoding="utf-8")
            if old_ocr != new_ocr:
                old_ocr.unlink()
        except Exception as e:
            logger.warning("Erreur rename .ocr.json pour %s: %s", old_filename, e)

    # 5. Mettre à jour les associations opérations
    _update_operation_references(old_filename, new_filename)

    # 6. Mettre à jour GED metadata
    _update_ged_metadata_reference(old_filename, new_filename)

    logger.info("Justificatif renommé: %s → %s (%s)", old_filename, new_filename, location)
    invalidate_referenced_cache()
    return {"old": old_filename, "new": new_filename, "location": location}


def auto_rename_from_ocr(filename: str, ocr_data: dict) -> Optional[str]:
    """Tente un auto-rename en stratégie filename-first (fallback OCR).

    Retourne le nouveau filename si renommé, None sinon.

    La logique vit dans `rename_service.compute_canonical_name` :
      1. Si le filename est déjà canonique, on ne touche à rien
      2. Sinon, on tente de le parser (source prioritaire, plus fiable que l'OCR)
      3. Sinon, fallback sur les données OCR (si supplier non suspect + date + montant)
    """
    from backend.services import rename_service

    # Localiser le répertoire source (en_attente ou traites)
    en_attente = JUSTIFICATIFS_EN_ATTENTE_DIR / filename
    traites = JUSTIFICATIFS_TRAITES_DIR / filename
    if en_attente.exists():
        source_dir = en_attente.parent
    elif traites.exists():
        source_dir = traites.parent
    else:
        return None

    result = rename_service.compute_canonical_name(
        filename, ocr_data=ocr_data, source_dir=source_dir
    )
    if not result:
        return None
    new_name, _source = result
    if new_name == filename:
        return None

    try:
        return rename_justificatif(filename, new_name)["new"]
    except Exception as e:
        logger.warning("Auto-rename échoué pour %s: %s", filename, e)
        return None


def _update_operation_references(old_filename: str, new_filename: str) -> None:
    """Parcourt tous les fichiers d'opérations et remplace les références au justificatif."""
    for ops_file in IMPORTS_OPERATIONS_DIR.glob("operations_*.json"):
        try:
            data = json.loads(ops_file.read_text(encoding="utf-8"))
        except Exception:
            continue

        modified = False
        for op in data:
            # Lien justificatif principal (format "traites/xxx.pdf" ou "en_attente/xxx.pdf")
            lien = op.get("Lien justificatif", "") or ""
            if lien and lien.split("/")[-1] == old_filename:
                parent = lien.rsplit("/", 1)[0] if "/" in lien else ""
                op["Lien justificatif"] = f"{parent}/{new_filename}" if parent else new_filename
                modified = True

            # Champ justificatif_file direct
            if op.get("justificatif_file") == old_filename:
                op["justificatif_file"] = new_filename
                modified = True

            # Ventilation entries
            for vl in op.get("ventilation", []) or []:
                vl_lien = vl.get("justificatif", "") or ""
                if vl_lien and vl_lien.split("/")[-1] == old_filename:
                    parent = vl_lien.rsplit("/", 1)[0] if "/" in vl_lien else ""
                    vl["justificatif"] = f"{parent}/{new_filename}" if parent else new_filename
                    modified = True
                if vl.get("justificatif_file") == old_filename:
                    vl["justificatif_file"] = new_filename
                    modified = True

        if modified:
            ops_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _update_ged_metadata_location(filename: str, new_location: str) -> None:
    """Met à jour ged_metadata.json quand un justificatif change de dossier
    (associate: en_attente → traites, dissociate: traites → en_attente).

    Met à jour : la clé du dict, le champ interne `doc_id`, et `ocr_file`.
    `new_location` doit être "en_attente" ou "traites".
    """
    ged_path = Path(GED_DIR) / "ged_metadata.json"
    if not ged_path.exists():
        return
    if new_location not in ("en_attente", "traites"):
        return

    try:
        metadata = json.loads(ged_path.read_text(encoding="utf-8"))
    except Exception:
        return

    documents = metadata.get("documents", {})
    basename = Path(filename).name
    key_to_update = None

    for key, doc in documents.items():
        if doc.get("type") != "justificatif":
            continue
        if Path(key).name == basename:
            key_to_update = key
            break

    if not key_to_update:
        return

    new_key = f"data/justificatifs/{new_location}/{basename}"
    if new_key == key_to_update:
        return

    doc = documents.pop(key_to_update)
    doc["doc_id"] = new_key
    doc["statut_justificatif"] = "traite" if new_location == "traites" else "en_attente"
    if doc.get("ocr_file"):
        # Utiliser with_suffix pour ne remplacer QUE le dernier `.pdf`
        ocr_basename = Path(basename).with_suffix(".ocr.json").name
        doc["ocr_file"] = f"data/justificatifs/{new_location}/{ocr_basename}"
    documents[new_key] = doc

    metadata["documents"] = documents
    ged_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


def _update_ged_metadata_reference(old_filename: str, new_filename: str) -> None:
    """Met à jour ged_metadata.json si le justificatif y est référencé."""
    ged_path = Path(GED_DIR) / "ged_metadata.json"
    if not ged_path.exists():
        return

    try:
        metadata = json.loads(ged_path.read_text(encoding="utf-8"))
    except Exception:
        return

    documents = metadata.get("documents", {})
    old_basename = Path(old_filename).name
    doc_id_to_rename = None

    for doc_id, doc in documents.items():
        if doc.get("type") != "justificatif":
            continue
        if Path(doc_id).name == old_basename or (doc.get("original_name") or "") == old_basename:
            doc_id_to_rename = doc_id
            break

    if not doc_id_to_rename:
        return

    doc = documents.pop(doc_id_to_rename)
    # Reconstruire la clé avec le nouveau filename
    new_doc_id = doc_id_to_rename.replace(old_basename, new_filename)
    doc["doc_id"] = new_doc_id  # Sinon get_documents() renvoie l'ancien chemin → URL thumbnail/preview 404
    doc["filename"] = new_filename
    if "renamed_from" not in doc:
        doc["renamed_from"] = old_filename
    documents[new_doc_id] = doc

    metadata["documents"] = documents
    ged_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


# ─── Link integrity scan & repair ───

def _md5_file(path: Path, block_size: int = 65536) -> str:
    """Calcule le hash MD5 d'un fichier en streamant par blocs."""
    import hashlib
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(block_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _collect_referenced_justificatifs() -> dict:
    """Parcourt tous les fichiers d'opérations et retourne
    {filename: [(op_file, op_index), ...]} des justificatifs référencés."""
    referenced: dict = {}
    for fp in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"scan_link_issues: impossible de lire {fp.name}: {e}")
            continue
        ops = data.get("operations", data) if isinstance(data, dict) else data
        if not isinstance(ops, list):
            continue
        for i, op in enumerate(ops):
            lien = (op.get("Lien justificatif") or "").strip()
            if lien:
                fname = Path(lien).name
                referenced.setdefault(fname, []).append((fp.name, i))

            # Sous-lignes ventilées
            for vl in op.get("ventilation", []):
                vl_justif = (vl.get("justificatif") or "").strip()
                if vl_justif:
                    referenced.setdefault(vl_justif, []).append((fp.name, i))
    return referenced


_REF_CACHE: Optional[tuple] = None  # (timestamp, set[str])
_REF_CACHE_TTL: float = 5.0  # secondes


def get_all_referenced_justificatifs() -> set:
    """Version publique avec cache TTL 5s pour éviter de re-scanner à chaque requête.
    Retourne un set[str] de noms de fichiers justificatifs référencés.
    Invalider via invalidate_referenced_cache() après toute mutation."""
    global _REF_CACHE
    now = _time.time()
    if _REF_CACHE is not None and now - _REF_CACHE[0] < _REF_CACHE_TTL:
        return _REF_CACHE[1]
    result = set(_collect_referenced_justificatifs().keys())
    _REF_CACHE = (now, result)
    return result


def invalidate_referenced_cache() -> None:
    """Invalider le cache après associate / dissociate / rename / repair."""
    global _REF_CACHE
    _REF_CACHE = None


def scan_link_issues() -> dict:
    """Scanne les justificatifs à la recherche d'incohérences disque ↔ op.

    Retourne une structure typée utilisable en dry-run pour l'UI :
    - duplicates_to_delete_attente : fichier en double, référencé par une op,
      hash identique dans les 2 dossiers → la copie de en_attente/ est fantôme.
    - misplaced_to_move_to_traites : fichier référencé par une op, présent
      uniquement dans en_attente/ → déplacer vers traites/.
    - orphans_to_delete_traites : fichier dans traites/ sans op qui le référence,
      mais duplicate identique présent en en_attente/ → supprimer la copie traites/.
    - orphans_to_move_to_attente : fichier dans traites/ sans op qui le référence
      et pas de duplicate en en_attente/ → déplacer vers en_attente/ pour
      qu'il redevienne attribuable.
    - hash_conflicts : fichiers en double mais hashes différents → skip
      (inspection manuelle requise).
    - ghost_refs : op dont le Lien justificatif pointe vers un fichier absent
      des deux dossiers → le lien doit être vidé.
    """
    referenced = _collect_referenced_justificatifs()
    traites_pdfs = {p.name for p in JUSTIFICATIFS_TRAITES_DIR.glob("*.pdf")}
    attente_pdfs = {p.name for p in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf")}

    duplicates_to_delete_attente: list[dict] = []
    misplaced_to_move_to_traites: list[dict] = []
    orphans_to_delete_traites: list[dict] = []
    orphans_to_move_to_attente: list[dict] = []
    hash_conflicts: list[dict] = []
    ghost_refs: list[dict] = []

    # A : fichiers référencés par une op, présents dans en_attente/
    for name in sorted(attente_pdfs & set(referenced.keys())):
        src = JUSTIFICATIFS_EN_ATTENTE_DIR / name
        dst = JUSTIFICATIFS_TRAITES_DIR / name
        refs_count = len(referenced[name])
        if dst.exists():
            # Duplicate : comparer les hashes
            try:
                h_src = _md5_file(src)
                h_dst = _md5_file(dst)
            except Exception as e:
                logger.warning(f"scan_link_issues: hash failed pour {name}: {e}")
                continue
            if h_src == h_dst:
                duplicates_to_delete_attente.append(
                    {"name": name, "refs": refs_count, "hash": h_src}
                )
            else:
                hash_conflicts.append(
                    {
                        "name": name,
                        "hash_attente": h_src,
                        "hash_traites": h_dst,
                        "location": "both",
                        "refs": refs_count,
                    }
                )
        else:
            misplaced_to_move_to_traites.append(
                {"name": name, "refs": refs_count}
            )

    # B : fichiers dans traites/ sans op qui les référence
    for name in sorted(traites_pdfs - set(referenced.keys())):
        src = JUSTIFICATIFS_TRAITES_DIR / name
        dst = JUSTIFICATIFS_EN_ATTENTE_DIR / name
        if dst.exists():
            try:
                h_src = _md5_file(src)
                h_dst = _md5_file(dst)
            except Exception as e:
                logger.warning(f"scan_link_issues: hash failed pour {name}: {e}")
                continue
            if h_src == h_dst:
                orphans_to_delete_traites.append({"name": name, "hash": h_src})
            else:
                hash_conflicts.append(
                    {
                        "name": name,
                        "hash_attente": h_dst,
                        "hash_traites": h_src,
                        "location": "both",
                        "refs": 0,
                    }
                )
        else:
            orphans_to_move_to_attente.append({"name": name})

    # C : ghosts — op référence un fichier absent des deux dossiers
    on_disk = traites_pdfs | attente_pdfs
    for name in sorted(set(referenced.keys()) - on_disk):
        for op_file, op_idx in referenced[name]:
            ghost_refs.append({"name": name, "op_file": op_file, "op_idx": op_idx})

    # D : reconnect ventilation — orphans traites/ dont le filename canonique
    # (supplier_YYYYMMDD_montant.pdf) matche une sous-ligne ventilée vide
    # d'une op au même montant/date. Cas post-split/merge où les refs vl ont
    # été perdues mais le PDF est resté en traites/.
    reconnectable_ventilation: list[dict] = []
    if orphans_to_move_to_attente:
        orphan_names = [item["name"] for item in orphans_to_move_to_attente]
        reconnectable_ventilation = _detect_ventilation_reconnects(orphan_names)
        # Retirer les orphans reconnectés du bucket "move to attente"
        reconnected_names = {r["name"] for r in reconnectable_ventilation}
        orphans_to_move_to_attente = [
            item for item in orphans_to_move_to_attente
            if item["name"] not in reconnected_names
        ]

    return {
        "scanned": {
            "traites": len(traites_pdfs),
            "attente": len(attente_pdfs),
            "op_refs": sum(len(v) for v in referenced.values()),
        },
        "duplicates_to_delete_attente": duplicates_to_delete_attente,
        "misplaced_to_move_to_traites": misplaced_to_move_to_traites,
        "orphans_to_delete_traites": orphans_to_delete_traites,
        "orphans_to_move_to_attente": orphans_to_move_to_attente,
        "reconnectable_ventilation": reconnectable_ventilation,
        "hash_conflicts": hash_conflicts,
        "ghost_refs": ghost_refs,
    }


def _detect_ventilation_reconnects(orphan_names: list) -> list:
    """Pour chaque orphan en traites/, essaie de matcher le filename canonique
    à une sous-ligne ventilée vide (même montant ±0.01€, même date).

    Retourne [{name, op_file, op_index, ventilation_index, montant, date}]
    pour les matches uniques (pas d'ambiguïté multi-sous-lignes).
    """
    try:
        from backend.services import rename_service
    except Exception:
        return []

    # Parser tous les filenames en premier (cache)
    parsed: dict = {}
    for name in orphan_names:
        try:
            result = rename_service.try_parse_filename(name)
        except Exception:
            continue
        if not result:
            continue
        supplier, ymd, amount, _suffix = result
        # YYYYMMDD → YYYY-MM-DD
        if len(ymd) != 8:
            continue
        iso_date = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"
        parsed[name] = {"supplier": supplier, "date": iso_date, "amount": float(amount)}
    if not parsed:
        return []

    # Pré-calculer les candidats par (date, montant-rounded)
    candidates: list = []
    for fp in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        ops = data.get("operations", data) if isinstance(data, dict) else data
        if not isinstance(ops, list):
            continue
        for op_idx, op in enumerate(ops):
            op_date = (op.get("Date") or "")[:10]
            if not op_date:
                continue
            vlines = op.get("ventilation", []) or []
            for vl_idx, vl in enumerate(vlines):
                if (vl.get("justificatif") or "").strip():
                    continue  # slot déjà occupé
                try:
                    vl_amount = float(vl.get("montant") or 0)
                except (TypeError, ValueError):
                    continue
                if vl_amount <= 0:
                    continue
                candidates.append({
                    "op_file": fp.name,
                    "op_index": op_idx,
                    "ventilation_index": vl_idx,
                    "date": op_date,
                    "amount": vl_amount,
                })

    # Matcher chaque orphan à 1 candidat unique
    reconnects: list = []
    for name, info in parsed.items():
        matches = [
            c for c in candidates
            if c["date"] == info["date"]
            and abs(c["amount"] - info["amount"]) <= 0.01
        ]
        if len(matches) != 1:
            continue  # skip si ambigu ou aucun match
        m = matches[0]
        reconnects.append({
            "name": name,
            "op_file": m["op_file"],
            "op_index": m["op_index"],
            "ventilation_index": m["ventilation_index"],
            "montant": m["amount"],
            "date": m["date"],
            "supplier": info["supplier"],
        })
    return reconnects


def _move_pdf_with_ocr(src: Path, dst: Path) -> None:
    """Déplace un PDF + son .ocr.json compagnon. dst.parent doit exister."""
    _invalidate_thumbnail_for_path(src)
    shutil.move(str(src), str(dst))
    src_ocr = src.with_suffix(".ocr.json")
    if src_ocr.exists():
        shutil.move(str(src_ocr), str(dst.with_suffix(".ocr.json")))


def _delete_pdf_with_ocr(path: Path) -> None:
    """Supprime un PDF + son .ocr.json compagnon (et sa thumbnail GED)."""
    _invalidate_thumbnail_for_path(path)
    if path.exists():
        path.unlink()
    ocr = path.with_suffix(".ocr.json")
    if ocr.exists():
        ocr.unlink()


def apply_link_repair(plan: Optional[dict] = None) -> dict:
    """Applique un plan de réparation. Si `plan=None`, re-scanne juste avant.

    Skippe systématiquement les `hash_conflicts` (inspection manuelle requise).
    Les autres incohérences sont réparées dans l'ordre :
      1. duplicates_to_delete_attente → unlink
      2. misplaced_to_move_to_traites → shutil.move
      3. orphans_to_delete_traites → unlink
      4. orphans_to_move_to_attente → shutil.move
      5. ghost_refs → Justificatif=false + Lien justificatif=""
    """
    if plan is None:
        plan = scan_link_issues()

    result = {
        "deleted_from_attente": 0,
        "moved_to_traites": 0,
        "deleted_from_traites": 0,
        "moved_to_attente": 0,
        "ventilation_reconnected": 0,
        "ghost_refs_cleared": 0,
        "conflicts_skipped": len(plan.get("hash_conflicts", [])),
        "errors": [],
    }

    # 1. Duplicates en_attente (hash identique au canonique dans traites/)
    for item in plan.get("duplicates_to_delete_attente", []):
        name = item["name"]
        try:
            _delete_pdf_with_ocr(JUSTIFICATIFS_EN_ATTENTE_DIR / name)
            result["deleted_from_attente"] += 1
        except Exception as e:
            result["errors"].append(f"delete en_attente/{name}: {e}")
            logger.warning(f"apply_link_repair: delete en_attente/{name} failed: {e}")

    # 2. Misplaced (en_attente → traites)
    for item in plan.get("misplaced_to_move_to_traites", []):
        name = item["name"]
        src = JUSTIFICATIFS_EN_ATTENTE_DIR / name
        dst = JUSTIFICATIFS_TRAITES_DIR / name
        if dst.exists():
            # État concurrent : un autre process a créé le fichier entre-temps
            result["errors"].append(f"move {name}: destination déjà présente")
            continue
        try:
            _move_pdf_with_ocr(src, dst)
            result["moved_to_traites"] += 1
        except Exception as e:
            result["errors"].append(f"move en_attente→traites/{name}: {e}")
            logger.warning(f"apply_link_repair: move en_attente→traites/{name} failed: {e}")

    # 3. Orphans duplicates dans traites/
    for item in plan.get("orphans_to_delete_traites", []):
        name = item["name"]
        try:
            _delete_pdf_with_ocr(JUSTIFICATIFS_TRAITES_DIR / name)
            result["deleted_from_traites"] += 1
        except Exception as e:
            result["errors"].append(f"delete traites/{name}: {e}")
            logger.warning(f"apply_link_repair: delete traites/{name} failed: {e}")

    # 3b. Reconnect ventilation : orphans traites/ → sous-ligne ventilée vide
    # (matching unique par date + montant ±0.01€). Exécuté AVANT les moves
    # vers en_attente/ pour ne pas déplacer des fichiers qui redeviennent
    # référencés.
    reconnect_by_op: dict = {}
    for r in plan.get("reconnectable_ventilation", []):
        reconnect_by_op.setdefault(r["op_file"], []).append(r)

    for op_file, items in reconnect_by_op.items():
        try:
            ops = operation_service.load_operations(op_file)
        except Exception as e:
            result["errors"].append(f"reconnect load {op_file}: {e}")
            continue
        changed = False
        for r in items:
            op_idx = r["op_index"]
            vl_idx = r["ventilation_index"]
            if not (0 <= op_idx < len(ops)):
                continue
            vlines = ops[op_idx].get("ventilation", []) or []
            if not (0 <= vl_idx < len(vlines)):
                continue
            # Re-vérif idempotence : ne pas écraser si déjà attribué
            if (vlines[vl_idx].get("justificatif") or "").strip():
                continue
            vlines[vl_idx]["justificatif"] = r["name"]
            changed = True
            result["ventilation_reconnected"] += 1
            logger.info(
                f"apply_link_repair: reconnect {r['name']} → {op_file}#{op_idx}/vl{vl_idx} "
                f"({r['montant']}€ {r['date']})"
            )
        if changed:
            try:
                operation_service.save_operations(ops, filename=op_file)
            except Exception as e:
                result["errors"].append(f"reconnect save {op_file}: {e}")
                logger.warning(f"apply_link_repair: reconnect save {op_file} failed: {e}")

    # 4. Orphans à redéplacer en en_attente/
    for item in plan.get("orphans_to_move_to_attente", []):
        name = item["name"]
        src = JUSTIFICATIFS_TRAITES_DIR / name
        dst = JUSTIFICATIFS_EN_ATTENTE_DIR / name
        if dst.exists():
            result["errors"].append(f"move {name}: destination déjà présente")
            continue
        try:
            _move_pdf_with_ocr(src, dst)
            result["moved_to_attente"] += 1
        except Exception as e:
            result["errors"].append(f"move traites→en_attente/{name}: {e}")
            logger.warning(f"apply_link_repair: move traites→en_attente/{name} failed: {e}")

    # 5. Ghost refs : clearer le Lien justificatif dans les ops
    # Grouper par (op_file, op_idx) pour un seul load/save par op
    ghost_by_op: dict = {}
    for g in plan.get("ghost_refs", []):
        ghost_by_op.setdefault(g["op_file"], set()).add(g["op_idx"])

    for op_file, indices in ghost_by_op.items():
        try:
            ops = operation_service.load_operations(op_file)
        except Exception as e:
            result["errors"].append(f"load {op_file}: {e}")
            continue
        changed = False
        for idx in indices:
            if 0 <= idx < len(ops):
                ops[idx]["Justificatif"] = False
                ops[idx]["Lien justificatif"] = ""
                changed = True
                result["ghost_refs_cleared"] += 1
        if changed:
            try:
                operation_service.save_operations(ops, filename=op_file)
            except Exception as e:
                result["errors"].append(f"save {op_file}: {e}")
                logger.warning(f"apply_link_repair: save {op_file} failed: {e}")

    # Warning log pour les conflits (skippés volontairement)
    if result["conflicts_skipped"] > 0:
        names = ", ".join(c["name"] for c in plan.get("hash_conflicts", []))
        logger.warning(
            f"apply_link_repair: {result['conflicts_skipped']} conflits hash skippés "
            f"(inspection manuelle requise): {names}"
        )

    invalidate_referenced_cache()
    return result
