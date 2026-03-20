"""
Service pour la gestion des catégories.
Refactoré depuis utils/file_operations.py et modules/data_utils.py de V2.
"""

import json
import logging
from typing import Optional

from backend.core.config import CATEGORIES_FILE, SOUS_CATEGORIES_FILE

logger = logging.getLogger(__name__)


def load_categories() -> list[dict]:
    """Charge les catégories depuis le fichier JSON."""
    if not CATEGORIES_FILE.exists():
        return []
    try:
        with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Erreur chargement catégories: {e}")
        return []


def save_categories(categories: list[dict]) -> None:
    """Sauvegarde les catégories dans le fichier JSON."""
    CATEGORIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CATEGORIES_FILE, "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=2)


def add_category(name: str, color: str = "#000000", sous_categorie: Optional[str] = None) -> list[dict]:
    """Ajoute une catégorie."""
    categories = load_categories()
    categories.append({
        "Catégorie": name,
        "Sous-catégorie": sous_categorie,
        "Couleur": color,
    })
    save_categories(categories)
    return categories


def delete_category(name: str, sous_categorie: Optional[str] = None) -> list[dict]:
    """Supprime une catégorie ou sous-catégorie."""
    categories = load_categories()
    if sous_categorie:
        categories = [
            c for c in categories
            if not (c.get("Catégorie") == name and c.get("Sous-catégorie") == sous_categorie)
        ]
    else:
        categories = [c for c in categories if c.get("Catégorie") != name]
    save_categories(categories)
    return categories


def update_category(old_name: str, new_name: str, color: Optional[str] = None, sous_categorie: Optional[str] = None) -> list[dict]:
    """Met à jour une catégorie."""
    categories = load_categories()
    for cat in categories:
        if cat.get("Catégorie") == old_name:
            if sous_categorie is None or cat.get("Sous-catégorie") == sous_categorie:
                cat["Catégorie"] = new_name
                if color:
                    cat["Couleur"] = color
    save_categories(categories)
    return categories


def get_category_colors() -> dict[str, str]:
    """Retourne un dictionnaire {catégorie: couleur}."""
    categories = load_categories()
    return {c["Catégorie"]: c.get("Couleur", "#000000") for c in categories}


def get_subcategories(category: str) -> list[str]:
    """Retourne les sous-catégories pour une catégorie donnée."""
    categories = load_categories()
    sous_cats = []
    for cat in categories:
        if cat.get("Catégorie") == category and cat.get("Sous-catégorie"):
            sc = cat["Sous-catégorie"]
            if sc and sc != "null" and sc not in sous_cats:
                sous_cats.append(sc)
    return sorted(sous_cats)


def load_sous_categories() -> dict:
    """Charge les sous-catégories depuis le fichier JSON dédié."""
    if not SOUS_CATEGORIES_FILE.exists():
        return {}
    try:
        with open(SOUS_CATEGORIES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}
