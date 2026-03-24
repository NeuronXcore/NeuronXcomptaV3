"""
Service de rapprochement opérations / justificatifs.
Moteur de scoring + auto-association + suggestions.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import (
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    LOGS_DIR,
    ensure_directories,
)
from backend.services import operation_service, justificatif_service

logger = logging.getLogger(__name__)

_auto_lock = threading.Lock()

# Stopwords pour la normalisation fournisseur
_STOPWORDS = {"du", "de", "la", "le", "les", "sa", "sarl", "sas", "eurl", "et", "l", "d"}


# ─── Scoring pur (sans I/O) ───

def _normalize_tokens(text: str) -> set:
    """Normalise une chaîne en set de tokens pour comparaison Jaccard."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    tokens = {t for t in text.split() if t and t not in _STOPWORDS and len(t) > 1}
    return tokens


def score_montant(j_montant: Optional[float], o_montant: float) -> float:
    """Score de correspondance montant (compare valeurs absolues)."""
    if j_montant is None or o_montant == 0:
        return 0.0
    a = abs(j_montant)
    b = abs(o_montant)
    if a == 0 and b == 0:
        return 1.0
    if a == 0 or b == 0:
        return 0.0
    ecart_abs = abs(a - b)
    if ecart_abs <= 0.01:
        return 1.0
    if ecart_abs < 1.0:
        return 0.9
    ecart_rel = ecart_abs / max(a, b)
    if ecart_rel < 0.02:
        return 0.75
    if ecart_rel < 0.05:
        return 0.5
    if ecart_rel < 0.10:
        return 0.25
    return 0.0


def score_date(j_date_str: Optional[str], o_date_str: str) -> float:
    """Score de correspondance date."""
    if not j_date_str or not o_date_str:
        return 0.0
    j_date = _parse_date(j_date_str)
    o_date = _parse_date(o_date_str)
    if not j_date or not o_date:
        return 0.0
    ecart = abs((j_date - o_date).days)
    if ecart == 0:
        return 1.0
    if ecart <= 3:
        return 0.8
    if ecart <= 7:
        return 0.6
    if ecart <= 15:
        return 0.4
    if ecart <= 30:
        return 0.2
    return 0.0


def score_fournisseur(j_fournisseur: Optional[str], o_libelle: Optional[str]) -> float:
    """Score Jaccard sur tokens normalisés."""
    if not j_fournisseur or not o_libelle:
        return 0.0
    tokens_a = _normalize_tokens(j_fournisseur)
    tokens_b = _normalize_tokens(o_libelle)
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def _confidence_level(score: float) -> str:
    if score >= 0.95:
        return "fort"
    if score >= 0.75:
        return "probable"
    if score >= 0.60:
        return "possible"
    return "faible"


def compute_score(justificatif_ocr: dict, operation: dict) -> dict:
    """
    Calcule le score de correspondance entre un justificatif (données OCR) et une opération.

    justificatif_ocr: {"best_date": str|None, "best_amount": float|None, "supplier": str|None}
    operation: dict avec clés françaises (Débit, Crédit, Date, Libellé)
    """
    j_amount = justificatif_ocr.get("best_amount")
    j_date = justificatif_ocr.get("best_date")
    j_supplier = justificatif_ocr.get("supplier")

    # Montant de l'opération : max(Débit, Crédit)
    o_debit = float(operation.get("Débit", 0) or 0)
    o_credit = float(operation.get("Crédit", 0) or 0)
    o_montant = max(o_debit, o_credit)

    o_date = operation.get("Date", "")
    o_libelle = operation.get("Libellé", "")

    s_montant = score_montant(j_amount, o_montant)
    s_date = score_date(j_date, o_date)
    s_fournisseur = score_fournisseur(j_supplier, o_libelle)

    total = round(s_montant * 0.45 + s_date * 0.35 + s_fournisseur * 0.20, 4)

    return {
        "total": total,
        "detail": {
            "montant": round(s_montant, 4),
            "date": round(s_date, 4),
            "fournisseur": round(s_fournisseur, 4),
        },
        "confidence_level": _confidence_level(total),
    }


# ─── Helpers I/O ───

def _parse_date(date_str: str) -> Optional[datetime]:
    """Parse une date en essayant plusieurs formats."""
    if not date_str:
        return None
    # Nettoyer
    date_str = date_str.strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return None


