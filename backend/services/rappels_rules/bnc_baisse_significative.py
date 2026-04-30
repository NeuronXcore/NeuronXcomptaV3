"""Règle 11 : baisse significative du BNC entre N-2 et N-1.

Une chute > 20 % impacte directement les acomptes URSSAF/CARMF de l'année
suivante (calculés sur la base N-2). Détecter tôt permet d'anticiper la
trésorerie ou de demander une modulation d'acomptes auprès des organismes.

Skip si l'une des 2 années est en proxy bancaire (sans liasse) — comparaison
peu fiable, on attend que les BNC soient figés fiscalement.
"""
from __future__ import annotations

import logging

from backend.models.rappel import Rappel, RappelCTA
from backend.services import bnc_service
from backend.services.rappels_rules._base import RappelContext, format_eur

logger = logging.getLogger(__name__)


_THRESHOLD_WARNING = 0.80   # ratio < 0.80 = baisse > 20%
_THRESHOLD_CRITICAL = 0.65  # ratio < 0.65 = baisse > 35%


class BncBaisseSignificativeRule:
    """Émet un rappel si BNC N-1 < BNC N-2 × 0.80 (baisse > 20 %).

    Niveau :
    - ratio < 0.65 → critical (chute >35 %, signal majeur).
    - 0.65 <= ratio < 0.80 → warning.

    Skip :
    - L'une des 2 liasses (N-1 ou N-2) non saisie → calcul peu fiable
      (proxy bancaire). On attend que les BNC soient figés fiscalement.
    - `bnc_n_minus_2 <= 0` → ratio non calculable.
    - Baisse < 20 % (bruit normal d'année en année).
    """

    rule_id = "bnc_baisse_significative"
    label = "BNC en baisse significative"
    description = "Chute > 20 % du BNC N-1 vs N-2 — anticipe une régul URSSAF importante ou demande une modulation d'acomptes."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        year_n = ctx.today.year - 1
        year_n_minus_1 = ctx.today.year - 2

        try:
            bnc_n = bnc_service.compute_bnc(year_n)
            bnc_n_minus_1 = bnc_service.compute_bnc(year_n_minus_1)
        except Exception as exc:
            logger.warning("rappels: compute_bnc échec (%s)", exc)
            return []

        # Skip si l'une des 2 années n'a pas de liasse saisie.
        if bnc_n.ca_liasse is None or bnc_n_minus_1.ca_liasse is None:
            return []

        ref = bnc_n_minus_1.bnc
        if ref <= 0:
            return []

        ratio = bnc_n.bnc / ref
        if ratio >= _THRESHOLD_WARNING:
            return []

        niveau = "critical" if ratio < _THRESHOLD_CRITICAL else "warning"
        baisse_pct = int(round((1 - ratio) * 100))

        return [Rappel(
            id=f"bnc_baisse_significative_{year_n}",
            niveau=niveau,
            categorie="patrimoine",
            titre=f"BNC {year_n} en baisse de {baisse_pct} %",
            message=(
                f"BNC {year_n} : {format_eur(bnc_n.bnc)} vs "
                f"{year_n_minus_1} : {format_eur(bnc_n_minus_1.bnc)}. "
                "Anticipe une éventuelle régul URSSAF importante."
            ),
            cta=RappelCTA(label="Détails", route="/simulation"),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
