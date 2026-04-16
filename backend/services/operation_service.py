from __future__ import annotations

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


# Cache mémoire pour list_operation_files : clé = path, valeur = (mtime, meta_dict)
# Invalidé automatiquement quand le mtime du fichier change (save/rename/delete).
_LIST_FILES_CACHE: dict[str, tuple[float, dict]] = {}


def _compute_file_meta(f: "Path") -> dict:
    """Calcule les metadata d'un fichier ops (count, totaux, mois dominant, année dominante).
    Utilise json natif + Counter (pas pandas) pour la vitesse — ~5x plus rapide que pd.read_json.
    """
    from collections import Counter
    meta: dict = {"filename": f.name, "count": 0}
    try:
        with open(f, "r", encoding="utf-8") as fh:
            ops = json.load(fh)
    except Exception as e:
        logger.warning(f"Impossible de lire {f.name}: {e}")
        return meta
    if not isinstance(ops, list):
        return meta

    total_debit = 0.0
    total_credit = 0.0
    month_counts: Counter = Counter()
    year_counts: Counter = Counter()
    for op in ops:
        if not isinstance(op, dict):
            continue
        d = op.get("Débit")
        c = op.get("Crédit")
        if isinstance(d, (int, float)) and not (isinstance(d, float) and (d != d)):  # skip NaN
            total_debit += d
        if isinstance(c, (int, float)) and not (isinstance(c, float) and (c != c)):
            total_credit += c
        date_str = op.get("Date")
        if isinstance(date_str, str) and len(date_str) >= 7:
            try:
                y = int(date_str[:4])
                m = int(date_str[5:7])
                if 1 <= m <= 12 and 2000 <= y <= 2100:
                    month_counts[m] += 1
                    year_counts[y] += 1
            except ValueError:
                pass
    meta["count"] = len(ops)
    meta["total_debit"] = total_debit
    meta["total_credit"] = total_credit
    if month_counts:
        meta["month"] = month_counts.most_common(1)[0][0]
    if year_counts:
        meta["year"] = year_counts.most_common(1)[0][0]
    # Fallback : dériver year/month depuis le filename si aucune op datée (fichier vide ou manuel)
    if "year" not in meta or "month" not in meta:
        import re
        m = re.search(r"_(\d{4})(\d{2})_", f.name)
        if m:
            y, mo = int(m.group(1)), int(m.group(2))
            if 2000 <= y <= 2100 and 1 <= mo <= 12:
                meta.setdefault("year", y)
                meta.setdefault("month", mo)
    return meta


def list_operation_files() -> list[dict]:
    """Liste tous les fichiers d'opérations disponibles avec métadonnées.
    Cache par mtime : on recalcule uniquement pour les fichiers modifiés depuis le dernier appel.
    """
    ensure_directories()
    if not IMPORTS_OPERATIONS_DIR.exists():
        return []

    files = []
    seen_paths: set[str] = set()
    for f in sorted(IMPORTS_OPERATIONS_DIR.iterdir(), reverse=True):
        if f.suffix != ".json" or f.name.startswith("_"):
            continue
        key = str(f)
        seen_paths.add(key)
        try:
            mtime = f.stat().st_mtime
        except OSError:
            continue
        cached = _LIST_FILES_CACHE.get(key)
        if cached and cached[0] == mtime:
            files.append(cached[1])
            continue
        meta = _compute_file_meta(f)
        _LIST_FILES_CACHE[key] = (mtime, meta)
        files.append(meta)

    # Nettoyer le cache des fichiers supprimés
    stale = [k for k in _LIST_FILES_CACHE if k not in seen_paths]
    for k in stale:
        _LIST_FILES_CACHE.pop(k, None)

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
        # Sanitize ventilation sub-lines
        for vline in op.get("ventilation", []):
            if isinstance(vline, dict):
                for vkey in vline:
                    vline[vkey] = _sanitize_value(vline[vkey])

    return data


def auto_lettre_complete(operations: list[dict]) -> int:
    """Auto-pointe les opérations complètes (catégorie + sous-catégorie + justificatif ou exemptée).
    One-way: ne dé-pointe jamais. Retourne le nombre d'opérations auto-pointées."""
    from backend.services.justificatif_exemption_service import is_justificatif_required

    _EXCLUDED_CATS = {"", "Autres", "Ventilé"}
    count = 0
    for op in operations:
        if op.get("lettre"):
            continue  # déjà pointée
        cat = (op.get("Catégorie") or "").strip()
        sous_cat = (op.get("Sous-catégorie") or "").strip()
        lien = (op.get("Lien justificatif") or "").strip()
        ventilation = op.get("ventilation") or []

        if ventilation:
            # Op ventilée : pointer si TOUTES les sous-lignes sont complètes
            def _vl_complete(vl: dict) -> bool:
                vl_cat = (vl.get("categorie") or "").strip()
                vl_sub = (vl.get("sous_categorie") or "").strip()
                if not vl_cat or vl_cat in _EXCLUDED_CATS or not vl_sub:
                    return False
                has_justif = bool((vl.get("justificatif") or "").strip())
                exempt = not is_justificatif_required(vl_cat, vl_sub)
                return has_justif or exempt

            if ventilation and all(_vl_complete(vl) for vl in ventilation):
                op["lettre"] = True
                count += 1
        else:
            # Op simple : cat + sous_cat + (justificatif OU exemptée)
            if cat and cat not in _EXCLUDED_CATS and sous_cat:
                has_justif = bool(lien)
                exempt = not is_justificatif_required(cat, sous_cat)
                if has_justif or exempt:
                    op["lettre"] = True
                    count += 1
    return count


