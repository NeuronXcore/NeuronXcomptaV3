"""
Service utilitaire pour les exemptions de justificatifs par categorie/sous-categorie.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from backend.core.config import SETTINGS_FILE

logger = logging.getLogger(__name__)


def _load_exemptions() -> dict:
    """Charge les exemptions depuis settings.json."""
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("justificatif_exemptions", {})
    except Exception:
        pass
    # Default
    return {"categories": ["Perso"], "sous_categories": {}}


def is_justificatif_required(categorie: str, sous_categorie: str = "") -> bool:
    """Retourne True si un justificatif est requis pour cette categorie/sous-categorie."""
    if not categorie:
        return True  # ops non categorisees : justificatif requis

    exemptions = _load_exemptions()
    exempt_cats = exemptions.get("categories", [])
    exempt_subcats = exemptions.get("sous_categories", {})

    # Categorie entiere exemptee
    if categorie in exempt_cats:
        return False

    # Sous-categorie specifique exemptee
    if categorie in exempt_subcats and sous_categorie:
        if sous_categorie in exempt_subcats[categorie]:
            return False

    return True


def is_operation_justificatif_required(op: dict) -> bool:
    """Wrapper pour une operation (dict)."""
    cat = (op.get("Catégorie") or op.get("Categorie") or op.get("categorie") or "").strip()
    sous_cat = (op.get("Sous-catégorie") or op.get("Sous-categorie") or op.get("sous_categorie") or "").strip()
    return is_justificatif_required(cat, sous_cat)
