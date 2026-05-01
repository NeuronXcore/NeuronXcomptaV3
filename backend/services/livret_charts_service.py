"""
LivretChartsService — calcul des `ChartConfig` du Livret comptable (Phase 5 MVP).

3 builders :
  - `build_donut_charges_categories(chap_03)` — top-8 catégories + "Autres".
  - `build_waterfall_bnc(chap_08)` — formule BNC en barres cumulatives.
  - `build_cadence_chart(synthese)` — wraps la cadence mensuelle en ChartConfig.

Source unique pour les 3 vues (React Recharts · HTML SVG inline · PDF matplotlib).
Le calcul (agrégation, top-N, classement) est fait UNE seule fois ici.

Cf. plan : `/Users/andrececcoli/.claude/plans/askuserquestion-comment-ajouter-des-parallel-crayon.md`.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.models.livret import (
    ChartConfig,
    ChartPoint,
    ChartSeries,
    LivretBncChapter,
    LivretChapter,
    LivretSyntheseChapter,
)

logger = logging.getLogger(__name__)


# ─── Palette de couleurs cohérente avec compta-analytique ─────────
#
# Dupliquée depuis `frontend/src/components/compta-analytique/ComptaAnalytiquePage.tsx:27-30`
# pour que les 3 vues (React, HTML, PDF) consomment exactement les mêmes hex.
# Migration vers `backend/core/colors.py` envisageable si la palette est partagée par
# d'autres modules (snapshot Compta, exports PDF, etc.).
_PALETTE: list[str] = [
    "#811971",  # primary (violet)
    "#3b82f6",  # blue
    "#22c55e",  # green / success
    "#f59e0b",  # amber / warning
    "#ef4444",  # red / danger
    "#8b5cf6",  # purple
    "#06b6d4",  # cyan
    "#ec4899",  # pink
    "#f97316",  # orange
    "#14b8a6",  # teal
]
_FALLBACK_COLOR = "#64748b"  # gris pour "Autres"


# ─── Chapitre 03 — Donut charges par catégorie ────────────────────

def build_donut_charges_categories(chap_03: LivretChapter) -> Optional[ChartConfig]:
    """Construit un donut top-8 + "Autres" à partir des sous-catégories du chap 03.

    Les sous-cat sont nommées `"Catégorie / Sous-catégorie"` (cf. `_build_charges_pro_chapter`
    qui éclate en mode `eclate`). On agrège sur la racine (avant le `/`).
    Retourne `None` si le chapitre est vide (UI gère l'absence).
    """
    if not chap_03.subcategories:
        return None

    # Agrégation par catégorie racine (split sur " / ")
    aggregates: dict[str, float] = {}
    for sub in chap_03.subcategories:
        if sub.is_orphan_from_n1:
            continue  # ne pas inclure les lignes fantômes Phase 4
        root = sub.name.split("/")[0].strip() or sub.name.strip() or "Non classé"
        aggregates[root] = aggregates.get(root, 0.0) + max(0.0, sub.total_ytd)

    if not aggregates or sum(aggregates.values()) <= 0:
        return None

    # Tri décroissant + top-8 + "Autres"
    sorted_items = sorted(aggregates.items(), key=lambda kv: kv[1], reverse=True)
    top = sorted_items[:8]
    autres = sorted_items[8:]
    autres_total = round(sum(v for _, v in autres), 2)

    points: list[ChartPoint] = []
    for i, (name, value) in enumerate(top):
        points.append(ChartPoint(
            x=name,
            y=round(value, 2),
            color=_PALETTE[i % len(_PALETTE)],
            meta={"category_name": name},
        ))
    if autres_total > 0:
        points.append(ChartPoint(
            x="Autres",
            y=autres_total,
            color=_FALLBACK_COLOR,
            meta={"is_autres_aggregate": True, "categories": [n for n, _ in autres]},
        ))

    total = round(sum(p.y for p in points), 2)

    return ChartConfig(
        id="donut_charges_categories",
        type="donut",
        title="Répartition des charges professionnelles",
        subtitle=f"{len(points)} catégories · total {total:.2f} €",
        series=[ChartSeries(name="Charges YTD", color=_PALETTE[0], data=points)],
        total=total,
        drill_target="category_detail",
    )


# ─── Chapitre 08 — Waterfall BNC ──────────────────────────────────

def build_waterfall_bnc(chap_08: LivretBncChapter) -> Optional[ChartConfig]:
    """Construit un waterfall depuis les 5 lignes de la formule BNC.

    Recettes (+) → Charges (−) → Dotations (−) → Forfaits (−) = BNC (=)
    Les barres sont cumulatives ; la dernière (operator='equals') est en violet primary.
    """
    formula = chap_08.formula or []
    if not formula:
        return None

    # Couleurs par opérateur
    op_colors = {
        "plus": "#22c55e",
        "minus": "#ef4444",
        "equals": "#811971",
    }

    points: list[ChartPoint] = []
    for line in formula:
        op = line.operator
        # Pour le waterfall : la valeur affichée est la valeur absolue. L'opérateur
        # détermine le sens visuel (couleur + sens de la barre dans le frontend).
        value = abs(float(line.amount or 0.0))
        points.append(ChartPoint(
            x=line.label,
            y=round(value, 2),
            color=op_colors.get(op, _FALLBACK_COLOR),
            meta={"operator": op, "raw_amount": round(float(line.amount or 0.0), 2)},
        ))

    return ChartConfig(
        id="waterfall_bnc",
        type="waterfall",
        title="Construction du BNC",
        subtitle="Recettes − Charges − Dotations − Forfaits = BNC",
        series=[ChartSeries(name="BNC", color=op_colors["equals"], data=points)],
        total=round(float(chap_08.total_ytd or 0.0), 2),
    )


# ─── Chapitre 01 — Cadence mensuelle (migration ChartConfig) ──────

def build_cadence_chart(synthese: LivretSyntheseChapter) -> Optional[ChartConfig]:
    """Wraps la cadence mensuelle 12 mois en `ChartConfig`.

    2 séries (recettes vert / charges rouge) + série N-1 optionnelle (`solde_n1`)
    si Phase 4 active et `recettes_n1`/`charges_n1` présents.
    """
    cadence = synthese.cadence_mensuelle or []
    if not cadence:
        return None

    series: list[ChartSeries] = []

    rec_points: list[ChartPoint] = []
    chg_points: list[ChartPoint] = []
    solde_n1_points: list[ChartPoint] = []
    has_n1 = False

    for p in cadence:
        meta = {
            "month": p.month,
            "is_past": p.is_past,
            "is_current": p.is_current,
            "is_projection": p.is_projection,
        }
        rec_points.append(ChartPoint(
            x=p.label, y=round(p.recettes, 2),
            meta={**meta, "kind": "recettes"},
        ))
        chg_points.append(ChartPoint(
            x=p.label, y=round(p.charges, 2),
            meta={**meta, "kind": "charges"},
        ))
        # Phase 4 — solde N-1 si dispo
        if p.recettes_n1 is not None and p.charges_n1 is not None:
            has_n1 = True
            solde_n1_points.append(ChartPoint(
                x=p.label,
                y=round(p.recettes_n1 - p.charges_n1, 2),
                meta={**meta, "kind": "solde_n1"},
            ))

    series.append(ChartSeries(name="Recettes", color="#22c55e", data=rec_points))
    series.append(ChartSeries(name="Charges", color="#ef4444", data=chg_points))
    if has_n1 and solde_n1_points:
        series.append(ChartSeries(
            name="Solde N-1",
            color="#94a3b8",  # gris muted
            data=solde_n1_points,
        ))

    return ChartConfig(
        id="cadence_mensuelle",
        type="cadence",
        title="Cadence mensuelle",
        subtitle="Recettes vs Charges · 12 mois",
        x_label="Mois",
        y_label="Montant (€)",
        series=series,
    )
