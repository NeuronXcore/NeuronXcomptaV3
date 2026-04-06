from __future__ import annotations

"""Router pour le machine learning et l'agent IA."""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from datetime import datetime

from backend.services import ml_service, operation_service, ml_monitoring_service
from backend.models.ml import TrainingLog

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


def _log_training_result(result: dict) -> None:
    """Log un résultat d'entraînement."""
    try:
        model = ml_service.load_rules_model()
        metrics = result.get("metrics", {})
        ml_monitoring_service.log_training(TrainingLog(
            timestamp=datetime.now().isoformat(),
            examples_count=metrics.get("n_samples", 0),
            accuracy=metrics.get("acc_test"),
            rules_count=len(model.get("exact_matches", {})),
            keywords_count=len(model.get("keywords", {})),
        ))
    except Exception:
        pass


@router.post("/train")
async def train_model():
    """Entraîne le modèle scikit-learn."""
    result = ml_service.train_sklearn_model()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    _log_training_result(result)
    return result


@router.post("/train-and-apply")
async def train_and_apply(year: Optional[int] = None):
    """Entraîne le modèle puis recatégorise (empty_only) les fichiers de l'année."""
    # 1. Entraîner
    train_result = ml_service.train_sklearn_model()
    if "error" in train_result:
        raise HTTPException(status_code=400, detail=train_result["error"])
    _log_training_result(train_result)

    # 2. Lister et filtrer les fichiers
    files = operation_service.list_operation_files()
    if year is not None:
        files = [f for f in files if f.get("year") == year]

    # 3. Catégoriser chaque fichier
    total_modified = 0
    total_operations = 0
    for f in files:
        result = operation_service.categorize_file(f["filename"], mode="empty_only")
        total_modified += result["modified"]
        total_operations += result["total"]

    return {
        "success": True,
        "train_metrics": train_result.get("metrics", {}),
        "apply_results": {
            "files_processed": len(files),
            "total_operations": total_operations,
            "total_modified": total_modified,
            "year": year,
        },
    }


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


# ── Monitoring ───────────────────────────────────────────────────────────


@router.get("/monitoring/stats")
async def get_monitoring_stats(year: Optional[int] = None):
    """Stats agrégées du monitoring ML."""
    return ml_monitoring_service.get_monitoring_stats(year)


@router.get("/monitoring/health")
async def get_health_kpi():
    """KPI résumé pour le Dashboard."""
    return ml_monitoring_service.get_health_kpi()


@router.get("/monitoring/confusion")
async def get_confusion_matrix(year: Optional[int] = None):
    """Matrice de confusion depuis les corrections."""
    return ml_monitoring_service.get_confusion_matrix(year)


@router.get("/monitoring/correction-history")
async def get_correction_rate_history():
    """Taux de correction par mois."""
    return ml_monitoring_service.get_correction_rate_history()