def _load_ocr_data(justificatif_filename: str) -> dict:
    """Charge les données OCR d'un justificatif. Retourne un dict vide-safe."""
    try:
        from backend.services import ocr_service
        filepath = justificatif_service.get_justificatif_path(justificatif_filename)
        if filepath:
            cached = ocr_service.get_cached_result(filepath)
            if cached and cached.get("status") == "success":
                return cached.get("extracted_data", {})
    except Exception:
        pass
    return {}


def _get_operation_montant(op: dict) -> float:
    """Retourne le montant principal d'une opération."""
    debit = float(op.get("Débit", 0) or 0)
    credit = float(op.get("Crédit", 0) or 0)
    return max(debit, credit)


# ─── Méthodes publiques ───


def _human_size(size_bytes: int) -> str:
    """Convertit bytes en taille lisible."""
    for unit in ("o", "Ko", "Mo", "Go"):
        if abs(size_bytes) < 1024.0:
            return f"{size_bytes:.0f} {unit}" if unit == "o" else f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} To"


def get_filtered_suggestions(
    operation_file: str,
    operation_index: int,
    montant_min: Optional[float] = None,
    montant_max: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
) -> list:
    """Suggestions filtrées de justificatifs pour une opération (drawer manuel)."""
    ensure_directories()
    try:
        ops = operation_service.load_operations(operation_file)
        if not (0 <= operation_index < len(ops)):
            return []
        operation = ops[operation_index]
    except Exception:
        return []

    if not JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        return []

    o_montant = _get_operation_montant(operation)
    o_date = operation.get("Date", "")
    o_libelle = operation.get("Libellé", "")

    suggestions = []
    for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
        ocr_data = _load_ocr_data(pdf_path.name)
        ocr_montant = ocr_data.get("best_amount")
        ocr_date = ocr_data.get("best_date")
        ocr_fournisseur = ocr_data.get("supplier")

        # Appliquer les filtres — ne filtrer que si la donnée OCR existe
        if montant_min is not None and ocr_montant is not None:
            if ocr_montant < montant_min:
                continue
        if montant_max is not None and ocr_montant is not None:
            if ocr_montant > montant_max:
                continue

        if date_from and ocr_date:
            parsed_from = _parse_date(date_from)
            parsed_ocr = _parse_date(ocr_date)
            if parsed_from and parsed_ocr and parsed_ocr < parsed_from:
                continue

        if date_to and ocr_date:
            parsed_to = _parse_date(date_to)
            parsed_ocr = _parse_date(ocr_date)
            if parsed_to and parsed_ocr and parsed_ocr > parsed_to:
                continue

        if search and ocr_fournisseur:
            if search.lower() not in ocr_fournisseur.lower():
                continue
        elif search and not ocr_fournisseur:
            # Pas de fournisseur OCR: on vérifie aussi dans le filename
            if search.lower() not in pdf_path.name.lower():
                continue

        # Calculer le score de pertinence (formule simplifiée du prompt)
        s_montant = 0.0
        if ocr_montant is not None and o_montant > 0:
            s_montant = max(0.0, 1.0 - abs(ocr_montant - o_montant) / max(o_montant, 1.0))

        s_date = 0.0
        if ocr_date and o_date:
            p_ocr = _parse_date(ocr_date)
            p_op = _parse_date(o_date)
            if p_ocr and p_op:
                days_diff = abs((p_ocr - p_op).days)
                s_date = max(0.0, 1.0 - days_diff / 30.0)

        s_fournisseur = 0.0
        if ocr_fournisseur and o_libelle:
            if ocr_fournisseur.lower() in o_libelle.lower():
                s_fournisseur = 1.0

        total = round(s_montant * 0.50 + s_date * 0.30 + s_fournisseur * 0.20, 4)

        file_size = pdf_path.stat().st_size if pdf_path.exists() else 0

        suggestions.append({
            "filename": pdf_path.name,
            "ocr_date": ocr_date or "",
            "ocr_montant": ocr_montant,
            "ocr_fournisseur": ocr_fournisseur or "",
            "score": total,
            "size_human": _human_size(file_size),
        })

    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return suggestions


