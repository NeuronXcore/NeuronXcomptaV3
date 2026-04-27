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
from functools import lru_cache
from pathlib import Path
from typing import Optional

from backend.core.config import (
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
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
    Score de correspondance montant TTC (dégradation progressive ±10%).

    Paliers sur l'écart relatif :
    - Exact (0%) → 1.0
    - ≤ 1%  → 0.95
    - ≤ 2%  → 0.90
    - ≤ 3%  → 0.85
    - ≤ 5%  → 0.70
    - ≤ 10% → 0.40
    - > 10% → 0.0

    Tolérance élargie pour absorber les variations TTC réelles :
    - frais bancaires, arrondis, change forex (USD→EUR pour OpenAI/Mistral)
    - taux variables sur abonnements Stripe / facturation prorata

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
        base_score = 0.90
    elif ecart <= 0.03:
        base_score = 0.85
    elif ecart <= 0.05:
        base_score = 0.70
    elif ecart <= 0.10:
        base_score = 0.40
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
    Score fournisseur multi-stratégie : max(substring, Jaccard, Levenshtein, aliases).

    Stratégies :
    1. Substring match : fournisseur présent dans le libellé bancaire → 1.0
       (ex : "amazon" dans "PRLVSEPAAMAZONPAYMENT")
    2. Jaccard similarity sur tokens normalisés (hors stopwords)
    3. Levenshtein ratio (via difflib.SequenceMatcher) sur formes concaténées ;
       plancher 0.5 pour éviter le bruit
    4. Aliases fallback : si 1-3 retournent tous 0, vérifier la table
       `data/aliases_fournisseurs.json` (ex: "boulanger" → "paypaleuropes",
       "essence" → "qpf"/"avia"/"total"). Score 0.85 (signal plus faible que
       match lexical direct). Auto-enrichi par les associations manuelles.
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

    base = max(substring, jaccard, lev)

    # 4) Aliases fallback uniquement si aucun signal lexical direct.
    # Évite d'écraser un score lexical fort par un alias plus faible.
    if base > 0.0:
        return base
    try:
        from backend.services import aliases_service
        return aliases_service.score_aliases(j_fournisseur, o_libelle)
    except Exception:
        return 0.0


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


@lru_cache(maxsize=1024)
def _ml_predict_for_supplier(
    supplier_key: str,
) -> tuple[Optional[str], Optional[str], float]:
    """
    Prédiction ML cachée pour un fournisseur normalisé (lowercase strip).

    Retourne `(predicted_cat, predicted_sub, confidence)`.
    - Rules-based d'abord (confiance 1.0 quand match)
    - Sklearn fallback sinon (confiance réelle, accepté si ≥ 0.5)
    - `(None, None, 0.0)` si rien d'exploitable

    Cache **intra-run** : `_run_auto_rapprochement_locked` appelle `cache_clear()`
    en début de run pour éviter toute stale après un retraining ML. Sur 1 run
    auto-rapprochement, la même paire (supplier × N ops) ne fait qu'1 prédiction.

    `supplier_key` doit déjà être normalisé (lowercase strip) — la normalisation
    est faite à l'appelant pour éviter de cacher des variantes de la même clé.
    """
    if not supplier_key:
        return (None, None, 0.0)

    try:
        from backend.services import ml_service
    except Exception:
        return (None, None, 0.0)

    # 1) Rules-based (confiance 1.0 quand ça hit)
    try:
        rules_pred = ml_service.predict_category(supplier_key)
    except Exception:
        rules_pred = None
    if rules_pred:
        try:
            predicted_sub = ml_service.predict_subcategory(supplier_key)
        except Exception:
            predicted_sub = None
        return (rules_pred, predicted_sub, 1.0)

    # 2) Sklearn fallback avec confiance réelle
    try:
        cat, conf, _risk = ml_service.evaluate_hallucination_risk(supplier_key)
    except Exception:
        cat, conf = None, 0.0
    if cat and conf >= 0.5:
        return (cat, None, float(conf))

    return (None, None, 0.0)


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

    # ── Stratégie 2 : fallback ML (cache intra-run via _ml_predict_for_supplier) ──
    if not ocr_fournisseur:
        return None

    libelle = ocr_fournisseur.strip().lower()
    if not libelle:
        return None

    predicted_cat, predicted_sub, confidence = _ml_predict_for_supplier(libelle)

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

    # Score montant : MAX sur tous les montants candidats (filename_amount canonique,
    # best_amount OCR, et tableau OCR amounts complet). Robustesse contre les bugs
    # OCR qui ont mal sélectionné best_amount (ex: openai 824 alors que la bonne
    # valeur 24.0 est dans amounts[]). Le filename canonique
    # (supplier_YYYYMMDD_amount.pdf) est généralement la source la plus fiable.
    j_amounts: list = []
    fa = justificatif_ocr.get("filename_amount")
    if fa is not None:
        j_amounts.append(fa)
    ba = justificatif_ocr.get("best_amount")
    if ba is not None:
        j_amounts.append(ba)
    raw_amounts = justificatif_ocr.get("amounts") or []
    if isinstance(raw_amounts, list):
        j_amounts.extend(raw_amounts)
    seen: set = set()
    deduped: list = []
    for a in j_amounts:
        try:
            af = float(a)
        except (TypeError, ValueError):
            continue
        if af in seen:
            continue
        seen.add(af)
        deduped.append(af)
    if deduped:
        s_montant = max(score_montant(a, o_montant) for a in deduped)
        j_amount = next(
            (a for a in deduped if score_montant(a, o_montant) == s_montant),
            deduped[0],
        )
    else:
        s_montant = 0.0
        j_amount = None  # noqa: F841 (conservé pour compat éventuelle)
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


_FILENAME_DATE_RE = re.compile(r"_(\d{4})(\d{2})(\d{2})(?:_|\.)")


def _extract_pdf_date(filename: str, ocr_data: dict) -> Optional[datetime]:
    """Date de référence d'un justificatif (filename canonique > OCR best_date)."""
    m = _FILENAME_DATE_RE.search(filename)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return _parse_date(ocr_data.get("best_date") or "")


def _compute_scope_window(year: int, month: int) -> tuple[datetime, datetime]:
    """
    Fenêtre temporelle ±1 mois autour de (year, month) pour le scope-mois
    de l'auto-rapprochement. Gère les overflows année (déc → janv N+1, janv → déc N-1).

    Ex. (2025, 5) → (2025-04-01 00:00:00, 2025-06-30 23:59:59)
    Ex. (2025, 1) → (2024-12-01 00:00:00, 2025-02-28 23:59:59)
    Ex. (2025, 12) → (2025-11-01 00:00:00, 2026-01-31 23:59:59)
    """
    from calendar import monthrange

    if month == 1:
        start_year, start_month = year - 1, 12
    else:
        start_year, start_month = year, month - 1

    if month == 12:
        end_year, end_month = year + 1, 1
    else:
        end_year, end_month = year, month + 1

    last_day = monthrange(end_year, end_month)[1]
    return (
        datetime(start_year, start_month, 1, 0, 0, 0),
        datetime(end_year, end_month, last_day, 23, 59, 59),
    )


_FILENAME_AMOUNT_RE = re.compile(r"_(\d+(?:\.\d{1,2})?)(?:_[a-z0-9]+)*\.pdf$", re.IGNORECASE)


def _extract_filename_amount(filename: str) -> Optional[float]:
    """Extrait le montant canonique du filename (supplier_YYYYMMDD_amount[.suffix].pdf)."""
    m = _FILENAME_AMOUNT_RE.search(filename)
    if not m:
        return None
    try:
        return float(m.group(1))
    except (TypeError, ValueError):
        return None


def _load_ocr_data(justificatif_filename: str) -> dict:
    """Charge les données OCR d'un justificatif. Retourne un dict vide-safe.

    Inclut :
    - Les hints cat/sous-cat stockés au top-level du .ocr.json
      (category_hint, sous_categorie_hint) — utilisés comme override par
      `score_categorie()` pour booster le scoring sur fichiers déjà associés.
    - `filename_amount` : montant extrait du filename canonique
      (supplier_YYYYMMDD_amount.pdf). Plus fiable que `best_amount` OCR
      qui peut mal sélectionner (ex: openai 824 alors que 24.0 est dans amounts[]).
    """
    try:
        from backend.services import ocr_service
        filepath = justificatif_service.get_justificatif_path(justificatif_filename)
        if filepath:
            cached = ocr_service.get_cached_result(filepath)
            if cached and cached.get("status") == "success":
                ed = dict(cached.get("extracted_data", {}))
                ed["category_hint"] = cached.get("category_hint")
                ed["sous_categorie_hint"] = cached.get("sous_categorie_hint")
                # Montant canonique du filename : robustesse anti-OCR-erronés.
                fa = _extract_filename_amount(justificatif_filename)
                if fa is not None:
                    ed["filename_amount"] = fa
                return ed
    except Exception:
        pass
    # Fallback minimal : même sans .ocr.json, exposer le filename_amount
    fa = _extract_filename_amount(justificatif_filename)
    return {"filename_amount": fa} if fa is not None else {}


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


def _build_referenced_index() -> dict[str, list[dict]]:
    """Map {filename: [{operation_file, operation_index, libelle, locked, ventilation_index}]}
    en 1 scan complet des ops. Utilisé pour enrichir `get_filtered_suggestions` avec
    `is_referenced` + `referenced_by` quand `include_referenced=True`.
    """
    index: dict[str, list[dict]] = {}
    for f in operation_service.list_operation_files():
        try:
            ops = operation_service.load_operations(f["filename"])
        except Exception:
            continue
        for idx, op in enumerate(ops):
            lien = op.get("Lien justificatif", "") or ""
            if lien:
                fname = lien.split("/")[-1]
                index.setdefault(fname, []).append({
                    "operation_file": f["filename"],
                    "operation_index": idx,
                    "libelle": op.get("Libellé", ""),
                    "locked": bool(op.get("locked")),
                    "ventilation_index": None,
                })
            for vl_idx, vl in enumerate(op.get("ventilation", []) or []):
                vl_lien = vl.get("justificatif", "") or ""
                if vl_lien:
                    fname = vl_lien.split("/")[-1]
                    index.setdefault(fname, []).append({
                        "operation_file": f["filename"],
                        "operation_index": idx,
                        "libelle": vl.get("libelle") or op.get("Libellé", ""),
                        "locked": bool(op.get("locked")),
                        "ventilation_index": vl_idx,
                    })
    return index


def get_filtered_suggestions(
    operation_file: str,
    operation_index: int,
    montant_min: Optional[float] = None,
    montant_max: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    ventilation_index: Optional[int] = None,
    include_referenced: bool = False,
) -> list:
    """Suggestions filtrées de justificatifs pour une opération (drawer manuel).

    Si `include_referenced=True` : inclut aussi les PDFs déjà référencés par
    une autre op (scan en_attente/ + traites/). Chaque suggestion est enrichie
    de `is_referenced: bool` et `referenced_by: {operation_file, operation_index,
    libelle, locked, ventilation_index} | None`.
    """
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

    # Itérer sur en_attente/ + (si include_referenced) traites/.
    # Les PDFs traites/ ne sont scannés que sur demande pour ne pas alourdir le
    # cas standard. Dedup par filename pour éviter les doublons d'affichage si
    # un PDF existe en double (cas hash_conflict).
    pdf_iter = list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"))
    if include_referenced and JUSTIFICATIFS_TRAITES_DIR.exists():
        seen_names = {p.name for p in pdf_iter}
        for p in JUSTIFICATIFS_TRAITES_DIR.glob("*.pdf"):
            if p.name not in seen_names:
                pdf_iter.append(p)
                seen_names.add(p.name)

    suggestions = []
    for pdf_path in pdf_iter:
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

    # Exclure les justificatifs déjà associés à une autre opération.
    # Si include_referenced=True : ne pas exclure mais enrichir chaque suggestion
    # avec is_referenced + referenced_by (op qui le référence actuellement).
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

    if include_referenced:
        # Enrichir : pour chaque suggestion, calculer is_referenced + referenced_by
        # (excluant la cible courante pour ne pas se référencer soi-même).
        ref_index = _build_referenced_index()
        for s in suggestions:
            refs = ref_index.get(s["filename"], [])
            # Filtrer la cible courante de la liste des refs
            refs = [
                r for r in refs
                if not (
                    r["operation_file"] == operation_file
                    and r["operation_index"] == operation_index
                    and r.get("ventilation_index") == ventilation_index
                )
            ]
            if refs:
                # Prendre la première ref comme référent principal (cas usuel : 1 PDF = 1 op)
                first = refs[0]
                s["is_referenced"] = True
                s["referenced_by"] = {
                    "operation_file": first["operation_file"],
                    "operation_index": first["operation_index"],
                    "libelle": first["libelle"][:80] if first["libelle"] else "",
                    "locked": first["locked"],
                    "ventilation_index": first.get("ventilation_index"),
                }
            else:
                s["is_referenced"] = False
                s["referenced_by"] = None
    else:
        # Comportement par défaut : filtrer les référencés pour ne montrer que les libres
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
                        "op_locked": bool(op.get("locked", False)),
                        "op_locked_at": op.get("locked_at"),
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
                    "op_locked": bool(op.get("locked", False)),
                    "op_locked_at": op.get("locked_at"),
                })

    suggestions.sort(key=lambda s: s["score"]["total"], reverse=True)
    return suggestions[:max_results]


