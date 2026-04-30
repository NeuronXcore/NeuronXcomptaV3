"""Règle 2 : mois M-1 non clôturé après le 15 du mois courant."""
from __future__ import annotations

from datetime import timedelta

from backend.core.config import MOIS_FR
from backend.models.rappel import Rappel, RappelCTA
from backend.services.rappels_rules._base import RappelContext


def _pct(x: float) -> str:
    """Format pourcentage entier : 0.85 → '85%'."""
    try:
        return f"{int(round(float(x) * 100))}%"
    except (TypeError, ValueError):
        return "—"


class MoisNonClotureRule:
    """Détecte le mois M-1 non clôturé une fois passé le 15 du mois courant.

    Skip :
    - `today.day <= 15` (15 jours de grâce).
    - Mois M-1 sans entrée dans cloture_status (probablement absent / pas encore importé).
    - `taux_lettrage >= 1.0 ET taux_justificatifs >= 1.0` (mois clos).

    Émet 1 rappel warning, id stable `mois_non_cloture_{year}_{month:02d}`.
    """

    rule_id = "mois_non_cloture"
    label = "Mois M-1 non clôturé"
    description = "Le mois précédent n'est pas clos passé le 15 du mois courant."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        if ctx.today.day <= 15:
            return []

        # M-1 via day=1 - 1 jour : gère janvier → décembre N-1 sans modulo.
        first_of_current = ctx.today.replace(day=1)
        prev = first_of_current - timedelta(days=1)
        prev_year = prev.year
        prev_month = prev.month

        entries = ctx.cloture_status.get(prev_year, [])
        entry = next((e for e in entries if e.get("mois") == prev_month), None)
        if entry is None:
            return []

        taux_l = float(entry.get("taux_lettrage") or 0.0)
        taux_j = float(entry.get("taux_justificatifs") or 0.0)
        if taux_l >= 1.0 and taux_j >= 1.0:
            return []

        # Index 1-12 → MOIS_FR index 0-11
        mois_label = MOIS_FR[prev_month - 1].capitalize()

        return [Rappel(
            id=f"mois_non_cloture_{prev_year}_{prev_month:02d}",
            niveau="warning",
            categorie="comptable",
            titre=f"{mois_label} {prev_year} non clôturé",
            message=f"Lettrage {_pct(taux_l)} · Justificatifs {_pct(taux_j)}",
            cta=RappelCTA(
                label="Clôturer",
                route=f"/cloture?year={prev_year}&month={prev_month}",
            ),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
