"""Service d'évaluation du risque fiscal pour chaque item de la plaquette (Session 39 P2).

Bascule la lecture de la plaquette de l'angle interne (challenge comptable)
vers l'angle externe (défendabilité fisc — préparation contrôle BNC SCP).

Règles de scoring (chaque driver appliqué une seule fois) :

  AGGRAVANTS (+1)
    categorie_sensible       : item.categories_neuronx ∩ CATEGORIES_SENSIBLES non vide
    forfait_applique         : flags apply_quote_part_vehicule / split_csg_deductible / split_urssaf_cotisations
    taux_justif_bas          : min(taux justif des categories_neuronx) < TAUX_JUSTIF_BAS
    ecart_n1_anormal         : |montant_plaquette - montant_plaquette_n1| / max(N-1, 1) > ECART_N1_ANORMAL
                                ET pas de commentaire utilisateur (auto-flag si écart non documenté)
    montant_eleve_sensible   : categorie_sensible ET montant_neuronx > MONTANT_ELEVE_SEUIL

  ATTÉNUANTS (-1)
    boi_cgi_cite             : regex BOI-?... ou art\\.?\\s*\\d+ dans item.commentaire
    statut_resolu            : item.statut == "resolu"
    statut_refus_justifie    : item.statut == "refus_justifie"

Le **niveau CRITIQUE est réservé aux overrides manuels** : le score auto plafonne
naturellement à 4 (5 aggravants − 1 atténuant) → ELEVE. Pour escalader, l'utilisateur
override avec un motif (traçabilité).

Score → niveau via SCORE_THRESHOLDS (ordre croissant) :
    < 2 → FAIBLE  |  >= 2 < 3 → MODERE  |  >= 3 < 999 → ELEVE  |  >= 999 → CRITIQUE
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional

from backend.models.plaquette_check import (
    PlaquetteCheckStatus,
    RisqueDriver,
    RisqueFiscalEvaluation,
    RisqueNiveau,
)

logger = logging.getLogger(__name__)


# ─── Constantes scoring ───

# Catégories typiquement scrutées en contrôle BNC (charges mixtes + forfaits)
CATEGORIES_SENSIBLES = {
    "véhicule", "vehicule",
    "repas", "restauration", "repas pro",
    "blanchissage",
    "cadeaux", "cadeau",
    "réception", "reception",
    "téléphone", "telephone",
    "internet",
    "energie", "énergie",
    "abonnement", "abonnements",
}

TAUX_JUSTIF_BAS = 0.80  # < 80 % justif déclenche driver
ECART_N1_ANORMAL = 0.50  # > 50 % d'écart vs N-1 déclenche driver
MONTANT_ELEVE_SEUIL = 5000.0  # € sur catégorie sensible

# Score (cumul drivers) → niveau (lookup par seuil croissant)
SCORE_THRESHOLDS: list[tuple[int, RisqueNiveau]] = [
    (0, RisqueNiveau.FAIBLE),
    (2, RisqueNiveau.MODERE),
    (3, RisqueNiveau.ELEVE),
    (999, RisqueNiveau.CRITIQUE),  # critique = override manuel uniquement
]

# Poids par niveau pour le score global pondéré
_NIVEAU_WEIGHT: dict[RisqueNiveau, int] = {
    RisqueNiveau.FAIBLE: 0,
    RisqueNiveau.MODERE: 1,
    RisqueNiveau.ELEVE: 2,
    RisqueNiveau.CRITIQUE: 3,
}

# Regex de détection BOI/CGI/LPF dans les commentaires
_BOI_CGI_REGEX = re.compile(
    r"BOI[\s\-]?[A-Z0-9\-]+|art(?:icle)?\.?\s*L?\d+[\s\-]?[A-Z0-9]*\s*(?:CGI|LPF)?",
    re.IGNORECASE,
)


# ─── Helpers ───


def _now_iso() -> str:
    return datetime.now().isoformat()


def _is_categorie_sensible(categories: list[str]) -> bool:
    """True si au moins une catégorie de l'item est dans la whitelist sensible."""
    if not categories:
        return False
    for c in categories:
        if (c or "").strip().lower() in CATEGORIES_SENSIBLES:
            return True
    return False


