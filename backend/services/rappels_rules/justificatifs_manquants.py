"""Règle 1 : justificatifs manquants depuis 30j (warning) ou 60j (critical)."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from backend.models.rappel import Rappel, RappelCTA
from backend.services import operation_service
from backend.services.justificatif_exemption_service import is_justificatif_required
from backend.services.rappels_rules._base import RappelContext, format_eur

logger = logging.getLogger(__name__)


_EXCLUDED_CATS = {"", "Autres", "Ventilé"}


def _parse_op_date(date_str: str) -> Optional[datetime]:
    """Parse une date ISO 'YYYY-MM-DD' (format confirmé par operation_service / cloture_service).
    Retourne None si format invalide.
    """
    if not date_str or not isinstance(date_str, str):
        return None
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


class JustificatifsManquantsRule:
    """Détecte les opérations de l'année courante sans justificatif depuis ≥ 30 jours.

    Émet 0, 1 ou 2 rappels :
    - bucket 30-60j → warning, id=`justif_manquant_30j`
    - bucket ≥ 60j → critical, id=`justif_manquant_60j`

    Skip :
    - Catégorie exemptée (via `is_justificatif_required` — gère perso intrinsèquement).
    - Catégorie vide ou « Ventilé » (ventilation hors scope V1).
    - Op avec `Lien justificatif` non vide.
    - Op à montant zéro (Débit == 0 AND Crédit == 0).
    - Date opération non parseable.
    """

    rule_id = "justif_manquant"
    label = "Justificatifs manquants"
    description = "Opérations sans justificatif depuis ≥ 30 jours (warning) ou ≥ 60 jours (critical)."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        year = ctx.today.year
        files_year = [f for f in ctx.operation_files if f.get("year") == year]
        if not files_year:
            return []

        bucket_30_count = 0
        bucket_30_total = 0.0
        bucket_60_count = 0
        bucket_60_total = 0.0
        today_dt = datetime(ctx.today.year, ctx.today.month, ctx.today.day)

        for fmeta in files_year:
            filename = fmeta.get("filename")
            if not filename:
                continue
            try:
                ops = operation_service.load_operations(filename)
            except Exception as exc:
                logger.warning("rappels: load_operations(%s) a échoué: %s", filename, exc)
                continue

            for op in ops:
                cat = (op.get("Catégorie") or "").strip()
                sub = (op.get("Sous-catégorie") or "").strip()

                # Skip catégorie absente / spéciale
                if cat in _EXCLUDED_CATS:
                    continue
                # Skip si exemptée (perso, CARMF, URSSAF, Honoraires…)
                if not is_justificatif_required(cat, sub):
                    continue
                # Skip si justificatif déjà associé
                if (op.get("Lien justificatif") or "").strip():
                    continue
                # Skip montant zéro
                debit = float(op.get("Débit") or 0)
                credit = float(op.get("Crédit") or 0)
                if debit == 0 and credit == 0:
                    continue

                op_dt = _parse_op_date(op.get("Date") or "")
                if op_dt is None:
                    continue
                age = (today_dt - op_dt).days
                if age < 30:
                    continue

                amount = abs(debit) if debit else abs(credit)
                if age >= 60:
                    bucket_60_count += 1
                    bucket_60_total += amount
                else:  # 30 <= age < 60
                    bucket_30_count += 1
                    bucket_30_total += amount

        rappels: list[Rappel] = []
        detection = ctx.today.isoformat()

        if bucket_30_count > 0:
            rappels.append(Rappel(
                id="justif_manquant_30j",
                niveau="warning",
                categorie="comptable",
                titre=(
                    f"{bucket_30_count} justificatif manquant depuis plus de 30 jours"
                    if bucket_30_count == 1
                    else f"{bucket_30_count} justificatifs manquants depuis plus de 30 jours"
                ),
                message=f"Total impacté : {format_eur(bucket_30_total)}",
                cta=RappelCTA(label="Voir", route="/justificatifs?filter=sans"),
                snoozable=True,
                date_detection=detection,
            ))

        if bucket_60_count > 0:
            rappels.append(Rappel(
                id="justif_manquant_60j",
                niveau="critical",
                categorie="comptable",
                titre=(
                    f"{bucket_60_count} justificatif manquant depuis plus de 60 jours"
                    if bucket_60_count == 1
                    else f"{bucket_60_count} justificatifs manquants depuis plus de 60 jours"
                ),
                message=f"Total impacté : {format_eur(bucket_60_total)}",
                cta=RappelCTA(label="Voir", route="/justificatifs?filter=sans"),
                snoozable=True,
                date_detection=detection,
            ))

        return rappels