def run_auto_rapprochement(
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> dict:
    """
    Parcourt tous les justificatifs en attente et auto-associe ceux
    avec un score >= 0.95 et un match unique.

    Si `year` et `month` sont fournis, restreint le scope au mois ±1 (PDFs
    et ops) pour accélérer drastiquement le run sur grand volume. Sinon scan
    complet — appelé typiquement depuis sandbox / scan-rename / OCR upload
    où le contexte UI n'est pas connu.
    """
    with _auto_lock:
        return _run_auto_rapprochement_locked(year=year, month=month)


def _run_auto_rapprochement_locked(
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> dict:
    ensure_directories()
    now = datetime.now().isoformat()
    start_ts = datetime.now()

    # Reset du cache ML (intra-run) — évite toute stale après un retraining ML
    # entre deux runs. Sur un run, la même paire (supplier × N ops) profite
    # du cache pour ne faire qu'1 prédiction ML par fournisseur unique.
    _ml_predict_for_supplier.cache_clear()

    # Calculer la fenêtre de scope si year+month fournis (±1 mois autour).
    scope_start: Optional[datetime] = None
    scope_end: Optional[datetime] = None
    scope_label: str = "global"
    if year is not None and month is not None:
        try:
            scope_start, scope_end = _compute_scope_window(year, month)
            scope_label = f"{year:04d}-{month:02d}"
        except (ValueError, TypeError) as e:
            logger.warning(f"auto_rapprochement: scope invalide ({year=}, {month=}): {e} — fallback global")
            scope_start = scope_end = None

    # Charger tous les justificatifs en attente
    all_pending = list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"))

    # Skip les PDFs déjà référencés par une op (cache TTL 5s côté justificatif_service).
    # Évite de scorer des fichiers qui sont en en_attente/ par accident (ex. miettes
    # post-split/merge) mais qui sont déjà liés à une op via Lien justificatif ou
    # ventilation — la passe `apply_link_repair` les nettoie au boot, mais on filtre
    # par sécurité.
    referenced = justificatif_service.get_all_referenced_justificatifs()
    pending_pdfs_unfiltered = [p for p in all_pending if p.name not in referenced]
    skipped_referenced = len(all_pending) - len(pending_pdfs_unfiltered)

    # Pré-filtre scope-mois sur les PDFs : ne garder que ceux dont la date
    # (filename canonique ou OCR best_date) tombe dans la fenêtre. Sans date
    # inférable → skip (choix produit : les passes globales les couvrent).
    skipped_no_date = 0
    skipped_out_of_scope = 0
    if scope_start is not None and scope_end is not None:
        pending_pdfs = []
        for p in pending_pdfs_unfiltered:
            ocr = _load_ocr_data(p.name)
            pdf_date = _extract_pdf_date(p.name, ocr)
            if pdf_date is None:
                skipped_no_date += 1
                continue
            if pdf_date < scope_start or pdf_date > scope_end:
                skipped_out_of_scope += 1
                continue
            pending_pdfs.append(p)
    else:
        pending_pdfs = pending_pdfs_unfiltered

    if not pending_pdfs:
        logger.info(
            f"auto_rapprochement: noop scope={scope_label} "
            f"(skipped {skipped_referenced} ref, {skipped_no_date} no-date, "
            f"{skipped_out_of_scope} hors scope)"
        )
        return {
            "total_justificatifs_traites": 0,
            "associations_auto": 0,
            "suggestions_fortes": 0,
            "sans_correspondance": 0,
            "ran_at": now,
        }

    # Cache des fichiers d'opérations (full load — indices préservés par position
    # dans la liste, critique pour save_operations + GED enrichment + ventilation).
    # Le filtre scope-mois est appliqué LATE dans le loop sur la Date de chaque op,
    # même coût que le pré-filtre ±15j existant.
    op_files = operation_service.list_operation_files()
    ops_cache: dict[str, list] = {}
    for f in op_files:
        try:
            ops_cache[f["filename"]] = operation_service.load_operations(f["filename"])
        except Exception:
            continue

    associations_auto = 0
    associations_detail: list[dict] = []
    suggestions_fortes = 0
    sans_correspondance = 0
    score_calls = 0
    skipped_date_window = 0
    skipped_out_of_scope_ops = 0

    logger.info(
        f"auto_rapprochement: start scope={scope_label}, "
        f"{len(pending_pdfs)} pending PDFs "
        f"(skipped {skipped_referenced} ref, {skipped_no_date} no-date, "
        f"{skipped_out_of_scope} hors scope), "
        f"{sum(len(ops) for ops in ops_cache.values())} ops in {len(ops_cache)} files"
    )

    for pdf_path in pending_pdfs:
        filename = pdf_path.name
        ocr_data = _load_ocr_data(filename)
        # Date de référence du PDF (filename canonique ou OCR best_date) pour
        # pré-filtrer les ops candidates : score_date renvoie 0 au-delà de ±14j
        # → le gate de ligne ~830 rejette → inutile de scorer hors fenêtre.
        # Fallback : si pas de date inférable, on garde le scan complet.
        ref_date = _extract_pdf_date(filename, ocr_data)

        best_score = 0.0
        best_match = None
        second_best_score = 0.0

        for op_file, ops in ops_cache.items():
            for idx, op in enumerate(ops):
                if op.get("locked"):
                    continue  # skip silencieusement les ops verrouillées manuellement

                # Pré-filtre scope-mois (si activé) : skip les ops hors fenêtre.
                # Cheap : 1 _parse_date par op. Cohérent avec le filtre PDF en amont.
                if scope_start is not None and scope_end is not None:
                    op_date_scope = _parse_date(op.get("Date", ""))
                    if op_date_scope is not None and (
                        op_date_scope < scope_start or op_date_scope > scope_end
                    ):
                        skipped_out_of_scope_ops += 1
                        continue

                # Pré-filtre date : ±15j autour de la date de référence du PDF.
                # Strictement plus large que le gate (≤14j → score=0) pour garder
                # la marge de tolérance, mais coupe O(N×M) sur les paires impossibles.
                if ref_date is not None:
                    op_date = _parse_date(op.get("Date", ""))
                    if op_date and abs((op_date - ref_date).days) > 15:
                        skipped_date_window += 1
                        continue

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
                        score_calls += 1
                        # Auto-score : montant TTC + date uniquement (0.55/0.45).
                        # Fournisseur et catégorie sont écartés du total auto, mais
                        # restent calculés (utiles pour le drawer manuel + garde-fou).
                        auto_total = round(
                            0.55 * result["detail"]["montant"]
                            + 0.45 * result["detail"]["date"],
                            4,
                        )
                        if auto_total > best_score:
                            second_best_score = best_score
                            best_score = auto_total
                            best_match = {
                                "op_file": op_file,
                                "op_index": idx,
                                "score": result,
                                "op": op,
                                "ventilation_index": vl_idx,
                            }
                        elif auto_total > second_best_score:
                            second_best_score = auto_total
                else:
                    if op.get("Justificatif"):
                        continue
                    result = compute_score(ocr_data, op)
                    score_calls += 1
                    auto_total = round(
                        0.55 * result["detail"]["montant"]
                        + 0.45 * result["detail"]["date"],
                        4,
                    )
                    if auto_total > best_score:
                        second_best_score = best_score
                        best_score = auto_total
                        best_match = {
                            "op_file": op_file,
                            "op_index": idx,
                            "score": result,
                            "op": op,
                            "ventilation_index": None,
                        }
                    elif auto_total > second_best_score:
                        second_best_score = auto_total

        if best_score < 0.60:
            sans_correspondance += 1
            continue

        # Gate date : refuser toute auto-association si l'écart de date > 14j
        # (score_date == 0.0). Protège contre les cross-year hallucinés.
        # Les suggestions fortes restent visibles dans le drawer manuel.
        best_date_score = (
            (best_match.get("score") or {}).get("detail", {}).get("date", None)
            if best_match else None
        )
        if best_date_score is not None and best_date_score <= 0.0:
            if best_score >= 0.75:
                suggestions_fortes += 1
            else:
                sans_correspondance += 1
            continue

        # Garde-fou fournisseur strict : rejet auto si score_fournisseur=0.
        # Sans signal lexical du fournisseur dans le libellé bancaire, on n'a
        # aucune preuve que le PDF correspond à cette op — montant + date
        # similaires ne suffisent pas (ex. EDF 48.20€ le 01/05 vs LW MONTAUBAN
        # 47.80€ le 29/04 : 2 ops totalement distinctes mais montant + date
        # ressemblants). La suggestion reste visible dans le drawer manuel
        # pour validation humaine.
        if best_match:
            best_fournisseur_score = best_match["score"]["detail"].get("fournisseur", 0.0)
            if best_fournisseur_score == 0.0:
                if best_score >= 0.75:
                    suggestions_fortes += 1
                else:
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
                                # Auto-lock sur score très confiant (≥ 0.95) — évite régressions
                                # accidentelles sans figer les matches 0.80-0.95 éditables.
                                locked_by_auto = False
                                if best_score >= 0.95:
                                    try:
                                        cached_op["locked"] = True
                                        cached_op["locked_at"] = datetime.now().isoformat(timespec="seconds")
                                        operation_service.save_operations(cached_ops, filename=best_match["op_file"])
                                        locked_by_auto = True
                                    except Exception as e:
                                        logger.warning(f"Auto-lock échoué {filename}: {e}")
                                _op_v = best_match["op"]
                                _vl_amount = float(vlines[vl_idx].get("montant", 0)) if vlines and 0 <= vl_idx < len(vlines) else 0
                                associations_detail.append({
                                    "justificatif": filename,
                                    "operation_file": best_match["op_file"],
                                    "operation_index": best_match["op_index"],
                                    "ventilation_index": vl_idx,
                                    "libelle": _op_v.get("Libellé", ""),
                                    "date": _op_v.get("Date", ""),
                                    "montant": _vl_amount,
                                    "score": best_score,
                                    "locked": locked_by_auto,
                                })
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
                        # Auto-lock si score ≥ 0.95 (très haute confiance)
                        locked_by_auto = False
                        if best_score >= 0.95:
                            try:
                                fresh_ops = operation_service.load_operations(best_match["op_file"])
                                if 0 <= best_match["op_index"] < len(fresh_ops):
                                    fresh_ops[best_match["op_index"]]["locked"] = True
                                    fresh_ops[best_match["op_index"]]["locked_at"] = datetime.now().isoformat(timespec="seconds")
                                    operation_service.save_operations(fresh_ops, filename=best_match["op_file"])
                                    locked_by_auto = True
                            except Exception as e:
                                logger.warning(f"Auto-lock échoué {filename}: {e}")
                        _op_s = best_match["op"]
                        _op_amount = abs(float(_op_s.get("Débit", 0) or 0)) or abs(float(_op_s.get("Crédit", 0) or 0))
                        associations_detail.append({
                            "justificatif": filename,
                            "operation_file": best_match["op_file"],
                            "operation_index": best_match["op_index"],
                            "ventilation_index": None,
                            "libelle": _op_s.get("Libellé", ""),
                            "date": _op_s.get("Date", ""),
                            "montant": _op_amount,
                            "score": best_score,
                            "locked": locked_by_auto,
                        })
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

    elapsed = (datetime.now() - start_ts).total_seconds()
    cache_info = _ml_predict_for_supplier.cache_info()
    logger.info(
        f"auto_rapprochement: done in {elapsed:.1f}s scope={scope_label} — "
        f"{associations_auto} auto, {suggestions_fortes} fortes, {sans_correspondance} skip "
        f"(score_calls={score_calls}, skipped_date_window={skipped_date_window}, "
        f"skipped_out_of_scope_ops={skipped_out_of_scope_ops}, "
        f"ml_cache=hits={cache_info.hits}/misses={cache_info.misses})"
    )

    return {
        "total_justificatifs_traites": len(pending_pdfs),
        "associations_auto": associations_auto,
        "associations_detail": associations_detail,
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
    # Tuples: (filename, idx, op, override_montant_or_None, override_categorie_or_None,
    #         override_sous_categorie_or_None). La propagation de la sous-catégorie
    #         aligne ce scoring avec get_batch_hints() pour éviter les divergences
    #         score_categorie sur les ops ventilées (cat match + sub mismatch = 0.6).
    all_targets: list[tuple[str, int, dict, Optional[float], Optional[str], Optional[str]]] = []
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
                                vl.get("sous_categorie", ""),
                            ))
                elif not op.get("Justificatif"):
                    all_targets.append((f["filename"], idx, op, None, None, None))
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
        for _, _, op, override_m, override_c, override_sc in all_targets:
            result = compute_score(
                ocr_data,
                op,
                override_montant=override_m,
                override_categorie=override_c,
                override_sous_categorie=override_sc,
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
