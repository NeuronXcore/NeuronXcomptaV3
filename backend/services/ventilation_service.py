from __future__ import annotations

"""Service pour la ventilation d'opérations en sous-lignes."""

import logging
from typing import Optional

from backend.services import operation_service

logger = logging.getLogger(__name__)


def _validate_ventilation(operation: dict, lines: list[dict]) -> None:
    """Valide que sum(montants) == montant opération (tolérance 0.01€)."""
    if len(lines) < 2:
        raise ValueError("La ventilation doit contenir au moins 2 lignes")

    montant_op = max(operation.get("Débit", 0.0), operation.get("Crédit", 0.0))
    total_lines = sum(line.get("montant", 0.0) for line in lines)

    for i, line in enumerate(lines):
        m = line.get("montant", 0.0)
        if m <= 0:
            raise ValueError(f"Ligne {i}: le montant doit être > 0 (reçu {m})")

    if abs(total_lines - montant_op) > 0.01:
        raise ValueError(
            f"La somme des montants ({total_lines:.2f}) ne correspond pas "
            f"au montant de l'opération ({montant_op:.2f})"
        )


def _reindex_lines(lines: list[dict]) -> list[dict]:
    """Recalcule les index 0..N-1."""
    for i, line in enumerate(lines):
        line["index"] = i
    return lines


def set_ventilation(filename: str, op_index: int, lines: list[dict]) -> dict:
    """
    Crée ou remplace la ventilation d'une opération.
    Valide que sum(montants) == montant opération.
    Met la catégorie parente à "Ventilé".
    """
    ops = operation_service.load_operations(filename)
    if op_index < 0 or op_index >= len(ops):
        raise IndexError(f"Index d'opération invalide: {op_index}")

    op = ops[op_index]
    _validate_ventilation(op, lines)

    lines = _reindex_lines(lines)
    # S'assurer que chaque ligne a les champs par défaut
    for line in lines:
        line.setdefault("categorie", "")
        line.setdefault("sous_categorie", "")
        line.setdefault("libelle", "")
        line.setdefault("justificatif", None)
        line.setdefault("lettre", False)

    op["ventilation"] = lines
    op["Catégorie"] = "Ventilé"

    operation_service.save_operations(ops, filename=filename)
    return op


def remove_ventilation(filename: str, op_index: int) -> dict:
    """Supprime la ventilation, remet catégorie à '' (sera recatégorisée)."""
    ops = operation_service.load_operations(filename)
    if op_index < 0 or op_index >= len(ops):
        raise IndexError(f"Index d'opération invalide: {op_index}")

    op = ops[op_index]
    op["ventilation"] = []
    op["Catégorie"] = ""

    operation_service.save_operations(ops, filename=filename)
    return op


def update_ventilation_line(
    filename: str, op_index: int, line_index: int, updates: dict
) -> dict:
    """Met à jour un champ d'une sous-ligne (catégorie, justificatif, lettre...)."""
    ops = operation_service.load_operations(filename)
    if op_index < 0 or op_index >= len(ops):
        raise IndexError(f"Index d'opération invalide: {op_index}")

    op = ops[op_index]
    ventilation = op.get("ventilation", [])
    if line_index < 0 or line_index >= len(ventilation):
        raise IndexError(f"Index de sous-ligne invalide: {line_index}")

    line = ventilation[line_index]
    for key, value in updates.items():
        if key != "index":  # on ne modifie pas l'index manuellement
            line[key] = value

    # Re-valider si le montant a changé
    if "montant" in updates:
        _validate_ventilation(op, ventilation)

    operation_service.save_operations(ops, filename=filename)
    return op
