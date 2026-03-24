"""
Configuration unifiée pour NeuronXcompta backend.
Regroupe config/constants.py et modules/constants.py de V2.
"""

from pathlib import Path

# Racine du projet (neuronxcode/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Répertoire des données
DATA_DIR = BASE_DIR / "data"
IMPORTS_DIR = DATA_DIR / "imports"
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
        DATA_DIR, IMPORTS_DIR, EXPORTS_DIR, REPORTS_DIR, RAPPORTS_DIR,
        LOGS_DIR, JUSTIFICATIFS_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR,
        JUSTIFICATIFS_TRAITES_DIR, JUSTIFICATIFS_TEMP_DIR, JUSTIFICATIFS_SANDBOX_DIR,
        ML_DIR, ML_BACKUPS_DIR, COMPTA_ANALYTIQUE_DIR, OCR_DIR,
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
