"""Base du moteur de rappels — contexte partagé + Protocol des règles + helpers."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from backend.models.rappel import Rappel


def format_eur(amount: float) -> str:
    """Format français : 1 234,56 €. Mutualisé entre toutes les règles."""
    rounded = round(amount, 2)
    integer_part = int(rounded)
    decimal_part = abs(rounded - integer_part)
    formatted_int = f"{integer_part:,}".replace(",", " ")
    decimal_str = f"{decimal_part:.2f}".split(".")[1]
    return f"{formatted_int},{decimal_str} €"


@dataclass
class RappelContext:
    """Contexte construit une seule fois par requête, partagé entre toutes les règles.

    - `today` : injectable pour tests deterministes.
    - `operation_files` : meta des fichiers d'ops (PAS les ops elles-mêmes).
       Les règles qui en ont besoin chargent à la volée via `operation_service.load_operations()`.
    - `cloture_status` : indexé par année — toujours `{today.year - 1, today.year}` chargé
       (pas de branche conditionnelle). La règle « M-1 non clôturé » lit M-1 sans modulo.
    - `settings` : dict brut chargé depuis `settings.json` (peut être vide si absent).
    - `snooze_state` : dict {rule_id: expiry_datetime} — uniquement les snoozes ACTIFS
       (les expirés sont droppés au load).
    """
    today: date
    operation_files: list[dict]
    cloture_status: dict[int, list[dict]]
    settings: dict
    snooze_state: dict[str, datetime]


class RappelRule(Protocol):
    """Interface des règles de rappel.

    Chaque règle expose :
    - `rule_id` : préfixe stable pour le snooze et la désactivation (ex. `justif_manquant`).
    - `label` : libellé court humain pour l'UI Settings (ex. « Justificatifs manquants »).
    - `description` : 1 phrase d'explication du déclenchement (ex. « ≥30 jours sans justif »).
    - `evaluate(ctx)` : retourne 0, 1 ou plusieurs rappels.

    Les rappels émis ont des `id` qui peuvent être suffixés (ex. `justif_manquant_30j`,
    `justif_manquant_60j`) — la désactivation côté Settings se fait par `rule_id` (la
    racine), pas par instance de rappel.
    """

    rule_id: str
    label: str
    description: str

    def evaluate(self, ctx: RappelContext) -> list[Rappel]:
        ...
