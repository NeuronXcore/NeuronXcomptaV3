"""Règle 6 : régularisation URSSAF de l'exercice N-1 anticipée.

L'URSSAF appelle typiquement la régul N-1 entre octobre et novembre N (écart entre
le revenu réel N-1 et les acomptes provisionnels payés sur la base N-3). Si l'écart
calculé est significatif, on alerte l'utilisateur pour qu'il prépare sa trésorerie
(régul à payer) ou anticipe le remboursement attendu.

Réutilise `urssaf_provisional_service.compute_urssaf_regul_estimate(year-1)` qui
calcule déjà l'écart côté backend (consommé par la card du widget Compta Analytique).
"""
from __future__ import annotations

import logging

from backend.models.rappel import Rappel, RappelCTA
from backend.services.rappels_rules._base import RappelContext

logger = logging.getLogger(__name__)


_THRESHOLD_EUR = 1_000.0  # seuil min d'écart pour émettre un rappel
_THRESHOLD_CRITICAL_EUR = 5_000.0


class UrssafRegulAnticipeeRule:
    """Émet un rappel quand la régul URSSAF N-1 attendue dépasse le seuil.

    Niveau :
    - `|ecart| >= 5 000 €` OU `today.month >= 9` → critical (appel imminent).
    - `1 000 € <= |ecart| < 5 000 €` ET `today.month < 9` → warning.

    Skip :
    - `|ecart| < 1 000 €` (négligeable).
    - `confiance == "provisoire"` (BNC N-1 non figé via liasse SCP — calcul
      potentiellement imprécis, mieux vaut attendre la liasse).
    - Erreur backend (BNC indisponible, barème manquant) → log warning, return [].

    L'id `urssaf_regul_{year_courante}` permet à l'utilisateur de snoozer l'alerte
    de l'année en cours sans masquer celle de l'année suivante.
    """

    rule_id = "urssaf_regul"
    label = "Régularisation URSSAF anticipée"
    description = "Écart attendu (régul ou remboursement) ≥ 1 000 € sur l'exercice N-1, calculé d'après la liasse saisie."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        # Import local pour éviter le coût d'import bnc_service / fiscal_service
        # quand la règle n'a rien à émettre (la majorité des appels).
        try:
            from backend.services import urssaf_provisional_service
            estimate = urssaf_provisional_service.compute_urssaf_regul_estimate(
                ctx.today.year - 1
            )
        except Exception as exc:
            logger.warning("rappels: compute_urssaf_regul_estimate a échoué (%s)", exc)
            return []

        ecart = float(estimate.get("ecart_regul") or 0.0)
        confiance = estimate.get("confiance")
        signe = estimate.get("signe")

        if confiance != "definitif":
            # BNC provisoire → la liasse SCP n'est pas saisie, autre règle s'en occupe.
            return []
        if abs(ecart) < _THRESHOLD_EUR:
            return []

        if abs(ecart) >= _THRESHOLD_CRITICAL_EUR or ctx.today.month >= 9:
            niveau = "critical"
        else:
            niveau = "warning"

        target_year = ctx.today.year - 1
        ecart_str = f"{abs(ecart):,.0f} €".replace(",", " ")
        if signe == "regul":
            titre = f"Régularisation URSSAF {target_year} attendue"
            message = (
                f"Estimation : {ecart_str} à payer (appel typique octobre-novembre {ctx.today.year}). "
                "Anticipe ta trésorerie."
            )
        elif signe == "remboursement":
            titre = f"Remboursement URSSAF {target_year} attendu"
            message = (
                f"Estimation : {ecart_str} à recevoir suite à la régul {target_year}. "
                "Vérifie la cohérence avec ta liasse."
            )
        else:
            # Edge case : signe == "equilibre" mais |ecart| >= seuil — improbable
            # avec la tolérance interne du service, mais on remonte un signal neutre.
            return []

        return [Rappel(
            id=f"urssaf_regul_{ctx.today.year}",
            niveau=niveau,
            categorie="fiscal",
            titre=titre,
            message=message,
            cta=RappelCTA(
                label="Détails",
                route=f"/visualization?year={target_year}&category=URSSAF",
            ),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
