"""Règle 10 : écart anormal entre CA déclaré (liasse SCP) et flux bancaires.

Une fois la liasse SCP saisie, on peut comparer le `ca_declare` au proxy
bancaire calculé par le moteur BNC (`recettes_pro_bancaires`). Un écart
modéré (~5%) est normal — décalages factures émises / encaissements.
Au-delà, soit la saisie de liasse est erronée (erreur de virgule), soit
il manque un mois bancaire dans les imports → BNC final faussé.
"""
from __future__ import annotations

import logging

from backend.models.rappel import Rappel, RappelCTA
from backend.services import bnc_service
from backend.services.rappels_rules._base import RappelContext, format_eur

logger = logging.getLogger(__name__)


_THRESHOLD_WARNING = 0.05   # 5%
_THRESHOLD_CRITICAL = 0.20  # 20%


class LiasseScpIncoherenteRule:
    """Émet un rappel si le CA déclaré diverge du proxy bancaire de plus de 5 %.

    Niveau :
    - delta >= 20 % → critical (sûrement un mois manquant ou erreur saisie).
    - 5 % <= delta < 20 % → warning.

    Skip :
    - Liasse non saisie (`ca_liasse is None`) → la règle `liasse_scp_manquante`
      prend la main.
    - `recettes_pro_bancaires == 0` (pas d'ops importées, comparaison non
      significative).
    - delta < 5 % (cohérent, marge normale décalages factures/encaissements).
    """

    rule_id = "liasse_scp_incoherente"
    label = "Liasse SCP incohérente"
    description = "Écart > 5 % entre CA déclaré et flux bancaires de l'exercice — saisie erronée ou import incomplet."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        target_year = ctx.today.year - 1

        try:
            bnc = bnc_service.compute_bnc(target_year)
        except Exception as exc:
            logger.warning("rappels: compute_bnc(%d) a échoué (%s)", target_year, exc)
            return []

        ca_liasse = bnc.ca_liasse
        recettes_bancaires = bnc.recettes_pro_bancaires

        if ca_liasse is None:
            return []
        if recettes_bancaires <= 0:
            return []

        denominator = max(ca_liasse, recettes_bancaires)
        if denominator <= 0:
            return []

        delta = abs(ca_liasse - recettes_bancaires) / denominator
        if delta < _THRESHOLD_WARNING:
            return []

        niveau = "critical" if delta >= _THRESHOLD_CRITICAL else "warning"
        delta_pct = int(round(delta * 100))

        return [Rappel(
            id=f"liasse_scp_incoherente_{target_year}",
            niveau=niveau,
            categorie="scp",
            titre=f"Écart CA liasse vs flux bancaires : {delta_pct} %",
            message=(
                f"CA déclaré {format_eur(ca_liasse)} vs recettes bancaires "
                f"{format_eur(recettes_bancaires)} — vérifie la saisie ou les "
                "imports manquants."
            ),
            cta=RappelCTA(
                label="Vérifier",
                route=f"/visualization?year={target_year}",
            ),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
