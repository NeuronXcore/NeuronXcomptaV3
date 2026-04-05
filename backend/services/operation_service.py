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

from backend.core.config import IMPORTS_OPERATIONS_DIR, IMPORTS_RELEVES_DIR, DATA_DIR, ensure_directories

logger = logging.getLogger(__name__)


def list_operation_files() -> list[dict]:
    """Liste tous les fichiers d'opérations disponibles avec métadonnées."""
    ensure_directories()
    if not IMPORTS_OPERATIONS_DIR.exists():
        return []

    files = []
    for f in sorted(IMPORTS_OPERATIONS_DIR.iterdir(), reverse=True):
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
    # Tri chronologique par année puis mois (janvier → décembre)
    files.sort(key=lambda m: (m.get("year", 0), m.get("month", 0)))
    return files


def _sanitize_value(v):
    """Remplace NaN/Inf par 0 pour les floats, sinon retourne tel quel."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return 0.0
    return v


def load_operations(filename: str) -> list[dict]:
    """Charge les opérations depuis un fichier JSON."""
    filepath = IMPORTS_OPERATIONS_DIR / filename
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

    # Recalculer les alertes avant sauvegarde
    from backend.services.alerte_service import refresh_alertes_fichier
    refresh_alertes_fichier(operations)

    filepath = IMPORTS_OPERATIONS_DIR / filename
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(operations, f, ensure_ascii=False, indent=2, default=str)

    # Sauvegarder le PDF source si disponible
    if pdf_bytes is not None and pdf_hash is not None:
        pdf_filename = f"pdf_{pdf_hash[:8]}.pdf"
        pdf_filepath = IMPORTS_RELEVES_DIR / pdf_filename
        with open(pdf_filepath, "wb") as f:
            f.write(pdf_bytes)

    return filename


def delete_operation_file(filename: str) -> bool:
    """Supprime un fichier d'opérations et son PDF associé."""
    filepath = IMPORTS_OPERATIONS_DIR / filename
    if not filepath.exists():
        return False

    try:
        # Extraire le hash du nom du fichier
        pdf_hash = filename.split("_")[-1].replace(".json", "")
        pdf_filename = f"pdf_{pdf_hash}.pdf"
        pdf_filepath = IMPORTS_RELEVES_DIR / pdf_filename

        filepath.unlink()
        if pdf_filepath.exists():
            pdf_filepath.unlink()

        return True
    except Exception as e:
        logger.error(f"Erreur lors de la suppression: {e}")
        return False


def delete_pdf_with_json(pdf_filename: str) -> bool:
    """Supprime un PDF source et le fichier JSON d'opérations associé."""
    ensure_directories()
    pdf_path = IMPORTS_RELEVES_DIR / pdf_filename
    if not pdf_path.exists():
        return False

    try:
        # Extraire le hash du nom PDF (convention: pdf_{hash}.pdf)
        pdf_stem = pdf_filename.replace(".pdf", "")
        if not pdf_stem.startswith("pdf_"):
            return False
        pdf_hash = pdf_stem.replace("pdf_", "")

        # Chercher le JSON correspondant (finit par _{hash}.json)
        json_deleted = False
        for json_file in IMPORTS_OPERATIONS_DIR.glob(f"*_{pdf_hash}.json"):
            json_file.unlink()
            json_deleted = True
            logger.info(f"JSON supprimé: {json_file.name}")

        pdf_path.unlink()
        logger.info(f"PDF supprimé: {pdf_filename}")

        return True
    except Exception as e:
        logger.error(f"Erreur lors de la suppression PDF+JSON: {e}")
        return False


def rename_file(old_filename: str, new_filename: str) -> dict:
    """Renomme un fichier d'opérations JSON (et son PDF associé si présent)."""
    from fastapi import HTTPException

    ensure_directories()
    old_path = IMPORTS_OPERATIONS_DIR / old_filename
    new_path = IMPORTS_OPERATIONS_DIR / new_filename

    if not old_path.exists():
        raise HTTPException(status_code=404, detail="Fichier source introuvable")
    if new_path.exists():
        raise HTTPException(status_code=409, detail="Un fichier avec ce nom existe déjà")
    if not new_filename.endswith(".json"):
        raise HTTPException(status_code=422, detail="Le nouveau nom doit se terminer par .json")

    old_path.rename(new_path)

    # Renomme aussi le PDF associé si présent (convention: pdf_{hash}.pdf)
    old_pdf = get_pdf_path(old_filename)
    if old_pdf and old_pdf.exists():
        # Extraire le nouveau hash du nouveau nom
        new_stem_parts = new_filename.replace(".json", "").split("_")
        new_hash = new_stem_parts[-1] if len(new_stem_parts) >= 2 else None
        if new_hash and new_hash != "manual":
            new_pdf = IMPORTS_RELEVES_DIR / f"pdf_{new_hash}.pdf"
            if not new_pdf.exists():
                old_pdf.rename(new_pdf)

    return {"old_filename": old_filename, "new_filename": new_filename}


