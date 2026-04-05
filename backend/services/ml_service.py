"""
Service pour le machine learning et la catégorisation IA.
Fusionne modules/ml_utils.py, modules/rules_model.py et modules/data_utils.py de V2.
Aucune dépendance Streamlit.
"""

import json
import os
import re
import shutil
import pickle
import unicodedata
import logging
from collections import Counter, defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

from backend.core.config import (
    TRAINING_FILE, MODEL_FILE, VECTORIZER_FILE,
    RULES_MODEL_PATH, ML_BACKUPS_DIR,
)

logger = logging.getLogger(__name__)


# ── Text utilities ──────────────────────────────────────────────────────

def clean_libelle(libelle: str) -> str:
    """Nettoie un libellé (supprime accents, codes, montants, ponctuation)."""
    libelle = libelle.lower()
    libelle = "".join(
        c for c in unicodedata.normalize("NFD", libelle)
        if unicodedata.category(c) != "Mn"
    )
    libelle = re.sub(r"^[a-z]\d{8,}\s*", "", libelle)
    libelle = re.sub(r"^du\d{6,}", "", libelle)
    libelle = re.sub(r"\s*\d+[.,]\d{2}$", "", libelle)
    libelle = re.sub(r"\s*\d+$", "", libelle)
    libelle = re.sub(r"\s*\d+\s+\d+[.,]\d{2}$", "", libelle)
    libelle = re.sub(r"[^\w\s]", "", libelle)
    libelle = re.sub(r"\s+", " ", libelle).strip()
    return libelle


def extract_keywords(libelle: str) -> list[str]:
    """Extrait les mots-clés en supprimant les mots vides français."""
    words = re.findall(r"\w+", libelle.lower())
    stop_words = {
        "le", "la", "les", "un", "une", "des", "et", "ou", "de", "du",
        "au", "aux", "a", "à", "par", "pour", "dans", "sur", "avec",
        "sans", "chez",
    }
    return [w for w in words if w not in stop_words]


def calculate_similarity(a: str, b: str) -> float:
    """Score de similarité entre deux chaînes (0-1)."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


# ── Rules-based model ───────────────────────────────────────────────────

def load_rules_model() -> dict:
    """Charge le modèle basé sur les règles (model.json)."""
    if RULES_MODEL_PATH.exists():
        try:
            with open(RULES_MODEL_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            logger.error(f"Erreur décodage model.json: {e}")
            # Tenter récupération depuis backup
            backups = list_backups()
            if backups:
                logger.info(f"Récupération depuis backup: {backups[0]}")
                if restore_backup(backups[0], restore_training_data=False):
                    with open(RULES_MODEL_PATH, "r", encoding="utf-8") as f:
                        return json.load(f)

    return _empty_model()


def save_rules_model(model: dict) -> None:
    """Sauvegarde le modèle avec vérification d'intégrité."""
    RULES_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = str(RULES_MODEL_PATH) + ".temp"
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(model, f, ensure_ascii=False, indent=2)
        # Vérifier l'intégrité
        with open(temp_path, "r", encoding="utf-8") as f:
            json.load(f)
        # Remplacer
        os.replace(temp_path, str(RULES_MODEL_PATH))
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        logger.error(f"Erreur sauvegarde modèle: {e}")
        raise


def predict_category(libelle: str, model: Optional[dict] = None) -> Optional[str]:
    """Prédit la catégorie via le modèle à règles."""
    if model is None:
        model = load_rules_model()

    libelle_clean = libelle.strip().lower()

    # Correspondance exacte
    if libelle_clean in model.get("exact_matches", {}):
        return model["exact_matches"][libelle_clean]

    # Scoring par mots-clés (exact match + substring match)
    keywords = extract_keywords(libelle_clean)
    scores: dict[str, float] = defaultdict(float)
    for word in keywords:
        for category, word_list in model.get("keywords", {}).items():
            # Exact match
            if word in word_list:
                scores[category] += 1.0 / max(len(word_list), 1)
            else:
                # Substring match : le mot contient un keyword (ex: "motifremplacementdr" contient "rempla")
                for kw in word_list:
                    if kw in word:
                        scores[category] += 0.8 / max(len(word_list), 1)
                        break

    if scores:
        return max(scores.items(), key=lambda x: x[1])[0]
    return None