def _has_forfait_flag(mapping_flags: dict) -> bool:
    """True si l'item a un flag de forfait/quote-part (apply_quote_part_vehicule, split_csg_deductible, split_urssaf_cotisations)."""
    return bool(
        mapping_flags.get("apply_quote_part_vehicule")
        or mapping_flags.get("split_csg_deductible")
        or mapping_flags.get("split_urssaf_cotisations")
    )


def _detect_boi_refs(commentaire: str) -> list[str]:
    """Extrait les références BOI/CGI/LPF citées dans le commentaire."""
    if not commentaire:
        return []
    matches = _BOI_CGI_REGEX.findall(commentaire)
    # Dédup en préservant l'ordre
    seen: set[str] = set()
    out: list[str] = []
    for m in matches:
        key = m.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(m.strip())
    return out


def _min_taux_justif(categories: list[str], taux_justif_categorie: dict[str, float]) -> Optional[float]:
    """Retourne le min des taux justif pour les catégories de l'item, ou None si aucune mesurée."""
    if not categories:
        return None
    rates: list[float] = []
    for c in categories:
        if c in taux_justif_categorie:
            rates.append(taux_justif_categorie[c])
    return min(rates) if rates else None


def _score_to_niveau(score: int) -> RisqueNiveau:
    """Map score brut → niveau via SCORE_THRESHOLDS (ordre croissant)."""
    result = RisqueNiveau.FAIBLE
    for seuil, niveau in SCORE_THRESHOLDS:
        if score >= seuil:
            result = niveau
        else:
            break
    return result


# ─── Évaluation per-item ───


