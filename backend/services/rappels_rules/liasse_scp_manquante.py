"""Règle 4 : liasse SCP de l'exercice N-1 non saisie après le 1er mai N.

Tant que la liasse n'est pas saisie, le BNC reste calculé sur la base bancaire
(provisoire) au lieu du CA déclaré (définitif). Le comptable ne peut pas
finaliser sa préparation 2035 sans cette donnée.
"""
from __future__ import annotations

from backend.models.rappel import Rappel, RappelCTA
from backend.services import liasse_scp_service
from backend.services.rappels_rules._base import RappelContext


class LiasseScpManquanteRule:
    """Émet un rappel à partir de mai si la liasse N-1 manque.

    Niveau :
    - mai-juin → warning (rappel doux, l'expert-comptable a souvent jusqu'à mi-mai
      pour finaliser).
    - juillet → critical (anormal de ne pas avoir le CA officiel passé l'été).

    Skip :
    - `today.month < 5` → return [] (avant le butoir 2035, la règle dédiée s'occupe
      du rappel de dépôt).
    - Liasse N-1 saisie (présente dans `data/liasse_scp/liasse_{year-1}.json`).
    """

    rule_id = "liasse_scp_manquante"
    label = "Liasse SCP non saisie"
    description = "À partir de mai N, signale si la liasse SCP de l'exercice N-1 n'a pas été saisie (BNC reste provisoire)."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        if ctx.today.month < 5:
            return []

        target_year = ctx.today.year - 1
        if liasse_scp_service.get_liasse(target_year) is not None:
            return []

        niveau = "critical" if ctx.today.month >= 7 else "warning"

        return [Rappel(
            id=f"liasse_scp_manquante_{target_year}",
            niveau=niveau,
            categorie="scp",
            titre=f"Liasse SCP {target_year} non saisie",
            message=(
                f"BNC {target_year} encore provisoire (basé sur les flux bancaires) — "
                "saisis le CA déclaré pour figer le résultat fiscal."
            ),
            cta=RappelCTA(
                label="Saisir",
                route=f"/ged?type=liasse_fiscale_scp&year={target_year}",
            ),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
