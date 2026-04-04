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

def build_tree(metadata: dict, postes: dict) -> list[dict]:
    docs = metadata.get("documents", {})
    postes_list = postes.get("postes", [])
    postes_map = {p["id"]: p for p in postes_list}

    # Helpers
    def _count(predicate) -> int:
        return sum(1 for d in docs.values() if predicate(d))

    # Root: Relevés bancaires
    releves_by_year: dict[int, dict[int, int]] = {}
    for d in docs.values():
        if d["type"] == "releve" and d.get("year"):
            y = d["year"]
            m = d.get("month", 0) or 0
            releves_by_year.setdefault(y, {})
            releves_by_year[y][m] = releves_by_year[y].get(m, 0) + 1

    releves_children = []
    for y in sorted(releves_by_year.keys(), reverse=True):
        month_children = []
        for m in sorted(releves_by_year[y].keys()):
            label = _month_label(m) if m > 0 else "Non daté"
            month_children.append({
                "id": f"releve-{y}-{m}",
                "label": label,
                "count": releves_by_year[y][m],
                "children": [],
            })
        releves_children.append({
            "id": f"releve-{y}",
            "label": str(y),
            "count": sum(releves_by_year[y].values()),
            "children": month_children,
        })

    releves_node = {
        "id": "releves",
        "label": "Relevés bancaires",
        "count": _count(lambda d: d["type"] == "releve"),
        "children": releves_children,
        "icon": "FileText",
    }

    # Root: Justificatifs
    just_by_year: dict[int, dict[str, int]] = {}
    just_en_attente_count = 0
    just_by_poste: dict[str, int] = {}
    just_no_poste = 0

    for d in docs.values():
        if d["type"] != "justificatif":
            continue
        # Par date
        y = d.get("year")
        if y:
            just_by_year.setdefault(y, {})
            status = "traites" if "traites" in d.get("doc_id", "") else "en_attente"
            if status == "en_attente":
                just_en_attente_count += 1
            m_key = str(d.get("month", 0) or 0)
            just_by_year[y][m_key] = just_by_year[y].get(m_key, 0) + 1
        else:
            if "en_attente" in d.get("doc_id", ""):
                just_en_attente_count += 1

        # Par poste
        poste_id = _resolve_poste_for_doc(d, postes_map)
        if poste_id:
            just_by_poste[poste_id] = just_by_poste.get(poste_id, 0) + 1
        else:
            just_no_poste += 1

    # Justificatifs par date
    just_date_children = []
    for y in sorted(just_by_year.keys(), reverse=True):
        month_children = []
        for m_str in sorted(just_by_year[y].keys(), key=lambda x: int(x)):
            m = int(m_str)
            label = _month_label(m) if m > 0 else "Non daté"
            month_children.append({
                "id": f"justificatif-date-{y}-{m}",
                "label": label,
                "count": just_by_year[y][m_str],
                "children": [],
            })
        just_date_children.append({
            "id": f"justificatif-date-{y}",
            "label": str(y),
            "count": sum(just_by_year[y].values()),
            "children": month_children,
        })

    # Justificatifs par poste
    just_poste_children = []
    for pid, count in sorted(just_by_poste.items(), key=lambda x: x[1], reverse=True):
        p = postes_map.get(pid)
        label = p["label"] if p else pid
        just_poste_children.append({
            "id": f"justificatif-poste-{pid}",
            "label": label,
            "count": count,
            "children": [],
        })
    if just_no_poste > 0:
        just_poste_children.append({
            "id": "justificatif-poste-none",
            "label": "Non associés",
            "count": just_no_poste,
            "children": [],
        })

    just_total = _count(lambda d: d["type"] == "justificatif")
    justificatifs_node = {
        "id": "justificatifs",
        "label": "Justificatifs",
        "count": just_total,
        "icon": "Receipt",
        "children": [
            {"id": "justificatifs-par-date", "label": "Par date", "count": just_total, "children": just_date_children},
            {"id": "justificatifs-par-poste", "label": "Par poste comptable", "count": just_total, "children": just_poste_children},
        ],
    }

    # Root: Rapports
    rapports_children = []
    rapports_by_poste: dict[str, int] = {}
    rapports_no_poste = 0
    for d in docs.values():
        if d["type"] != "rapport":
            continue
        poste_id = d.get("poste_comptable")
        if poste_id:
            rapports_by_poste[poste_id] = rapports_by_poste.get(poste_id, 0) + 1
        else:
            rapports_no_poste += 1

    if rapports_no_poste > 0:
        rapports_children.append({
            "id": "rapport-tous",
            "label": "Tous postes",
            "count": rapports_no_poste,
            "children": [],
        })
    for pid, count in sorted(rapports_by_poste.items(), key=lambda x: x[1], reverse=True):
        p = postes_map.get(pid)
        label = p["label"] if p else pid
        rapports_children.append({
            "id": f"rapport-poste-{pid}",
            "label": label,
            "count": count,
            "children": [],
        })

    rapports_node = {
        "id": "rapports",
        "label": "Rapports",
        "count": _count(lambda d: d["type"] == "rapport"),
        "children": rapports_children,
        "icon": "BarChart3",
    }

    # Root: Documents libres
    libre_children_map: dict[str, int] = {}
    for d in docs.values():
        if d["type"] != "document_libre":
            continue
        # Groupe par sous-dossier ou "Divers"
        doc_path = d.get("doc_id", "")
        parts = doc_path.replace("data/ged/", "").split("/")
        group = parts[0] if len(parts) > 1 and not parts[0].isdigit() else "Divers"
        if parts[0].isdigit():
            group = parts[0]  # année
        libre_children_map[group] = libre_children_map.get(group, 0) + 1

    libre_children = []
    for group, count in sorted(libre_children_map.items()):
        libre_children.append({
            "id": f"libre-{group}",
            "label": group,
            "count": count,
            "children": [],
        })

    libres_node = {
        "id": "documents-libres",
        "label": "Documents libres",
        "count": _count(lambda d: d["type"] == "document_libre"),
        "children": libre_children,
        "icon": "FolderOpen",
    }

    by_type = [releves_node, justificatifs_node, rapports_node, libres_node]
    by_year = _build_tree_by_year(docs)

    return {"by_type": by_type, "by_year": by_year}


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
    from backend.core.config import MOIS_FR
    if 1 <= month <= 12:
        return MOIS_FR[month - 1].capitalize()
    return str(month)


