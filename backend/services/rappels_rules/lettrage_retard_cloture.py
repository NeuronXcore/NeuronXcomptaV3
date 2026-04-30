"""Règle 7 : lettrage incomplet sur un exercice fiscalement clôturé.

Une fois la liasse SCP saisie pour l'exercice N-1, les comptes sont fiscalement
figés. Tout mois de cet exercice avec `taux_lettrage < 1.0` représente un retard
de rapprochement banc/compta qui doit être nettoyé pour que les écritures
matchent la déclaration officielle.

Distinct de `mois_non_cloture` (qui ne couvre que M-1 récent) — ici on remonte
TOUT l'exercice N-1 dès qu'il est clos fiscalement.
"""
from __future__ import annotations

from backend.core.config import MOIS_FR
from backend.models.rappel import Rappel, RappelCTA
from backend.services import liasse_scp_service
from backend.services.rappels_rules._base import RappelContext


class LettrageRetardClotureRule:
    """Émet un rappel par exercice clôturé fiscalement avec lettrage incomplet.

    Logique :
    - target_year = today.year - 1.
    - Skip si liasse SCP non saisie (la règle `liasse_scp_manquante` prend la main).
    - Compte les mois de target_year avec `taux_lettrage < 1.0`.
    - Si 0 mois → return [].

    Niveau :
    - 1-3 mois → warning (rattrapage modéré).
    - ≥ 4 mois → critical (incohérence majeure compta/déclaratif).

    L'id `lettrage_retard_cloture_{year}` est stable par exercice — un snooze posé
    sur l'exercice 2024 reste indépendant de l'exercice 2025.
    """

    rule_id = "lettrage_retard_cloture"
    label = "Lettrage en retard sur exercice clôturé"
    description = "Mois avec lettrage incomplet sur un exercice dont la liasse SCP est saisie."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        target_year = ctx.today.year - 1

        # Pas de liasse → l'exercice n'est pas figé fiscalement, autre règle s'en
        # occupe. Évite de bombarder l'utilisateur d'alertes pendant que le BNC
        # est encore en mouvement.
        if liasse_scp_service.get_liasse(target_year) is None:
            return []

        entries = ctx.cloture_status.get(target_year, [])
        # `taux_lettrage` est un float [0.0, 1.0]. On compte uniquement les mois
        # avec opérations (`has_releve` ou nb_operations > 0) pour ne pas
        # signaler les mois à 0% mais vides — déjà couverts par `mois_non_cloture`.
        mois_retard = [
            e for e in entries
            if e.get("nb_operations", 0) > 0 and float(e.get("taux_lettrage") or 0.0) < 1.0
        ]
        if not mois_retard:
            return []

        n = len(mois_retard)
        niveau = "critical" if n >= 4 else "warning"

        # Liste lisible des mois concernés (max 3 affichés, +N autres)
        labels = [MOIS_FR[m["mois"] - 1].capitalize() for m in mois_retard[:3]]
        if n > 3:
            mois_str = f"{', '.join(labels)} (+{n - 3} autres)"
        else:
            mois_str = ", ".join(labels)

        plural = "s" if n > 1 else ""
        return [Rappel(
            id=f"lettrage_retard_cloture_{target_year}",
            niveau=niveau,
            categorie="comptable",
            titre=f"Lettrage incomplet sur {n} mois de l'exercice {target_year}",
            message=f"L'exercice {target_year} est clôturé (liasse saisie) mais des mois ont du retard : {mois_str}.",
            cta=RappelCTA(label="Lettrer", route=f"/cloture?year={target_year}"),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
