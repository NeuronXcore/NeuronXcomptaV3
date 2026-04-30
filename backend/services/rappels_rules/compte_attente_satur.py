"""Règle 5 : compte d'attente saturé (anomalies non résolues sur opérations).

Distinct du module Rappels lui-même : `/api/alertes` gère les anomalies réactives
(justif manquant, à catégoriser, montant suspect, doublon, confiance faible). Cette
règle remonte uniquement quand le COMPTEUR de ces alertes franchit un seuil de
saturation — signal qu'un nettoyage de compte d'attente s'impose.
"""
from __future__ import annotations

import logging

from backend.models.rappel import Rappel, RappelCTA
from backend.services import operation_service
from backend.services.rappels_rules._base import RappelContext

logger = logging.getLogger(__name__)


_THRESHOLD_WARNING = 30
_THRESHOLD_CRITICAL = 60


def _is_op_in_attente(op: dict) -> bool:
    """Une op est "en compte d'attente" si elle a au moins une alerte non résolue
    OU si elle a été flaggée explicitement `compte_attente: true`.

    Aligné sur la logique de `alerte_service.refresh_alertes_fichier` : `alertes`
    est la liste des types détectés, `alertes_resolues` est la liste de ceux que
    l'utilisateur a marqués résolus. Un type présent dans `alertes` mais pas
    dans `alertes_resolues` = anomalie active.
    """
    if op.get("compte_attente") is True:
        return True
    alertes = op.get("alertes") or []
    if not alertes:
        return False
    resolues = set(op.get("alertes_resolues") or [])
    return any(a not in resolues for a in alertes)


class CompteAttenteSaturRule:
    """Compte les ops de l'année courante avec anomalies actives.

    Seuils :
    - 30 ≤ count < 60 → warning.
    - count ≥ 60 → critical.

    Skip : count < 30 (le compte d'attente normal de quelques ops n'est pas un
    rappel — c'est l'usage attendu).
    """

    rule_id = "compte_attente_satur"
    label = "Compte d'attente saturé"
    description = "Volume d'opérations en compte d'attente : ≥ 30 (warning) ou ≥ 60 (critical)."

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        year = ctx.today.year
        files_year = [f for f in ctx.operation_files if f.get("year") == year]
        if not files_year:
            return []

        count = 0
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
                if _is_op_in_attente(op):
                    count += 1

        if count < _THRESHOLD_WARNING:
            return []

        niveau = "critical" if count >= _THRESHOLD_CRITICAL else "warning"
        if niveau == "critical":
            titre = f"{count} opérations en compte d'attente"
            message = "Volume élevé d'anomalies non résolues — un nettoyage s'impose pour éviter le déraillement de la clôture."
        else:
            titre = f"{count} opérations en compte d'attente"
            message = "Le compte d'attente s'accumule — pense à résoudre les anomalies par batch."

        return [Rappel(
            id="compte_attente_satur",
            niveau=niveau,
            categorie="comptable",
            titre=titre,
            message=message,
            cta=RappelCTA(label="Voir", route=f"/alertes?year={year}"),
            snoozable=True,
            date_detection=ctx.today.isoformat(),
        )]
