"""Service de finalisation du cycle de vie Plaquette (Session 39 P1).

3 statuts : en_cours → validation_finale → declare (irréversible).

Responsabilités :
  - transition_status() : applique la matrice de transitions autorisées
  - finalize() : action atomique →DECLARE (PDF watermarké + snapshot JSON + GED protégé)
  - helpers is_item_modifiable / is_journal_appendable / is_status_revertable

Matrice transitions :
    De \\ Vers         | en_cours | validation_finale | declare
    ──────────────────┼──────────┼───────────────────┼─────────
    en_cours          |    —     |        ✓          |    ✗
    validation_finale |    ✓     |        —          |    ✓ (via finalize)
    declare           |    ✗     |        ✗          |    —

Règles métier :
  - Items modifiables UNIQUEMENT en `en_cours`.
  - Journal appendable TOUJOURS (même en `declare` — questions fisc post-déclaration).
  - Statut réversible sauf `declare` (figé jusqu'à prescription L169 LPF).
"""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import PLAQUETTE_CHECK_DIR
from backend.models.plaquette_check import PlaquetteCheckStatus

logger = logging.getLogger(__name__)


# ─── Constantes ───

_VALID_TRANSITIONS = {
    PlaquetteCheckStatus.EN_COURS.value: {PlaquetteCheckStatus.VALIDATION_FINALE.value},
    PlaquetteCheckStatus.VALIDATION_FINALE.value: {
        PlaquetteCheckStatus.EN_COURS.value,
        PlaquetteCheckStatus.DECLARE.value,
    },
    PlaquetteCheckStatus.DECLARE.value: set(),  # irréversible
}


# ─── Helpers I/O ───


def _now_iso() -> str:
    return datetime.now().isoformat()


def _coerce_status(value: object) -> str:
    """Accepte enum, str, ou None ; retourne la string canonique."""
    if value is None:
        return PlaquetteCheckStatus.EN_COURS.value
    if isinstance(value, PlaquetteCheckStatus):
        return value.value
    return str(value)


# ─── Gardes (utilisés par plaquette_service + routers) ───


def is_item_modifiable(check: dict) -> bool:
    """Items éditables UNIQUEMENT si status == EN_COURS."""
    status = _coerce_status(check.get("status"))
    return status == PlaquetteCheckStatus.EN_COURS.value


def is_journal_appendable(check: dict) -> bool:  # noqa: ARG001 — paramètre conservé pour symétrie API
    """Le journal reste appendable même post-DECLARE (questions fisc, etc.)."""
    return True


def is_status_revertable(check: dict) -> bool:
    """Statut réversible sauf DECLARE (figé jusqu'à prescription)."""
    status = _coerce_status(check.get("status"))
    return status != PlaquetteCheckStatus.DECLARE.value


# ─── Transitions ───


def _validate_transition(current: str, target: str) -> None:
    """Lève ValueError si la transition n'est pas autorisée."""
    if current == target:
        raise ValueError(f"Transition no-op : status est déjà {current}")
    allowed = _VALID_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise ValueError(
            f"Transition interdite : {current} → {target} "
            f"(autorisées depuis {current} : {sorted(allowed) or ['(aucune)']})"
        )


def transition_status(
    year: int,
    new_status: PlaquetteCheckStatus | str,
    declaration_ref: Optional[str] = None,  # noqa: ARG001 — placeholder symétrie, utilisé par finalize()
) -> dict:
    """Applique une transition de statut (hors →DECLARE qui passe par finalize()).

    Args:
        year: exercice fiscal
        new_status: statut cible (enum ou string)
        declaration_ref: ignoré ici (passer par finalize() pour →DECLARE)

    Returns:
        dict PlaquetteCheck mis à jour

    Raises:
        ValueError: transition invalide / année introuvable / tentative →DECLARE (utiliser finalize)
    """
    from backend.services import plaquette_service

    target = _coerce_status(new_status)
    if target == PlaquetteCheckStatus.DECLARE.value:
        raise ValueError("Utiliser finalize() pour la transition vers DECLARE (snapshot atomique)")

    data = plaquette_service._load_year(year)
    if data is None:
        raise ValueError(f"PlaquetteCheck {year} introuvable")

    current = _coerce_status(data.get("status"))
    _validate_transition(current, target)

    data["status"] = target
    if target == PlaquetteCheckStatus.VALIDATION_FINALE.value:
        data["validated_at"] = _now_iso()
    elif target == PlaquetteCheckStatus.EN_COURS.value:
        # Réversion : on garde validated_at en mémoire pour audit, on ne le clear pas.
        pass
    data["updated_at"] = _now_iso()

    plaquette_service._save_atomic(plaquette_service._year_file(year), data)
    logger.info("plaquette %s status %s → %s", year, current, target)
    return data


