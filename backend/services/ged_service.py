"""
Service GED (Gestion Électronique de Documents).
Indexe les documents existants, gère les uploads libres,
postes comptables et calculs de déductibilité.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import (
    BASE_DIR,
    DATA_DIR,
    GED_DIR,
    GED_METADATA_FILE,
    GED_POSTES_FILE,
    GED_THUMBNAILS_DIR,
    IMPORTS_RELEVES_DIR,
    IMPORTS_OPERATIONS_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    REPORTS_DIR,
    RAPPORTS_DIR,
    MOIS_FR,
    ALLOWED_JUSTIFICATIF_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MAGIC_BYTES,
    ensure_directories,
)

logger = logging.getLogger(__name__)

# ─── Default Postes ───

DEFAULT_POSTES: list[dict] = [
    {"id": "loyer-cabinet", "label": "Loyer & charges cabinet", "deductible_pct": 100, "categories_associees": ["Loyer"], "notes": "", "is_system": True},
    {"id": "loyer-domicile", "label": "Loyer domicile (quote-part pro)", "deductible_pct": 20, "categories_associees": [], "notes": "Prorata surface bureau / logement", "is_system": True},
    {"id": "vehicule", "label": "Véhicule (carburant, entretien, leasing)", "deductible_pct": 70, "categories_associees": ["Transport", "Véhicule"], "notes": "", "is_system": True},
    {"id": "telephone", "label": "Téléphone mobile", "deductible_pct": 60, "categories_associees": ["Téléphone", "Télécommunications"], "notes": "Usage mixte", "is_system": True},
    {"id": "internet-domicile", "label": "Internet domicile", "deductible_pct": 20, "categories_associees": ["Internet"], "notes": "= prorata surface bureau", "is_system": True},
    {"id": "assurance-rcp", "label": "Assurance RCP", "deductible_pct": 100, "categories_associees": ["Assurance"], "notes": "", "is_system": True},
    {"id": "charges-sociales", "label": "Charges sociales (URSSAF, CARMF, ODM)", "deductible_pct": 100, "categories_associees": ["Charges sociales", "URSSAF", "CARMF"], "notes": "Obligatoires", "is_system": True},
    {"id": "frais-personnel", "label": "Frais de personnel", "deductible_pct": 100, "categories_associees": ["Personnel", "Salaires"], "notes": "", "is_system": True},
    {"id": "fournitures", "label": "Achats & fournitures", "deductible_pct": 100, "categories_associees": ["Fournitures", "Matériel", "Consommables"], "notes": "", "is_system": True},
    {"id": "formation", "label": "Formation & congrès", "deductible_pct": 100, "categories_associees": ["Formation"], "notes": "DPC, séminaires", "is_system": True},
    {"id": "cotisations-pro", "label": "Cotisations professionnelles", "deductible_pct": 100, "categories_associees": ["Cotisation", "AGA", "Ordre"], "notes": "AGA, syndicat, Ordre", "is_system": True},
    {"id": "repas", "label": "Frais de repas", "deductible_pct": 100, "categories_associees": ["Repas", "Restaurant"], "notes": "Part déductible après seuil", "is_system": True},
    {"id": "honoraires-retrocedes", "label": "Honoraires rétrocédés", "deductible_pct": 100, "categories_associees": ["Rétrocession"], "notes": "", "is_system": True},
    {"id": "frais-financiers", "label": "Frais financiers", "deductible_pct": 100, "categories_associees": ["Banque", "Frais bancaires"], "notes": "Intérêts emprunt pro", "is_system": True},
    {"id": "madelin-prevoyance", "label": "Prévoyance Madelin", "deductible_pct": 100, "categories_associees": ["Madelin", "Prévoyance"], "notes": "Dans limites fiscales", "is_system": True},
    {"id": "divers", "label": "Divers / Non classé", "deductible_pct": 0, "categories_associees": [], "notes": "Non déduit par défaut", "is_system": True},
]


# ─── Metadata persistence ───

def ensure_ged_directories() -> None:
    ensure_directories()
    GED_DIR.mkdir(parents=True, exist_ok=True)
    GED_THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)


def load_metadata() -> dict:
    if GED_METADATA_FILE.exists():
        try:
            with open(GED_METADATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Erreur chargement metadata GED: {e}")
    return {"version": 1, "documents": {}}


def save_metadata(metadata: dict) -> None:
    ensure_ged_directories()
    with open(GED_METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2, default=str)


def load_postes(exercice: Optional[int] = None) -> dict:
    if exercice is None:
        exercice = datetime.now().year
    if GED_POSTES_FILE.exists():
        try:
            with open(GED_POSTES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Erreur chargement postes GED: {e}")
    # Créer avec les postes par défaut
    data = get_default_postes(exercice)
    save_postes(data)
    return data


def save_postes(postes: dict) -> None:
    ensure_ged_directories()
    with open(GED_POSTES_FILE, "w", encoding="utf-8") as f:
        json.dump(postes, f, ensure_ascii=False, indent=2)


def get_default_postes(exercice: int) -> dict:
    return {
        "version": 1,
        "exercice": exercice,
        "postes": [dict(p) for p in DEFAULT_POSTES],
    }


def _clean_fournisseur(name: Optional[str]) -> Optional[str]:
    """Nettoie un nom de fournisseur (trim, retire guillemets parasites, capitalise)."""
    if not name:
        return None
    clean = name.strip().strip('"').strip("'").strip()
    if not clean:
        return None
    # Capitalize first letter of each word
    return clean.title() if clean == clean.lower() or clean == clean.upper() else clean


# ─── Mapping poste → catégorie ───

POSTE_TO_CATEGORIE: dict[str, tuple[str, Optional[str]]] = {
    "loyer-cabinet": ("Locaux", None),
    "loyer-domicile": ("Locaux", "Domicile"),
    "vehicule": ("Véhicule", None),
    "telephone": ("Télécom", "Téléphone"),
    "internet-domicile": ("Télécom", "Internet"),
    "assurance-rcp": ("Assurances", "RC Pro"),
    "charges-sociales": ("Charges sociales", None),
    "frais-personnel": ("Personnel", None),
    "fournitures": ("Fournitures", None),
    "formation": ("Formation", "DPC"),
    "cotisations-pro": ("Cotisations", "Ordre"),
    "repas": ("Frais de repas", None),
    "honoraires-retrocedes": ("Rétrocession", None),
    "frais-financiers": ("Frais bancaires", None),
    "madelin-prevoyance": ("Madelin", "Prévoyance"),
    "divers": ("Divers", None),
}


# ─── GED V2 Enrichment functions ───

def _find_doc_id_for_justificatif(metadata: dict, justificatif_filename: str) -> Optional[str]:
    """Trouve le doc_id GED correspondant à un nom de fichier justificatif."""
    docs = metadata.get("documents", {})
    basename = Path(justificatif_filename).name
    for doc_id, doc in docs.items():
        if doc.get("type") != "justificatif":
            continue
        if Path(doc_id).name == basename or (doc.get("original_name") or "") == basename:
            return doc_id
    return None


def enrich_metadata_on_association(
    justificatif_filename: str,
    operation_file: str,
    operation_index: int,
    categorie: str,
    sous_categorie: Optional[str],
    fournisseur: Optional[str],
    date_operation: str,
    montant: float,
    ventilation_index: Optional[int] = None,
) -> None:
    """Enrichit le metadata GED du justificatif avec les infos de l'opération."""
    metadata = load_metadata()
    doc_id = _find_doc_id_for_justificatif(metadata, justificatif_filename)
    if not doc_id:
        return

    doc = metadata["documents"][doc_id]
    doc["categorie"] = categorie
    doc["sous_categorie"] = sous_categorie
    doc["fournisseur"] = fournisseur
    doc["date_operation"] = date_operation
    doc["montant"] = montant
    doc["ventilation_index"] = ventilation_index
    doc["operation_ref"] = {
        "file": operation_file,
        "index": operation_index,
        "ventilation_index": ventilation_index,
    }

    # Calculer period depuis date_operation
    if date_operation:
        try:
            dt = datetime.strptime(date_operation, "%Y-%m-%d")
            doc["period"] = {
                "year": dt.year,
                "month": dt.month,
                "quarter": (dt.month - 1) // 3 + 1,
            }
            doc["year"] = dt.year
            doc["month"] = dt.month
        except ValueError:
            pass

    save_metadata(metadata)


