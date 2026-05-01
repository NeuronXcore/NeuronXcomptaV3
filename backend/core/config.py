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
REPORTS_INDEX = REPORTS_DIR / "reports_index.json"
REPORTS_ARCHIVES_DIR = REPORTS_DIR / "archives"
RAPPORTS_DIR = DATA_DIR / "rapports"
ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
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

# Cache thumbnails sandbox (séparé de la GED pour ne pas polluer l'index
# documentaire : les fichiers sandbox sont par définition hors-périmètre GED).
SANDBOX_THUMBS_DIR = DATA_DIR / "sandbox_thumbs"

# Amortissements
AMORTISSEMENTS_DIR = DATA_DIR / "amortissements"

# Barèmes fiscaux
BAREMES_DIR = DATA_DIR / "baremes"

# Prévisionnel
PREVISIONNEL_DIR = DATA_DIR / "previsionnel"
PREV_PROVIDERS_FILE = PREVISIONNEL_DIR / "providers.json"
PREV_ECHEANCES_FILE = PREVISIONNEL_DIR / "echeances.json"
PREV_SETTINGS_FILE = PREVISIONNEL_DIR / "settings.json"

# Liasse fiscale SCP — déclaration 2035 annuelle
LIASSE_SCP_DIR = DATA_DIR / "liasse_scp"

# Check d'envoi — rituel pré-vol récurrent
CHECK_ENVOI_DIR = DATA_DIR / "check_envoi"
CHECK_ENVOI_REMINDERS_FILE = CHECK_ENVOI_DIR / "reminders.json"

# Livret comptable — snapshots Phase 3 (Phase 1 : dossier seedé pour préparation)
LIVRET_SNAPSHOTS_DIR = DATA_DIR / "livret_snapshots"
LIVRET_SNAPSHOTS_MANIFEST = LIVRET_SNAPSHOTS_DIR / "manifest.json"

# Templates justificatifs
TEMPLATES_DIR = DATA_DIR / "templates"
TEMPLATES_FILE = TEMPLATES_DIR / "justificatifs_templates.json"

SEUIL_IMMOBILISATION = 500  # € TTC

CATEGORIES_IMMOBILISABLES = [
    "Matériel", "Informatique", "Véhicule", "Mobilier", "Travaux"
]

SOUS_CATEGORIES_EXCLUES_IMMO = [
    "Carburant", "Entretien", "Assurance", "Consommables",
    "Péage", "Parking", "Location", "Leasing", "Loyer"
]

DUREES_AMORTISSEMENT_DEFAUT: dict[str, int] = {
    "materiel-medical": 5,
    "informatique": 3,
    "vehicule": 5,
    "mobilier": 10,
    "telephone": 3,
    "travaux": 10,
    "logiciel": 1,
    "materiel": 5,
}

PLAFONDS_VEHICULE: list[dict] = [
    {"label": "Électrique (≤ 20g CO2)", "co2_max": 20, "plafond": 30000},
    {"label": "Hybride (20-50g CO2)", "co2_max": 50, "plafond": 20300},
    {"label": "Standard (50-130g CO2)", "co2_max": 130, "plafond": 18300},
    {"label": "Polluant (> 130g CO2)", "co2_max": 9999, "plafond": 9900},
]

COEFFICIENTS_DEGRESSIF: dict[int, float] = {
    3: 1.25, 4: 1.25,
    5: 1.75, 6: 1.75,
    7: 2.25, 8: 2.25, 9: 2.25, 10: 2.25,
}

# Fichiers ML
ML_DIR = DATA_DIR / "ml"
ML_BACKUPS_DIR = ML_DIR / "backups"
TRAINING_FILE = ML_DIR / "training_examples.json"
MODEL_FILE = ML_DIR / "sklearn_model.pkl"
VECTORIZER_FILE = ML_DIR / "vectorizer.pkl"
RULES_MODEL_PATH = ML_DIR / "model.json"
ML_LOGS_DIR = ML_DIR / "logs"
ML_PREDICTIONS_LOG_DIR = ML_LOGS_DIR / "predictions"
ML_CORRECTIONS_LOG_DIR = ML_LOGS_DIR / "corrections"

# Fichiers de données
CATEGORIES_FILE = DATA_DIR / "categories.json"
SOUS_CATEGORIES_FILE = DATA_DIR / "sous_categories.json"
SETTINGS_FILE = BASE_DIR / "settings.json"
TASKS_FILE = DATA_DIR / "tasks.json"
SNAPSHOTS_FILE = DATA_DIR / "snapshots.json"
RAPPELS_SNOOZE_FILE = DATA_DIR / "rappels_snooze.json"

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
        EXPORTS_DIR, REPORTS_DIR, REPORTS_ARCHIVES_DIR, RAPPORTS_DIR,
        LOGS_DIR, JUSTIFICATIFS_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR,
        JUSTIFICATIFS_TRAITES_DIR, JUSTIFICATIFS_TEMP_DIR, JUSTIFICATIFS_SANDBOX_DIR,
        ML_DIR, ML_BACKUPS_DIR, ML_LOGS_DIR, ML_PREDICTIONS_LOG_DIR, ML_CORRECTIONS_LOG_DIR,
        COMPTA_ANALYTIQUE_DIR, OCR_DIR,
        GED_DIR, GED_THUMBNAILS_DIR, SANDBOX_THUMBS_DIR,
        AMORTISSEMENTS_DIR,
        BAREMES_DIR,
        TEMPLATES_DIR,
        PREVISIONNEL_DIR,
        LIASSE_SCP_DIR,
        CHECK_ENVOI_DIR,
        LIVRET_SNAPSHOTS_DIR,
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)

    # Seed manifest des snapshots Livret (Phase 3 — créé vide en Phase 1 pour anticipation)
    if not LIVRET_SNAPSHOTS_MANIFEST.exists():
        import json
        try:
            with open(LIVRET_SNAPSHOTS_MANIFEST, "w", encoding="utf-8") as f:
                json.dump({"version": 1, "snapshots": []}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


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
