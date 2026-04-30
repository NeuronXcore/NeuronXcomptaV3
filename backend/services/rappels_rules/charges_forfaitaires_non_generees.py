"""Règle 9 : forfaits blanchissage / repas / véhicule non générés en fin d'année.

Ces 3 forfaits réduisent significativement le BNC (blanchissage ~3 000 €,
repas ~3 000 €, véhicule via ratio sur poste). Oubli fréquent en fin
d'exercice → coût fiscal réel. La règle remonte un signal à partir de
novembre N pour donner 2 mois de marge à l'utilisateur.
"""
from __future__ import annotations

import logging

from backend.models.rappel import Rappel, RappelCTA
from backend.services.charges_forfaitaires_service import ChargesForfaitairesService
from backend.services.rappels_rules._base import RappelContext

logger = logging.getLogger(__name__)


_FORFAIT_LABELS = {
    "blanchissage": "Blanchissage",
    "repas": "Repas",
    "vehicule": "Véhicule",
}


class ChargesForfaitairesNonGenereesRule:
    """Émet un rappel à partir de novembre N si au moins un forfait manque.

    Niveau :
    - 3 forfaits manquants OU `today.month == 12 ET today.day > 15` → critical
      (urgence fin d'année).
    - 1-2 forfaits manquants en novembre ou décembre ≤ 15 → warning.

    Skip :
    - `today.month < 11` (trop tôt, l'utilisateur n'a pas commencé sa clôture).
    - Si tous les forfaits sont déjà générés.

    L'id `charges_forfaitaires_non_generees_{year}` permet de snoozer pour
    l'année courante. Une nouvelle alerte en N+1 aura un id différent.
    """

    rule_id = "charges_forfaitaires_non_generees"
    label = "Charges forfaitaires non générées"
    description = "À partir de novembre N : signale les forfaits blanchissage/repas/véhicule non générés pour l'exercice."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        if ctx.today.month < 11:
            return []

        year = ctx.today.year
        try:
            service = ChargesForfaitairesService()
        except Exception as exc:
            logger.warning("rappels: instantiation ChargesForfaitairesService a échoué (%s)", exc)
            return []

        missing: list[str] = []
        try:
            if not service.get_forfaits_generes(year):
                missing.append(_FORFAIT_LABELS["blanchissage"])
        except Exception as exc:
            logger.warning("rappels: get_forfaits_generes(%d) a échoué (%s)", year, exc)
        try:
            if not service.get_repas_generes(year):
                missing.append(_FORFAIT_LABELS["repas"])
        except Exception as exc:
            logger.warning("rappels: get_repas_generes(%d) a échoué (%s)", year, exc)
        try:
            if service.get_vehicule_genere(year) is None:
                missing.append(_FORFAIT_LABELS["vehicule"])
        except Exception as exc:
            logger.warning("rappels: get_vehicule_genere(%d) a échoué (%s)", year, exc)

        if not missing:
            return []

        # Niveau : critical si tous manquants OU urgence fin d'année (>15 décembre).
        is_late_december = ctx.today.month == 12 and ctx.today.day > 15
        if len(missing) == 3 or is_late_december:
            niveau = "critical"
        else:
            niveau = "warning"

        plural = "s" if len(missing) > 1 else ""
        return [Rappel(
            id=f"charges_forfaitaires_non_generees_{year}",
            niveau=niveau,
            categorie="comptable",
            titre=f"{len(missing)} forfait{plural} non généré{plural} pour {year}",
            message=(
                f"À générer avant clôture : {', '.join(missing)}. "
                "Impact direct sur le BNC déductible."
            ),
            cta=RappelCTA(label="Générer", route="/charges-forfaitaires"),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