def get_suggestions_for_operation(
    operation_file: str,
    operation_index: int,
    max_results: int = 5,
) -> list:
    """Suggestions de justificatifs pour une opération donnée."""
    ensure_directories()
    try:
        ops = operation_service.load_operations(operation_file)
        if not (0 <= operation_index < len(ops)):
            return []
        operation = ops[operation_index]
    except Exception:
        return []

    # Scanner tous les justificatifs en attente
    suggestions = []
    if not JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        return []

    for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
        ocr_data = _load_ocr_data(pdf_path.name)
        score_result = compute_score(ocr_data, operation)

        if score_result["confidence_level"] == "faible":
            continue

        suggestions.append({
            "justificatif_filename": pdf_path.name,
            "operation_file": operation_file,
            "operation_index": operation_index,
            "operation_libelle": operation.get("Libellé", ""),
            "operation_date": operation.get("Date", "")[:10],
            "operation_montant": _get_operation_montant(operation),
            "score": score_result,
        })

    suggestions.sort(key=lambda s: s["score"]["total"], reverse=True)
    return suggestions[:max_results]


def get_suggestions_for_justificatif(
    justificatif_filename: str,
    max_results: int = 5,
) -> list:
    """Suggestions d'opérations pour un justificatif donné."""
    ensure_directories()
    ocr_data = _load_ocr_data(justificatif_filename)

    suggestions = []
    files = operation_service.list_operation_files()

    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
        except Exception:
            continue

        for idx, op in enumerate(ops):
            if op.get("Justificatif"):
                continue

            score_result = compute_score(ocr_data, op)
            if score_result["confidence_level"] == "faible":
                continue

            suggestions.append({
                "justificatif_filename": justificatif_filename,
                "operation_file": f["filename"],
                "operation_index": idx,
                "operation_libelle": op.get("Libellé", ""),
                "operation_date": op.get("Date", "")[:10],
                "operation_montant": _get_operation_montant(op),
                "score": score_result,
            })

    suggestions.sort(key=lambda s: s["score"]["total"], reverse=True)
    return suggestions[:max_results]


def run_auto_rapprochement() -> dict:
    """
    Parcourt tous les justificatifs en attente et auto-associe ceux
    avec un score >= 0.95 et un match unique.
    """
    with _auto_lock:
        return _run_auto_rapprochement_locked()


def _run_auto_rapprochement_locked() -> dict:
    ensure_directories()
    now = datetime.now().isoformat()

    # Charger tous les justificatifs en attente
    pending_pdfs = list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"))
    if not pending_pdfs:
        return {
            "total_justificatifs_traites": 0,
            "associations_auto": 0,
            "suggestions_fortes": 0,
            "sans_correspondance": 0,
            "ran_at": now,
        }

    # Cache des fichiers d'opérations
    op_files = operation_service.list_operation_files()
    ops_cache: dict[str, list] = {}
    for f in op_files:
        try:
            ops_cache[f["filename"]] = operation_service.load_operations(f["filename"])
        except Exception:
            continue

    associations_auto = 0
    suggestions_fortes = 0
    sans_correspondance = 0

    for pdf_path in pending_pdfs:
        filename = pdf_path.name
        ocr_data = _load_ocr_data(filename)

        best_score = 0.0
        best_match = None
        second_best_score = 0.0

        for op_file, ops in ops_cache.items():
            for idx, op in enumerate(ops):
                if op.get("Justificatif"):
                    continue

                result = compute_score(ocr_data, op)
                total = result["total"]

                if total > best_score:
                    second_best_score = best_score
                    best_score = total
                    best_match = {
                        "op_file": op_file,
                        "op_index": idx,
                        "score": result,
                        "op": op,
                    }
                elif total > second_best_score:
                    second_best_score = total

        if best_score < 0.60:
            sans_correspondance += 1
            continue

        # Auto-association : score >= 0.95 et pas d'ex-aequo à ±0.02
        if best_score >= 0.95 and (best_score - second_best_score) > 0.02 and best_match:
            try:
                success = justificatif_service.associate(
                    filename,
                    best_match["op_file"],
                    best_match["op_index"],
                )
                if success:
                    # Écrire métadonnées rapprochement dans l'opération
                    write_rapprochement_metadata(
                        best_match["op_file"],
                        best_match["op_index"],
                        best_score,
                        "auto",
                    )
                    # Mettre à jour le cache pour ne pas réassocier
                    if best_match["op_file"] in ops_cache:
                        ops_cache[best_match["op_file"]][best_match["op_index"]]["Justificatif"] = True
                    associations_auto += 1
                    _log_auto_rapprochement(
                        action="associe",
                        justificatif=filename,
                        operation_file=best_match["op_file"],
                        operation_index=best_match["op_index"],
                        operation_libelle=best_match["op"].get("Libellé", ""),
                        score=best_score,
                    )
                    continue
            except Exception as e:
                logger.error(f"Erreur auto-association {filename}: {e}")

        if best_score >= 0.75:
            suggestions_fortes += 1
        else:
            sans_correspondance += 1

    return {
        "total_justificatifs_traites": len(pending_pdfs),
        "associations_auto": associations_auto,
        "suggestions_fortes": suggestions_fortes,
        "sans_correspondance": sans_correspondance,
        "ran_at": now,
    }