# ─── Finalisation atomique (→ DECLARE) ───


def _copy_to_final_snapshot(year: int) -> Path:
    """Copie le JSON courant vers data/plaquette_check/{year}/final_snapshot.json (immutable)."""
    src = PLAQUETTE_CHECK_DIR / f"{year}.json"
    if not src.exists():
        raise ValueError(f"Fichier source introuvable : {src}")
    dest_dir = PLAQUETTE_CHECK_DIR / str(year)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "final_snapshot.json"
    # Copie atomique : tempfile dans le même dir puis os.replace
    fd, tmp = tempfile.mkstemp(dir=str(dest_dir), suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(src.read_bytes())
        os.replace(tmp, str(dest))
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    logger.info("plaquette %s snapshot final écrit : %s", year, dest)
    return dest


def finalize(
    year: int,
    declaration_ref: str,
    declared_at: Optional[str] = None,
) -> dict:
    """Transition atomique →DECLARE : PDF watermarké + snapshot JSON + GED protégé.

    Étapes :
      1. Vérifie status courant == VALIDATION_FINALE (sinon ValueError)
      2. Génère le PDF rapport final via plaquette_report_service.generate_and_register(year, final=True)
         Le PDF porte un watermark "VERSION DÉFINITIVE — Déclarée le {date}".
      3. Copie le JSON courant vers data/plaquette_check/{year}/final_snapshot.json (immutable).
      4. Le PDF est enregistré en GED avec protected=True (non supprimable via delete_document).
      5. Met à jour PlaquetteCheck : status=DECLARE, declared_at, declaration_ref, final_snapshot_ged_doc_id.

    Args:
        year: exercice fiscal
        declaration_ref: référence officielle (ex. "2042 N° XXX télédéclaré le JJ/MM/AAAA")
        declared_at: ISO datetime, défaut = now()

    Returns:
        {"plaquette_check": dict, "snapshot_ged_doc_id": str, "snapshot_path": str}

    Raises:
        ValueError: status incorrect / année introuvable / declaration_ref vide
    """
    from backend.services import plaquette_report_service, plaquette_service

    if not (declaration_ref or "").strip():
        raise ValueError("declaration_ref est obligatoire")

    data = plaquette_service._load_year(year)
    if data is None:
        raise ValueError(f"PlaquetteCheck {year} introuvable")

    current = _coerce_status(data.get("status"))
    if current != PlaquetteCheckStatus.VALIDATION_FINALE.value:
        raise ValueError(
            f"Finalisation impossible depuis status={current} "
            f"(requis : {PlaquetteCheckStatus.VALIDATION_FINALE.value})"
        )

    declared_iso = declared_at or _now_iso()

    # 1. Génère PDF final (avec watermark + flag protected=True en GED)
    rapport = plaquette_report_service.generate_and_register(year, final=True)
    snapshot_ged_doc_id = rapport.get("ged_doc_id")
    if not snapshot_ged_doc_id:
        raise RuntimeError(f"PDF final non enregistré en GED pour {year} (rapport={rapport})")

    # 2. Snapshot JSON immutable (copie après génération PDF pour que le JSON
    #    contienne déjà la référence au PDF final via plaquette_check.json mis à jour).
    #    Note : on copie après update final pour figer la version la plus complète.

    # 3. Met à jour PlaquetteCheck
    data["status"] = PlaquetteCheckStatus.DECLARE.value
    data["declared_at"] = declared_iso
    data["declaration_ref"] = declaration_ref.strip()
    data["final_snapshot_ged_doc_id"] = snapshot_ged_doc_id
    data["updated_at"] = _now_iso()
    plaquette_service._save_atomic(plaquette_service._year_file(year), data)

    # 4. Copie JSON figée (après le save final pour embarquer status=declare + refs)
    snapshot_path = _copy_to_final_snapshot(year)

    logger.info(
        "plaquette %s DECLARED — ref=%s, snapshot_pdf=%s, snapshot_json=%s",
        year,
        declaration_ref,
        snapshot_ged_doc_id,
        snapshot_path,
    )

    return {
        "plaquette_check": data,
        "snapshot_ged_doc_id": snapshot_ged_doc_id,
        "snapshot_path": str(snapshot_path),
    }