def evaluate_item(
    item: dict,
    mapping_flags: dict,
    taux_justif_categorie: dict[str, float],
    nb_ops_by_categorie: Optional[dict[str, int]] = None,
    nb_justifs_by_categorie: Optional[dict[str, int]] = None,
) -> RisqueFiscalEvaluation:
    """Calcule le risque fiscal d'un item.

    Args:
        item: dict de PlaquetteItem (montant_plaquette, montant_plaquette_n1, statut,
              commentaire, categories_neuronx, montant_neuronx, ...)
        mapping_flags: dict flags du mapping PCG (apply_quote_part_vehicule, etc.)
        taux_justif_categorie: dict {categorie: taux_justif (0..1)}
        nb_ops_by_categorie / nb_justifs_by_categorie: optionnels, pour la pièce
            "{n} justifs sur {m} ops" dans `pieces_disponibles`.

    Returns:
        RisqueFiscalEvaluation avec niveau auto-calculé, drivers détaillés,
        pieces_disponibles informatives, auto_calcule=True.
    """
    categories = item.get("categories_neuronx") or []
    montant_neuronx = float(item.get("montant_neuronx") or 0.0)
    montant_p = item.get("montant_plaquette")
    montant_p_n1 = item.get("montant_plaquette_n1")
    statut = (item.get("statut") or "").strip()
    commentaire = (item.get("commentaire") or "").strip()

    drivers: list[RisqueDriver] = []

    # +1 categorie_sensible
    sensible = _is_categorie_sensible(categories)
    if sensible:
        drivers.append(RisqueDriver(
            code="categorie_sensible",
            label="Catégorie sensible",
            delta_score=1,
            detail=", ".join(categories[:3]) or None,
        ))

    # +1 forfait_applique
    if _has_forfait_flag(mapping_flags):
        applied_flags = []
        if mapping_flags.get("apply_quote_part_vehicule"):
            applied_flags.append("quote-part véhicule")
        if mapping_flags.get("split_csg_deductible"):
            applied_flags.append("CSG déductible")
        if mapping_flags.get("split_urssaf_cotisations"):
            applied_flags.append("URSSAF cotisations")
        drivers.append(RisqueDriver(
            code="forfait_applique",
            label="Forfait / quote-part appliqué",
            delta_score=1,
            detail=" + ".join(applied_flags) or None,
        ))

    # +1 taux_justif_bas
    min_taux = _min_taux_justif(categories, taux_justif_categorie)
    if min_taux is not None and min_taux < TAUX_JUSTIF_BAS:
        drivers.append(RisqueDriver(
            code="taux_justif_bas",
            label="Taux de justificatifs faible",
            delta_score=1,
            detail=f"{int(min_taux * 100)} % (< {int(TAUX_JUSTIF_BAS * 100)} %)",
        ))

    # +1 ecart_n1_anormal (uniquement si pas de commentaire pour documenter)
    if (
        montant_p is not None
        and montant_p_n1 is not None
        and float(montant_p_n1) != 0
        and abs(float(montant_p) - float(montant_p_n1)) / max(abs(float(montant_p_n1)), 1.0) > ECART_N1_ANORMAL
        and not commentaire
    ):
        delta_pct = (float(montant_p) - float(montant_p_n1)) / max(abs(float(montant_p_n1)), 1.0) * 100
        drivers.append(RisqueDriver(
            code="ecart_n1_anormal",
            label="Écart N-1 anormal non documenté",
            delta_score=1,
            detail=f"{delta_pct:+.1f} % vs N-1",
        ))

    # +1 montant_eleve_sensible
    if sensible and montant_neuronx > MONTANT_ELEVE_SEUIL:
        drivers.append(RisqueDriver(
            code="montant_eleve_sensible",
            label="Montant élevé sur catégorie sensible",
            delta_score=1,
            detail=f"{montant_neuronx:,.0f} € (> {MONTANT_ELEVE_SEUIL:,.0f} €)".replace(",", " "),
        ))

    # -1 boi_cgi_cite
    boi_refs = _detect_boi_refs(commentaire)
    if boi_refs:
        drivers.append(RisqueDriver(
            code="boi_cgi_cite",
            label="Référence légale citée",
            delta_score=-1,
            detail=", ".join(boi_refs[:3]),
        ))

    # -1 statut_resolu / statut_refus_justifie
    if statut == "resolu":
        drivers.append(RisqueDriver(
            code="statut_resolu",
            label="Item résolu après discussion comptable",
            delta_score=-1,
        ))
    elif statut == "refus_justifie":
        drivers.append(RisqueDriver(
            code="statut_refus_justifie",
            label="Refus justifié documenté",
            delta_score=-1,
        ))

    # Calcul score brut
    score = sum(d.delta_score for d in drivers)
    niveau_auto = _score_to_niveau(score)

    # Pieces disponibles (informatives, n'affectent pas le score)
    pieces: list[str] = []
    if nb_ops_by_categorie and nb_justifs_by_categorie:
        total_ops = sum(nb_ops_by_categorie.get(c, 0) for c in categories)
        total_just = sum(nb_justifs_by_categorie.get(c, 0) for c in categories)
        if total_ops > 0:
            pct = int((total_just / total_ops) * 100)
            pieces.append(f"{total_just} justifs sur {total_ops} ops · {pct} %")
    if boi_refs:
        pieces.append(f"BOI/CGI cité : {', '.join(boi_refs[:3])}")
    if statut == "resolu":
        pieces.append("Item résolu après discussion comptable")
    if statut == "refus_justifie" and commentaire:
        pieces.append("Refus argumenté dans commentaire")

    # Préserver l'override existant si présent
    existing = item.get("risque_fiscal") or {}
    overridden_niveau = existing.get("overridden_niveau")
    overridden_motif = existing.get("overridden_motif")
    auto_calcule = existing.get("auto_calcule", True)

    # Niveau final = override si présent + auto_calcule=False, sinon auto
    if overridden_niveau and not auto_calcule:
        niveau_final = RisqueNiveau(overridden_niveau)
    else:
        niveau_final = niveau_auto
        overridden_niveau = None
        overridden_motif = None

    return RisqueFiscalEvaluation(
        niveau=niveau_final,
        score=score,
        drivers=drivers,
        pieces_disponibles=pieces,
        auto_calcule=auto_calcule and overridden_niveau is None,
        overridden_niveau=RisqueNiveau(overridden_niveau) if overridden_niveau else None,
        overridden_motif=overridden_motif,
        last_evaluated_at=_now_iso(),
    )


