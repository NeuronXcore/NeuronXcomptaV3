"""
Service pour la gestion des opérations.
Refactoré depuis utils/file_operations.py de V2 (sans dépendance Streamlit).
"""

import json
import hashlib
import logging
import math
import re
import io
import warnings
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
import pdfplumber

from backend.core.config import IMPORTS_DIR, DATA_DIR, ensure_directories

logger = logging.getLogger(__name__)


def list_operation_files() -> list[dict]:
    """Liste tous les fichiers d'opérations disponibles avec métadonnées."""
    ensure_directories()
    if not IMPORTS_DIR.exists():
        return []

    files = []
    for f in sorted(IMPORTS_DIR.iterdir(), reverse=True):
        if f.suffix == ".json":
            try:
                ops = pd.read_json(f)
                meta = {
                    "filename": f.name,
                    "count": len(ops),
                    "total_debit": float(ops.get("Débit", pd.Series([0])).sum()),
                    "total_credit": float(ops.get("Crédit", pd.Series([0])).sum()),
                }
                # Extraire mois/année depuis le contenu
                if "Date" in ops.columns and not ops.empty:
                    dates = pd.to_datetime(ops["Date"], errors="coerce")
                    dates = dates.dropna()
                    if not dates.empty:
                        most_common_month = dates.dt.month.mode()
                        most_common_year = dates.dt.year.mode()
                        if len(most_common_month) > 0:
                            meta["month"] = int(most_common_month.iloc[0])
                        if len(most_common_year) > 0:
                            meta["year"] = int(most_common_year.iloc[0])
                files.append(meta)
            except Exception as e:
                logger.warning(f"Impossible de lire {f.name}: {e}")
                files.append({"filename": f.name, "count": 0})
    return files


def _sanitize_value(v):
    """Remplace NaN/Inf par 0 pour les floats, sinon retourne tel quel."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return 0.0
    return v


def load_operations(filename: str) -> list[dict]:
    """Charge les opérations depuis un fichier JSON."""
    filepath = IMPORTS_DIR / filename
    if not filepath.exists():
        raise FileNotFoundError(f"Le fichier {filename} n'existe pas")

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f, parse_float=float)

    # Nettoyer les valeurs NaN/Inf qui ne sont pas sérialisables en JSON standard
    for op in data:
        for key in op:
            op[key] = _sanitize_value(op[key])

    return data


def save_operations(
    operations: list[dict],
    filename: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    pdf_hash: Optional[str] = None,
) -> str:
    """Sauvegarde les opérations dans un fichier JSON."""
    ensure_directories()

    if filename is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        short_hash = pdf_hash[:8] if pdf_hash else "manual"
        filename = f"operations_{timestamp}_{short_hash}.json"

    filepath = IMPORTS_DIR / filename
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(operations, f, ensure_ascii=False, indent=2, default=str)

    # Sauvegarder le PDF source si disponible
    if pdf_bytes is not None and pdf_hash is not None:
        pdf_filename = f"pdf_{pdf_hash[:8]}.pdf"
        pdf_filepath = IMPORTS_DIR / pdf_filename
        with open(pdf_filepath, "wb") as f:
            f.write(pdf_bytes)

    return filename


def delete_operation_file(filename: str) -> bool:
    """Supprime un fichier d'opérations et son PDF associé."""
    filepath = IMPORTS_DIR / filename
    if not filepath.exists():
        return False

    try:
        # Extraire le hash du nom du fichier
        pdf_hash = filename.split("_")[-1].replace(".json", "")
        pdf_filename = f"pdf_{pdf_hash}.pdf"
        pdf_filepath = IMPORTS_DIR / pdf_filename

        filepath.unlink()
        if pdf_filepath.exists():
            pdf_filepath.unlink()

        return True
    except Exception as e:
        logger.error(f"Erreur lors de la suppression: {e}")
        return False


def calculate_pdf_hash(pdf_bytes: bytes) -> str:
    """Calcule le hash SHA-256 d'un PDF."""
    return hashlib.sha256(pdf_bytes).hexdigest()


def check_pdf_duplicate(pdf_hash: str) -> bool:
    """Vérifie si un PDF avec ce hash existe déjà."""
    pdf_filename = f"pdf_{pdf_hash[:8]}.pdf"
    return (IMPORTS_DIR / pdf_filename).exists()


