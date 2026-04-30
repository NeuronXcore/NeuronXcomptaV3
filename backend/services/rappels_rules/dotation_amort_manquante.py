"""Règle 8 : OD dotation aux amortissements manquante sur exercice clôturé.

Une fois la liasse SCP saisie pour l'exercice N-1, l'OD au 31/12 figeant la
dotation des immobilisations devrait être générée. Si elle manque, le BNC
déclaré est faussé : la déduction des amortissements n'est pas comptabilisée
côté ops bancaires.

Distinct de `liasse_scp_manquante` qui couvre l'exercice N-1 sans liasse —
ici on suppose la liasse présente et on signale UNIQUEMENT l'absence d'OD.
"""
from __future__ import annotations

import logging

from backend.models.rappel import Rappel, RappelCTA
from backend.services import amortissement_service, liasse_scp_service
from backend.services.rappels_rules._base import RappelContext, format_eur

logger = logging.getLogger(__name__)


class DotationAmortManquanteRule:
    """Émet un rappel critique si liasse N-1 saisie mais OD dotation absente.

    Logique :
    - target_year = today.year - 1.
    - Skip si liasse non saisie (la règle `liasse_scp_manquante` prend la main).
    - Skip si `total_deductible <= 0` (aucune immo active → rien à déduire).
    - Skip si `find_dotation_operation` trouve l'OD (cas normal).
    - Sinon → 1 rappel critical avec montant manquant.

    L'id `dotation_amort_manquante_{year}` est stable par exercice.
    """

    rule_id = "dotation_amort_manquante"
    label = "Dotation amortissements manquante"
    description = "Si liasse N-1 saisie mais aucune OD dotation détectée pour l'exercice → critical. Préserve la déduction BNC."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        target_year = ctx.today.year - 1

        # Pas de liasse → autre règle s'en occupe.
        if liasse_scp_service.get_liasse(target_year) is None:
            return []

        # Aucune dotation à attendre (pas d'immo active sur cet exercice).
        try:
            dotations = amortissement_service.get_dotations(target_year)
        except Exception as exc:
            logger.warning("rappels: get_dotations(%d) a échoué (%s)", target_year, exc)
            return []
        total_deductible = float(dotations.get("total_deductible") or 0.0)
        if total_deductible <= 0:
            return []

        # OD trouvée → silence.
        if amortissement_service.find_dotation_operation(target_year) is not None:
            return []

        return [Rappel(
            id=f"dotation_amort_manquante_{target_year}",
            niveau="critical",
            categorie="comptable",
            titre=f"Dotation amortissements {target_year} manquante",
            message=(
                f"Liasse {target_year} saisie mais aucune OD dotation détectée — "
                f"manque {format_eur(total_deductible)} de déduction BNC."
            ),
            cta=RappelCTA(
                label="Générer",
                route=f"/amortissements?tab=dotation&year={target_year}",
            ),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
