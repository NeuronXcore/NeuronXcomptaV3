"""Service d'historique des envois email."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from backend.core.config import DATA_DIR
from backend.models.email import EmailHistoryEntry

logger = logging.getLogger(__name__)

HISTORY_FILE = DATA_DIR / "email_history.json"


def _load_history() -> list[dict]:
    """Charge l'historique depuis le fichier JSON."""
    if not HISTORY_FILE.exists():
        return []
    try:
        return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_history(entries: list[dict]) -> None:
    """Sauvegarde atomique de l'historique."""
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(HISTORY_FILE.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, str(HISTORY_FILE))
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def log_send(entry: EmailHistoryEntry) -> None:
    """Ajoute une entrée à l'historique."""
    history = _load_history()
    history.append(entry.model_dump())
    _save_history(history)
    logger.info("Email history logged: id=%s success=%s", entry.id, entry.success)


def get_history(year: Optional[int] = None, limit: int = 50) -> list[dict]:
    """Retourne l'historique trié par date décroissante."""
    history = _load_history()

    if year:
        year_str = str(year)
        history = [e for e in history if e.get("sent_at", "").startswith(year_str)]

    history.sort(key=lambda e: e.get("sent_at", ""), reverse=True)
    return history[:limit]


def get_send_coverage(year: int) -> dict:
    """Pour une année, retourne {mois: True/False} si un envoi contenant un export de ce mois existe.

    Considère les envois SMTP (mode="smtp") ET manuels (mode="manual"). Mode absent
    sur les anciennes entrées → traité comme "smtp" pour rétrocompat.
    """
    history = _load_history()
    coverage: dict[int, bool] = {m: False for m in range(1, 13)}

    for entry in history:
        if not entry.get("success"):
            continue
        mode = entry.get("mode", "smtp")
        if mode not in ("smtp", "manual"):
            continue
        for doc in entry.get("documents", []):
            if doc.get("type") == "export":
                fname = doc.get("filename", "")
                # Chercher le mois dans le filename
                for m in range(1, 13):
                    month_str = f"{m:02d}"
                    if month_str in fname or (
                        any(mname.lower() in fname.lower() for mname in _month_names_for(m))
                    ):
                        if str(year) in fname:
                            coverage[m] = True

    return coverage


def _month_names_for(month: int) -> list[str]:
    """Retourne les variantes de noms de mois pour la recherche."""
    names = [
        'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
    ]
    if 1 <= month <= 12:
        return [names[month - 1]]
    return []
