"""Schemas Pydantic pour les catégories."""

from pydantic import BaseModel, Field
from typing import Optional, List


class Category(BaseModel):
    Categorie: str = Field(alias="Catégorie")
    Sous_categorie: Optional[str] = Field(None, alias="Sous-catégorie")
    Couleur: str = "#000000"

    model_config = {"populate_by_name": True}


class CategoryCreate(BaseModel):
    name: str
    color: str = "#000000"
    examples: List[str] = []


class SubcategoryCreate(BaseModel):
    category: str
    name: str
    color: str = "#000000"


class MLLabel(BaseModel):
    libelle: str
    categorie: str
    sous_categorie: Optional[str] = None