def extract_operations_from_pdf(pdf_bytes: bytes) -> list[dict]:
    """Extrait les opérations bancaires d'un relevé PDF."""
    operations = []

    pattern_date = r"(\d{2}[/.]\d{2}[/.]\d{2,4}|\d{2}[/.]\d{2}|\d{4}-\d{2}-\d{2})"
    patterns_montant = [
        r"(\d{1,3}(?:[ \u202f]?\d{3})*,\d{2})",
        r"(\d+[,.]\d{2})",
    ]

    mots_cles_credit = [
        "VIREMENT", "REMBOURSEMENT", "VERSEMENT", "SALAIRE",
        "REMISE", "VIRSCTINSTRECU", "VIRSEPARECU",
    ]
    mots_cles_debit = [
        "CARTE", "RETRAIT", "PAIEMENT", "ACHAT", "FACTURE",
        "PRELEVEMENT", "COMMISSION", "COTISATION", "ASSURANCE",
    ]

    try:
        warnings.filterwarnings("ignore", message="CropBox missing from /Page")

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            logger.info(f"PDF ouvert, {len(pdf.pages)} pages")

            for page_num, page in enumerate(pdf.pages):
                texte = page.extract_text()
                if not texte:
                    continue

                for ligne in texte.split("\n"):
                    if len(ligne) < 10:
                        continue

                    dates = re.findall(pattern_date, ligne)
                    if not dates:
                        continue

                    # Chercher les montants
                    montant = 0.0
                    montant_trouve = False
                    for pattern in patterns_montant:
                        montants = re.findall(pattern, ligne)
                        if montants:
                            montant_str = montants[0].replace(" ", "").replace("\u202f", "")
                            try:
                                montant = float(montant_str.replace(",", "."))
                                montant_trouve = True
                                break
                            except ValueError:
                                continue

                    if not montant_trouve:
                        continue

                    # Déterminer débit/crédit
                    est_credit = any(mot in ligne.upper() for mot in mots_cles_credit)
                    est_debit = not est_credit

                    # Formater la date
                    date_str = dates[0].replace(".", "/")
                    if len(date_str.split("/")) == 2:
                        date_str += f"/{datetime.now().year}"

                    # Nettoyer le libellé
                    libelle = ligne
                    for d in dates:
                        libelle = libelle.replace(d, "")
                    libelle = re.sub(r"\s+", " ", libelle).strip()

                    # Catégorisation simplifiée
                    categorie = _categorize_simple(libelle)

                    operations.append({
                        "Date": date_str,
                        "Libellé": libelle,
                        "Débit": montant if est_debit else 0.0,
                        "Crédit": montant if est_credit else 0.0,
                        "Catégorie": categorie,
                        "Sous-catégorie": "",
                        "Justificatif": False,
                        "Lien justificatif": "",
                        "Important": False,
                        "A_revoir": False,
                        "Commentaire": "",
                    })

        logger.info(f"Extraction terminée: {len(operations)} opérations")
        return operations

    except Exception as e:
        logger.error(f"Erreur extraction PDF: {e}")
        return []


def _categorize_simple(libelle: str) -> str:
    """Catégorisation simplifiée basée sur les mots-clés."""
    libelle_upper = libelle.upper()

    categories = {
        "Revenus": ["SALAIRE", "VIREMENT", "REMBOURSEMENT", "VERSEMENT"],
        "Alimentation": ["CARREFOUR", "LECLERC", "AUCHAN", "INTERMARCHE", "FRANPRIX", "MONOPRIX", "SUPERMARCH"],
        "Transport": ["SNCF", "RATP", "TAXI", "UBER", "ESSENCE", "CARBURANT", "AUTOROUTE", "PEAGE"],
        "Logement": ["LOYER", "EDF", "ENGIE", "GAZ", "ELECTRICITE", "ASSURANCE HAB"],
        "Loisirs": ["RESTAURANT", "CINEMA", "THEATRE", "NETFLIX", "SPOTIFY", "AMAZON PRIME"],
        "Santé": ["PHARMACIE", "MEDECIN", "DENTISTE", "MUTUELLE"],
        "Épargne": ["EPARGNE", "LIVRET", "PLACEMENT", "ASSURANCE VIE"],
    }

    for categorie, mots_cles in categories.items():
        for mot in mots_cles:
            if mot in libelle_upper:
                return categorie
    return "Autres"