def _resolve_poste_for_doc(doc: dict, postes_map: dict[str, dict]) -> Optional[str]:
    """Résout le poste pour un document via son poste_comptable ou categories_associees."""
    if doc.get("poste_comptable"):
        return doc["poste_comptable"]
    return None


# ─── Document listing ───

def get_documents(
    metadata: dict,
    type_filter: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    poste_comptable: Optional[str] = None,
    tags: Optional[list[str]] = None,
    search: Optional[str] = None,
    sort_by: str = "added_at",
    sort_order: str = "desc",
) -> list[dict]:
    docs = list(metadata.get("documents", {}).values())

    if type_filter:
        docs = [d for d in docs if d["type"] == type_filter]
    if year:
        docs = [d for d in docs if d.get("year") == year]
    if month:
        docs = [d for d in docs if d.get("month") == month]
    if poste_comptable:
        docs = [d for d in docs if d.get("poste_comptable") == poste_comptable]
    if tags:
        docs = [d for d in docs if any(t in d.get("tags", []) for t in tags)]
    if search:
        q = search.lower()
        docs = [d for d in docs if q in d.get("doc_id", "").lower()
                or q in (d.get("original_name") or "").lower()
                or q in (d.get("notes") or "").lower()
                or any(q in t.lower() for t in d.get("tags", []))]

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
        "montant_brut": None,
        "deductible_pct_override": None,
        "tags": request.get("tags", []),
        "notes": request.get("notes", ""),
        "added_at": now,
        "original_name": filename,
        "ocr_file": None,
    }

    metadata = load_metadata()
    metadata["documents"][doc_id] = doc
    save_metadata(metadata)

    logger.info(f"GED: document uploadé → {doc_id}")
    return doc


def update_document(doc_id: str, updates: dict) -> dict:
    metadata = load_metadata()
    docs = metadata.get("documents", {})
    if doc_id not in docs:
        raise ValueError(f"Document non trouvé: {doc_id}")

    doc = docs[doc_id]
    for key in ["poste_comptable", "tags", "notes", "montant_brut", "deductible_pct_override"]:
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
    if doc["type"] != "document_libre":
        raise ValueError("Seuls les documents libres peuvent être supprimés via la GED")

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

    return {
        "total_documents": len(docs),
        "total_brut": round(total_brut, 2),
        "total_deductible": round(total_deductible, 2),
        "disk_size_human": _human_size(total_size),
        "par_poste": sorted(par_poste.values(), key=lambda x: x["total_brut"], reverse=True),
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
