"""
Service de calcul des alertes automatiques sur les opérations comptables.
"""
from __future__ import annotations

import math
import statistics
from collections import Counter
from typing import Dict, List, Optional


def _sanitize_montant(val) -> float:
    """Retourne 0.0 si val est None, NaN ou Inf."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        if math.isnan(val) or math.isinf(val):
            return 0.0
        return float(val)
    return 0.0


def compute_alertes(
    op: dict,
    stats: dict,
    seen_keys: Dict[tuple, int],
) -> List[str]:
    """Détecte les alertes sur une opération selon les règles métier."""
    alertes: List[str] = []
    resolues = op.get("alertes_resolues", []) or []

    # 1. justificatif_manquant (respecte les exemptions configurées)
    from backend.services.justificatif_exemption_service import is_justificatif_required
    categorie = op.get("Catégorie", "") or ""
    sous_cat = op.get("Sous-catégorie", "") or ""
    vlines = op.get("ventilation", [])
    if vlines:
        # Op ventilée : alerte si au moins une sous-ligne non-exemptée sans justificatif
        has_missing = False
        for vl in vlines:
            vl_cat = (vl.get("categorie") or "").strip()
            vl_sub = (vl.get("sous_categorie") or "").strip()
            if is_justificatif_required(vl_cat, vl_sub) and not vl.get("justificatif"):
                has_missing = True
                break
        if has_missing:
            alertes.append("justificatif_manquant")
    else:
        justif = op.get("Justificatif")
        lien_justif = op.get("Lien justificatif", "")
        if not justif and not lien_justif and is_justificatif_required(categorie, sous_cat):
            alertes.append("justificatif_manquant")

    # 2. a_categoriser (skip pour ops ventilées — catégorie "Ventilé" est intentionnelle)
    if not vlines and categorie in ("", "Non catégorisé", "?"):
        alertes.append("a_categoriser")

    # 3. confiance_faible
    cat_source = op.get("categorisation_source", "")
    ml_conf = op.get("ml_confidence", 1.0)
    if cat_source == "ml" and isinstance(ml_conf, (int, float)) and ml_conf < 0.60:
        alertes.append("confiance_faible")

    # 4. montant_a_verifier
    debit = _sanitize_montant(op.get("Débit", 0))
    credit = _sanitize_montant(op.get("Crédit", 0))
    montant = abs(debit) if debit else abs(credit)
    mean = stats.get("mean", 0)
    std = stats.get("std", 0)
    if std > 0 and montant > 0:
        z_score = (montant - mean) / std
        if z_score > 3.0:
            alertes.append("montant_a_verifier")

    # 5. doublon_suspect
    libelle = op.get("Libellé", "") or ""
    key = (libelle, debit, credit)
    if seen_keys.get(key, 0) > 1:
        alertes.append("doublon_suspect")

    # Filtrer les alertes déjà résolues
    alertes = [a for a in alertes if a not in resolues]

    return alertes


def refresh_alertes_fichier(operations: List[dict]) -> List[dict]:
    """Recalcule les alertes sur toute la liste d'opérations.

    Modifie la liste en place et la retourne.
    """
    # 1. Calculer mean/std des montants
    montants: List[float] = []
    for op in operations:
        debit = _sanitize_montant(op.get("Débit", 0))
        credit = _sanitize_montant(op.get("Crédit", 0))
        m = abs(debit) if debit else abs(credit)
        if m > 0:
            montants.append(m)

    if len(montants) >= 2:
        stats = {
            "mean": statistics.mean(montants),
            "std": statistics.stdev(montants),
        }
    elif len(montants) == 1:
        stats = {"mean": montants[0], "std": 0.0}
    else:
        stats = {"mean": 0.0, "std": 0.0}

    # 2. Détecter les doublons
    keys: List[tuple] = []
    for op in operations:
        libelle = op.get("Libellé", "") or ""
        debit = _sanitize_montant(op.get("Débit", 0))
        credit = _sanitize_montant(op.get("Crédit", 0))
        keys.append((libelle, debit, credit))
    seen_keys = dict(Counter(keys))

    # 3. Calculer les alertes pour chaque opération
    for op in operations:
        nouvelles_alertes = compute_alertes(op, stats, seen_keys)
        op["alertes"] = nouvelles_alertes
        op["compte_attente"] = len(nouvelles_alertes) > 0

    return operations