def maybe_auto_lettre(operations: list[dict]) -> int:
    """Auto-pointe si le setting auto_pointage est activé. Retourne le count."""
    try:
        from backend.core.config import SETTINGS_FILE
        settings_data = {}
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                settings_data = json.load(f)
        if not settings_data.get("auto_pointage", True):
            return 0
    except Exception:
        pass  # En cas d'erreur, on active par défaut
    return auto_lettre_complete(operations)


def _mark_exempt_as_justified(operations: list[dict]) -> None:
    """Auto-marque les opérations exemptées de justificatif (configuré dans Settings)."""
    from backend.services.justificatif_exemption_service import is_justificatif_required, is_operation_justificatif_required

    for op in operations:
        if not is_operation_justificatif_required(op) and not op.get("Justificatif"):
            op["Justificatif"] = True
        # Ventilations : idem par sous-ligne
        for vl in op.get("ventilation", []):
            cat = (vl.get("categorie") or "").strip()
            sous_cat = (vl.get("sous_categorie") or "").strip()
            if cat and not is_justificatif_required(cat, sous_cat) and not vl.get("justificatif"):
                vl["justificatif"] = True


def save_operations(
    operations: list[dict],
    filename: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    pdf_hash: Optional[str] = None,
) -> str:
    """Sauvegarde les opérations dans un fichier JSON."""
    ensure_directories()

    # Auto-marquer les ops exemptées comme justifiées
    _mark_exempt_as_justified(operations)

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


def create_empty_file(year: int, month: int) -> str:
    """Crée un fichier d'opérations vide pour un mois donné (saisie manuelle, ex. notes de frais).

    Nommage `operations_manual_YYYYMM_<hash8>.json` — le préfixe `manual_` trace l'origine
    (né hors import PDF) ; les scripts de merge existants (merge_overlapping_monthly_files.py)
    dédupliquent ensuite par hash op-identité si un relevé est importé pour le même mois plus tard.
    """
    import secrets
    ensure_directories()
    if not (1 <= month <= 12):
        raise ValueError(f"month must be 1..12, got {month}")
    short_hash = secrets.token_hex(4)  # 8 hex chars
    filename = f"operations_manual_{year:04d}{month:02d}_{short_hash}.json"
    filepath = IMPORTS_OPERATIONS_DIR / filename
    if filepath.exists():
        # Collision improbable mais géré : regénérer le hash
        short_hash = secrets.token_hex(4)
        filename = f"operations_manual_{year:04d}{month:02d}_{short_hash}.json"
        filepath = IMPORTS_OPERATIONS_DIR / filename
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump([], f, ensure_ascii=False, indent=2)
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


# ── Catégorisation IA d'un fichier ───────────────────────────────────────

def categorize_file(filename: str, mode: str = "empty_only") -> dict:
    """Catégorise les opérations d'un fichier via IA (rules + sklearn).

    Args:
        filename: nom du fichier d'opérations
        mode: "empty_only" (défaut) ou "all"

    Returns:
        {"filename": str, "modified": int, "total": int}
    """
    from backend.services import ml_service, ml_monitoring_service
    from backend.models.ml import PredictionLog, PredictionBatchLog, PredictionSource

    operations = load_operations(filename)
    model = ml_service.load_rules_model()
    modified = 0
    prediction_logs: list[PredictionLog] = []
    high = medium = low = hallucination_flags = 0

    for op in operations:
        libelle = op.get("Libellé", "")
        current_cat = op.get("Catégorie", "")

        # Skip global des ops verrouillées — une association manuelle auto-locke l'op
        # (cf. associate_manual). Cohérent avec run_auto_rapprochement() qui applique
        # la même garde. Protège aussi bien mode=empty_only que mode=all contre
        # l'écrasement silencieux par la prédiction ML.
        if op.get("locked"):
            continue

        if mode == "empty_only" and current_cat and current_cat != "Autres":
            continue

        clean = ml_service.clean_libelle(libelle)

        # Predict with source tracking
        predicted = ml_service.predict_category(clean, model)
        source = PredictionSource.keywords
        confidence = 1.0
        risk = False

        if predicted is None:
            predicted = ml_service.predict_category_sklearn(clean)
            source = PredictionSource.sklearn
            if predicted:
                _, confidence, risk = ml_service.evaluate_hallucination_risk(clean)
        else:
            # Rules-based: check if exact match
            clean_lower = clean.lower() if clean else ""
            exact = model.get("exact_matches", {})
            if clean_lower in exact or clean in exact:
                source = PredictionSource.exact_match

        if predicted:
            op["Catégorie"] = predicted
            sub = ml_service.predict_subcategory(clean, model)
            if sub:
                op["Sous-catégorie"] = sub
            modified += 1

            # Log this prediction
            if confidence >= 0.8:
                high += 1
            elif confidence >= 0.5:
                medium += 1
            else:
                low += 1
            if risk:
                hallucination_flags += 1

            prediction_logs.append(PredictionLog(
                libelle=libelle,
                predicted_category=predicted,
                predicted_subcategory=sub,
                confidence=confidence,
                source=source,
                hallucination_risk=risk,
            ))

    # Auto-pointage après catégorisation
    maybe_auto_lettre(operations)

    save_operations(operations, filename=filename)

    # Log prediction batch
    if prediction_logs:
        try:
            batch = PredictionBatchLog(
                timestamp=datetime.now().isoformat(),
                filename=filename,
                mode=mode,
                total_operations=len(operations),
                predicted=len(prediction_logs),
                high_confidence=high,
                medium_confidence=medium,
                low_confidence=low,
                hallucination_flags=hallucination_flags,
                predictions=prediction_logs,
            )
            ml_monitoring_service.log_prediction_batch(batch)
        except Exception as e:
            logger.warning("Failed to log prediction batch: %s", e)

    return {"filename": filename, "modified": modified, "total": len(operations)}
