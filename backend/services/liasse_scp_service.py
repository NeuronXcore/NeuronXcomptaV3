"""Service de gestion des liasses fiscales SCP (déclaration 2035 annuelle)."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import LIASSE_SCP_DIR

logger = logging.getLogger(__name__)


def _path(year: int) -> Path:
    return LIASSE_SCP_DIR / f"liasse_{year}.json"


def _ensure_dir() -> None:
    LIASSE_SCP_DIR.mkdir(parents=True, exist_ok=True)


def get_liasse(year: int) -> Optional[dict]:
    """Retourne la liasse pour une année, ou None si absente."""
    p = _path(year)
    if not p.exists():
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Impossible de lire liasse_%d.json: %s", year, e)
        return None


def save_liasse(
    year: int,
    ca_declare: float,
    ged_document_id: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    """Sauvegarde (ou écrase) la liasse d'une année."""
    _ensure_dir()
    payload = {
        "year": int(year),
        "ca_declare": float(ca_declare),
        "ged_document_id": ged_document_id,
        "note": note,
        "saved_at": datetime.now().isoformat(),
    }
    with open(_path(year), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return payload


def delete_liasse(year: int) -> bool:
    """Supprime la liasse d'une année. Retourne True si supprimée, False si absente."""
    p = _path(year)
    if not p.exists():
        return False
    try:
        p.unlink()
        return True
    except Exception as e:
        logger.warning("Impossible de supprimer liasse_%d.json: %s", year, e)
        return False


def list_liasses() -> list[dict]:
    """Liste toutes les liasses stockées, triées par année DESC."""
    _ensure_dir()
    out: list[dict] = []
    for p in LIASSE_SCP_DIR.glob("liasse_*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                out.append(json.load(f))
        except Exception as e:
            logger.warning("Liasse malformée ignorée (%s): %s", p.name, e)
            continue
    out.sort(key=lambda x: x.get("year", 0), reverse=True)
    return out


def get_ca_for_bnc(year: int) -> Optional[float]:
    """Helper utilisé par analytics_service pour injection dans _compute_bnc_metrics.

    Retourne le CA déclaré de la liasse si présente, sinon None (→ base bancaire).
    """
    liasse = get_liasse(year)
    if liasse is None:
        return None
    ca = liasse.get("ca_declare")
    try:
        return float(ca) if ca is not None else None
    except (TypeError, ValueError):
        return None