def clear_metadata_on_dissociation(justificatif_filename: str) -> None:
    """Reset les champs enrichis après dissociation."""
    metadata = load_metadata()
    doc_id = _find_doc_id_for_justificatif(metadata, justificatif_filename)
    if not doc_id:
        return

    doc = metadata["documents"][doc_id]
    for field in ["categorie", "sous_categorie", "fournisseur", "date_operation",
                   "montant", "ventilation_index", "operation_ref"]:
        doc[field] = None

    # Garder period si date_document existe
    if not doc.get("date_document"):
        doc["period"] = None
        doc["year"] = None
        doc["month"] = None

    save_metadata(metadata)


def enrich_metadata_on_ocr(
    justificatif_filename: str,
    fournisseur: Optional[str] = None,
    date_document: Optional[str] = None,
    montant: Optional[float] = None,
    is_reconstitue: bool = False,
) -> None:
    """Enrichit le metadata GED après OCR."""
    metadata = load_metadata()
    doc_id = _find_doc_id_for_justificatif(metadata, justificatif_filename)
    if not doc_id:
        return

    doc = metadata["documents"][doc_id]
    if fournisseur:
        doc["fournisseur"] = fournisseur
    if date_document:
        doc["date_document"] = date_document
        try:
            dt = datetime.strptime(date_document, "%Y-%m-%d")
            if not doc.get("period"):
                doc["period"] = {
                    "year": dt.year,
                    "month": dt.month,
                    "quarter": (dt.month - 1) // 3 + 1,
                }
        except ValueError:
            pass
    if montant is not None:
        doc["montant"] = montant
    doc["is_reconstitue"] = is_reconstitue
    save_metadata(metadata)


def register_rapport(
    filename: str,
    path: str,
    title: str,
    description: Optional[str],
    filters: dict,
    format_type: str,
    template_id: Optional[str] = None,
    replaced_filename: Optional[str] = None,
) -> None:
    """Enregistre un rapport dans le metadata GED."""
    metadata = load_metadata()
    docs = metadata.get("documents", {})

    # Supprimer ancien si remplacement
    if replaced_filename:
        old_id = f"rapports/{replaced_filename}"
        docs.pop(old_id, None)
        # Aussi chercher avec le chemin complet
        for doc_id in list(docs.keys()):
            if docs[doc_id].get("type") == "rapport" and Path(doc_id).name == replaced_filename:
                docs.pop(doc_id)
                break

    # Construire doc_id
    doc_id = _relative_path(Path(path)) if Path(path).is_absolute() else path

    # Déduire period depuis filters
    period = None
    if filters.get("year"):
        period = {
            "year": filters["year"],
            "month": filters.get("month"),
            "quarter": filters.get("quarter"),
        }

    # Déduire categorie
    categorie = None
    cats = filters.get("categories", [])
    if isinstance(cats, list) and len(cats) == 1:
        categorie = cats[0]

    now = datetime.now().isoformat()
    docs[doc_id] = {
        "doc_id": doc_id,
        "type": "rapport",
        "filename": filename,
        "year": filters.get("year"),
        "month": filters.get("month"),
        "poste_comptable": None,
        "categorie": categorie,
        "sous_categorie": None,
        "montant_brut": None,
        "deductible_pct_override": None,
        "tags": [],
        "notes": "",
        "added_at": now,
        "original_name": filename,
        "ocr_file": None,
        "fournisseur": None,
        "date_document": None,
        "date_operation": None,
        "period": period,
        "montant": None,
        "ventilation_index": None,
        "is_reconstitue": False,
        "operation_ref": None,
        "rapport_meta": {
            "template_id": template_id,
            "title": title,
            "description": description,
            "filters": filters,
            "format": format_type,
            "favorite": False,
            "generated_at": now,
            "can_regenerate": True,
            "can_compare": True,
        },
    }

    metadata["documents"] = docs
    save_metadata(metadata)


def propagate_category_change(
    operation_file: str,
    operation_index: int,
    new_categorie: str,
    new_sous_categorie: Optional[str],
) -> None:
    """Propage le changement de catégorie aux justificatifs liés."""
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    changed = False

    for doc_id, doc in docs.items():
        if doc.get("type") != "justificatif":
            continue
        ref = doc.get("operation_ref")
        if not ref:
            continue
        if ref.get("file") == operation_file and ref.get("index") == operation_index:
            doc["categorie"] = new_categorie
            doc["sous_categorie"] = new_sous_categorie
            changed = True

    if changed:
        save_metadata(metadata)


def remove_document(doc_id: str) -> None:
    """Supprime une entrée du metadata GED (sans toucher au fichier)."""
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    # Essayer match exact puis par filename
    if doc_id in docs:
        del docs[doc_id]
    else:
        for did in list(docs.keys()):
            if Path(did).name == doc_id or docs[did].get("original_name") == doc_id:
                del docs[did]
                break
    save_metadata(metadata)


def toggle_rapport_favorite(doc_id: str) -> dict:
    """Toggle favori sur un rapport."""
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    doc = docs.get(doc_id)
    if not doc or doc.get("type") != "rapport":
        raise ValueError(f"Rapport non trouvé: {doc_id}")

    rm = doc.get("rapport_meta") or {}
    rm["favorite"] = not rm.get("favorite", False)
    doc["rapport_meta"] = rm
    save_metadata(metadata)

    # Sync with report_service index
    try:
        from backend.services import report_service
        report_service.toggle_favorite(Path(doc_id).name)
    except Exception:
        pass

    return doc


def regenerate_rapport(doc_id: str) -> dict:
    """Re-génère un rapport via le service rapports."""
    metadata = load_metadata()
    doc = metadata.get("documents", {}).get(doc_id)
    if not doc or doc.get("type") != "rapport":
        raise ValueError(f"Rapport non trouvé: {doc_id}")

    filename = Path(doc_id).name
    from backend.services import report_service
    return report_service.regenerate_report(filename)


def compare_reports(doc_id_a: str, doc_id_b: str) -> dict:
    """Compare 2 rapports."""
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    a = docs.get(doc_id_a)
    b = docs.get(doc_id_b)
    if not a or not b:
        raise ValueError("Un ou plusieurs rapports non trouvés")

    filename_a = Path(doc_id_a).name
    filename_b = Path(doc_id_b).name
    from backend.services import report_service
    return report_service.compare_reports(filename_a, filename_b)


