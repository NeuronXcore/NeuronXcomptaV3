"""Mapping comptes comptables PCG → catégories NeuronX.

Stockage : data/plaquette_pcg_mapping.json (versionné).
Un mapping par cabinet comptable (template), extensible.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from backend.core.config import DATA_DIR

logger = logging.getLogger(__name__)

MAPPING_FILE = DATA_DIR / "plaquette_pcg_mapping.json"

DEFAULT_TEMPLATE = "sygnatures_marenco"


def load_mapping() -> dict:
    """Charge le mapping complet."""
    if not MAPPING_FILE.exists():
        return {"version": 1, "templates": {}}
    try:
        return json.loads(MAPPING_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Failed to load PCG mapping: %s", e)
        return {"version": 1, "templates": {}}


def save_mapping(data: dict) -> None:
    """Sauvegarde atomique du mapping."""
    MAPPING_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(MAPPING_FILE.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, str(MAPPING_FILE))
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def get_template_comptes(template: str = DEFAULT_TEMPLATE) -> dict:
    """Retourne dict {compte_pcg: {label, rubrique, categories, sous_categories, ...}}."""
    data = load_mapping()
    tpl = data.get("templates", {}).get(template, {})
    return tpl.get("comptes", {}) or {}


def list_templates() -> list[dict]:
    """Liste les templates disponibles : [{key, label}, ...]."""
    data = load_mapping()
    out = []
    for key, tpl in (data.get("templates") or {}).items():
        out.append({"key": key, "label": tpl.get("label", key)})
    return out


def resolve(
    compte_pcg: Optional[str],
    template: str = DEFAULT_TEMPLATE,
) -> tuple[list[str], list[str], dict]:
    """Résout (compte_pcg, template) → (categories, sous_categories, flags).

    flags : dict des attributs spéciaux (`is_bilan`, `is_dotation`, `is_recettes`,
    `split_csg_deductible`, `split_urssaf_cotisations`).
    """
    if not compte_pcg:
        return [], [], {}
    comptes = get_template_comptes(template)
    info = comptes.get(compte_pcg)
    if not info:
        return [], [], {}
    cats = list(info.get("categories") or [])
    subs = list(info.get("sous_categories") or [])
    flags = {
        k: v
        for k, v in info.items()
        if k not in ("label", "rubrique", "categories", "sous_categories")
    }
    return cats, subs, flags


def seed_items_from_template(template: str = DEFAULT_TEMPLATE) -> list[dict]:
    """Génère une liste d'items initiale depuis le template (pour saisie pré-remplie).

    Retourne `[{compte_pcg, compte_label, rubrique_2035, categories, sous_categories, flags}, ...]`.
    Les montants restent None — c'est à l'utilisateur de les saisir depuis la plaquette.

    Les comptes `is_recettes` sont skip (gérés via `totaux_plaquette` distinct).
    Les comptes `is_bilan` et `is_dotation` sont INCLUS — utiles pour visualiser :
      - les acquisitions immo de l'année non passées au bilan
      - la dotation aux amortissements
    """
    comptes = get_template_comptes(template)
    out = []
    for compte_pcg, info in comptes.items():
        flags = {
            k: v
            for k, v in info.items()
            if k not in ("label", "rubrique", "categories", "sous_categories")
        }
        # Recettes gérées séparément via totaux_plaquette
        if flags.get("is_recettes"):
            continue
        out.append({
            "compte_pcg": compte_pcg,
            "compte_label": info.get("label", compte_pcg),
            "rubrique_2035": info.get("rubrique"),
            "categories": list(info.get("categories") or []),
            "sous_categories": list(info.get("sous_categories") or []),
            "flags": flags,
        })
    # Tri par numéro de compte pour stabilité
    out.sort(key=lambda x: x["compte_pcg"] or "")
    return out
