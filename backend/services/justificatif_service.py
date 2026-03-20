"""
Service pour la gestion des justificatifs comptables.
Upload, galerie, association aux opérations, suggestions automatiques.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from backend.core.config import (
    JUSTIFICATIFS_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    ensure_directories,
)
from backend.services import operation_service

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
    except Exception:
        info["ocr_data"] = None

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
            # Valider PDF (magic bytes)
            if not file_bytes[:5] == b"%PDF-":
                results.append({
                    "filename": "",
                    "original_name": original_filename,
                    "size": len(file_bytes),
                    "success": False,
                    "error": "Le fichier n'est pas un PDF valide",
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

            # Nettoyer le nom de fichier
            clean_name = re.sub(r"[^\w\.\-]", "_", original_filename)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            new_filename = f"justificatif_{timestamp}_{clean_name}"
            if not new_filename.lower().endswith(".pdf"):
                new_filename += ".pdf"

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

def delete_justificatif(filename: str) -> bool:
    """Supprime un justificatif et nettoie le lien dans les opérations."""
    filepath = get_justificatif_path(filename)
    if not filepath:
        return False

    # Si traité, nettoyer le lien dans les opérations
    if "traites" in str(filepath.parent):
        _clean_operation_link(filename)

    # Supprimer le cache OCR associé
    try:
        from backend.services import ocr_service
        ocr_service.delete_ocr_cache_for(filepath)
    except Exception:
        pass

    filepath.unlink()
    logger.info(f"Justificatif supprimé: {filename}")
    return True


def _clean_operation_link(justificatif_filename: str):
    """Nettoie le lien justificatif dans les opérations."""
    files = operation_service.list_operation_files()
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            modified = False
            for op in ops:
                lien = op.get("Lien justificatif", "")
                if lien and justificatif_filename in lien:
                    op["Justificatif"] = False
                    op["Lien justificatif"] = ""
                    modified = True
            if modified:
                operation_service.save_operations(ops, filename=f["filename"])
                logger.info(f"Lien justificatif nettoyé dans {f['filename']}")
        except Exception as e:
            logger.warning(f"Erreur nettoyage lien dans {f['filename']}: {e}")


# ─── Path resolution ───

def get_justificatif_path(filename: str) -> Optional[Path]:
    """Résout le chemin d'un justificatif dans en_attente ou traites."""
    for dir_path in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        filepath = dir_path / filename
        if filepath.exists():
            return filepath
    return None


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
        shutil.move(str(src), str(dst))
        try:
            from backend.services import ocr_service
            ocr_service.move_ocr_cache(src.parent, dst.parent, justificatif_filename)
        except Exception:
            pass

    # 3. Mettre à jour l'opération
    try:
        ops = operation_service.load_operations(operation_file)
        if 0 <= operation_index < len(ops):
            ops[operation_index]["Justificatif"] = True
            ops[operation_index]["Lien justificatif"] = f"traites/{justificatif_filename}"
            operation_service.save_operations(ops, filename=operation_file)
            logger.info(f"Association: {justificatif_filename} → {operation_file}[{operation_index}]")
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
            shutil.move(str(src), str(dst))
            try:
                from backend.services import ocr_service
                ocr_service.move_ocr_cache(src.parent, dst.parent, justificatif_filename)
            except Exception:
                pass

        # Mettre à jour l'opération
        op["Justificatif"] = False
        op["Lien justificatif"] = ""
        operation_service.save_operations(ops, filename=operation_file)
        logger.info(f"Dissociation: {justificatif_filename} ← {operation_file}[{operation_index}]")
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
                if op.get("Justificatif"):
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