def predict_subcategory(libelle: str, model: Optional[dict] = None) -> Optional[str]:
    """Prédit la sous-catégorie via le modèle à règles."""
    if model is None:
        model = load_rules_model()
    libelle_clean = libelle.strip().lower()

    # Exact match
    result = model.get("subcategories", {}).get(libelle_clean)
    if result:
        return result

    # Substring patterns (pour les libellés avec montants variables)
    for pattern, subcat in model.get("subcategory_patterns", {}).items():
        if pattern in libelle_clean:
            return subcat

    return None


# ── Sklearn model ───────────────────────────────────────────────────────

def predict_category_sklearn(libelle: str) -> Optional[str]:
    """Prédit la catégorie via le modèle scikit-learn."""
    if not MODEL_FILE.exists() or not VECTORIZER_FILE.exists():
        return None
    try:
        with open(MODEL_FILE, "rb") as f:
            clf = pickle.load(f)
        with open(VECTORIZER_FILE, "rb") as f:
            vectorizer = pickle.load(f)
        X_vect = vectorizer.transform([libelle])
        return clf.predict(X_vect)[0]
    except Exception as e:
        logger.error(f"Erreur prédiction sklearn: {e}")
        return None


def evaluate_hallucination_risk(libelle: str, threshold: float = 0.5) -> tuple:
    """Évalue le risque d'hallucination du modèle sklearn.

    Returns:
        (catégorie prédite, confiance, risque_hallucination)
    """
    if not MODEL_FILE.exists() or not VECTORIZER_FILE.exists():
        return None, 0.0, True
    try:
        with open(MODEL_FILE, "rb") as f:
            clf = pickle.load(f)
        with open(VECTORIZER_FILE, "rb") as f:
            vectorizer = pickle.load(f)

        X_vect = vectorizer.transform([libelle])
        predicted = clf.predict(X_vect)[0]
        probas = clf.predict_proba(X_vect)[0]
        idx = list(clf.classes_).index(predicted)
        confidence = float(probas[idx])
        return predicted, confidence, confidence < threshold
    except Exception as e:
        logger.error(f"Erreur évaluation hallucination: {e}")
        return None, 0.0, True


def train_sklearn_model() -> dict:
    """Entraîne et sauvegarde le modèle scikit-learn.

    Returns:
        dict avec les métriques d'entraînement.
    """
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import f1_score, precision_score, recall_score, confusion_matrix

    X, y = load_training_data()
    if not X:
        return {"error": "Aucune donnée d'entraînement"}

    unique_classes = set(y)
    if len(unique_classes) < 2:
        return {"error": f"Il faut au moins 2 catégories. Trouvée: {list(unique_classes)[0]}"}

    class_counts = Counter(y)
    too_few = [cat for cat, count in class_counts.items() if count < 2]
    if too_few:
        return {"error": f"Catégories avec moins de 2 exemples: {', '.join(too_few)}"}

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )
    vectorizer = TfidfVectorizer()
    X_train_vect = vectorizer.fit_transform(X_train)
    X_test_vect = vectorizer.transform(X_test)

    clf = LogisticRegression(max_iter=1000)
    clf.fit(X_train_vect, y_train)

    # Sauvegarder
    MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_FILE, "wb") as f:
        pickle.dump(clf, f)
    with open(VECTORIZER_FILE, "wb") as f:
        pickle.dump(vectorizer, f)

    # Métriques
    y_test_pred = clf.predict(X_test_vect)
    acc_train = float(clf.score(X_train_vect, y_train))
    acc_test = float(clf.score(X_test_vect, y_test))
    f1 = float(f1_score(y_test, y_test_pred, average="weighted", zero_division=0))
    precision = float(precision_score(y_test, y_test_pred, average="weighted", zero_division=0))
    recall = float(recall_score(y_test, y_test_pred, average="weighted", zero_division=0))
    conf_mat = confusion_matrix(y_test, y_test_pred, labels=list(unique_classes)).tolist()

    metrics = {
        "acc_train": acc_train,
        "acc_test": acc_test,
        "f1": f1,
        "precision": precision,
        "recall": recall,
        "n_samples": len(X),
        "n_classes": len(unique_classes),
        "labels": list(unique_classes),
        "confusion_matrix": conf_mat,
    }

    # Mettre à jour les stats dans le modèle à règles
    model = load_rules_model()
    if "learning_curve" not in model.get("stats", {}):
        model.setdefault("stats", {})["learning_curve"] = {
            "dates": [], "acc_train": [], "acc_test": [],
            "f1": [], "precision": [], "recall": [],
            "n_samples": [], "n_classes": [], "conf_matrices": [],
            "labels": [], "nb_regles": [],
        }

    lc = model["stats"]["learning_curve"]
    for key in ["dates", "acc_train", "acc_test", "f1", "precision", "recall",
                 "n_samples", "n_classes", "conf_matrices", "labels", "nb_regles"]:
        lc.setdefault(key, [])

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lc["dates"].append(now)
    lc["acc_train"].append(acc_train)
    lc["acc_test"].append(acc_test)
    lc["f1"].append(f1)
    lc["precision"].append(precision)
    lc["recall"].append(recall)
    lc["n_samples"].append(len(X))
    lc["n_classes"].append(len(unique_classes))
    lc["conf_matrices"].append(conf_mat)
    lc["labels"] = list(unique_classes)
    lc["nb_regles"].append(len(model.get("exact_matches", {})))
    model["stats"]["last_training"] = now

    save_rules_model(model)

    return {"success": True, "metrics": metrics}