def get_unmatched_summary() -> dict:
    """Compteurs : opérations sans justificatif / justificatifs en attente."""
    ensure_directories()

    # Justificatifs en attente
    en_attente = len(list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf")))

    # Opérations sans justificatif
    ops_sans = 0
    for f in operation_service.list_operation_files():
        try:
            ops = operation_service.load_operations(f["filename"])
            ops_sans += sum(1 for op in ops if not op.get("Justificatif"))
        except Exception:
            continue

    return {
        "operations_sans_justificatif": ops_sans,
        "justificatifs_en_attente": en_attente,
    }


def get_auto_log(limit: int = 20) -> list:
    """Retourne les dernières entrées du log auto-rapprochement."""
    log_path = LOGS_DIR / "auto_rapprochement.jsonl"
    if not log_path.exists():
        return []

    lines = []
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except Exception:
        return []

    entries = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(entries) >= limit:
            break

    return entries


def get_batch_hints(filename: str) -> dict:
    """
    Pour un fichier d'opérations, retourne {index: best_score}
    pour toutes les opérations non associées.
    Utilisé par l'éditeur pour afficher les badges de suggestion.
    """
    ensure_directories()
    try:
        ops = operation_service.load_operations(filename)
    except Exception:
        return {}

    # Charger les OCR de tous les justificatifs en attente
    pending_ocr: list[tuple[str, dict]] = []
    if JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
            ocr_data = _load_ocr_data(pdf_path.name)
            pending_ocr.append((pdf_path.name, ocr_data))

    if not pending_ocr:
        return {}

    hints: dict[int, float] = {}
    for idx, op in enumerate(ops):
        if op.get("Justificatif"):
            continue

        best = 0.0
        for _, ocr_data in pending_ocr:
            result = compute_score(ocr_data, op)
            if result["total"] > best:
                best = result["total"]

        if best >= 0.60:
            hints[idx] = round(best, 4)

    return hints


def get_batch_justificatif_scores() -> dict:
    """
    Pour tous les justificatifs en attente, retourne {filename: best_score}.
    Utilisé par la galerie pour les filtres de correspondance.
    """
    ensure_directories()
    if not JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        return {}

    # Charger toutes les opérations non associées
    all_ops: list[tuple[str, int, dict]] = []
    for f in operation_service.list_operation_files():
        try:
            ops = operation_service.load_operations(f["filename"])
            for idx, op in enumerate(ops):
                if not op.get("Justificatif"):
                    all_ops.append((f["filename"], idx, op))
        except Exception:
            continue

    if not all_ops:
        return {}

    scores: dict[str, float] = {}
    for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
        ocr_data = _load_ocr_data(pdf_path.name)
        best = 0.0
        for _, _, op in all_ops:
            result = compute_score(ocr_data, op)
            if result["total"] > best:
                best = result["total"]
        if best >= 0.60:
            scores[pdf_path.name] = round(best, 4)

    return scores


# ─── Helpers internes ───

def write_rapprochement_metadata(
    operation_file: str,
    operation_index: int,
    score: float,
    mode: str,
) -> None:
    """Écrit les métadonnées de rapprochement dans l'opération."""
    try:
        ops = operation_service.load_operations(operation_file)
        if 0 <= operation_index < len(ops):
            ops[operation_index]["rapprochement_score"] = round(score, 4)
            ops[operation_index]["rapprochement_mode"] = mode
            ops[operation_index]["rapprochement_date"] = datetime.now().isoformat()
            operation_service.save_operations(ops, filename=operation_file)
    except Exception as e:
        logger.error(f"Erreur écriture metadata rapprochement: {e}")


def _log_auto_rapprochement(
    action: str,
    justificatif: str,
    operation_file: str,
    operation_index: int,
    operation_libelle: str,
    score: float,
) -> None:
    """Ajoute une entrée dans le log auto-rapprochement JSONL."""
    ensure_directories()
    log_path = LOGS_DIR / "auto_rapprochement.jsonl"
    entry = {
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "justificatif": justificatif,
        "operation_file": operation_file,
        "operation_index": operation_index,
        "operation_libelle": operation_libelle,
        "score": round(score, 4),
    }
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.error(f"Erreur écriture log rapprochement: {e}")
