"""
Service de nommage filename-first pour les justificatifs.

Stratégie : privilégier le parsing du nom de fichier existant (source de vérité la
plus fiable) plutôt que l'OCR qui se trompe souvent sur le fournisseur ou le montant.

Utilisé par :
- `justificatif_service.auto_rename_from_ocr()` pour le rename post-OCR
- `routers/justificatifs.py POST /scan-rename` pour le scan on-demand
- `scripts/rename_justificatifs_convention.py` pour la maintenance manuelle

Zéro effet de bord autre que la lecture des `.ocr.json` siblings.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional, TypedDict

from backend.services import naming_service

logger = logging.getLogger(__name__)


# ─── Constantes ───────────────────────────────────────────────────────────

# Regex du nom canonique : fournisseur_YYYYMMDD_montant.XX[_suffix].pdf
# Le montant utilise un point comme séparateur décimal (convention internationale).
# Le suffix optionnel couvre :
#   - `_fs` pour les fac-similés reconstitués (ex: `auchan_20250315_87.81_fs.pdf`)
#   - `_a`, `_b` pour la ventilation multi-justificatifs (ex: `boulanger_20251130_2789.00_a.pdf`)
#   - `_2`, `_3`, … pour la déduplication
CANONICAL_RE = re.compile(
    r"^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}(_[a-z0-9]+)*\.pdf$"
)

# Regex pour détecter un fac-similé reconstitué (suffix `_fs` juste avant .pdf,
# éventuellement suivi d'une dédup `_N`).
FACSIMILE_RE = re.compile(r"_fs(_\d+)?\.pdf$", re.IGNORECASE)

# Suppliers génériques à rejeter si détectés dans le filename
# (on préférera le fallback OCR ou le bucket "bad_supplier")
# `reconstitue` est inclus : les filenames legacy `reconstitue_YYYYMMDD_HHMMSS_supplier.pdf`
# seraient sinon mal parsés (HHMMSS interprété comme montant). Les reconstitues
# doivent passer par le fallback metadata qui lit le `.ocr.json` avec `source: "reconstitue"`.
GENERIC_FILENAME_PREFIXES = {
    "facture", "justificatif", "document", "scan", "receipt", "invoice",
    "reconstitue",
}

# Suppliers OCR à rejeter (mots vides, OCR misread, abréviations courtes)
SUSPICIOUS_SUPPLIERS = {
    "inconnu", "le", "la", "les", "l", "d", "de", "du",
    "sa", "sas", "sarl", "n", "m", "et",
}

# Sanity cap sur les montants parsés depuis le filename
# (évite de parser un YYYYMMDD comme montant — ex. `contabo_20250227_20260408.pdf`)
MAX_PARSED_AMOUNT = 100_000.0

# Tentatives de parse du filename existant (ordre de priorité)
FILENAME_PATTERNS = [
    # supplier_YYYYMMDD_amount(.XX|,XX)?(_suffix)?.pdf
    re.compile(
        r"^(?P<supplier>[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*?)_"
        r"(?P<date>\d{8})_"
        r"(?P<amount_int>\d+)"
        r"(?:[.,](?P<amount_dec>\d{1,2}))?"
        r"(?P<suffix>_[a-z0-9]+)?\.pdf$",
        re.IGNORECASE,
    ),
    # supplier-YYYYMMDD_amount (tiret au lieu d'underscore entre supplier et date)
    re.compile(
        r"^(?P<supplier>[a-z][a-z0-9]*(?:-[a-z0-9]+)*)-"
        r"(?P<date>\d{8})_"
        r"(?P<amount_int>\d+)"
        r"(?:[.,](?P<amount_dec>\d{1,2}))?\.pdf$",
        re.IGNORECASE,
    ),
    # supplierYYYYMMDD_amount (pas de séparateur entre supplier et date)
    re.compile(
        r"^(?P<supplier>[a-z]{3,})"
        r"(?P<date>\d{8})_"
        r"(?P<amount_int>\d+)"
        r"(?:[.,](?P<amount_dec>\d{1,2}))?\.pdf$",
        re.IGNORECASE,
    ),
]


# ─── Détection canonique ──────────────────────────────────────────────────

def is_canonical(name: str) -> bool:
    """True si le nom respecte déjà la convention fournisseur_YYYYMMDD_montant.XX[_suffix].pdf."""
    return bool(CANONICAL_RE.match(name))


def is_facsimile(name: str) -> bool:
    """True si le fichier est un fac-similé reconstitué.

    Détecte :
    - Nouveau format : suffix `_fs` avant `.pdf` (ex: `auchan_20250315_87.81_fs.pdf`)
    - Legacy : préfixe `reconstitue_` (pendant la période de migration)
    """
    if not name:
        return False
    basename = name.split("/")[-1]
    if basename.startswith("reconstitue_"):
        return True
    if FACSIMILE_RE.search(basename):
        return True
    return False


def normalize_filename_quirks(name: str) -> str:
    """Nettoyages préalables avant le regex match.

    - `ford-credit_20260318_1443.55pdf.pdf` → `ford-credit_20260318_1443.55.pdf`
    - `foo.pdf.pdf` → `foo.pdf`
    - `name (1).pdf` → `name.pdf` (la marque de doublon disparaît — le dedup final la ré-ajoutera si besoin)
    """
    # `NNpdf.pdf` → `NN.pdf`
    name = re.sub(r"pdf\.pdf$", ".pdf", name, flags=re.IGNORECASE)
    # `.pdf.pdf` → `.pdf`
    if name.lower().endswith(".pdf.pdf"):
        name = name[:-4]
    # `name (1).pdf` → `name.pdf`
    name = re.sub(r"\s*\(\d+\)(\.pdf)$", r"\1", name, flags=re.IGNORECASE)
    return name


# ─── Parsing filename-first ───────────────────────────────────────────────

def try_parse_filename(name: str) -> Optional[tuple[str, str, float, str]]:
    """Essaie d'extraire (supplier, YYYYMMDD, amount, suffix) depuis le filename.

    Retourne None si :
      - Aucun pattern ne matche
      - Le supplier extrait est générique (facture, justificatif, reconstitue, ...)
      - La date est implausible (année hors 2000-2100, mois/jour invalide)
      - Le montant parsé dépasse MAX_PARSED_AMOUNT ou est ≤ 0
    """
    cleaned = normalize_filename_quirks(name)
    for pattern in FILENAME_PATTERNS:
        m = pattern.match(cleaned)
        if not m:
            continue

        supplier_raw = m.group("supplier").lower()
        supplier_core = supplier_raw.replace("-", "").replace("_", "")
        if supplier_core in GENERIC_FILENAME_PREFIXES:
            return None
        # Pour le pattern sans séparateur, exiger un supplier de 3+ lettres pures
        if "_" not in name.split("_")[0] and len(supplier_core) < 3:
            return None

        date_str = m.group("date")
        try:
            year = int(date_str[:4])
            month = int(date_str[4:6])
            day = int(date_str[6:8])
        except ValueError:
            return None
        if not (2000 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
            return None

        amount_int = m.group("amount_int")
        amount_dec = m.groupdict().get("amount_dec") or "00"
        try:
            amount = float(f"{amount_int}.{amount_dec.ljust(2, '0')}")
        except ValueError:
            return None
        if amount > MAX_PARSED_AMOUNT or amount <= 0:
            return None

        suffix = m.groupdict().get("suffix") or ""
        return supplier_raw, date_str, amount, suffix
    return None


def build_from_parsed(
    supplier: str, date_str: str, amount: float, suffix: str = ""
) -> str:
    """Reconstruit un nom canonique depuis les composants parsés du filename.

    Point décimal conservé (convention canonique).
    """
    clean_supplier = naming_service.normalize_supplier(supplier)
    amount_str = f"{amount:.2f}"
    base = f"{clean_supplier}_{date_str}_{amount_str}"
    if suffix:
        if not suffix.startswith("_"):
            suffix = f"_{suffix}"
        base = f"{base}{suffix}"
    return f"{base}.pdf"


# ─── Helpers OCR / supplier ───────────────────────────────────────────────

def is_suspicious_supplier(raw: Optional[str]) -> bool:
    """True si le supplier OCR est vide, trop court, ou dans la liste des mots vides."""
    if not raw:
        return True
    cleaned = re.sub(r"[^a-zA-Z0-9]", "", raw).lower()
    if len(cleaned) < 3:
        return True
    if cleaned in SUSPICIOUS_SUPPLIERS:
        return True
    return False


def _load_ocr_cache(pdf_path: Path) -> Optional[tuple[dict, bool]]:
    """Charge le `.ocr.json` sibling.

    Retourne `(extracted_data, is_reconstitue)` où :
    - Pour un OCR réel : extracted_data est la clé imbriquée, is_reconstitue=False
    - Pour un reconstitue : les champs sont à la racine (pas d'`extracted_data`),
      is_reconstitue=True. Les reconstitues n'ont pas de champ `status`.

    Retourne None si le fichier est absent, illisible, ou si c'est un OCR en échec.
    """
    cache = pdf_path.with_suffix(".ocr.json")
    if not cache.exists():
        return None
    try:
        payload = json.loads(cache.read_text(encoding="utf-8"))
    except Exception:
        return None

    # Reconstitue : champs à la racine, flag source="reconstitue"
    if payload.get("source") == "reconstitue":
        return (
            {
                "supplier": payload.get("supplier"),
                "best_date": payload.get("best_date"),
                "best_amount": payload.get("best_amount"),
            },
            True,
        )

    # OCR standard : nécessite status=success et extracted_data
    if payload.get("status") != "success":
        return None
    return payload.get("extracted_data") or {}, False


# ─── Déduplication ────────────────────────────────────────────────────────

def deduplicate_against(
    target_dir: Path, desired_name: str, source_path: Optional[Path] = None
) -> str:
    """
    Si `desired_name` existe déjà dans `target_dir` :
    - S'il s'agit du même fichier que `source_path` (self-collision), retourne le nom inchangé
    - Sinon, ajoute un suffixe `_2`, `_3`, … jusqu'à trouver un nom libre
    """
    target = target_dir / desired_name
    if not target.exists():
        return desired_name
    # Self-collision : le fichier cible EST le fichier source
    if source_path is not None:
        try:
            if target.resolve() == source_path.resolve():
                return desired_name
        except Exception:
            pass
    stem = Path(desired_name).stem
    suffix = Path(desired_name).suffix
    for i in range(2, 100):
        candidate = f"{stem}_{i}{suffix}"
        candidate_path = target_dir / candidate
        if not candidate_path.exists():
            return candidate
        if source_path is not None:
            try:
                if candidate_path.resolve() == source_path.resolve():
                    return candidate
            except Exception:
                pass
    raise RuntimeError(f"Impossible de dédupliquer {desired_name} dans {target_dir}")


# ─── Orchestration : nom canonique unifié ─────────────────────────────────

def _inject_fs_suffix(canonical_name: str) -> str:
    """Insère le suffix `_fs` avant `.pdf` d'un nom canonique.

    Ex: `auchan_20250315_87.81.pdf` → `auchan_20250315_87.81_fs.pdf`
    """
    if canonical_name.endswith(".pdf"):
        return canonical_name[:-4] + "_fs.pdf"
    return canonical_name + "_fs"


def compute_canonical_name(
    filename: str,
    ocr_data: Optional[dict] = None,
    source_dir: Optional[Path] = None,
    is_reconstitue: bool = False,
) -> Optional[tuple[str, str]]:
    """Calcule le nom canonique pour un justificatif.

    Stratégie :
      1. Si déjà canonique → retourne None (rien à faire)
      2. Sinon, tente le parsing filename-first → si succès, retourne (name, "filename")
      3. Sinon, tente l'OCR/metadata fallback si `ocr_data` fourni
         → si succès, retourne (name, "ocr" ou "reconstitue")
      4. Sinon retourne None

    Si `is_reconstitue=True`, le suffix `_fs` est automatiquement injecté avant `.pdf`.
    Déduplique contre `source_dir` si fourni.
    """
    if is_canonical(filename):
        return None

    source_path: Optional[Path] = None
    if source_dir is not None:
        candidate = source_dir / filename
        if candidate.exists():
            source_path = candidate

    # ── Stratégie 1 : parse filename existant ──
    parsed = try_parse_filename(filename)
    if parsed:
        supplier_raw, date_str, amount, suffix = parsed
        new_name = build_from_parsed(supplier_raw, date_str, amount, suffix)
        if is_reconstitue and not FACSIMILE_RE.search(new_name):
            new_name = _inject_fs_suffix(new_name)
        if source_dir is not None:
            new_name = deduplicate_against(source_dir, new_name, source_path)
        if new_name == filename:
            return None
        return new_name, "filename"

    # ── Stratégie 2 : OCR / reconstitue metadata fallback ──
    if ocr_data is None:
        return None

    supplier = (ocr_data.get("supplier") or "").strip()
    date = ocr_data.get("best_date")
    amount = ocr_data.get("best_amount")

    if not date or amount is None:
        return None
    # Pour les reconstitues on accepte le supplier même s'il est court
    if not is_reconstitue and is_suspicious_supplier(supplier):
        return None

    new_name = naming_service.build_convention_filename(supplier, date, amount)
    if not new_name:
        return None
    if is_reconstitue:
        new_name = _inject_fs_suffix(new_name)
    if source_dir is not None:
        new_name = deduplicate_against(source_dir, new_name, source_path)
    if new_name == filename:
        return None
    return new_name, ("reconstitue" if is_reconstitue else "ocr")


# ─── Scan planner ─────────────────────────────────────────────────────────

class RenameItem(TypedDict):
    old: str
    new: str


class RenameItemOCR(TypedDict):
    old: str
    new: str
    supplier_ocr: str


class SkippedItem(TypedDict):
    """Item skipped enrichi avec les données OCR disponibles, pour alimenter
    l'éditeur inline côté frontend (ScanRenameDrawer.SkippedItemCard)."""
    filename: str
    supplier: Optional[str]
    best_date: Optional[str]
    best_amount: Optional[float]
    amounts: list[float]
    dates: list[str]
    reason: str  # "no_ocr" | "bad_supplier" | "no_date_amount"


def _build_skipped_item(
    name: str, ocr_extracted: Optional[dict], reason: str
) -> SkippedItem:
    """Construit un SkippedItem enrichi à partir des données OCR brutes."""
    ed = ocr_extracted or {}
    return {
        "filename": name,
        "supplier": ed.get("supplier"),
        "best_date": ed.get("best_date"),
        "best_amount": ed.get("best_amount"),
        "amounts": ed.get("amounts") or [],
        "dates": ed.get("dates") or [],
        "reason": reason,
    }


class ScanPlan(TypedDict):
    scanned: int
    already_canonical: int
    to_rename_from_name: list[RenameItem]
    to_rename_from_ocr: list[RenameItemOCR]
    skipped_no_ocr: list[SkippedItem]
    skipped_bad_supplier: list[SkippedItem]
    skipped_no_date_amount: list[SkippedItem]


def scan_and_plan_renames(
    directory: Path,
    force_generic: bool = False,
) -> ScanPlan:
    """Walk tous les `*.pdf` dans `directory` et classifie chaque fichier.

    Classification :
      - `already_canonical` : nom déjà conforme
      - `to_rename_from_name` : parsé depuis le filename (SAFE)
      - `to_rename_from_ocr` : reconstruit depuis l'OCR (review recommandé)
      - `skipped_no_ocr` : pas de `.ocr.json` et filename non parsable
      - `skipped_bad_supplier` : OCR avec supplier suspect (sauf si `force_generic=True`)
      - `skipped_no_date_amount` : OCR incomplet et filename non parsable

    Lecture seule. Aucun fichier n'est modifié.
    """
    plan: ScanPlan = {
        "scanned": 0,
        "already_canonical": 0,
        "to_rename_from_name": [],
        "to_rename_from_ocr": [],
        "skipped_no_ocr": [],
        "skipped_bad_supplier": [],
        "skipped_no_date_amount": [],
    }

    if not directory.exists():
        return plan

    pdfs = sorted(directory.glob("*.pdf"))
    plan["scanned"] = len(pdfs)

    for pdf in pdfs:
        name = pdf.name

        if is_canonical(name):
            plan["already_canonical"] += 1
            continue

        # Charger les metadata OCR / reconstitue en avance (informe is_reconstitue)
        meta = _load_ocr_cache(pdf)
        is_recon = False
        ocr_extracted: Optional[dict] = None
        if meta is not None:
            ocr_extracted, is_recon = meta

        # Stratégie 1 : filename-first
        parsed = try_parse_filename(name)
        if parsed:
            supplier_raw, date_str, amount, suffix = parsed
            new_name = build_from_parsed(supplier_raw, date_str, amount, suffix)
            if is_recon and not FACSIMILE_RE.search(new_name):
                new_name = _inject_fs_suffix(new_name)
            new_name = deduplicate_against(pdf.parent, new_name, pdf)
            if new_name == name:
                plan["already_canonical"] += 1
                continue
            plan["to_rename_from_name"].append({"old": name, "new": new_name})
            continue

        # Stratégie 2 : OCR / reconstitue metadata fallback
        if ocr_extracted is None:
            plan["skipped_no_ocr"].append(_build_skipped_item(name, None, "no_ocr"))
            continue

        supplier = (ocr_extracted.get("supplier") or "").strip()
        date = ocr_extracted.get("best_date")
        amount = ocr_extracted.get("best_amount")

        if not date or amount is None:
            plan["skipped_no_date_amount"].append(
                _build_skipped_item(name, ocr_extracted, "no_date_amount")
            )
            continue

        # Pour un reconstitue, on fait confiance au supplier (pas de filtre suspect)
        if not is_recon and is_suspicious_supplier(supplier) and not force_generic:
            plan["skipped_bad_supplier"].append(
                _build_skipped_item(name, ocr_extracted, "bad_supplier")
            )
            continue

        new_name = naming_service.build_convention_filename(supplier, date, amount)
        if not new_name:
            plan["skipped_no_date_amount"].append(
                _build_skipped_item(name, ocr_extracted, "no_date_amount")
            )
            continue

        if is_recon:
            new_name = _inject_fs_suffix(new_name)

        new_name = deduplicate_against(pdf.parent, new_name, pdf)
        if new_name == name:
            plan["already_canonical"] += 1
            continue

        plan["to_rename_from_ocr"].append(
            {"old": name, "new": new_name, "supplier_ocr": supplier}
        )

    return plan
