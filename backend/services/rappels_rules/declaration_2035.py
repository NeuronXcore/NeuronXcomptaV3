"""Règle 3 : déclaration 2035 (échéance 30 avril)."""
from __future__ import annotations

from backend.models.rappel import Rappel, RappelCTA
from backend.services.rappels_rules._base import RappelContext


class Declaration2035Rule:
    """Émet un rappel sur l'ensemble du mois d'avril.

    Niveau :
    - `today.day <= 15` → warning (rappel doux, 2 semaines avant butoir).
    - `today.day > 15`  → critical (moins de 2 semaines).

    Skip :
    - `today.month != 4` → return [].

    CTA → `/ged?type=liasse_fiscale_scp&year={year}` qui filtre la GED sur le type
    `liasse_fiscale_scp` (l'objet exact de la 2035, drawer dédié).

    Id stable `decl_2035_{year}` — un snooze posé en avril N reste actif jusqu'à
    expiration ; l'année suivante émet un nouveau rappel avec id différent.
    """

    rule_id = "decl_2035"
    label = "Déclaration 2035"
    description = "Échéance de dépôt de la liasse fiscale BNC le 30 avril."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        if ctx.today.month != 4:
            return []

        days_remaining = 30 - ctx.today.day
        niveau = "critical" if ctx.today.day > 15 else "warning"
        plural = "s" if days_remaining > 1 else ""
        message = (
            f"Date butoir : 30 avril {ctx.today.year}"
            + (f" (dans {days_remaining} jour{plural})" if days_remaining > 0 else " (aujourd'hui)")
        )

        return [Rappel(
            id=f"decl_2035_{ctx.today.year}",
            niveau=niveau,
            categorie="fiscal",
            titre="Déclaration 2035 à déposer",
            message=message,
            cta=RappelCTA(
                label="Préparer",
                route=f"/ged?type=liasse_fiscale_scp&year={ctx.today.year}",
            ),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