# ─── Évaluation batch ───


def _compute_taux_justif_categorie(year: int) -> tuple[dict[str, float], dict[str, int], dict[str, int]]:
    """Calcule {categorie: taux_justif} + {categorie: nb_ops} + {categorie: nb_justifs} sur les ops de l'année.

    Itère les ventilations également (sub_lines). Une op avec `Lien justificatif`
    non vide compte comme justifiée. Pour les ventilées, chaque sous-ligne est
    comptée séparément si elle a son propre `justificatif`.
    """
    from backend.services import operation_service

    files = operation_service.list_operation_files()
    year_files = [f for f in files if f.get("year") == year]
    nb_ops: dict[str, int] = {}
    nb_just: dict[str, int] = {}

    for finfo in year_files:
        try:
            ops = operation_service.load_operations(finfo["filename"])
        except Exception as e:
            logger.debug("Skipping file %s: %s", finfo.get("filename"), e)
            continue
        for op in ops:
            ventil = op.get("ventilation") or []
            if ventil:
                # Sous-lignes ventilées : compter chaque sub_line séparément
                for sub in ventil:
                    sub_cat = (sub.get("categorie") or "").strip()
                    if not sub_cat or sub_cat.lower() == "perso":
                        continue
                    nb_ops[sub_cat] = nb_ops.get(sub_cat, 0) + 1
                    if sub.get("justificatif"):
                        nb_just[sub_cat] = nb_just.get(sub_cat, 0) + 1
            else:
                cat = (op.get("Catégorie") or "").strip()
                if not cat or cat.lower() == "perso":
                    continue
                nb_ops[cat] = nb_ops.get(cat, 0) + 1
                if op.get("Lien justificatif"):
                    nb_just[cat] = nb_just.get(cat, 0) + 1

    taux: dict[str, float] = {}
    for cat, n in nb_ops.items():
        taux[cat] = nb_just.get(cat, 0) / n if n > 0 else 1.0
    return taux, nb_ops, nb_just


def evaluate_all_items(plaquette_check: dict, force_recompute: bool = False) -> dict:
    """Pour chaque item, calcule `risque_fiscal` si nécessaire.

    - Skip silencieux si `status == DECLARE` (snapshot figé, ne pas re-calculer).
    - Préserve les overrides manuels (`overridden_niveau` non None).
    - Re-calcule si jamais évalué OU si `force_recompute=True`.
    - Met à jour `risque_score_global` (moyenne pondérée par montant_neuronx).

    Le dict est muté + retourné pour chaînage.
    """
    status = plaquette_check.get("status")
    if status == PlaquetteCheckStatus.DECLARE.value:
        logger.debug("evaluate_all_items: skip — plaquette declared (figée)")
        return plaquette_check

    from backend.services import plaquette_pcg_mapping_service

    year = plaquette_check.get("year")
    if not year:
        return plaquette_check

    template = plaquette_check.get("cabinet_template") or "sygnatures_marenco"
    taux_justif, nb_ops_by_cat, nb_just_by_cat = _compute_taux_justif_categorie(year)

    items = plaquette_check.get("items", []) or []
    for item in items:
        # Skip si déjà évalué + pas de force_recompute + pas modifié récemment
        existing = item.get("risque_fiscal")
        if existing and not force_recompute:
            last_eval = existing.get("last_evaluated_at") or ""
            last_mod = item.get("last_modified_at") or ""
            if last_eval and last_eval >= last_mod:
                continue
        # Préserver override manuel : on recalcule les drivers mais on garde le niveau forcé
        _, _, flags = plaquette_pcg_mapping_service.resolve(item.get("compte_pcg"), template)
        evaluation = evaluate_item(
            item=item,
            mapping_flags=flags,
            taux_justif_categorie=taux_justif,
            nb_ops_by_categorie=nb_ops_by_cat,
            nb_justifs_by_categorie=nb_just_by_cat,
        )
        # Conversion dict (Pydantic → dict pour stockage JSON)
        item["risque_fiscal"] = evaluation.model_dump(mode="json")

    plaquette_check["risque_score_global"] = compute_global_score(items)
    return plaquette_check


