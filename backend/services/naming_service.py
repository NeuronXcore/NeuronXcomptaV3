"""Service de nommage des justificatifs selon la convention fournisseur_YYYYMMDD_montant.XX.pdf."""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Optional


def normalize_supplier(raw: str) -> str:
    """Normalise le nom fournisseur pour le filename.

    - lowercase
    - supprime accents (NFD + strip combining)
    - remplace espaces/points/tirets multiples par un seul tiret
    - supprime caractères non-alphanumériques (sauf tiret)
    - strip tirets en début/fin
    - max 30 caractères
    """
    s = raw.lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[\u0300-\u036f]", "", s)  # strip accents
    s = re.sub(r"[\s.\-_]+", "-", s)  # spaces/dots/dashes → single dash
    s = re.sub(r"[^a-z0-9\-]", "", s)  # keep alphanum + dash only
    s = s.strip("-")
    return s[:30] or "inconnu"


def build_convention_filename(
    supplier: Optional[str],
    date_str: Optional[str],  # format "YYYY-MM-DD"
    amount: Optional[float],
) -> Optional[str]:
    """Construit le nom selon la convention fournisseur_YYYYMMDD_montant.XX.pdf.

    Retourne None si date OU montant manquants (supplier fallback "inconnu").
    Le montant utilise un point comme séparateur décimal (convention internationale,
    évite les conflits de parsing avec les outils shell).
    """
    if not date_str or amount is None:
        return None

    clean_supplier = normalize_supplier(supplier or "inconnu")
    date_compact = date_str.replace("-", "")  # "20250409"

    # Formater montant : 1439.87 → "1439.87" (point décimal conservé)
    amount_str = f"{abs(amount):.2f}"

    return f"{clean_supplier}_{date_compact}_{amount_str}.pdf"


def deduplicate_filename(target_dir: Path, desired_name: str) -> str:
    """Si desired_name existe déjà dans target_dir, ajoute un suffixe _2, _3, etc."""
    if not (target_dir / desired_name).exists():
        return desired_name

    stem = Path(desired_name).stem
    suffix = Path(desired_name).suffix
    counter = 2
    while (target_dir / f"{stem}_{counter}{suffix}").exists():
        counter += 1
    return f"{stem}_{counter}{suffix}"
