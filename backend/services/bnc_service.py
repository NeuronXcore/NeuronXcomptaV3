"""
Service BNC — source unique du calcul fiscal.

Façade qui réutilise la logique de `analytics_service._bnc_metrics_from_operations`
(elle-même délègue à `export_service._prepare_export_operations` pour le tri
pro/perso/attente + explosion ventilations) et y ajoute :
  - Dotations annuelles (`amortissement_service.get_dotations(year).total_deductible`)
  - Forfaits déductibles (`charges_forfaitaires_service.get_total_deductible_year(year)`)

Formule : `bnc = recettes_pro − charges_pro − dotations − forfaits`.

Imports locaux dans chaque fonction pour éviter cycles avec analytics_service.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional


@dataclass
class BncBreakdown:
    year: int
    recettes_pro: float           # CA liasse si saisi, sinon proxy bancaire
    recettes_pro_bancaires: float  # toujours le proxy bancaire (référence)
    base_recettes: str             # 'liasse' | 'bancaire'
    charges_pro: float             # hors EXCLUDED_FROM_CHARGES_PRO, après déduction CSG non déductible
    dotations_amortissements: float
    forfaits_total: float          # 0.0 en A1 (voir CLAUDE.md, Prompt C raffinera)
    bnc: float
    nb_ops_pro: int
    ca_liasse: Optional[float] = None

    def to_dict(self) -> dict:
        return asdict(self)


def _load_year_operations(year: int) -> list[dict]:
    """Charge toutes les opérations d'une année donnée (concat des fichiers mensuels)."""
    from backend.services import operation_service

    operations: list[dict] = []
    files = operation_service.list_operation_files()
    for meta in files:
        if meta.get("year") != year:
            continue
        try:
            ops = operation_service.load_operations(meta["filename"])
        except Exception:
            continue
        operations.extend(ops)
    return operations


def compute_bnc(year: int, ca_liasse: Optional[float] = None) -> BncBreakdown:
    """Source unique du calcul BNC pour une année.

    Si `ca_liasse` non fourni, lit la liasse SCP via `liasse_scp_service`.
    Si toujours absente, base_recettes = 'bancaire' (proxy).
    """
    from backend.services import (
        amortissement_service,
        analytics_service,
        charges_forfaitaires_service,
        liasse_scp_service,
    )

    # CA liasse (si fourni en argument, sinon lecture)
    if ca_liasse is None:
        try:
            ca_liasse = liasse_scp_service.get_ca_for_bnc(year)
        except Exception:
            ca_liasse = None

    operations = _load_year_operations(year)
    metrics = analytics_service._bnc_metrics_from_operations(operations, ca_liasse=ca_liasse)
    bnc_block = metrics["bnc"]

    recettes_pro = float(bnc_block.get("recettes_pro", 0.0))
    recettes_pro_bancaires = float(bnc_block.get("recettes_pro_bancaires", 0.0))
    charges_pro = float(bnc_block.get("charges_pro", 0.0))
    base_recettes = bnc_block.get("base_recettes", "bancaire")
    nb_ops_pro = int(bnc_block.get("nb_ops_pro", 0))

    # Dotations annuelles
    try:
        dotations_data = amortissement_service.get_dotations(year)
        dotations = float(dotations_data.get("total_deductible", 0.0))
    except Exception:
        dotations = 0.0

    # Forfaits déductibles (A1 : 0.0 — les OD blanchissage/repas/véhicule sont
    # déjà des opérations bancaires comptées dans charges_pro). Voir CLAUDE.md
    # pour la stratégie cible (Prompt C).
    try:
        forfaits = float(charges_forfaitaires_service.get_total_deductible_year(year))
    except Exception:
        forfaits = 0.0

    bnc_value = round(recettes_pro - charges_pro - dotations - forfaits, 2)

    return BncBreakdown(
        year=year,
        recettes_pro=round(recettes_pro, 2),
        recettes_pro_bancaires=round(recettes_pro_bancaires, 2),
        base_recettes=base_recettes,
        charges_pro=round(charges_pro, 2),
        dotations_amortissements=round(dotations, 2),
        forfaits_total=round(forfaits, 2),
        bnc=bnc_value,
        nb_ops_pro=nb_ops_pro,
        ca_liasse=round(float(ca_liasse), 2) if ca_liasse is not None else None,
    )
