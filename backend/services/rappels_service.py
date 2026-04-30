"""Moteur du module Rappels Dashboard.

Construit un `RappelContext` par requête, itère `ALL_RULES` en try/except
isolé (un crash de règle ne masque pas les autres), filtre les rappels snoozés,
trie par niveau puis par date_detection, retourne un `RappelsSummary`.

Persiste les snoozes dans `data/rappels_snooze.json` (dict ISO datetime).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from backend.core.config import (
    RAPPELS_SNOOZE_FILE,
    SETTINGS_FILE,
    ensure_directories,
)
from backend.models.rappel import Rappel, RappelLevel, RappelsSummary, RuleInfo
from backend.services import cloture_service, operation_service
from backend.services.rappels_rules import ALL_RULES, RappelContext

logger = logging.getLogger(__name__)


_LEVEL_PRIORITY: dict[RappelLevel, int] = {
    "critical": 0,
    "warning": 1,
    "info": 2,
}


# ---------- I/O snooze ----------

def _load_snooze() -> dict[str, datetime]:
    """Charge les snoozes actifs. Drop silencieux des entrées expirées ou mal formatées."""
    if not RAPPELS_SNOOZE_FILE.exists():
        return {}
    try:
        with open(RAPPELS_SNOOZE_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as exc:
        logger.warning("rappels: lecture snooze impossible (%s) — état réinitialisé", exc)
        return {}
    if not isinstance(raw, dict):
        return {}

    now = datetime.now()
    state: dict[str, datetime] = {}
    for rule_id, iso in raw.items():
        if not isinstance(rule_id, str) or not isinstance(iso, str):
            continue
        try:
            expiry = datetime.fromisoformat(iso)
        except ValueError:
            continue
        if expiry > now:
            state[rule_id] = expiry
    return state


def _save_snooze(state: dict[str, datetime]) -> None:
    """Écrit l'état snooze (cleanup des expirés à chaque save)."""
    ensure_directories()
    now = datetime.now()
    cleaned = {k: v for k, v in state.items() if v > now}
    RAPPELS_SNOOZE_FILE.parent.mkdir(parents=True, exist_ok=True)
    serialized = {k: v.isoformat() for k, v in cleaned.items()}
    with open(RAPPELS_SNOOZE_FILE, "w", encoding="utf-8") as f:
        json.dump(serialized, f, ensure_ascii=False, indent=2)


def _is_snoozed(rule_id: str, snooze_state: dict[str, datetime], today: date) -> bool:
    expiry = snooze_state.get(rule_id)
    if expiry is None:
        return False
    return expiry.date() > today


# ---------- Contexte ----------

def _load_settings() -> dict:
    """Lit settings.json. Retourne {} si absent ou illisible."""
    if not SETTINGS_FILE.exists():
        return {}
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("rappels: settings.json illisible (%s)", exc)
        return {}


def _build_context(today: date) -> RappelContext:
    """Construit le contexte une seule fois pour toutes les règles."""
    try:
        operation_files = operation_service.list_operation_files()
    except Exception as exc:
        logger.warning("rappels: list_operation_files a échoué (%s) — liste vide", exc)
        operation_files = []

    # Toujours charger N-1 et N (pas de branche conditionnelle « si janvier »).
    cloture_status: dict[int, list[dict]] = {}
    for year in (today.year - 1, today.year):
        try:
            cloture_status[year] = cloture_service.get_annual_status(year)
        except Exception as exc:
            logger.warning("rappels: get_annual_status(%d) a échoué (%s)", year, exc)
            cloture_status[year] = []

    return RappelContext(
        today=today,
        operation_files=operation_files,
        cloture_status=cloture_status,
        settings=_load_settings(),
        snooze_state=_load_snooze(),
    )


# ---------- API publique ----------

def get_all_rappels(today: Optional[date] = None) -> RappelsSummary:
    """Itère ALL_RULES, filtre snoozés, trie, retourne un summary.

    `today` injectable pour tests deterministes — fallback `date.today()`.
    """
    if today is None:
        today = date.today()

    ctx = _build_context(today)

    # Récupère la liste des règles désactivées (par rule_id) depuis settings.
    # Filet : si la clé est absente ou de mauvais type, on traite comme [].
    raw_disabled = ctx.settings.get("rappels_disabled_rules") or []
    disabled_rule_ids = {str(r) for r in raw_disabled if isinstance(r, str)}

    collected: list[Rappel] = []
    for rule in ALL_RULES:
        rule_id = getattr(rule, "rule_id", None)
        if rule_id and rule_id in disabled_rule_ids:
            continue
        try:
            collected.extend(rule.evaluate(ctx))
        except Exception as exc:
            # Un crash dans une règle ne doit jamais masquer les autres rappels.
            rule_name = rule_id or type(rule).__name__
            logger.warning("rappels: règle '%s' a échoué (%s)", rule_name, exc)

    # Filtre snoozés
    visible = [r for r in collected if not _is_snoozed(r.id, ctx.snooze_state, today)]

    # Tri stable : niveau (critical > warning > info) puis date_detection desc
    visible.sort(key=lambda r: (
        _LEVEL_PRIORITY.get(r.niveau, 99),
        r.date_detection,
    ), reverse=False)

    counts: dict[RappelLevel, int] = {"critical": 0, "warning": 0, "info": 0}
    for r in visible:
        counts[r.niveau] = counts.get(r.niveau, 0) + 1

    return RappelsSummary(
        rappels=visible,
        counts=counts,
        total=len(visible),
    )


def snooze_rappel(rule_id: str, days: int = 7) -> dict[str, str]:
    """Snooze un rappel pour `days` jours. Retourne `{rule_id, expiry}`."""
    state = _load_snooze()
    expiry = datetime.now() + timedelta(days=days)
    state[rule_id] = expiry
    _save_snooze(state)
    return {"rule_id": rule_id, "expiry": expiry.isoformat()}


def unsnooze_rappel(rule_id: str) -> None:
    """Retire un snooze actif (no-op si absent)."""
    state = _load_snooze()
    if rule_id in state:
        del state[rule_id]
        _save_snooze(state)


def list_rules() -> list[RuleInfo]:
    """Liste toutes les règles avec leur état actif (enabled / disabled).

    Source de vérité : `ALL_RULES` (ordre conservé). L'état désactivé est
    lu depuis `settings.rappels_disabled_rules`.
    """
    settings_data = _load_settings()
    raw_disabled = settings_data.get("rappels_disabled_rules") or []
    disabled = {str(r) for r in raw_disabled if isinstance(r, str)}

    return [
        RuleInfo(
            rule_id=getattr(rule, "rule_id", type(rule).__name__),
            label=getattr(rule, "label", getattr(rule, "rule_id", "")),
            description=getattr(rule, "description", ""),
            enabled=getattr(rule, "rule_id", None) not in disabled,
        )
        for rule in ALL_RULES
    ]