def get_pdf_path(filename: str) -> Optional[Path]:
    """Retourne le chemin du PDF source associé à un fichier d'opérations, ou None."""
    # Extraire le hash du nom : operations_YYYYMMDD_HHMMSS_{hash}.json
    parts = filename.replace(".json", "").split("_")
    if len(parts) < 2:
        return None
    pdf_hash = parts[-1]
    if pdf_hash == "manual":
        return None
    pdf_filepath = IMPORTS_RELEVES_DIR / f"pdf_{pdf_hash}.pdf"
    if pdf_filepath.exists():
        return pdf_filepath
    return None


def calculate_pdf_hash(pdf_bytes: bytes) -> str:
    """Calcule le hash SHA-256 d'un PDF."""
    return hashlib.sha256(pdf_bytes).hexdigest()


def check_pdf_duplicate(pdf_hash: str) -> bool:
    """Vérifie si un PDF avec ce hash existe déjà."""
    pdf_filename = f"pdf_{pdf_hash[:8]}.pdf"
    return (IMPORTS_RELEVES_DIR / pdf_filename).exists()


def extract_operations_from_pdf(pdf_bytes: bytes) -> list[dict]:
    """Extrait les opérations bancaires d'un relevé PDF."""
    operations = []

    pattern_date = r"(\d{2}[/.]\d{2}[/.]\d{2,4}|\d{2}[/.]\d{2}|\d{4}-\d{2}-\d{2})"
    patterns_montant = [
        r"(\d+[,.]\d{2})",
        r"(\d{1,3}(?:[ \u202f]\d{3})+,\d{2})",
    ]

    mots_cles_exclusion = [
        "SOLDE", "SOLDECR", "SOLDECRÉDITEUR", "SOLDECREDITEUR",
        "SOLDEDÉBITEUR", "SOLDEDEBITEUR",
        "TOTAL", "TOTALDES", "ANCIEN SOLDE", "NOUVEAU SOLDE",
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
                            montant_str = montants[-1].replace(" ", "").replace("\u202f", "")
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

                    # Formater la date en YYYY-MM-DD (requis par input type="date")
                    date_str = dates[0].replace(".", "/")
                    parts = date_str.split("/")
                    if len(parts) == 2:
                        parts.append(str(datetime.now().year))
                    if len(parts) == 3:
                        jour, mois, annee = parts
                        if len(annee) == 2:
                            annee = f"20{annee}"
                        date_str = f"{annee}-{mois.zfill(2)}-{jour.zfill(2)}"

                    # Nettoyer le libellé
                    libelle = ligne
                    for d in dates:
                        libelle = libelle.replace(d, "")
                    libelle = re.sub(r"\s+", " ", libelle).strip()

                    # Exclure les lignes de solde/total
                    libelle_upper = re.sub(r"\s+", "", libelle).upper()
                    if any(mot in libelle_upper for mot in mots_cles_exclusion):
                        continue

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


def toggle_lettrage(filename: str, index: int) -> bool:
    """Inverse le flag lettre d'une opération. Retourne la nouvelle valeur."""
    ops = load_operations(filename)
    if index < 0 or index >= len(ops):
        raise IndexError(f"Index {index} hors limites (0-{len(ops) - 1})")
    ops[index]["lettre"] = not ops[index].get("lettre", False)
    save_operations(ops, filename=filename)
    return ops[index]["lettre"]


def bulk_lettrage(filename: str, indices: list[int], lettre: bool) -> int:
    """Applique lettre=val aux indices donnés. Retourne le nombre modifié."""
    ops = load_operations(filename)
    count = 0
    for i in indices:
        if 0 <= i < len(ops):
            ops[i]["lettre"] = lettre
            count += 1
    if count > 0:
        save_operations(ops, filename=filename)
    return count


def get_lettrage_stats(filename: str) -> dict:
    """Retourne les statistiques de lettrage d'un fichier."""
    ops = load_operations(filename)
    total = len(ops)
    lettrees = sum(1 for op in ops if op.get("lettre", False))
    return {
        "total": total,
        "lettrees": lettrees,
        "non_lettrees": total - lettrees,
        "taux": lettrees / total if total > 0 else 0.0,
    }


def _categorize_simple(libelle: str) -> str:
    """Catégorisation simplifiée basée sur les mots-clés."""
    libelle_upper = libelle.upper()

    categories = {
        "Remplaçant": ["REMPLA", "REMPLACANT", "REMPLACEMENT"],
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
