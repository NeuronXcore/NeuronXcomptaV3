"""Router pour le machine learning et l'agent IA."""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from backend.services import ml_service

router = APIRouter(prefix="/api/ml", tags=["ml"])


class PredictRequest(BaseModel):
    libelle: str


class TrainingExample(BaseModel):
    libelle: str
    categorie: str
    sous_categorie: str = ""


class RuleCreate(BaseModel):
    libelle: str
    categorie: str
    sous_categorie: Optional[str] = None


@router.get("/model")
async def get_model():
    """Retourne le modèle à règles (model.json)."""
    model = ml_service.load_rules_model()
    return {
        "exact_matches_count": len(model.get("exact_matches", {})),
        "keywords_count": len(model.get("keywords", {})),
        "subcategories_count": len(model.get("subcategories", {})),
        "stats": model.get("stats", {}),
    }


@router.get("/model/full")
async def get_full_model():
    """Retourne le modèle complet (pour l'admin)."""
    return ml_service.load_rules_model()


@router.post("/predict")
async def predict(request: PredictRequest):
    """Prédit la catégorie d'un libellé."""
    clean = ml_service.clean_libelle(request.libelle)
    model = ml_service.load_rules_model()

    # Prédiction rules
    rules_cat = ml_service.predict_category(clean, model)
    rules_subcat = ml_service.predict_subcategory(clean, model)

    # Prédiction sklearn
    sklearn_cat = ml_service.predict_category_sklearn(clean)

    # Évaluation risque
    _, confidence, risk = ml_service.evaluate_hallucination_risk(clean)

    return {
        "libelle_clean": clean,
        "rules_prediction": rules_cat,
        "rules_subcategory": rules_subcat,
        "sklearn_prediction": sklearn_cat,
        "confidence": confidence,
        "hallucination_risk": risk,
        "best_prediction": rules_cat or sklearn_cat,
    }


@router.post("/train")
async def train_model():
    """Entraîne le modèle scikit-learn."""
    result = ml_service.train_sklearn_model()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/training-data")
async def get_training_data():
    """Retourne les exemples d'entraînement."""
    examples = ml_service.get_training_examples()
    return {"count": len(examples), "examples": examples}


@router.post("/training-data")
async def add_training_data(example: TrainingExample):
    """Ajoute un exemple d'entraînement."""
    ml_service.add_training_example(
        example.libelle, example.categorie, example.sous_categorie
    )
    return {"message": "Exemple ajouté"}


@router.post("/rules")
async def add_rule(rule: RuleCreate):
    """Ajoute une règle exacte au modèle."""
    model = ml_service.load_rules_model()
    clean = ml_service.clean_libelle(rule.libelle)
    model["exact_matches"][clean] = rule.categorie
    if rule.sous_categorie:
        model.setdefault("subcategories", {})[clean] = rule.sous_categorie
    ml_service.save_rules_model(model)
    return {"message": f"Règle ajoutée pour '{clean}' → {rule.categorie}"}


@router.delete("/rules/{libelle}")
async def delete_rule(libelle: str):
    """Supprime une règle exacte du modèle."""
    model = ml_service.load_rules_model()
    clean = libelle.strip().lower()
    removed = False
    if clean in model.get("exact_matches", {}):
        del model["exact_matches"][clean]
        removed = True
    if clean in model.get("subcategories", {}):
        del model["subcategories"][clean]
    if removed:
        ml_service.save_rules_model(model)
        return {"message": f"Règle supprimée pour '{clean}'"}
    raise HTTPException(status_code=404, detail="Règle non trouvée")


@router.post("/backup")
async def create_backup():
    """Crée un backup du modèle ML."""
    name = ml_service.create_backup()
    return {"backup_name": name}


@router.get("/backups")
async def list_backups():
    """Liste les backups disponibles."""
    return {"backups": ml_service.list_backups()}


@router.post("/restore/{backup_name}")
async def restore_backup(backup_name: str, restore_training: bool = True):
    """Restaure un backup."""
    success = ml_service.restore_backup(backup_name, restore_training)
    if not success:
        raise HTTPException(status_code=404, detail="Backup non trouvé ou erreur")
    return {"message": f"Backup {backup_name} restauré"}
