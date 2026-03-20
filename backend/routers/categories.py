"""Router pour les catégories."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.services import category_service
from backend.models.category import CategoryCreate, SubcategoryCreate


class CategoryUpdate(BaseModel):
    new_name: Optional[str] = None
    color: Optional[str] = None
    sous_categorie: Optional[str] = None


router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("")
async def get_categories():
    """Liste toutes les catégories avec leurs sous-catégories."""
    categories = category_service.load_categories()

    # Grouper par catégorie principale
    grouped: dict[str, dict] = {}
    for cat in categories:
        name = cat.get("Catégorie", "")
        if name not in grouped:
            grouped[name] = {
                "name": name,
                "color": cat.get("Couleur", "#000000"),
                "subcategories": [],
            }
        sub = cat.get("Sous-catégorie")
        if sub and sub != "null":
            grouped[name]["subcategories"].append({
                "name": sub,
                "color": cat.get("Couleur", "#000000"),
            })

    return {"categories": list(grouped.values()), "raw": categories}


@router.post("")
async def create_category(data: CategoryCreate):
    """Crée une nouvelle catégorie."""
    categories = category_service.add_category(data.name, data.color)
    return {"categories": categories}


@router.post("/subcategory")
async def create_subcategory(data: SubcategoryCreate):
    """Ajoute une sous-catégorie à une catégorie existante."""
    categories = category_service.add_category(
        data.category, data.color, sous_categorie=data.name
    )
    return {"categories": categories}


@router.put("/{name}")
async def update_category(name: str, data: CategoryUpdate):
    """Met à jour une catégorie (renommer, changer couleur)."""
    categories = category_service.update_category(
        old_name=name,
        new_name=data.new_name or name,
        color=data.color,
        sous_categorie=data.sous_categorie,
    )
    return {"categories": categories}


@router.delete("/{name}")
async def delete_category(name: str, sous_categorie: str = None):
    """Supprime une catégorie ou sous-catégorie."""
    categories = category_service.delete_category(name, sous_categorie)
    return {"categories": categories}


@router.get("/{name}/subcategories")
async def get_subcategories(name: str):
    """Retourne les sous-catégories d'une catégorie."""
    return {"subcategories": category_service.get_subcategories(name)}


@router.get("/colors")
async def get_colors():
    """Retourne les couleurs des catégories."""
    return category_service.get_category_colors()