def get_pending_reports(year: int) -> list[dict]:
    """Identifie les rapports mensuels manquants pour les mois passés."""
    from datetime import date
    metadata = load_metadata()
    docs = metadata.get("documents", {})

    # Rapports existants pour l'année
    existing_months: set[int] = set()
    for doc_id, doc in docs.items():
        if doc.get("type") != "rapport":
            continue
        rm = doc.get("rapport_meta")
        if not rm:
            continue
        period = doc.get("period") or {}
        if period.get("year") == year and period.get("month"):
            existing_months.add(period["month"])

    # Mois passés sans rapport
    today = date.today()
    pending = []
    for month in range(1, 13):
        if year > today.year or (year == today.year and month >= today.month):
            break
        if month not in existing_months:
            label_m = MOIS_FR[month - 1].capitalize() if 1 <= month <= 12 else str(month)
            pending.append({
                "type": "mensuel",
                "year": year,
                "month": month,
                "label": f"Rapport mensuel — {label_m} {year}",
            })

    return pending


def _enrich_from_filename(doc: dict, basename: str) -> None:
    """Enrichit un document GED avec les données parsées du nom de fichier (convention fournisseur_YYYYMMDD_montant.pdf)."""
    import re as _re
    m = _re.match(r"^(.+?)_(\d{4})(\d{2})(\d{2})_(.+?)\.pdf$", basename)
    if not m:
        return
    vendor_raw, year_s, month_s, day_s, amount_s = m.groups()
    if not doc.get("fournisseur"):
        doc["fournisseur"] = _clean_fournisseur(vendor_raw.replace("-", " ").replace("_", " ").title())
    try:
        y, mo = int(year_s), int(month_s)
        if 2020 <= y <= 2030 and 1 <= mo <= 12:
            if not doc.get("year"):
                doc["year"] = y
                doc["month"] = mo
                doc["period"] = {"year": y, "month": mo, "quarter": (mo - 1) // 3 + 1}
    except ValueError:
        pass
    try:
        amt = float(amount_s.replace(",", "."))
        if not doc.get("montant") and amt > 0:
            doc["montant"] = amt
    except ValueError:
        pass


def backfill_justificatifs_metadata() -> int:
    """Backfill: enrichit les justificatifs (traités ET en attente) avec les infos disponibles."""
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    count = 0

    # Collect all justificatifs without enrichment (traités + en_attente)
    to_enrich: list[tuple[str, dict]] = []
    for doc_id, doc in docs.items():
        if doc.get("type") != "justificatif":
            continue
        # Already fully enriched?
        if doc.get("categorie") and doc.get("period") and doc.get("operation_ref"):
            continue
        to_enrich.append((doc_id, doc))

    if not to_enrich:
        return 0

    # Load all operations and build a reverse index: justificatif_filename -> operation info
    justif_to_op: dict[str, dict] = {}
    if IMPORTS_OPERATIONS_DIR.exists():
        for op_file in sorted(IMPORTS_OPERATIONS_DIR.glob("*.json")):
            try:
                with open(op_file, "r", encoding="utf-8") as f:
                    ops = json.load(f)
                for idx, op in enumerate(ops):
                    lien = op.get("Lien justificatif", "")
                    if not lien:
                        continue
                    # Extract basename from lien (may contain folder prefix like "traites/...")
                    lien_basename = Path(lien).name
                    justif_to_op[lien_basename] = {
                        "file": op_file.name,
                        "index": idx,
                        "categorie": op.get("Catégorie", ""),
                        "sous_categorie": op.get("Sous-catégorie", ""),
                        "date": op.get("Date", ""),
                        "debit": op.get("Débit", 0),
                        "credit": op.get("Crédit", 0),
                        "libelle": op.get("Libellé", ""),
                    }
                    # Also check ventilation sub-lines
                    for vi, vline in enumerate(op.get("ventilation", [])):
                        vlien = vline.get("justificatif", "")
                        if vlien:
                            justif_to_op[Path(vlien).name] = {
                                "file": op_file.name,
                                "index": idx,
                                "ventilation_index": vi,
                                "categorie": vline.get("categorie", ""),
                                "sous_categorie": vline.get("sous_categorie", ""),
                                "date": op.get("Date", ""),
                                "debit": vline.get("montant", 0),
                                "credit": 0,
                                "libelle": op.get("Libellé", ""),
                            }
            except Exception:
                continue

    # Enrich each justificatif
    for doc_id, doc in to_enrich:
        basename = Path(doc_id).name
        is_traite = "traites" in doc_id
        op_info = justif_to_op.get(basename)

        # Enrichir depuis l'opération liée (traités uniquement)
        if op_info and is_traite:
            doc["categorie"] = op_info.get("categorie") or None
            doc["sous_categorie"] = op_info.get("sous_categorie") or None
            doc["date_operation"] = op_info.get("date") or None
            montant = float(op_info.get("debit") or 0) or float(op_info.get("credit") or 0)
            doc["montant"] = montant if montant else None
            doc["operation_ref"] = {
                "file": op_info["file"],
                "index": op_info["index"],
                "ventilation_index": op_info.get("ventilation_index"),
            }

            # Compute period from date
            date_str = op_info.get("date", "")
            if date_str:
                try:
                    dt = datetime.strptime(date_str, "%Y-%m-%d")
                    doc["period"] = {
                        "year": dt.year,
                        "month": dt.month,
                        "quarter": (dt.month - 1) // 3 + 1,
                    }
                    doc["year"] = dt.year
                    doc["month"] = dt.month
                except ValueError:
                    pass

        # Enrichir depuis le nom de fichier (convention fournisseur_YYYYMMDD_montant.pdf)
        _enrich_from_filename(doc, basename)

        # Try to get fournisseur from OCR cache
        ocr_file = doc.get("ocr_file")
        if ocr_file and not doc.get("fournisseur"):
            ocr_path = BASE_DIR / ocr_file
            if ocr_path.exists():
                try:
                    with open(ocr_path, "r", encoding="utf-8") as f:
                        ocr_data = json.load(f)
                    supplier = ocr_data.get("extracted_data", {}).get("supplier")
                    if supplier:
                        doc["fournisseur"] = _clean_fournisseur(supplier)
                except Exception:
                    pass

        # Détection fac-similé : nouveau format `_fs` ou legacy `reconstitue_`
        from backend.services import rename_service as _rn
        doc["is_reconstitue"] = _rn.is_facsimile(basename)
        doc["statut_justificatif"] = "traite" if is_traite else "en_attente"
        count += 1

    if count > 0:
        save_metadata(metadata)
        logger.info(f"GED: backfill justificatifs — {count} documents enrichis")

    return count


def migrate_reports_index() -> int:
    """Migre reports_index.json vers ged_metadata.json. Retourne le nb migrés."""
    index_path = REPORTS_DIR / "reports_index.json"
    if not index_path.exists():
        return 0

    migrated_path = index_path.with_suffix(".json.migrated")
    if migrated_path.exists():
        return 0  # Déjà migré

    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return 0

    reports_list = data.get("reports", []) if isinstance(data, dict) else data
    if not reports_list:
        return 0

    metadata = load_metadata()
    docs = metadata.get("documents", {})
    count = 0

    for report in reports_list:
        filename = report.get("filename", "")
        if not filename:
            continue

        # Check path on disk
        report_path = REPORTS_DIR / filename
        if not report_path.exists():
            # Also check RAPPORTS_DIR
            report_path = RAPPORTS_DIR / filename
            if not report_path.exists():
                continue

        doc_id = _relative_path(report_path)
        if doc_id in docs:
            # Enrich existing entry with rapport_meta
            if not docs[doc_id].get("rapport_meta"):
                filters = report.get("filters", {})
                docs[doc_id]["rapport_meta"] = {
                    "template_id": report.get("template_id"),
                    "title": report.get("title", filename),
                    "description": report.get("description"),
                    "filters": filters,
                    "format": report.get("format", "pdf"),
                    "favorite": report.get("favorite", False),
                    "generated_at": report.get("generated_at"),
                    "can_regenerate": True,
                    "can_compare": True,
                }
                # Also set period/categorie if missing
                if not docs[doc_id].get("period") and filters.get("year"):
                    docs[doc_id]["period"] = {
                        "year": filters["year"],
                        "month": filters.get("month"),
                        "quarter": filters.get("quarter"),
                    }
                cats = filters.get("categories", [])
                if not docs[doc_id].get("categorie") and isinstance(cats, list) and len(cats) == 1:
                    docs[doc_id]["categorie"] = cats[0]
                count += 1
            continue

        # Create new entry
        filters = report.get("filters", {})
        period = None
        if filters.get("year"):
            period = {
                "year": filters["year"],
                "month": filters.get("month"),
                "quarter": filters.get("quarter"),
            }
        categorie = None
        cats = filters.get("categories", [])
        if isinstance(cats, list) and len(cats) == 1:
            categorie = cats[0]

        docs[doc_id] = {
            "doc_id": doc_id,
            "type": "rapport",
            "year": filters.get("year"),
            "month": filters.get("month"),
            "poste_comptable": None,
            "categorie": categorie,
            "sous_categorie": None,
            "montant_brut": None,
            "deductible_pct_override": None,
            "tags": [],
            "notes": "",
            "added_at": report.get("generated_at", datetime.now().isoformat()),
            "original_name": filename,
            "ocr_file": None,
            "fournisseur": None,
            "date_document": None,
            "date_operation": None,
            "period": period,
            "montant": None,
            "ventilation_index": None,
            "is_reconstitue": False,
            "operation_ref": None,
            "rapport_meta": {
                "template_id": report.get("template_id"),
                "title": report.get("title", filename),
                "description": report.get("description"),
                "filters": filters,
                "format": report.get("format", "pdf"),
                "favorite": report.get("favorite", False),
                "generated_at": report.get("generated_at"),
                "can_regenerate": True,
                "can_compare": True,
            },
        }
        count += 1

    metadata["documents"] = docs
    save_metadata(metadata)

    # Renommer pour ne pas re-migrer
    try:
        index_path.rename(migrated_path)
    except Exception as e:
        logger.warning(f"GED: impossible de renommer reports_index.json: {e}")

    logger.info(f"GED: migration rapports terminée — {count} rapports migrés")
    return count


# ─── Document scanning ───

def _relative_path(p: Path) -> str:
    try:
        return str(p.relative_to(BASE_DIR))
    except ValueError:
        return str(p)


def _extract_year_month_from_operations(releve_filename: str) -> tuple[Optional[int], Optional[int]]:
    """Déduit année/mois depuis les fichiers d'opérations associés au relevé."""
    stem = Path(releve_filename).stem
    # Extraire le hash du relevé (pdf_HASH -> HASH)
    releve_hash = stem.replace("pdf_", "") if stem.startswith("pdf_") else stem

    # Chercher un fichier d'opérations contenant le même hash
    for op_file in IMPORTS_OPERATIONS_DIR.glob("*.json"):
        if releve_hash and releve_hash in op_file.stem:
            try:
                with open(op_file, "r", encoding="utf-8") as f:
                    ops = json.load(f)
                if ops and isinstance(ops, list) and ops[0].get("Date"):
                    date_str = ops[0]["Date"]
                    # Format YYYY-MM-DD
                    parts = date_str.split("-")
                    if len(parts) == 3:
                        year = int(parts[0])
                        month = int(parts[1])
                        if 2000 <= year <= 2099:
                            return year, month
            except Exception:
                pass
    return None, None


def _file_info(filepath: Path) -> dict:
    stat = filepath.stat()
    return {
        "size": stat.st_size,
        "size_human": _human_size(stat.st_size),
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


def _human_size(size: int) -> str:
    for unit in ["o", "Ko", "Mo", "Go"]:
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "o" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} To"


def scan_all_sources() -> dict:
    """Scanne les sources existantes, merge avec le metadata."""
    ensure_ged_directories()
    # Migration one-shot des rapports
    try:
        migrate_reports_index()
    except Exception as e:
        logger.warning(f"GED: erreur migration rapports: {e}")
    # Backfill justificatifs traités existants
    try:
        backfill_justificatifs_metadata()
    except Exception as e:
        logger.warning(f"GED: erreur backfill justificatifs: {e}")
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    seen_ids: set[str] = set()
    now = datetime.now().isoformat()

    def _add_or_update(filepath: Path, doc_type: str, year: Optional[int] = None, month: Optional[int] = None) -> None:
        doc_id = _relative_path(filepath)
        seen_ids.add(doc_id)
        if doc_id in docs:
            return  # déjà indexé
        # Chercher un fichier OCR associé
        ocr_file = None
        ocr_path = filepath.with_suffix(".ocr.json")
        if ocr_path.exists():
            ocr_file = _relative_path(ocr_path)
        docs[doc_id] = {
            "doc_id": doc_id,
            "type": doc_type,
            "year": year,
            "month": month,
            "poste_comptable": None,
            "montant_brut": None,
            "deductible_pct_override": None,
            "tags": [],
            "notes": "",
            "added_at": now,
            "original_name": filepath.name,
            "ocr_file": ocr_file,
        }

    # 1. Relevés bancaires
    if IMPORTS_RELEVES_DIR.exists():
        for f in sorted(IMPORTS_RELEVES_DIR.glob("*.pdf")):
            year, month = _extract_year_month_from_operations(f.name)
            _add_or_update(f, "releve", year, month)

    # 2. Justificatifs en attente
    if JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        for f in sorted(JUSTIFICATIFS_EN_ATTENTE_DIR.iterdir()):
            if f.suffix.lower() == ".pdf":
                _add_or_update(f, "justificatif")

    # 3. Justificatifs traités
    if JUSTIFICATIFS_TRAITES_DIR.exists():
        for f in sorted(JUSTIFICATIFS_TRAITES_DIR.iterdir()):
            if f.suffix.lower() == ".pdf":
                _add_or_update(f, "justificatif")

    # 4. Rapports
    for reports_dir in [REPORTS_DIR, RAPPORTS_DIR]:
        if reports_dir.exists():
            for f in sorted(reports_dir.iterdir()):
                if f.suffix.lower() in (".pdf", ".csv", ".xlsx"):
                    _add_or_update(f, "rapport")

    # 5. Documents libres (data/ged/)
    for root, _dirs, files in os.walk(GED_DIR):
        root_path = Path(root)
        if root_path == GED_THUMBNAILS_DIR:
            continue
        for fname in files:
            fpath = root_path / fname
            if fname.endswith(".json") or fname.startswith("."):
                continue
            _add_or_update(fpath, "document_libre")

    # Retirer les documents supprimés du filesystem
    to_remove = [doc_id for doc_id in docs if doc_id not in seen_ids and docs[doc_id].get("type") != "document_libre"]
    # Pour les documents libres, vérifier qu'ils existent encore
    for doc_id in list(docs.keys()):
        if docs[doc_id].get("type") == "document_libre" and doc_id not in seen_ids:
            abs_path = BASE_DIR / doc_id
            if not abs_path.exists():
                to_remove.append(doc_id)

    for doc_id in to_remove:
        docs.pop(doc_id, None)

    metadata["documents"] = docs
    save_metadata(metadata)
    return metadata


# ─── Tree building ───

def build_tree(metadata: dict, postes: dict) -> dict:
    docs = metadata.get("documents", {})
    postes_list = postes.get("postes", [])
    postes_map = {p["id"]: p for p in postes_list}

    return {
        "by_period": _build_period_tree(docs),
        "by_category": _build_category_tree(docs, postes_map),
        "by_vendor": _build_vendor_tree(docs),
        "by_type": _build_type_tree(docs, postes_map),
        "by_year": _build_tree_by_year(docs),
    }


def _build_period_tree(docs: dict) -> list[dict]:
    """Arbre par année → trimestre → mois (tous types mélangés)."""
    by_year: dict[int, dict[int, dict[int, int]]] = {}
    no_date_count = 0

    for d in docs.values():
        period = d.get("period")
        if period and period.get("year"):
            y = period["year"]
            q = period.get("quarter") or ((period.get("month", 1) - 1) // 3 + 1)
            m = period.get("month") or 0
            by_year.setdefault(y, {}).setdefault(q, {})
            by_year[y][q][m] = by_year[y][q].get(m, 0) + 1
        elif d.get("year"):
            y = d["year"]
            m = d.get("month") or 0
            q = ((m - 1) // 3 + 1) if m > 0 else 1
            by_year.setdefault(y, {}).setdefault(q, {})
            by_year[y][q][m] = by_year[y][q].get(m, 0) + 1
        else:
            no_date_count += 1

    year_nodes = []
    for y in sorted(by_year.keys(), reverse=True):
        q_nodes = []
        year_total = 0
        for q in sorted(by_year[y].keys()):
            m_nodes = []
            q_total = 0
            for m in sorted(by_year[y][q].keys()):
                cnt = by_year[y][q][m]
                q_total += cnt
                label = _month_label(m) if m > 0 else "Non daté"
                m_nodes.append({"id": f"period-{y}-{m}", "label": label, "count": cnt, "children": []})
            year_total += q_total
            q_nodes.append({"id": f"period-{y}-T{q}", "label": f"T{q}", "count": q_total, "children": m_nodes})
        year_nodes.append({"id": f"period-{y}", "label": str(y), "count": year_total, "children": q_nodes, "icon": "Calendar"})

    if no_date_count > 0:
        year_nodes.append({"id": "period-none", "label": "Non daté", "count": no_date_count, "children": []})

    return year_nodes


def _build_category_tree(docs: dict, postes_map: dict) -> list[dict]:
    """Arbre par catégorie → sous-catégorie."""
    by_cat: dict[str, dict[str, int]] = {}
    non_classes = 0

    for d in docs.values():
        cat = d.get("categorie")
        # For docs libres with poste but no categorie, use mapping
        if not cat and d.get("poste_comptable"):
            mapping = POSTE_TO_CATEGORIE.get(d["poste_comptable"])
            if mapping:
                cat = mapping[0]

        if not cat:
            non_classes += 1
            continue

        sous_cat = d.get("sous_categorie") or "—"
        by_cat.setdefault(cat, {})
        by_cat[cat][sous_cat] = by_cat[cat].get(sous_cat, 0) + 1

    nodes = []
    if non_classes > 0:
        nodes.append({"id": "cat-non-classes", "label": "\u26a0 Non classés", "count": non_classes, "children": [], "icon": "AlertTriangle"})

    for cat in sorted(by_cat.keys()):
        sub_nodes = []
        cat_total = 0
        for sc, cnt in sorted(by_cat[cat].items()):
            cat_total += cnt
            if sc != "—":
                sub_nodes.append({"id": f"cat-{cat}-{sc}", "label": sc, "count": cnt, "children": []})
            else:
                cat_total += 0  # counted above
        # If only "—" sub-category, don't show sub-nodes
        if len(by_cat[cat]) == 1 and "—" in by_cat[cat]:
            cat_total = by_cat[cat]["—"]
            sub_nodes = []
        else:
            cat_total = sum(by_cat[cat].values())
        nodes.append({"id": f"cat-{cat}", "label": cat, "count": cat_total, "children": sub_nodes})

    return nodes


def _build_vendor_tree(docs: dict) -> list[dict]:
    """Arbre par fournisseur → année. Exclut relevés et rapports."""
    by_vendor: dict[str, dict[int, int]] = {}
    unknown = 0

    for d in docs.values():
        if d.get("type") in ("releve", "rapport"):
            continue
        vendor = d.get("fournisseur")
        if not vendor:
            unknown += 1
            continue
        period = d.get("period") or {}
        y = period.get("year") or d.get("year") or 0
        by_vendor.setdefault(vendor, {})
        by_vendor[vendor][y] = by_vendor[vendor].get(y, 0) + 1

    nodes = []
    for vendor in sorted(by_vendor.keys()):
        year_nodes = []
        vendor_total = 0
        for y in sorted(by_vendor[vendor].keys(), reverse=True):
            cnt = by_vendor[vendor][y]
            vendor_total += cnt
            label = str(y) if y > 0 else "Non daté"
            slug = re.sub(r"[^a-zA-Z0-9]", "-", vendor.lower()).strip("-")
            year_nodes.append({"id": f"vendor-{slug}-{y}", "label": label, "count": cnt, "children": []})
        slug = re.sub(r"[^a-zA-Z0-9]", "-", vendor.lower()).strip("-")
        nodes.append({"id": f"vendor-{slug}", "label": vendor, "count": vendor_total, "children": year_nodes, "icon": "Building2"})

    if unknown > 0:
        nodes.append({"id": "vendor-unknown", "label": "Fournisseur inconnu", "count": unknown, "children": []})

    return nodes


def _build_type_tree(docs: dict, postes_map: dict) -> list[dict]:
    """Arbre par type enrichi (rétrocompatible)."""
    # Relevés par année/mois
    releves_by_year: dict[int, dict[int, int]] = {}
    for d in docs.values():
        if d["type"] != "releve":
            continue
        y = d.get("year") or 0
        m = d.get("month") or 0
        releves_by_year.setdefault(y, {})
        releves_by_year[y][m] = releves_by_year[y].get(m, 0) + 1

    releves_children = []
    for y in sorted(releves_by_year.keys(), reverse=True):
        month_children = []
        for m in sorted(releves_by_year[y].keys()):
            label = _month_label(m) if m > 0 else "Non daté"
            month_children.append({"id": f"releve-{y}-{m}", "label": label, "count": releves_by_year[y][m], "children": []})
        releves_children.append({"id": f"releve-{y}", "label": str(y) if y > 0 else "Non daté", "count": sum(releves_by_year[y].values()), "children": month_children})

    releves_node = {
        "id": "releves", "label": "Relevés bancaires",
        "count": sum(sum(m.values()) for m in releves_by_year.values()),
        "children": releves_children, "icon": "FileText",
    }

    # Justificatifs: en attente / traités par année/mois
    en_attente_count = 0
    traites_by_year: dict[int, dict[int, int]] = {}
    for d in docs.values():
        if d["type"] != "justificatif":
            continue
        if "en_attente" in d.get("doc_id", ""):
            en_attente_count += 1
        else:
            y = d.get("year") or 0
            m = d.get("month") or 0
            traites_by_year.setdefault(y, {})
            traites_by_year[y][m] = traites_by_year[y].get(m, 0) + 1

    traites_children = []
    for y in sorted(traites_by_year.keys(), reverse=True):
        month_children = []
        for m in sorted(traites_by_year[y].keys()):
            label = _month_label(m) if m > 0 else "Non daté"
            month_children.append({"id": f"justificatif-date-{y}-{m}", "label": label, "count": traites_by_year[y][m], "children": []})
        traites_children.append({"id": f"justificatif-date-{y}", "label": str(y) if y > 0 else "Non daté", "count": sum(traites_by_year[y].values()), "children": month_children})

    just_total = en_attente_count + sum(sum(m.values()) for m in traites_by_year.values())
    justificatifs_node = {
        "id": "justificatifs", "label": "Justificatifs", "count": just_total, "icon": "Receipt",
        "children": [
            {"id": "justificatifs-en-attente", "label": "En attente", "count": en_attente_count, "children": []},
            {"id": "justificatifs-traites", "label": "Traités", "count": just_total - en_attente_count, "children": traites_children},
        ],
    }

    # Rapports: par format
    rapports_by_format: dict[str, int] = {}
    rapports_favoris = 0
    for d in docs.values():
        if d["type"] != "rapport":
            continue
        rm = d.get("rapport_meta") or {}
        fmt = rm.get("format") or _guess_format(d.get("doc_id", ""))
        rapports_by_format[fmt] = rapports_by_format.get(fmt, 0) + 1
        if rm.get("favorite"):
            rapports_favoris += 1

    FORMAT_LABELS = {"pdf": "PDF", "csv": "CSV", "excel": "Excel", "xlsx": "Excel"}
    rapports_children = []
    for fmt in ["pdf", "csv", "excel", "xlsx"]:
        if fmt in rapports_by_format:
            rapports_children.append({"id": f"rapport-{fmt}", "label": FORMAT_LABELS.get(fmt, fmt.upper()), "count": rapports_by_format[fmt], "children": []})

    rapports_node = {
        "id": "rapports", "label": "Rapports",
        "count": sum(rapports_by_format.values()),
        "children": rapports_children, "icon": "BarChart3",
    }

    # Documents libres par année/mois (inclut les types custom non standard)
    KNOWN_TYPES = {"releve", "justificatif", "rapport"}
    libre_by_year: dict[int, dict[int, int]] = {}
    for d in docs.values():
        if d["type"] in KNOWN_TYPES:
            continue
        y = d.get("year") or 0
        m = d.get("month") or 0
        libre_by_year.setdefault(y, {})
        libre_by_year[y][m] = libre_by_year[y].get(m, 0) + 1

    libre_children = []
    for y in sorted(libre_by_year.keys(), reverse=True):
        month_children = []
        for m in sorted(libre_by_year[y].keys()):
            label = _month_label(m) if m > 0 else "Non daté"
            month_children.append({"id": f"libre-{y}-{m}", "label": label, "count": libre_by_year[y][m], "children": []})
        libre_children.append({"id": f"libre-{y}", "label": str(y) if y > 0 else "Non daté", "count": sum(libre_by_year[y].values()), "children": month_children})

    libres_node = {
        "id": "documents-libres", "label": "Documents libres",
        "count": sum(sum(m.values()) for m in libre_by_year.values()),
        "children": libre_children, "icon": "FolderOpen",
    }

    return [releves_node, justificatifs_node, rapports_node, libres_node]


def _guess_format(doc_id: str) -> str:
    ext = Path(doc_id).suffix.lower()
    return {"pdf": "pdf", ".csv": "csv", ".xlsx": "excel"}.get(ext, "pdf")


def _build_tree_by_year(docs: dict) -> list[dict]:
    """Construit l'arbre par année > type > mois."""
    TYPE_ICONS = {
        "releve": "FileText",
        "justificatif": "Receipt",
        "rapport": "BarChart3",
        "document_libre": "FolderOpen",
    }
    TYPE_LABELS = {
        "releve": "Relevés",
        "justificatif": "Justificatifs",
        "rapport": "Rapports",
        "document_libre": "Documents libres",
    }

    # Collecter par année > type > mois
    by_year: dict[int, dict[str, dict[int, int]]] = {}
    no_year: dict[str, int] = {}

    for d in docs.values():
        y = d.get("year")
        dtype = d.get("type", "document_libre")
        if dtype not in ("releve", "justificatif", "rapport", "document_libre"):
            dtype = "document_libre"
        m = d.get("month") or 0

        if y:
            by_year.setdefault(y, {})
            by_year[y].setdefault(dtype, {})
            by_year[y][dtype][m] = by_year[y][dtype].get(m, 0) + 1
        else:
            no_year[dtype] = no_year.get(dtype, 0) + 1

    year_nodes = []
    for y in sorted(by_year.keys(), reverse=True):
        type_children = []
        year_total = 0

        for dtype in ["releve", "justificatif", "rapport", "document_libre"]:
            if dtype not in by_year[y]:
                continue
            months = by_year[y][dtype]
            type_total = sum(months.values())
            year_total += type_total

            month_children = []
            for m in sorted(months.keys()):
                label = _month_label(m) if m > 0 else "Non daté"
                month_children.append({
                    "id": f"year-{y}-{dtype}-{m}",
                    "label": label,
                    "count": months[m],
                    "children": [],
                })

            type_children.append({
                "id": f"year-{y}-{dtype}",
                "label": TYPE_LABELS.get(dtype, dtype),
                "count": type_total,
                "children": month_children,
                "icon": TYPE_ICONS.get(dtype),
            })

        year_nodes.append({
            "id": f"year-{y}",
            "label": str(y),
            "count": year_total,
            "children": type_children,
            "icon": "Calendar",
        })

    # Non daté
    if no_year:
        nd_children = []
        nd_total = 0
        for dtype, count in no_year.items():
            nd_total += count
            nd_children.append({
                "id": f"year-none-{dtype}",
                "label": TYPE_LABELS.get(dtype, dtype),
                "count": count,
                "children": [],
                "icon": TYPE_ICONS.get(dtype),
            })
        year_nodes.append({
            "id": "year-none",
            "label": "Non daté",
            "count": nd_total,
            "children": nd_children,
        })

    return year_nodes


def _month_label(month: int) -> str:
    if 1 <= month <= 12:
        return MOIS_FR[month - 1].capitalize()
    return str(month)


def _resolve_poste_for_doc(doc: dict, postes_map: dict[str, dict]) -> Optional[str]:
    """Résout le poste pour un document via son poste_comptable ou categories_associees."""
    if doc.get("poste_comptable"):
        return doc["poste_comptable"]
    return None


# ─── Distinct types ───

DEFAULT_DOCUMENT_TYPES: set[str] = {
    "relevé", "justificatif", "rapport", "contrat", "courrier fiscal",
    "courrier social", "attestation", "devis", "divers",
}


def get_distinct_types() -> list[str]:
    """Retourne tous les types de documents uniques déjà utilisés, triés alphabétiquement."""
    metadata = load_metadata()
    types: set[str] = set()
    for doc in metadata.get("documents", {}).values():
        doc_type = doc.get("type", "").strip()
        if doc_type:
            types.add(doc_type)
    types.update(DEFAULT_DOCUMENT_TYPES)
    return sorted(types)


# ─── Document listing ───

def get_documents(
    metadata: dict,
    type_filter: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    quarter: Optional[int] = None,
    categorie: Optional[str] = None,
    sous_categorie: Optional[str] = None,
    fournisseur: Optional[str] = None,
    format_type: Optional[str] = None,
    favorite: Optional[bool] = None,
    poste_comptable: Optional[str] = None,
    tags: Optional[list[str]] = None,
    search: Optional[str] = None,
    sort_by: str = "added_at",
    sort_order: str = "desc",
) -> list[dict]:
    docs = list(metadata.get("documents", {}).values())

    if type_filter:
        if type_filter == "document_libre":
            # Inclure document_libre ET tout type custom (non standard)
            _STANDARD_TYPES = {"releve", "justificatif", "rapport"}
            docs = [d for d in docs if d["type"] not in _STANDARD_TYPES]
        else:
            docs = [d for d in docs if d["type"] == type_filter]
    if year:
        docs = [d for d in docs if d.get("year") == year or (d.get("period") or {}).get("year") == year]
    if month:
        docs = [d for d in docs if d.get("month") == month or (d.get("period") or {}).get("month") == month]
    if quarter:
        docs = [d for d in docs if (d.get("period") or {}).get("quarter") == quarter]
    if categorie:
        docs = [d for d in docs if d.get("categorie") == categorie]
    if sous_categorie:
        docs = [d for d in docs if d.get("sous_categorie") == sous_categorie]
    if fournisseur:
        docs = [d for d in docs if d.get("fournisseur") == fournisseur]
    if format_type:
        docs = [d for d in docs if (d.get("rapport_meta") or {}).get("format") == format_type]
    if favorite is not None:
        docs = [d for d in docs if (d.get("rapport_meta") or {}).get("favorite") == favorite]
    if poste_comptable:
        docs = [d for d in docs if d.get("poste_comptable") == poste_comptable]
    if tags:
        docs = [d for d in docs if any(t in d.get("tags", []) for t in tags)]
    if search:
        q = search.lower()
        docs = [d for d in docs if q in d.get("doc_id", "").lower()
                or q in (d.get("original_name") or "").lower()
                or q in (d.get("notes") or "").lower()
                or any(q in t.lower() for t in d.get("tags", []))
                or q in ((d.get("rapport_meta") or {}).get("title") or "").lower()
                or q in ((d.get("rapport_meta") or {}).get("description") or "").lower()
                or q in (d.get("fournisseur") or "").lower()]

    reverse = sort_order == "desc"
    docs.sort(key=lambda d: d.get(sort_by) or "", reverse=reverse)
    return docs


# ─── Upload ───

def upload_document(file_content: bytes, filename: str, request: dict) -> dict:
    ensure_ged_directories()

    year = request.get("year") or datetime.now().year
    month = request.get("month") or datetime.now().month

    dest_dir = GED_DIR / str(year) / str(month).zfill(2)
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Gestion doublons
    dest = dest_dir / filename
    if dest.exists():
        stem = Path(filename).stem
        ext = Path(filename).suffix
        ts = datetime.now().strftime("%H%M%S")
        dest = dest_dir / f"{stem}_{ts}{ext}"

    # Conversion image → PDF si nécessaire
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(file_content))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            pdf_bytes = io.BytesIO()
            img.save(pdf_bytes, "PDF")
            file_content = pdf_bytes.getvalue()
            dest = dest.with_suffix(".pdf")
        except Exception as e:
            logger.error(f"Erreur conversion image → PDF: {e}")

    with open(dest, "wb") as f:
        f.write(file_content)

    doc_id = _relative_path(dest)
    now = datetime.now().isoformat()

    doc = {
        "doc_id": doc_id,
        "type": request.get("type", "document_libre"),
        "year": year,
        "month": month,
        "poste_comptable": request.get("poste_comptable"),
        "categorie": request.get("categorie"),
        "sous_categorie": request.get("sous_categorie"),
        "montant_brut": None,
        "deductible_pct_override": None,
        "tags": request.get("tags", []),
        "notes": request.get("notes", ""),
        "added_at": now,
        "original_name": filename,
        "ocr_file": None,
    }

    # OCR automatique (PDF uniquement, les images ont été converties en PDF)
    ocr_result = None
    if dest.suffix.lower() == ".pdf":
        try:
            from backend.services.ocr_service import extract_or_cached
            ocr_result = extract_or_cached(dest)
            ocr_json_path = dest.with_suffix(".ocr.json")
            if ocr_json_path.exists():
                doc["ocr_file"] = _relative_path(ocr_json_path)
        except Exception as e:
            logger.warning(f"GED: OCR échoué pour {doc_id}: {e}")

    metadata = load_metadata()
    metadata["documents"][doc_id] = doc
    save_metadata(metadata)

    logger.info(f"GED: document uploadé → {doc_id} (OCR: {'OK' if ocr_result else 'non'})")
    return {
        **doc,
        "ocr_success": ocr_result is not None,
        "ocr_data": ocr_result,
    }


def update_document(doc_id: str, updates: dict) -> dict:
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    if doc_id not in docs:
        raise ValueError(f"Document non trouvé: {doc_id}")

    doc = docs[doc_id]
    for key in ["poste_comptable", "categorie", "sous_categorie", "tags", "notes", "montant_brut", "deductible_pct_override"]:
        if key in updates and updates[key] is not None:
            doc[key] = updates[key]

    metadata["documents"][doc_id] = doc
    save_metadata(metadata)
    return doc


def delete_document(doc_id: str) -> bool:
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    if doc_id not in docs:
        return False

    doc = docs[doc_id]

    # Rapports : déléguer à report_service puis nettoyer GED
    if doc["type"] == "rapport":
        try:
            from backend.services import report_service
            filename = Path(doc_id).name
            report_service.delete_report(filename)
            # Supprimer l'entrée GED
            del docs[doc_id]
            save_metadata(metadata)
            # Supprimer le thumbnail
            thumb = _thumbnail_cache_path(doc_id)
            if thumb.exists():
                thumb.unlink()
            logger.info(f"GED: rapport supprimé → {doc_id}")
            return True
        except Exception as e:
            logger.error(f"GED: erreur suppression rapport {doc_id}: {e}")
            return False

    if doc["type"] in ("releve",):
        raise ValueError("Ce type de document ne peut pas être supprimé via la GED")

    # Supprimer le fichier
    abs_path = BASE_DIR / doc_id
    if abs_path.exists():
        abs_path.unlink()

    # Supprimer le thumbnail
    thumb = _thumbnail_cache_path(doc_id)
    if thumb.exists():
        thumb.unlink()

    del docs[doc_id]
    save_metadata(metadata)
    logger.info(f"GED: document supprimé → {doc_id}")
    return True


# ─── Search ───

def search_fulltext(query: str, metadata: dict) -> list[dict]:
    if len(query) < 2:
        return []

    q = query.lower()
    results = []

    for doc_id, doc in metadata.get("documents", {}).items():
        score = 0.0
        context = ""

        # Nom fichier
        name = (doc.get("original_name") or Path(doc_id).name).lower()
        if q in name:
            score += 3.0
            context = doc.get("original_name") or Path(doc_id).name

        # Tags
        for tag in doc.get("tags", []):
            if q in tag.lower():
                score += 2.0
                context = context or f"Tag: {tag}"

        # Notes
        notes = (doc.get("notes") or "").lower()
        if q in notes:
            score += 1.5
            context = context or doc.get("notes", "")[:100]

        # Contenu OCR
        ocr_file = doc.get("ocr_file")
        if ocr_file:
            ocr_path = BASE_DIR / ocr_file
            if ocr_path.exists():
                try:
                    with open(ocr_path, "r", encoding="utf-8") as f:
                        ocr_data = json.load(f)
                    raw_text = (ocr_data.get("raw_text") or "").lower()
                    if q in raw_text:
                        score += 1.0
                        idx = raw_text.index(q)
                        start = max(0, idx - 30)
                        end = min(len(raw_text), idx + len(q) + 30)
                        context = context or f"...{raw_text[start:end]}..."
                except Exception:
                    pass

        if score > 0:
            results.append({
                "doc_id": doc_id,
                "document": doc,
                "match_context": context,
                "score": score,
            })

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:50]


# ─── Stats ───

def get_stats(metadata: dict, postes: dict) -> dict:
    docs = metadata.get("documents", {})
    postes_list = postes.get("postes", [])
    postes_map = {p["id"]: p for p in postes_list}

    total_brut = 0.0
    total_deductible = 0.0
    total_size = 0
    par_poste: dict[str, dict] = {}

    for doc in docs.values():
        # Taille fichier
        abs_path = BASE_DIR / doc["doc_id"]
        if abs_path.exists():
            total_size += abs_path.stat().st_size

        montant = doc.get("montant_brut") or 0
        if not montant:
            continue

        total_brut += montant

        # Calcul déductible
        pct = doc.get("deductible_pct_override")
        if pct is None:
            poste_id = doc.get("poste_comptable")
            if poste_id and poste_id in postes_map:
                pct = postes_map[poste_id]["deductible_pct"]
            else:
                pct = 0

        deductible = montant * pct / 100
        total_deductible += deductible

        # Par poste
        poste_id = doc.get("poste_comptable") or "non-classe"
        if poste_id not in par_poste:
            p = postes_map.get(poste_id)
            par_poste[poste_id] = {
                "poste_id": poste_id,
                "poste_label": p["label"] if p else "Non classé",
                "deductible_pct": p["deductible_pct"] if p else 0,
                "nb_docs": 0,
                "total_brut": 0,
                "total_deductible": 0,
            }
        par_poste[poste_id]["nb_docs"] += 1
        par_poste[poste_id]["total_brut"] += montant
        par_poste[poste_id]["total_deductible"] += deductible

    # Stats enrichies V2
    par_categorie: dict[str, dict] = {}
    par_fournisseur: dict[str, dict] = {}
    par_type: dict[str, int] = {}
    non_classes = 0
    rapports_favoris = 0

    for doc in docs.values():
        dtype = doc.get("type", "document_libre")
        par_type[dtype] = par_type.get(dtype, 0) + 1

        cat = doc.get("categorie")
        if cat:
            if cat not in par_categorie:
                par_categorie[cat] = {"categorie": cat, "count": 0, "total_montant": 0}
            par_categorie[cat]["count"] += 1
            par_categorie[cat]["total_montant"] += doc.get("montant") or doc.get("montant_brut") or 0
        else:
            non_classes += 1

        fournisseur = doc.get("fournisseur")
        if fournisseur:
            if fournisseur not in par_fournisseur:
                par_fournisseur[fournisseur] = {"fournisseur": fournisseur, "count": 0, "total_montant": 0}
            par_fournisseur[fournisseur]["count"] += 1
            par_fournisseur[fournisseur]["total_montant"] += doc.get("montant") or doc.get("montant_brut") or 0

        rm = doc.get("rapport_meta") or {}
        if rm.get("favorite"):
            rapports_favoris += 1

    return {
        "total_documents": len(docs),
        "total_brut": round(total_brut, 2),
        "total_deductible": round(total_deductible, 2),
        "disk_size_human": _human_size(total_size),
        "par_poste": sorted(par_poste.values(), key=lambda x: x["total_brut"], reverse=True),
        "par_categorie": sorted(par_categorie.values(), key=lambda x: x["total_montant"], reverse=True),
        "par_fournisseur": sorted(par_fournisseur.values(), key=lambda x: x["total_montant"], reverse=True),
        "par_type": par_type,
        "non_classes": non_classes,
        "rapports_favoris": rapports_favoris,
    }


# ─── Thumbnails ───

def _thumbnail_cache_path(doc_id: str) -> Path:
    h = hashlib.md5(doc_id.encode()).hexdigest()
    return GED_THUMBNAILS_DIR / f"{h}.png"


def generate_thumbnail(doc_id: str) -> Optional[str]:
    abs_path = BASE_DIR / doc_id
    if not abs_path.exists() or abs_path.suffix.lower() != ".pdf":
        return None

    thumb_path = _thumbnail_cache_path(doc_id)

    # Vérifier le cache
    if thumb_path.exists():
        if thumb_path.stat().st_mtime >= abs_path.stat().st_mtime:
            return str(thumb_path)

    try:
        from pdf2image import convert_from_path
        images = convert_from_path(str(abs_path), first_page=1, last_page=1, size=(200, None))
        if images:
            images[0].save(str(thumb_path), "PNG")
            return str(thumb_path)
    except Exception as e:
        logger.warning(f"GED: erreur génération thumbnail pour {doc_id}: {e}")
    return None


def get_thumbnail_path(doc_id: str) -> Optional[str]:
    thumb = _thumbnail_cache_path(doc_id)
    if thumb.exists():
        return str(thumb)
    return generate_thumbnail(doc_id)


# ─── Native open ───

def open_in_native_app(doc_id: str) -> bool:
    abs_path = BASE_DIR / doc_id
    if not abs_path.exists():
        return False
    try:
        subprocess.Popen(["open", str(abs_path)])
        return True
    except Exception as e:
        logger.error(f"GED: erreur ouverture native {doc_id}: {e}")
        return False


# ─── File path resolution ───

def get_file_path(doc_id: str) -> Optional[str]:
    abs_path = BASE_DIR / doc_id
    if abs_path.exists():
        return str(abs_path)
    return None


def resolve_poste_for_document(doc: dict, postes: dict) -> Optional[str]:
    """Résout le poste via categories_associees si pas de poste_comptable explicite."""
    if doc.get("poste_comptable"):
        return doc["poste_comptable"]
    # Pour un justificatif, on pourrait résoudre via catégorie de l'opération liée
    # Pour l'instant, retourne None
    return None