def override_item_risque(
    plaquette_check: dict,
    item_id: str,
    niveau: RisqueNiveau,
    motif: str,
) -> dict:
    """Force le niveau d'un item + figer auto_calcule=False + stocker motif.

    Lève ValueError si item introuvable. Le dict est muté + l'item est retourné.
    """
    items = plaquette_check.get("items", []) or []
    item = next((i for i in items if i.get("item_id") == item_id), None)
    if item is None:
        raise ValueError(f"Item {item_id} introuvable")

    existing = item.get("risque_fiscal") or {}
    # Si pas d'évaluation préexistante, on en crée une minimale
    if not existing:
        existing = {
            "niveau": niveau.value,
            "score": 0,
            "drivers": [],
            "pieces_disponibles": [],
            "auto_calcule": False,
            "overridden_niveau": niveau.value,
            "overridden_motif": motif,
            "last_evaluated_at": _now_iso(),
        }
    else:
        existing["niveau"] = niveau.value
        existing["overridden_niveau"] = niveau.value
        existing["overridden_motif"] = motif
        existing["auto_calcule"] = False
        existing["last_evaluated_at"] = _now_iso()
    item["risque_fiscal"] = existing
    return item


def reset_item_risque_auto(plaquette_check: dict, item_id: str) -> dict:
    """Repasse un item en mode auto-calculé (efface l'override).

    Le prochain `evaluate_all_items(force_recompute=True)` recalculera le niveau.
    """
    items = plaquette_check.get("items", []) or []
    item = next((i for i in items if i.get("item_id") == item_id), None)
    if item is None:
        raise ValueError(f"Item {item_id} introuvable")

    existing = item.get("risque_fiscal") or {}
    if existing:
        existing["auto_calcule"] = True
        existing["overridden_niveau"] = None
        existing["overridden_motif"] = None
        existing["last_evaluated_at"] = ""  # force re-calc au prochain evaluate
    item["risque_fiscal"] = existing
    return item


def compute_global_score(items: list[dict]) -> Optional[float]:
    """Moyenne pondérée par montant_neuronx, niveau → poids (0/1/2/3).

    Score normalisé sur 3.0. Retourne None si aucun item avec montant_neuronx > 0.
    """
    total_weight = 0.0
    weighted_sum = 0.0
    for item in items:
        montant = abs(float(item.get("montant_neuronx") or 0.0))
        if montant <= 0:
            continue
        risque = item.get("risque_fiscal") or {}
        niveau_str = risque.get("niveau")
        if not niveau_str:
            continue
        try:
            niveau = RisqueNiveau(niveau_str)
        except ValueError:
            continue
        weight = _NIVEAU_WEIGHT[niveau]
        weighted_sum += weight * montant
        total_weight += montant
    if total_weight <= 0:
        return None
    return round(weighted_sum / total_weight, 2)


def get_top_risques(plaquette_check: dict, limit: int = 5) -> list[dict]:
    """Top N items triés par niveau desc puis montant_neuronx desc.

    Utilisé par le PDF section 7 + endpoint `GET /risque/top`.
    Retourne uniquement les items avec niveau >= MODERE (faible exclus).
    """
    items = plaquette_check.get("items", []) or []
    scored: list[tuple[int, float, dict]] = []
    for item in items:
        risque = item.get("risque_fiscal") or {}
        niveau_str = risque.get("niveau")
        if not niveau_str:
            continue
        try:
            niveau = RisqueNiveau(niveau_str)
        except ValueError:
            continue
        if niveau == RisqueNiveau.FAIBLE:
            continue
        weight = _NIVEAU_WEIGHT[niveau]
        montant = abs(float(item.get("montant_neuronx") or 0.0))
        scored.append((weight, montant, item))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    return [t[2] for t in scored[:limit]]