# ── Training data ───────────────────────────────────────────────────────

def load_training_data() -> tuple[list[str], list[str]]:
    """Charge les données d'entraînement."""
    if not TRAINING_FILE.exists():
        return [], []
    with open(TRAINING_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    X = [d["libelle"] for d in data]
    y = [d["categorie"] for d in data]
    return X, y


def get_training_examples() -> list[dict]:
    """Retourne les exemples d'entraînement bruts."""
    if not TRAINING_FILE.exists():
        return []
    with open(TRAINING_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def add_training_example(libelle: str, categorie: str, sous_categorie: str = "") -> None:
    """Ajoute un exemple d'entraînement."""
    data = get_training_examples()
    data.append({
        "libelle": libelle,
        "categorie": categorie,
        "sous_categorie": sous_categorie,
    })
    TRAINING_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TRAINING_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── Backups ─────────────────────────────────────────────────────────────

def create_backup() -> str:
    """Crée un backup du modèle ML."""
    ML_BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"model_backup_{timestamp}_manuel"
    backup_path = ML_BACKUPS_DIR / backup_name
    backup_path.mkdir(parents=True, exist_ok=True)

    if RULES_MODEL_PATH.exists():
        shutil.copy2(RULES_MODEL_PATH, backup_path / "model.json")
    if TRAINING_FILE.exists():
        shutil.copy2(TRAINING_FILE, backup_path / "training_examples.json")
    if MODEL_FILE.exists():
        shutil.copy2(MODEL_FILE, backup_path / "sklearn_model.pkl")
    if VECTORIZER_FILE.exists():
        shutil.copy2(VECTORIZER_FILE, backup_path / "vectorizer.pkl")

    return backup_name


def restore_backup(backup_name: str, restore_training_data: bool = True) -> bool:
    """Restaure un backup."""
    backup_path = ML_BACKUPS_DIR / backup_name
    if not backup_path.exists():
        logger.error(f"Backup {backup_name} introuvable")
        return False

    try:
        model_path = backup_path / "model.json"
        if model_path.exists():
            shutil.copy2(model_path, RULES_MODEL_PATH)

        if restore_training_data:
            training_path = backup_path / "training_examples.json"
            if training_path.exists():
                shutil.copy2(training_path, TRAINING_FILE)

        sklearn_path = backup_path / "sklearn_model.pkl"
        if sklearn_path.exists():
            shutil.copy2(sklearn_path, MODEL_FILE)

        vectorizer_path = backup_path / "vectorizer.pkl"
        if vectorizer_path.exists():
            shutil.copy2(vectorizer_path, VECTORIZER_FILE)

        return True
    except Exception as e:
        logger.error(f"Erreur restauration backup: {e}")
        return False


def list_backups() -> list[str]:
    """Liste les backups disponibles (plus récent en premier)."""
    if not ML_BACKUPS_DIR.exists():
        return []
    return sorted(
        [d.name for d in ML_BACKUPS_DIR.iterdir()
         if d.is_dir() and d.name.startswith("model_backup_")],
        reverse=True,
    )


# ── Helpers ─────────────────────────────────────────────────────────────

def _empty_model() -> dict:
    return {
        "exact_matches": {},
        "keywords": {},
        "subcategories": {},
        "stats": {
            "operations_processed": 0,
            "success_rate": 0,
            "last_training": "",
            "learning_curve": {"dates": [], "success": []},
        },
    }
