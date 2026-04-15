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

# Taux TVA pour test HT/TTC (ordre : standard, intermédiaire, réduit)
_TVA_RATES = (1.20, 1.10, 1.055)


# ─── Scoring pur (sans I/O) ───

def _normalize_tokens(text: str) -> set:
    """Normalise une chaîne en set de tokens pour comparaison Jaccard."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    tokens = {t for t in text.split() if t and t not in _STOPWORDS and len(t) > 1}
    return tokens


def score_montant(j_montant: Optional[float], o_montant: float) -> float:
    """
    Score de correspondance montant (dégradation progressive).

    Paliers sur l'écart relatif :
    - Exact (0%) → 1.0
    - ≤ 1% → 0.95
    - ≤ 2% → 0.85
    - ≤ 5% → 0.60
    - > 5% → 0.0

    Inclut un test HT/TTC (plancher 0.95) : si le montant OCR (TTC facturé)
    divisé par un taux TVA usuel correspond au montant op (HT prélevé).
    """
    if j_montant is None or o_montant is None:
        return 0.0
    a = abs(j_montant)
    b = abs(o_montant)
    if a == 0 and b == 0:
        return 1.0
    if b == 0:
        return 0.0

    # Test HT/TTC : ocr / tva ≈ op (±0.02 €)
    tva_score = 0.0
    for tva in _TVA_RATES:
        ht = a / tva
        if abs(ht - b) <= 0.02:
            tva_score = 0.95
            break

    ecart = abs(a - b) / b
    if ecart == 0:
        base_score = 1.0
    elif ecart <= 0.01:
        base_score = 0.95
    elif ecart <= 0.02:
        base_score = 0.85
    elif ecart <= 0.05:
        base_score = 0.60
    else:
        base_score = 0.0

    return max(base_score, tva_score)


def score_date(j_date_str: Optional[str], o_date_str: str) -> float:
    """
    Score date avec dégradation non-linéaire (symétrique).

    Paliers :
    - ±0 jour → 1.0
    - ±1 jour → 0.95
    - ±3 jours → 0.80
    - ±7 jours → 0.50
    - ±14 jours → 0.20
    - > 14 jours → 0.0
    """
    if not j_date_str or not o_date_str:
        return 0.0
    j_date = _parse_date(j_date_str)
    o_date = _parse_date(o_date_str)
    if not j_date or not o_date:
        return 0.0
    delta = abs((j_date - o_date).days)
    if delta == 0:
        return 1.0
    if delta <= 1:
        return 0.95
    if delta <= 3:
        return 0.80
    if delta <= 7:
        return 0.50
    if delta <= 14:
        return 0.20
    return 0.0


def score_fournisseur(j_fournisseur: Optional[str], o_libelle: Optional[str]) -> float:
    """
    Score fournisseur multi-stratégie : max(substring, Jaccard, Levenshtein).

    Stratégies :
    1. Substring match : fournisseur présent dans le libellé bancaire → 1.0
       (ex : "amazon" dans "PRLVSEPAAMAZONPAYMENT")
    2. Jaccard similarity sur tokens normalisés (hors stopwords)
    3. Levenshtein ratio (via difflib.SequenceMatcher) sur formes concaténées ;
       plancher 0.5 pour éviter le bruit
    """
    if not j_fournisseur or not o_libelle:
        return 0.0

    from difflib import SequenceMatcher

    # 1) Jaccard sur tokens
    tokens_a = _normalize_tokens(j_fournisseur)
    tokens_b = _normalize_tokens(o_libelle)
    jaccard = 0.0
    if tokens_a and tokens_b:
        intersection = tokens_a & tokens_b
        union = tokens_a | tokens_b
        jaccard = len(intersection) / len(union)

    # 2) Sous-chaîne sur formes concaténées sans séparateurs
    j_norm = re.sub(r"[^\w]", "", j_fournisseur.lower())
    o_norm = re.sub(r"[^\w]", "", o_libelle.lower())
    substring = 0.0
    if j_norm and o_norm and len(j_norm) >= 3:
        if j_norm in o_norm or o_norm in j_norm:
            substring = 1.0
        else:
            # Chercher chaque token fournisseur (>= 3 chars) dans le libellé concaténé
            for token in tokens_a:
                if len(token) >= 3 and token in o_norm:
                    substring = max(substring, 0.85)

    # 3) Levenshtein ratio (fallback pour les variantes proches)
    lev = 0.0
    if j_norm and o_norm:
        ratio = SequenceMatcher(None, j_norm, o_norm).ratio()
        lev = ratio if ratio >= 0.5 else 0.0

    return max(substring, jaccard, lev)


def _confidence_level(score: float) -> str:
    if score >= 0.80:
        return "fort"
    if score >= 0.65:
        return "probable"
    if score >= 0.50:
        return "possible"
    return "faible"


def _normalize_supplier(s: Optional[str]) -> str:
    """Normalise un nom de fournisseur pour comparaison (lowercase, sans séparateurs)."""
    if not s:
        return ""
    return re.sub(r"[^\w]", "", s.lower())


def score_categorie(
    ocr_fournisseur: Optional[str],
    op_categorie: Optional[str],
    op_sous_categorie: Optional[str] = None,
    category_hint: Optional[str] = None,
    sous_categorie_hint: Optional[str] = None,
) -> Optional[float]:
    """
    Score catégorie basé sur l'inférence fournisseur → catégorie.

    Priorité :
      1. Si `category_hint` est fourni (saisi par l'user OU écrit automatiquement
         lors d'une association précédente), l'utiliser comme source de vérité :
         → match direct avec op_categorie, pas de ML.
      2. Sinon, fallback sur la prédiction ML depuis le supplier.

    Retourne None quand la catégorie ne peut pas être inférée (critère neutre,
    son poids est redistribué sur les 3 autres critères dans compute_total_score).

    - Catégorie == catégorie op → 1.0
    - Même catégorie mais sous-catégorie différente → 0.6
    - Catégorie différente → 0.0
    """
    if not op_categorie:
        return None

    # ── Stratégie 1 : hint utilisateur (priorité absolue) ──
    # Un hint est une vérité terrain (saisie manuelle OU propagée depuis une
    # association précédente) bien plus fiable que la prédiction ML depuis le
    # nom de fournisseur parsé par l'OCR.
    if category_hint and category_hint.strip():
        hint_cat = category_hint.strip().lower()
        op_cat = op_categorie.strip().lower()
        if hint_cat != op_cat:
            return 0.0
        # Cat match → check sous-cat si les 2 sont dispo
        if sous_categorie_hint and op_sous_categorie:
            if sous_categorie_hint.strip().lower() == op_sous_categorie.strip().lower():
                return 1.0
            return 0.6
        return 1.0

    # ── Stratégie 2 : fallback ML (comportement d'origine) ──
    if not ocr_fournisseur:
        return None

    try:
        from backend.services import ml_service
    except Exception:
        return None

    libelle = ocr_fournisseur.strip()
    if not libelle:
        return None

    predicted_cat: Optional[str] = None
    predicted_sub: Optional[str] = None
    confidence = 0.0

    # 1) Rules-based (confiance 1.0 quand ça hit)
    try:
        rules_pred = ml_service.predict_category(libelle)
    except Exception:
        rules_pred = None
    if rules_pred:
        predicted_cat = rules_pred
        confidence = 1.0
        try:
            predicted_sub = ml_service.predict_subcategory(libelle)
        except Exception:
            predicted_sub = None
    else:
        # 2) Sklearn fallback avec confiance réelle
        try:
            cat, conf, _risk = ml_service.evaluate_hallucination_risk(libelle)
        except Exception:
            cat, conf = None, 0.0
        if cat and conf >= 0.5:
            predicted_cat = cat
            confidence = float(conf)

    if not predicted_cat or confidence < 0.5:
        return None

    if predicted_cat.strip().lower() != op_categorie.strip().lower():
        return 0.0

    # Catégorie match → vérifier sous-catégorie si disponible des deux côtés
    if predicted_sub and op_sous_categorie:
        if predicted_sub.strip().lower() == op_sous_categorie.strip().lower():
            return 1.0
        return 0.6

    return 1.0


def compute_total_score(
    s_montant: float,
    s_date: float,
    s_fournisseur: float,
    s_categorie: Optional[float],
) -> float:
    """
    Score total avec pondération dynamique.

    Poids de base (4 critères actifs) :
      montant 0.35, fournisseur 0.25, date 0.20, catégorie 0.20

    Si `s_categorie is None` → son poids 0.20 est redistribué proportionnellement
    sur les 3 autres : montant 0.4375, fournisseur 0.3125, date 0.25.
    """
    if s_categorie is not None:
        total = (
            0.35 * s_montant
            + 0.25 * s_fournisseur
            + 0.20 * s_date
            + 0.20 * s_categorie
        )
    else:
        total = (
            0.4375 * s_montant
            + 0.3125 * s_fournisseur
            + 0.25 * s_date
        )
    return round(total, 4)


def compute_score(
    justificatif_ocr: dict,
    operation: dict,
    override_montant: Optional[float] = None,
    override_categorie: Optional[str] = None,
    override_sous_categorie: Optional[str] = None,
) -> dict:
    """
    Calcule le score de correspondance entre un justificatif (données OCR) et une opération.

    justificatif_ocr: {"best_date": str|None, "best_amount": float|None, "supplier": str|None}
    operation: dict avec clés françaises (Débit, Crédit, Date, Libellé, Catégorie, ...)
    override_montant: si fourni, utiliser ce montant (ventilation)
    override_categorie / override_sous_categorie: pour les sous-lignes ventilées
    """
    j_amount = justificatif_ocr.get("best_amount")
    j_date = justificatif_ocr.get("best_date")
    j_supplier = justificatif_ocr.get("supplier")
    # Hints top-level du .ocr.json (injectés par _load_ocr_data).
    # Si présents, score_categorie les utilise en priorité sur la prédiction ML.
    j_cat_hint = justificatif_ocr.get("category_hint")
    j_subcat_hint = justificatif_ocr.get("sous_categorie_hint")

    if override_montant is not None:
        o_montant = override_montant
    else:
        o_debit = float(operation.get("Débit", 0) or 0)
        o_credit = float(operation.get("Crédit", 0) or 0)
        o_montant = max(o_debit, o_credit)

    o_date = operation.get("Date", "")
    o_libelle = operation.get("Libellé", "")
    o_categorie = (
        override_categorie
        if override_categorie is not None
        else (operation.get("Catégorie", "") or "")
    )
    o_sous_categorie = (
        override_sous_categorie
        if override_sous_categorie is not None
        else (operation.get("Sous-catégorie", "") or "")
    )

    s_montant = score_montant(j_amount, o_montant)
    s_date = score_date(j_date, o_date)
    s_fournisseur = score_fournisseur(j_supplier, o_libelle)
    s_categorie = score_categorie(
        j_supplier,
        o_categorie,
        o_sous_categorie or None,
        category_hint=j_cat_hint,
        sous_categorie_hint=j_subcat_hint,
    )

    total = compute_total_score(s_montant, s_date, s_fournisseur, s_categorie)

    return {
        "total": total,
        "detail": {
            "montant": round(s_montant, 4),
            "date": round(s_date, 4),
            "fournisseur": round(s_fournisseur, 4),
            "categorie": round(s_categorie, 4) if s_categorie is not None else None,
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
    """Charge les données OCR d'un justificatif. Retourne un dict vide-safe.

    Inclut également les hints cat/sous-cat stockés au top-level du .ocr.json
    (category_hint, sous_categorie_hint) — ils sont utilisés comme override
    par `score_categorie()` pour booster le scoring quand l'utilisateur a
    déjà associé le fichier à une op catégorisée par le passé.
    """
    try:
        from backend.services import ocr_service
        filepath = justificatif_service.get_justificatif_path(justificatif_filename)
        if filepath:
            cached = ocr_service.get_cached_result(filepath)
            if cached and cached.get("status") == "success":
                ed = dict(cached.get("extracted_data", {}))
                # Injecter les hints top-level dans le dict ocr_data pour
                # qu'ils soient accessibles par `compute_score()` sans changer
                # la signature existante.
                ed["category_hint"] = cached.get("category_hint")
                ed["sous_categorie_hint"] = cached.get("sous_categorie_hint")
                return ed
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
    ventilation_index: Optional[int] = None,
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

    # Si ventilation_index fourni, utiliser le montant + catégorie de la sous-ligne
    vlines = operation.get("ventilation", [])
    override_montant: Optional[float] = None
    override_categorie: Optional[str] = None
    override_sous_categorie: Optional[str] = None
    if ventilation_index is not None and 0 <= ventilation_index < len(vlines):
        override_montant = vlines[ventilation_index].get("montant", 0)
        override_categorie = vlines[ventilation_index].get("categorie", "")
        override_sous_categorie = vlines[ventilation_index].get("sous_categorie", "")
        o_montant = override_montant
    else:
        o_montant = _get_operation_montant(operation)
    o_date = operation.get("Date", "")
    o_libelle = operation.get("Libellé", "")

    # Extraire année/mois de l'opération pour pré-filtrer les justificatifs
    op_year, op_month = None, None
    if o_date and len(o_date) >= 7:
        try:
            op_year = int(o_date[:4])
            op_month = int(o_date[5:7])
        except (ValueError, IndexError):
            pass

    suggestions = []
    for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
        # Pré-filtre par mois : extraire la date du nom de fichier (convention fournisseur_YYYYMMDD_montant.pdf)
        if op_year and op_month:
            fname_match = re.search(r"(\d{4})(\d{2})\d{2}", pdf_path.stem)
            if fname_match:
                f_year = int(fname_match.group(1))
                f_month = int(fname_match.group(2))
                # Tolérance ±1 mois
                op_total = op_year * 12 + op_month
                f_total = f_year * 12 + f_month
                if abs(op_total - f_total) > 1:
                    continue

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

        # Calculer le score via le moteur partagé (TVA, paliers gradués, catégorie ML)
        score_result = compute_score(
            ocr_data,
            operation,
            override_montant=override_montant,
            override_categorie=override_categorie,
            override_sous_categorie=override_sous_categorie,
        )
        total = score_result["total"]
        detail = score_result["detail"]

        file_size = pdf_path.stat().st_size if pdf_path.exists() else 0

        suggestions.append({
            "filename": pdf_path.name,
            "ocr_date": ocr_date or "",
            "ocr_montant": ocr_montant,
            "ocr_fournisseur": ocr_fournisseur or "",
            "score": total,
            "score_detail": detail,
            "size_human": _human_size(file_size),
        })

    # Exclure les justificatifs déjà associés à une autre opération
    from backend.services.justificatif_service import get_all_referenced_justificatifs
    referenced = get_all_referenced_justificatifs()

    # Exception : autoriser la ré-association du justificatif déjà lié à CETTE op
    current_justif = None
    if ventilation_index is not None:
        vlines = operation.get("ventilation", [])
        if 0 <= ventilation_index < len(vlines):
            current_justif = vlines[ventilation_index].get("justificatif") or None
    else:
        lien = operation.get("Lien justificatif") or ""
        if lien:
            current_justif = Path(lien).name
    if current_justif:
        referenced = referenced - {current_justif}

    suggestions = [s for s in suggestions if s["filename"] not in referenced]

    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return suggestions


def get_suggestions_for_operation(
    operation_file: str,
    operation_index: int,
    max_results: int = 5,
    ventilation_index: Optional[int] = None,
) -> list:
    """Suggestions de justificatifs pour une opération donnée.

    Si ventilation_index est fourni, scorer avec le montant de la sous-ligne.
    Si non fourni et op ventilée, retourne un flag ventilated avec les sous-lignes.
    """
    ensure_directories()
    try:
        ops = operation_service.load_operations(operation_file)
        if not (0 <= operation_index < len(ops)):
            return []
        operation = ops[operation_index]
    except Exception:
        return []

    vlines = operation.get("ventilation", [])

    # Si op ventilée et pas de ventilation_index, retourner les infos de ventilation
    if vlines and ventilation_index is None:
        return [{
            "ventilated": True,
            "ventilation_lines": [
                {"index": vl.get("index", i), "montant": vl.get("montant", 0),
                 "categorie": vl.get("categorie", ""), "libelle": vl.get("libelle", ""),
                 "justificatif": vl.get("justificatif")}
                for i, vl in enumerate(vlines)
            ],
        }]

    # Déterminer le montant + catégorie à utiliser pour le scoring
    override_montant = None
    override_categorie = None
    override_sous_categorie = None
    if ventilation_index is not None and 0 <= ventilation_index < len(vlines):
        override_montant = vlines[ventilation_index].get("montant", 0)
        override_categorie = vlines[ventilation_index].get("categorie", "")
        override_sous_categorie = vlines[ventilation_index].get("sous_categorie", "")

    # Scanner tous les justificatifs en attente
    suggestions = []
    if not JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        return []

    for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
        ocr_data = _load_ocr_data(pdf_path.name)
        score_result = compute_score(
            ocr_data,
            operation,
            override_montant=override_montant,
            override_categorie=override_categorie,
            override_sous_categorie=override_sous_categorie,
        )

        if score_result["confidence_level"] == "faible":
            continue

        suggestions.append({
            "justificatif_filename": pdf_path.name,
            "operation_file": operation_file,
            "operation_index": operation_index,
            "operation_libelle": operation.get("Libellé", ""),
            "operation_date": operation.get("Date", "")[:10],
            "operation_montant": override_montant if override_montant is not None else _get_operation_montant(operation),
            "score": score_result,
            "ventilation_index": ventilation_index,
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
            vlines = op.get("ventilation", [])
            if vlines:
                # Op ventilée : scorer chaque sous-ligne
                for vl_idx, vl in enumerate(vlines):
                    if vl.get("justificatif"):
                        continue
                    score_result = compute_score(
                        ocr_data,
                        op,
                        override_montant=vl.get("montant", 0),
                        override_categorie=vl.get("categorie", ""),
                        override_sous_categorie=vl.get("sous_categorie", ""),
                    )
                    if score_result["confidence_level"] == "faible":
                        continue
                    suggestions.append({
                        "justificatif_filename": justificatif_filename,
                        "operation_file": f["filename"],
                        "operation_index": idx,
                        "operation_libelle": vl.get("libelle") or op.get("Libellé", ""),
                        "operation_date": op.get("Date", "")[:10],
                        "operation_montant": vl.get("montant", 0),
                        "score": score_result,
                        "ventilation_index": vl_idx,
                    })
            else:
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
                if op.get("locked"):
                    continue  # skip silencieusement les ops verrouillées manuellement
                vlines = op.get("ventilation", [])
                if vlines:
                    # Op ventilée : scorer chaque sous-ligne individuellement
                    for vl_idx, vl in enumerate(vlines):
                        if vl.get("justificatif"):
                            continue
                        result = compute_score(
                            ocr_data,
                            op,
                            override_montant=vl.get("montant", 0),
                            override_categorie=vl.get("categorie", ""),
                            override_sous_categorie=vl.get("sous_categorie", ""),
                        )
                        total = result["total"]
                        if total > best_score:
                            second_best_score = best_score
                            best_score = total
                            best_match = {
                                "op_file": op_file,
                                "op_index": idx,
                                "score": result,
                                "op": op,
                                "ventilation_index": vl_idx,
                            }
                        elif total > second_best_score:
                            second_best_score = total
                else:
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
                            "ventilation_index": None,
                        }
                    elif total > second_best_score:
                        second_best_score = total

        if best_score < 0.60:
            sans_correspondance += 1
            continue

        # Auto-association : score >= 0.80 et pas d'ex-aequo à ±0.02
        if best_score >= 0.80 and (best_score - second_best_score) > 0.02 and best_match:
            try:
                vl_idx = best_match.get("ventilation_index")
                if vl_idx is not None:
                    # Ventilée : écrire le justificatif dans la sous-ligne
                    cached_ops = ops_cache.get(best_match["op_file"], [])
                    if 0 <= best_match["op_index"] < len(cached_ops):
                        cached_op = cached_ops[best_match["op_index"]]
                        vlines = cached_op.get("ventilation", [])
                        if 0 <= vl_idx < len(vlines):
                            vlines[vl_idx]["justificatif"] = filename
                            # Sauvegarder + déplacer le PDF
                            success = justificatif_service.associate(
                                filename,
                                best_match["op_file"],
                                best_match["op_index"],
                            )
                            if success:
                                # Re-sauver avec la sous-ligne mise à jour
                                operation_service.save_operations(cached_ops, filename=best_match["op_file"])
                                write_rapprochement_metadata(
                                    best_match["op_file"],
                                    best_match["op_index"],
                                    best_score,
                                    "auto",
                                    ventilation_index=vl_idx,
                                )
                                # GED V2 enrichment
                                try:
                                    from backend.services import ged_service
                                    _op = best_match["op"]
                                    _amount = float(vlines[vl_idx].get("montant", 0)) if vlines and 0 <= vl_idx < len(vlines) else 0
                                    ged_service.enrich_metadata_on_association(
                                        justificatif_filename=filename,
                                        operation_file=best_match["op_file"],
                                        operation_index=best_match["op_index"],
                                        categorie=vlines[vl_idx].get("categorie", "") if vlines and 0 <= vl_idx < len(vlines) else _op.get("Catégorie", ""),
                                        sous_categorie=vlines[vl_idx].get("sous_categorie", "") if vlines and 0 <= vl_idx < len(vlines) else _op.get("Sous-catégorie", ""),
                                        fournisseur=ocr_data.get("supplier", "") if ocr_data else "",
                                        date_operation=_op.get("Date", ""),
                                        montant=_amount,
                                        ventilation_index=vl_idx,
                                    )
                                except Exception:
                                    pass
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
                else:
                    success = justificatif_service.associate(
                        filename,
                        best_match["op_file"],
                        best_match["op_index"],
                    )
                    if success:
                        write_rapprochement_metadata(
                            best_match["op_file"],
                            best_match["op_index"],
                            best_score,
                            "auto",
                        )
                        if best_match["op_file"] in ops_cache:
                            ops_cache[best_match["op_file"]][best_match["op_index"]]["Justificatif"] = True
                        # GED V2 enrichment
                        try:
                            from backend.services import ged_service
                            _op = best_match["op"]
                            _amount = abs(float(_op.get("Débit", 0) or 0)) or abs(float(_op.get("Crédit", 0) or 0))
                            ged_service.enrich_metadata_on_association(
                                justificatif_filename=filename,
                                operation_file=best_match["op_file"],
                                operation_index=best_match["op_index"],
                                categorie=_op.get("Catégorie", ""),
                                sous_categorie=_op.get("Sous-catégorie", ""),
                                fournisseur=ocr_data.get("supplier", "") if ocr_data else "",
                                date_operation=_op.get("Date", ""),
                                montant=_amount,
                                ventilation_index=None,
                            )
                        except Exception:
                            pass
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

    # Compter les justificatifs restants en attente après traitement
    justificatifs_restants = len(list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf")))

    return {
        "total_justificatifs_traites": len(pending_pdfs),
        "associations_auto": associations_auto,
        "suggestions_fortes": suggestions_fortes,
        "sans_correspondance": sans_correspondance,
        "justificatifs_restants": justificatifs_restants,
        "ran_at": now,
    }


def get_unmatched_summary() -> dict:
    """Compteurs : opérations sans justificatif / justificatifs en attente."""
    ensure_directories()

    # Justificatifs en attente (exclure ceux déjà référencés par une opération)
    from backend.services.justificatif_service import get_all_referenced_justificatifs
    referenced = get_all_referenced_justificatifs()
    attente_files = list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"))
    en_attente = len([f for f in attente_files if f.name not in referenced])

    # Opérations sans justificatif (compter sous-lignes pour ops ventilées)
    ops_sans = 0
    for f in operation_service.list_operation_files():
        try:
            ops = operation_service.load_operations(f["filename"])
            for op in ops:
                vlines = op.get("ventilation", [])
                if vlines:
                    ops_sans += sum(1 for vl in vlines if not vl.get("justificatif"))
                elif not op.get("Justificatif"):
                    ops_sans += 1
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


_BATCH_HINTS_CACHE: dict[str, tuple[tuple, dict]] = {}
"""Cache : filename → (signature, hints_dict).
signature = (ops_mtime, frozenset_des_mtimes_des_pending_ocr) — invalide dès qu'un fichier bouge."""


def get_batch_hints(filename: str) -> dict:
    """
    Pour un fichier d'opérations, retourne {index: best_score}
    pour toutes les opérations non associées.
    Utilisé par l'éditeur pour afficher les badges de suggestion.

    Cachée par (mtime du fichier ops + ensemble des mtimes des pending OCR).
    Le calcul coûte O(N_ops × N_pending_ocr × compute_score), soit 1-2s pour
    un mois classique — le cache évite de recalculer tant que rien n'a bougé.
    """
    ensure_directories()
    # Signature cache
    from backend.core.config import IMPORTS_OPERATIONS_DIR
    ops_path = IMPORTS_OPERATIONS_DIR / filename
    try:
        ops_mtime = ops_path.stat().st_mtime
    except OSError:
        return {}

    # Collecter les pending OCR et leurs mtimes pour la signature
    from backend.services.justificatif_service import get_all_referenced_justificatifs
    referenced = get_all_referenced_justificatifs()
    pending_paths: list = []
    if JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
            if pdf_path.name in referenced:
                continue
            pending_paths.append(pdf_path)
    pending_mtimes = frozenset((p.name, p.stat().st_mtime) for p in pending_paths)
    signature = (ops_mtime, pending_mtimes)

    cached = _BATCH_HINTS_CACHE.get(filename)
    if cached and cached[0] == signature:
        return cached[1]

    try:
        ops = operation_service.load_operations(filename)
    except Exception:
        return {}

    pending_ocr: list[tuple[str, dict]] = []
    for pdf_path in pending_paths:
        ocr_data = _load_ocr_data(pdf_path.name)
        pending_ocr.append((pdf_path.name, ocr_data))

    if not pending_ocr:
        _BATCH_HINTS_CACHE[filename] = (signature, {})
        return {}

    hints: dict[str, float] = {}
    for idx, op in enumerate(ops):
        vlines = op.get("ventilation", [])
        if vlines:
            # Op ventilée : scorer chaque sous-ligne individuellement
            for vl_idx, vl in enumerate(vlines):
                if vl.get("justificatif"):
                    continue
                best = 0.0
                for _, ocr_data in pending_ocr:
                    result = compute_score(
                        ocr_data,
                        op,
                        override_montant=vl.get("montant", 0),
                        override_categorie=vl.get("categorie", ""),
                        override_sous_categorie=vl.get("sous_categorie", ""),
                    )
                    if result["total"] > best:
                        best = result["total"]
                if best >= 0.60:
                    hints[f"{idx}:{vl_idx}"] = round(best, 4)
        else:
            if op.get("Justificatif"):
                continue
            best = 0.0
            for _, ocr_data in pending_ocr:
                result = compute_score(ocr_data, op)
                if result["total"] > best:
                    best = result["total"]
            if best >= 0.60:
                hints[str(idx)] = round(best, 4)

    _BATCH_HINTS_CACHE[filename] = (signature, hints)
    return hints


def get_batch_justificatif_scores() -> dict:
    """
    Pour tous les justificatifs en attente, retourne {filename: best_score}.
    Utilisé par la galerie pour les filtres de correspondance.
    """
    ensure_directories()
    if not JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        return {}

    # Charger toutes les opérations non associées (+ sous-lignes ventilées)
    # Tuples: (filename, idx, op, override_montant_or_None, override_categorie_or_None)
    all_targets: list[tuple[str, int, dict, Optional[float], Optional[str]]] = []
    for f in operation_service.list_operation_files():
        try:
            ops = operation_service.load_operations(f["filename"])
            for idx, op in enumerate(ops):
                vlines = op.get("ventilation", [])
                if vlines:
                    for vl in vlines:
                        if not vl.get("justificatif"):
                            all_targets.append((
                                f["filename"], idx, op,
                                vl.get("montant", 0),
                                vl.get("categorie", ""),
                            ))
                elif not op.get("Justificatif"):
                    all_targets.append((f["filename"], idx, op, None, None))
        except Exception:
            continue

    if not all_targets:
        return {}

    from backend.services.justificatif_service import get_all_referenced_justificatifs
    referenced = get_all_referenced_justificatifs()

    scores: dict[str, float] = {}
    for pdf_path in JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"):
        if pdf_path.name in referenced:
            continue
        ocr_data = _load_ocr_data(pdf_path.name)
        best = 0.0
        for _, _, op, override_m, override_c in all_targets:
            result = compute_score(
                ocr_data,
                op,
                override_montant=override_m,
                override_categorie=override_c,
            )
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
    ventilation_index: Optional[int] = None,
) -> None:
    """Écrit les métadonnées de rapprochement dans l'opération ou une sous-ligne."""
    try:
        ops = operation_service.load_operations(operation_file)
        if 0 <= operation_index < len(ops):
            op = ops[operation_index]
            if ventilation_index is not None:
                vlines = op.get("ventilation", [])
                if 0 <= ventilation_index < len(vlines):
                    vlines[ventilation_index]["rapprochement_score"] = round(score, 4)
                    vlines[ventilation_index]["rapprochement_mode"] = mode
                    vlines[ventilation_index]["rapprochement_date"] = datetime.now().isoformat()
            else:
                op["rapprochement_score"] = round(score, 4)
                op["rapprochement_mode"] = mode
                op["rapprochement_date"] = datetime.now().isoformat()
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
