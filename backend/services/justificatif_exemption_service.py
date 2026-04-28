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
    """Retourne True si un justificatif est requis pour cette categorie/sous-categorie.

    Aligné sur la règle d'unicité des compteurs (cf. CLAUDE.md → Pipeline ↔ Justificatifs) :
    - "perso" (toute casse) est intrinsèquement exempt — BNC hors assiette, pas de justif requis,
      indépendamment de la config user.
    - Les comparaisons sur la config Settings sont **case-insensitive** pour résister aux
      divergences de casse ("Perso"/"perso", "CARMF"/"carmf", etc.).
    """
    cat = (categorie or "").strip()
    if not cat:
        return True  # ops non categorisees : justificatif requis

    cat_lower = cat.lower()
    # Règle métier — perso toujours exempt
    if cat_lower == "perso":
        return False

    exemptions = _load_exemptions()
    exempt_cats = exemptions.get("categories", []) or []
    exempt_subcats = exemptions.get("sous_categories", {}) or {}

    # Categorie entiere exemptee (case-insensitive)
    if any((c or "").strip().lower() == cat_lower for c in exempt_cats):
        return False

    # Sous-categorie specifique exemptee (case-insensitive sur cat ET sous-cat)
    sub = (sous_categorie or "").strip()
    if sub:
        sub_lower = sub.lower()
        for k, sub_list in exempt_subcats.items():
            if (k or "").strip().lower() == cat_lower:
                if any((s or "").strip().lower() == sub_lower for s in (sub_list or [])):
                    return False

    return True


def is_operation_justificatif_required(op: dict) -> bool:
    """Wrapper pour une operation (dict)."""
    cat = (op.get("Catégorie") or op.get("Categorie") or op.get("categorie") or "").strip()
    sous_cat = (op.get("Sous-catégorie") or op.get("Sous-categorie") or op.get("sous_categorie") or "").strip()
    return is_justificatif_required(cat, sous_cat)
