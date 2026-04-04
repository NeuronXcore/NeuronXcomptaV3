"""
Configuration unifiée pour NeuronXcompta backend.
Regroupe config/constants.py et modules/constants.py de V2.
"""
from __future__ import annotations

from pathlib import Path

# Racine du projet (neuronxcode/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Répertoire des données
DATA_DIR = BASE_DIR / "data"
IMPORTS_DIR = DATA_DIR / "imports"
IMPORTS_RELEVES_DIR = IMPORTS_DIR / "releves"
IMPORTS_OPERATIONS_DIR = IMPORTS_DIR / "operations"
EXPORTS_DIR = DATA_DIR / "exports"
REPORTS_DIR = DATA_DIR / "reports"
RAPPORTS_DIR = DATA_DIR / "rapports"
LOGS_DIR = DATA_DIR / "logs"
JUSTIFICATIFS_DIR = DATA_DIR / "justificatifs"
JUSTIFICATIFS_EN_ATTENTE_DIR = JUSTIFICATIFS_DIR / "en_attente"
JUSTIFICATIFS_TRAITES_DIR = JUSTIFICATIFS_DIR / "traites"
JUSTIFICATIFS_TEMP_DIR = JUSTIFICATIFS_DIR / "temp"
JUSTIFICATIFS_SANDBOX_DIR = JUSTIFICATIFS_DIR / "sandbox"
COMPTA_ANALYTIQUE_DIR = DATA_DIR / "compta_analytique"
OCR_DIR = DATA_DIR / "ocr"

# GED (Gestion Électronique de Documents)
GED_DIR = DATA_DIR / "ged"
GED_METADATA_FILE = GED_DIR / "ged_metadata.json"
GED_POSTES_FILE = GED_DIR / "ged_postes.json"
GED_THUMBNAILS_DIR = GED_DIR / "thumbnails"

# Fichiers ML
ML_DIR = DATA_DIR / "ml"
ML_BACKUPS_DIR = ML_DIR / "backups"
TRAINING_FILE = ML_DIR / "training_examples.json"
MODEL_FILE = ML_DIR / "sklearn_model.pkl"
VECTORIZER_FILE = ML_DIR / "vectorizer.pkl"
RULES_MODEL_PATH = ML_DIR / "model.json"

# Fichiers de données
CATEGORIES_FILE = DATA_DIR / "categories.json"
SOUS_CATEGORIES_FILE = DATA_DIR / "sous_categories.json"
SETTINGS_FILE = BASE_DIR / "settings.json"

# Constantes d'application
APP_NAME = "NeuronXcompta"
APP_VERSION = "3.0.0"

# Validation justificatifs (extensions & magic bytes)
ALLOWED_JUSTIFICATIF_EXTENSIONS: set[str] = {".pdf", ".jpg", ".jpeg", ".png"}
IMAGE_EXTENSIONS: set[str] = {".jpg", ".jpeg", ".png"}
MAGIC_BYTES: dict[str, bytes] = {
    ".pdf": b"%PDF-",
    ".jpg": b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
    ".png": b"\x89PNG",
}

# Catégories par défaut
DEFAULT_CATEGORIES = {
    "Revenus": ["Salaire", "Prestations", "Dividendes", "Intérêts", "Remboursements"],
    "Dépenses courantes": ["Alimentation", "Transports", "Logement", "Factures", "Santé", "Vêtements", "Loisirs", "Éducation"],
    "Dépenses exceptionnelles": ["Voyages", "Équipements", "Cadeaux", "Impôts"],
    "Épargne et Investissements": ["Épargne", "Placements", "Assurances"],
    "Professionnel": ["Matériel", "Services", "Abonnements", "Marketing"],
}

# Formats de date
DATE_FORMAT = "%d/%m/%Y"
DATE_TIME_FORMAT = "%d/%m/%Y %H:%M"

# Mois en français
MOIS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


def ensure_directories():
    """Crée tous les répertoires nécessaires s'ils n'existent pas."""
    dirs = [
        DATA_DIR, IMPORTS_DIR, IMPORTS_RELEVES_DIR, IMPORTS_OPERATIONS_DIR,
        EXPORTS_DIR, REPORTS_DIR, RAPPORTS_DIR,
        LOGS_DIR, JUSTIFICATIFS_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR,
        JUSTIFICATIFS_TRAITES_DIR, JUSTIFICATIFS_TEMP_DIR, JUSTIFICATIFS_SANDBOX_DIR,
        ML_DIR, ML_BACKUPS_DIR, COMPTA_ANALYTIQUE_DIR, OCR_DIR,
        GED_DIR, GED_THUMBNAILS_DIR,
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)


def migrate_imports_directory():
    """Déplace les fichiers existants de data/imports/ vers les sous-dossiers releves/ et operations/."""
    import shutil
    ensure_directories()
    for f in IMPORTS_DIR.iterdir():
        if f.is_dir() or f.name.startswith("."):
            continue
        if f.suffix == ".json":
            dest = IMPORTS_OPERATIONS_DIR / f.name
            if not dest.exists():
                shutil.move(str(f), str(dest))
        elif f.suffix == ".pdf":
            dest = IMPORTS_RELEVES_DIR / f.name
            if not dest.exists():
                shutil.move(str(f), str(dest))
