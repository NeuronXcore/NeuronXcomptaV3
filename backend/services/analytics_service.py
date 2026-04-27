"""
Service pour l'analytique financière.
Refactoré depuis utils/analytics.py de V2.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ─── Catégories exclues du calcul charges_pro (BNC) ───
# Ces catégories ne sont PAS comptées dans `bnc.charges_pro` :
#   - "Immobilisations" : la charge a été comptée à l'achat (op bancaire), mais sera
#     déduite via les dotations annuelles → exclure pour éviter le double-comptage.
#   - "Dotations aux amortissements" : ligne virtuelle injectée par le module Amortissements
#     dans le dashboard. Pas une vraie op bancaire → exclure des charges_pro.
#   - "Ventilé" : catégorie parente d'une op ventilée. Les sous-lignes (explosées par
#     `_expand_ventilation` / `_prepare_export_operations`) sont comptées individuellement.
EXCLUDED_FROM_CHARGES_PRO: set[str] = {
    "Immobilisations",
    "Dotations aux amortissements",
    "Ventilé",
}


# ─── BNC — source of truth fiscale unique ───
# Règle : BNC = recettes_pro − charges_pro_déductibles. Les ops "perso" sont HORS assiette.
# Le tri pro/perso/attente + l'explosion des ventilations sont délégués à
# export_service._prepare_export_operations() pour garantir une règle fiscale unique
# entre l'export comptable et l'analytique. Ne pas dupliquer la logique ici.


def _nature_of_category(categorie: str) -> str:
    """Classifie une catégorie en 'pro', 'perso' ou 'attente'. Miroir de export_service._classify_line.

    Les catégories `EXCLUDED_FROM_CHARGES_PRO` sont classées en 'attente' (visibles
    dans l'export comptable mais hors `charges_pro` BNC).
    """
    cat = (categorie or "").strip()
    cat_lower = cat.lower()
    if cat_lower == "perso":
        return "perso"
    if cat == "" or cat_lower == "autres" or cat in EXCLUDED_FROM_CHARGES_PRO:
        return "attente"
    return "pro"


def _bnc_metrics_from_operations(
    operations: list[dict],
    ca_liasse: Optional[float] = None,
) -> dict:
    """Calcule la structure 4-blocs {bnc, perso, attente, tresorerie} à partir des opérations brutes.

    Délègue le tri pro/perso/attente + explosion ventilations à export_service._prepare_export_operations.
    Injecte `ca_liasse` comme base de recettes si fourni (→ base_recettes='liasse'), sinon bancaire.

    Note : `charges_pro` intègre déjà la déduction `csg_non_deductible` (faite dans _prepare_export_operations).
    Ne pas la resoustraire.
    """
    # Import local pour éviter circular import potentiel
    from backend.services import export_service

    split = export_service._prepare_export_operations(operations or [], "")
    pro_ops = split["pro"]
    perso_ops = split["perso"]
    attente_ops = split["attente"]
    totals = split["totals"]

    recettes_pro_bancaires = float(totals.get("recettes_pro", 0.0))
    charges_pro = float(totals.get("charges_pro", 0.0))

    if ca_liasse is not None:
        recettes_pro = float(ca_liasse)
        base_recettes = "liasse"
    else:
        recettes_pro = recettes_pro_bancaires
        base_recettes = "bancaire"

    solde_bnc = recettes_pro - charges_pro

    # Trésorerie = tout confondu (pro + perso + attente)
    total_debit = sum(
        float(line.get("Debit", 0) or 0)
        for group in (pro_ops, perso_ops, attente_ops)
        for line in group
    )
    total_credit = sum(
        float(line.get("Credit", 0) or 0)
        for group in (pro_ops, perso_ops, attente_ops)
        for line in group
    )
    nb_total = len(pro_ops) + len(perso_ops) + len(attente_ops)

    return {
        "bnc": {
            "recettes_pro": round(recettes_pro, 2),
            "recettes_pro_bancaires": round(recettes_pro_bancaires, 2),
            "ca_liasse": round(float(ca_liasse), 2) if ca_liasse is not None else None,
            "base_recettes": base_recettes,
            "charges_pro": round(charges_pro, 2),
            "solde_bnc": round(solde_bnc, 2),
            "nb_ops_pro": len(pro_ops),
        },
        "perso": {
            "total_debit": round(float(totals.get("debit_perso", 0.0)), 2),
            "total_credit": round(float(totals.get("credit_perso", 0.0)), 2),
            "nb_ops": len(perso_ops),
        },
        "attente": {
            "total_debit": round(float(totals.get("debit_attente", 0.0)), 2),
            "total_credit": round(float(totals.get("credit_attente", 0.0)), 2),
            "nb_ops": len(attente_ops),
        },
        "tresorerie": {
            "total_debit": round(total_debit, 2),
            "total_credit": round(total_credit, 2),
            "solde": round(total_credit - total_debit, 2),
            "nb_ops": nb_total,
        },
    }


def _expand_ventilation(operations: list[dict]) -> list[dict]:
    """Explose les opérations ventilées en lignes virtuelles pour l'analytique.

    Pour chaque op ventilée, crée une ligne par sous-ligne avec le montant
    distribué sur Débit ou Crédit selon le sens de l'opération parente.
    Les ops non ventilées passent telles quelles.
    La catégorie "Ventilé" est exclue des résultats.
    """
    expanded = []
    for op in operations:
        vlines = op.get("ventilation", [])
        if vlines:
            is_debit = (op.get("Débit", 0) or 0) > 0
            for vl in vlines:
                virtual = {
                    "Date": op.get("Date", ""),
                    "Libellé": vl.get("libelle") or op.get("Libellé", ""),
                    "Catégorie": vl.get("categorie", ""),
                    "Sous-catégorie": vl.get("sous_categorie", ""),
                    "Débit": vl.get("montant", 0) if is_debit else 0,
                    "Crédit": vl.get("montant", 0) if not is_debit else 0,
                    "Justificatif": bool(vl.get("justificatif")),
                    "lettre": vl.get("lettre", False),
                }
                expanded.append(virtual)
        else:
            cat = op.get("Catégorie", "") or ""
            if cat != "Ventilé":
                expanded.append(op)
    return expanded


def get_category_summary(operations: list[dict]) -> list[dict]:
    """Résumé des dépenses par catégorie."""
    operations = _expand_ventilation(operations)
    df = pd.DataFrame(operations)
    if df.empty:
        return []

    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)
    df["Montant_Net"] = df["Crédit"] - df["Débit"]

    summary = df.groupby("Catégorie").agg({
        "Crédit": "sum",
        "Débit": "sum",
        "Montant_Net": "sum",
        "Date": "count",
    }).rename(columns={"Date": "Nombre_Opérations"})

    total_debit = summary["Débit"].sum()
    if total_debit > 0:
        summary["Pourcentage_Dépenses"] = (summary["Débit"] / total_debit * 100).round(2)
    else:
        summary["Pourcentage_Dépenses"] = 0

    records = summary.reset_index().to_dict(orient="records")
    for row in records:
        row["nature"] = _nature_of_category(row.get("Catégorie", ""))
    return records


def get_monthly_trends(operations: list[dict], nb_months: int = 6) -> dict:
    """Tendances mensuelles par catégorie, séparées par nature (pro / perso / all).

    Retourne 3 listes parallèles permettant au frontend de piloter les graphes
    selon le segmented control Pro/Perso/Tout :
        - trends_all  : toutes les ops (équivalent de l'ancien retour plat)
        - trends_pro  : uniquement catégories pro (hors perso, hors attente)
        - trends_perso: uniquement ops perso

    Chaque élément : {Mois: "YYYY-MM", Catégorie: str, Crédit: float, Débit: float}.
    """
    operations = _expand_ventilation(operations)
    df = pd.DataFrame(operations)
    if df.empty:
        return {"trends_all": [], "trends_pro": [], "trends_perso": []}

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)

    df = df.dropna(subset=["Date"])
    if df.empty:
        return {"trends_all": [], "trends_pro": [], "trends_perso": []}

    if nb_months > 0:
        start_date = datetime.now() - timedelta(days=30 * nb_months)
        df = df[df["Date"] >= start_date]

    df["Mois"] = df["Date"].dt.to_period("M")
    monthly = df.groupby(["Mois", "Catégorie"]).agg({
        "Crédit": "sum", "Débit": "sum",
    }).reset_index()
    monthly["Mois"] = monthly["Mois"].astype(str)

    records = monthly.to_dict(orient="records")
    for row in records:
        row["nature"] = _nature_of_category(row.get("Catégorie", ""))

    trends_pro = [r for r in records if r["nature"] == "pro"]
    trends_perso = [r for r in records if r["nature"] == "perso"]

    return {
        "trends_all": records,
        "trends_pro": trends_pro,
        "trends_perso": trends_perso,
    }


def get_dashboard_data(
    all_operations: list[dict],
    ca_liasse: Optional[float] = None,
    year_full: Optional[int] = None,
) -> dict:
    """Données agrégées pour le dashboard.

    Retourne les champs plats historiques (`total_debit`, `total_credit`, `solde`, ...)
    ET la structure 4-blocs BNC (`bnc`, `perso`, `attente`, `tresorerie`) pour le nouveau modèle.

    Si `ca_liasse` fourni, `bnc.recettes_pro = ca_liasse` et `bnc.base_recettes = 'liasse'`,
    sinon `bnc.recettes_pro = sum(crédits pro)` et `bnc.base_recettes = 'bancaire'`.

    Si `year_full` fourni (année complète, sans filtre mois/trimestre), enrichit le bloc BNC
    avec `dotations_amortissements` et `forfaits_total` annuels via `bnc_service.compute_bnc`,
    et `solde_bnc` reflète recettes − charges − dotations − forfaits. Sinon ces champs valent 0.0.
    """
    # Calcul BNC sur opérations BRUTES (ventilations explosées à l'intérieur de _bnc_metrics_from_operations)
    bnc_metrics = _bnc_metrics_from_operations(all_operations or [], ca_liasse=ca_liasse)

    # Enrichissement annuel (dotations + forfaits) — strict sur année complète uniquement
    if year_full is not None:
        from backend.services import bnc_service
        try:
            breakdown = bnc_service.compute_bnc(year_full, ca_liasse=ca_liasse)
            bnc_metrics["bnc"]["dotations_amortissements"] = breakdown.dotations_amortissements
            bnc_metrics["bnc"]["forfaits_total"] = breakdown.forfaits_total
            bnc_metrics["bnc"]["solde_bnc"] = breakdown.bnc
        except Exception as e:
            logger.warning(f"bnc_service.compute_bnc({year_full}) failed: {e}")
            bnc_metrics["bnc"]["dotations_amortissements"] = 0.0
            bnc_metrics["bnc"]["forfaits_total"] = 0.0
    else:
        bnc_metrics["bnc"]["dotations_amortissements"] = 0.0
        bnc_metrics["bnc"]["forfaits_total"] = 0.0

    all_operations = _expand_ventilation(all_operations)
    df = pd.DataFrame(all_operations)
    if df.empty:
        return {
            "total_debit": 0, "total_credit": 0, "solde": 0,
            "nb_operations": 0, "category_summary": [],
            "recent_operations": [], "monthly_evolution": [],
            "by_source": [],
            "bnc": bnc_metrics["bnc"],
            "perso": bnc_metrics["perso"],
            "attente": bnc_metrics["attente"],
            "tresorerie": bnc_metrics["tresorerie"],
        }

    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)
    df["Date"] = pd.to_datetime(df.get("Date"), errors="coerce")

    total_debit = float(df["Débit"].sum())
    total_credit = float(df["Crédit"].sum())

    # Opérations récentes
    recent = df.sort_values("Date", ascending=False).head(20)
    recent_list = recent.fillna("").to_dict(orient="records")
    # Convertir les dates en string pour la sérialisation
    for op in recent_list:
        if "Date" in op and hasattr(op["Date"], "isoformat"):
            op["Date"] = op["Date"].isoformat()

    # Résumé par catégorie
    cat_summary = get_category_summary(all_operations)

    # Ligne virtuelle "Dotations aux amortissements" (uniquement année complète + dotations > 0)
    dotations_virtuelle = float(bnc_metrics["bnc"].get("dotations_amortissements", 0.0) or 0.0)
    if year_full is not None and dotations_virtuelle > 0:
        try:
            from backend.services import amortissement_service
            dotations_data = amortissement_service.get_dotations(year_full)
            nb_immos = len(dotations_data.get("detail", []))
        except Exception:
            nb_immos = 0
        cat_summary.append({
            "Catégorie": "Dotations aux amortissements",
            "Crédit": 0.0,
            "Débit": dotations_virtuelle,
            "Montant_Net": -dotations_virtuelle,
            "Nombre_Opérations": nb_immos,
            "Pourcentage_Dépenses": 0,  # recalculé ci-dessous si pertinent
            "nature": "pro",  # affichée dans la vue Pro
            "is_virtual": True,
            "source": "amortissement",
        })

    # Évolution mensuelle
    df_dated = df.dropna(subset=["Date"])
    if not df_dated.empty:
        df_dated["Mois"] = df_dated["Date"].dt.to_period("M")
        monthly = df_dated.groupby("Mois").agg({
            "Crédit": "sum", "Débit": "sum",
        }).reset_index()
        monthly["Solde"] = monthly["Crédit"] - monthly["Débit"]
        monthly["Solde_Cumule"] = monthly["Solde"].cumsum()
        monthly["Mois"] = monthly["Mois"].astype(str)
        monthly_list = monthly.to_dict(orient="records")
    else:
        monthly_list = []

    # Répartition par type d'opération (source: bancaire vs note_de_frais)
    by_source: list[dict] = []
    if "source" in df.columns:
        # Normalise None/NaN/vide en "bancaire" (op classique sans source)
        df["__src__"] = df["source"].fillna("").replace("", "bancaire")
    else:
        df["__src__"] = "bancaire"
    grouped = df.groupby("__src__").agg(
        debit=("Débit", "sum"),
        credit=("Crédit", "sum"),
        count=("__src__", "size"),
    ).reset_index()
    for _, row in grouped.iterrows():
        by_source.append({
            "source": str(row["__src__"]),
            "debit": float(row["debit"]),
            "credit": float(row["credit"]),
            "count": int(row["count"]),
        })

    return {
        "total_debit": total_debit,
        "total_credit": total_credit,
        "solde": total_credit - total_debit,
        "nb_operations": len(df),
        "category_summary": cat_summary,
        "recent_operations": recent_list,
        "monthly_evolution": monthly_list,
        "by_source": by_source,
        "bnc": bnc_metrics["bnc"],
        "perso": bnc_metrics["perso"],
        "attente": bnc_metrics["attente"],
        "tresorerie": bnc_metrics["tresorerie"],
    }


def get_category_detail(operations: list[dict], category: str) -> dict:
    """Détail d'une catégorie : sous-catégories, évolution mensuelle, opérations."""
    operations = _expand_ventilation(operations)
    df = pd.DataFrame(operations)
    if df.empty:
        return {
            "category": category,
            "total_debit": 0, "total_credit": 0, "nb_operations": 0,
            "subcategories": [], "monthly_evolution": [], "operations": [],
        }

    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)

    # Filter by category
    cat_df = df[df["Catégorie"] == category].copy()
    if cat_df.empty:
        return {
            "category": category,
            "total_debit": 0, "total_credit": 0, "nb_operations": 0,
            "subcategories": [], "monthly_evolution": [], "operations": [],
        }

    total_debit = float(cat_df["Débit"].sum())
    total_credit = float(cat_df["Crédit"].sum())

    # CSG/CRDS non déductible agrégé (pour catégories URSSAF/Cotisations)
    total_csg_non_deductible = 0.0
    if "csg_non_deductible" in cat_df.columns:
        csg_col = pd.to_numeric(cat_df["csg_non_deductible"], errors="coerce").fillna(0)
        total_csg_non_deductible = float(csg_col.sum())

    # Subcategories
    sub_col = "Sous-catégorie"
    if sub_col in cat_df.columns:
        cat_df[sub_col] = cat_df[sub_col].fillna("Non classé")
        sub_agg = cat_df.groupby(sub_col).agg({
            "Débit": "sum", "Crédit": "sum", "Date": "count",
        }).rename(columns={"Date": "count"}).reset_index()
        sub_agg.rename(columns={sub_col: "name", "Débit": "debit", "Crédit": "credit"}, inplace=True)
        subcategories = sub_agg.to_dict(orient="records")
    else:
        subcategories = []

    # Monthly evolution
    cat_df["Date_parsed"] = pd.to_datetime(cat_df.get("Date"), errors="coerce")
    dated = cat_df.dropna(subset=["Date_parsed"])
    if not dated.empty:
        dated = dated.copy()
        dated["Mois"] = dated["Date_parsed"].dt.to_period("M")
        monthly = dated.groupby("Mois").agg({
            "Débit": "sum", "Crédit": "sum",
        }).reset_index()
        monthly["Mois"] = monthly["Mois"].astype(str)
        monthly.rename(columns={"Mois": "month", "Débit": "debit", "Crédit": "credit"}, inplace=True)
        monthly_evolution = monthly.to_dict(orient="records")
    else:
        monthly_evolution = []

    # Last 50 operations
    ops_sorted = cat_df.sort_values("Date", ascending=False).head(50)
    ops_list = []
    for _, row in ops_sorted.iterrows():
        op_entry: dict = {
            "date": str(row.get("Date", ""))[:10],
            "libelle": str(row.get("Libellé", "")),
            "debit": float(row.get("Débit", 0)),
            "credit": float(row.get("Crédit", 0)),
            "sous_categorie": str(row.get("Sous-catégorie", "")) if pd.notna(row.get("Sous-catégorie")) else "",
        }
        csg_nd = row.get("csg_non_deductible")
        if csg_nd is not None and pd.notna(csg_nd) and float(csg_nd) > 0:
            op_entry["csg_non_deductible"] = float(csg_nd)
        ops_list.append(op_entry)

    result: dict = {
        "category": category,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "nb_operations": len(cat_df),
        "subcategories": subcategories,
        "monthly_evolution": monthly_evolution,
        "operations": ops_list,
    }
    if total_csg_non_deductible > 0:
        result["total_csg_non_deductible"] = round(total_csg_non_deductible, 2)
        result["total_deductible"] = round(total_debit - total_csg_non_deductible, 2)
    return result


def detect_anomalies(operations: list[dict], threshold_factor: float = 2.0) -> list[dict]:
    """Détecte les opérations anormales."""
    operations = _expand_ventilation(operations)
    df = pd.DataFrame(operations)
    if df.empty:
        return []

    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)

    stats = df.groupby("Catégorie")["Débit"].agg(["mean", "std"]).reset_index()
    stats["threshold"] = stats["mean"] + stats["std"] * threshold_factor

    merged = pd.merge(df, stats, on="Catégorie", how="left")
    anomalies = merged[merged["Débit"] > merged["threshold"]].copy()

    if anomalies.empty:
        return []

    anomalies = anomalies[["Date", "Libellé", "Débit", "Catégorie", "mean", "std"]]
    anomalies.rename(columns={"mean": "Moyenne", "std": "Écart_Type"}, inplace=True)
    anomalies["Pourcentage_Sup_Moyenne"] = (
        (anomalies["Débit"] / anomalies["Moyenne"] - 1) * 100
    ).round(2)

    return anomalies.to_dict(orient="records")


def _period_totals(operations: list[dict]) -> dict:
    """Calcule les totaux pour une liste d'opérations."""
    operations = _expand_ventilation(operations)
    df = pd.DataFrame(operations)
    if df.empty:
        return {"total_debit": 0.0, "total_credit": 0.0, "solde": 0.0, "nb_operations": 0}
    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)
    td = float(df["Débit"].sum())
    tc = float(df["Crédit"].sum())
    return {"total_debit": td, "total_credit": tc, "solde": tc - td, "nb_operations": len(df)}


def compare_periods(
    ops_a: list[dict],
    ops_b: list[dict],
    ca_liasse_a: Optional[float] = None,
    ca_liasse_b: Optional[float] = None,
) -> dict:
    """Compare deux ensembles d'opérations : KPIs BNC + ventilation par catégorie.

    Enrichi avec les blocs bnc/perso/tresorerie par période + delta BNC + nature par catégorie.
    """
    totals_a = _period_totals(ops_a)
    totals_b = _period_totals(ops_b)

    # Delta percentages
    def _delta_pct(a: float, b: float) -> Optional[float]:
        if a == 0:
            return None
        return round((b - a) / abs(a) * 100, 2)

    delta = {
        "total_debit": _delta_pct(totals_a["total_debit"], totals_b["total_debit"]),
        "total_credit": _delta_pct(totals_a["total_credit"], totals_b["total_credit"]),
        "solde": _delta_pct(abs(totals_a["solde"]) if totals_a["solde"] != 0 else 1, totals_b["solde"]),
        "nb_operations": _delta_pct(totals_a["nb_operations"], totals_b["nb_operations"]),
    }

    # BNC metrics par période
    bnc_a = _bnc_metrics_from_operations(ops_a or [], ca_liasse=ca_liasse_a)
    bnc_b = _bnc_metrics_from_operations(ops_b or [], ca_liasse=ca_liasse_b)

    # Delta BNC
    delta["bnc_solde"] = bnc_b["bnc"]["solde_bnc"] - bnc_a["bnc"]["solde_bnc"]
    delta["recettes_pro"] = bnc_b["bnc"]["recettes_pro"] - bnc_a["bnc"]["recettes_pro"]
    delta["charges_pro"] = bnc_b["bnc"]["charges_pro"] - bnc_a["bnc"]["charges_pro"]
    delta["perso_debit"] = bnc_b["perso"]["total_debit"] - bnc_a["perso"]["total_debit"]

    # Enrichir totals avec bnc/perso/tresorerie
    period_a = {**totals_a, "bnc": bnc_a["bnc"], "perso": bnc_a["perso"], "tresorerie": bnc_a["tresorerie"]}
    period_b = {**totals_b, "bnc": bnc_b["bnc"], "perso": bnc_b["perso"], "tresorerie": bnc_b["tresorerie"]}

    # Category comparison
    cat_a = get_category_summary(ops_a)
    cat_b = get_category_summary(ops_b)

    cat_a_map = {c["Catégorie"]: c for c in cat_a}
    cat_b_map = {c["Catégorie"]: c for c in cat_b}
    all_cats = sorted(set(list(cat_a_map.keys()) + list(cat_b_map.keys())))

    categories = []
    for cat in all_cats:
        a = cat_a_map.get(cat, {"Débit": 0, "Crédit": 0, "Nombre_Opérations": 0})
        b = cat_b_map.get(cat, {"Débit": 0, "Crédit": 0, "Nombre_Opérations": 0})
        a_debit = float(a.get("Débit", 0))
        b_debit = float(b.get("Débit", 0))
        categories.append({
            "category": cat,
            "nature": _nature_of_category(cat),
            "a_debit": a_debit,
            "a_credit": float(a.get("Crédit", 0)),
            "a_ops": int(a.get("Nombre_Opérations", 0)),
            "b_debit": b_debit,
            "b_credit": float(b.get("Crédit", 0)),
            "b_ops": int(b.get("Nombre_Opérations", 0)),
            "delta_pct": _delta_pct(a_debit, b_debit),
        })

    # Sort by absolute delta
    categories.sort(key=lambda c: abs(c.get("delta_pct") or 0), reverse=True)

    return {
        "period_a": period_a,
        "period_b": period_b,
        "delta": delta,
        "categories": categories,
    }


# ─── Year Overview (Dashboard V2) ───

def get_year_overview(year: int) -> dict:
    """Cockpit annuel : mois, KPIs, alertes, progression, activité.

    Les KPIs BNC excluent strictement les ops perso (règle fiscale unique).
    Si la liasse fiscale SCP est saisie pour l'année, `kpis.total_recettes = ca_liasse`
    et `kpis.base_recettes = 'liasse'` ; sinon base bancaire (proxy provisoire).
    """
    from backend.core.config import (
        MOIS_FR, EXPORTS_DIR, IMPORTS_OPERATIONS_DIR,
        JUSTIFICATIFS_TRAITES_DIR, ensure_directories,
    )
    from backend.services import operation_service, cloture_service, liasse_scp_service
    import os

    ensure_directories()

    # CA liasse éventuel (None si pas saisi pour cette année)
    ca_liasse = liasse_scp_service.get_ca_for_bnc(year)

    # a) Données mensuelles
    annual_status = cloture_service.get_annual_status(year)
    files = operation_service.list_operation_files()
    files_by_month: dict[int, list[dict]] = {}
    for f in files:
        if f.get("year") == year and f.get("month"):
            files_by_month.setdefault(f["month"], []).append(f)

    now = datetime.now()
    current_month = now.month if year == now.year else (12 if year < now.year else 0)

    mois_data = []
    for m_status in annual_status:
        m = m_status["mois"]
        month_files = files_by_month.get(m, [])

        # Charger les opérations pour calculer taux_categorisation et taux_rapprochement
        all_ops: list[dict] = []
        for mf in month_files:
            try:
                ops = operation_service.load_operations(mf["filename"])
                all_ops.extend(ops)
            except Exception:
                pass

        nb = len(all_ops)
        nb_categorised = sum(
            1 for op in all_ops
            if op.get("Catégorie") and op["Catégorie"] not in ("", "Autres")
        ) if nb > 0 else 0
        nb_debit_ops = sum(1 for op in all_ops if op.get("Débit", 0) > 0)
        nb_rapproches = sum(
            1 for op in all_ops
            if op.get("Débit", 0) > 0 and op.get("Justificatif", False)
        )

        taux_cat = nb_categorised / nb if nb > 0 else 0.0
        taux_rapp = nb_rapproches / nb_debit_ops if nb_debit_ops > 0 else 0.0

        # Trésorerie brute (affichage des cards mensuelles du dashboard)
        total_credit = sum(op.get("Crédit", 0) for op in all_ops)
        total_debit = sum(op.get("Débit", 0) - (op.get("csg_non_deductible") or 0) for op in all_ops)

        # BNC mensuel — base bancaire (ca_liasse est annuel, pas mensuel)
        bnc_m = _bnc_metrics_from_operations(all_ops, ca_liasse=None)

        # Export exists?
        has_export = False
        if EXPORTS_DIR.exists():
            has_export = len(list(EXPORTS_DIR.glob(f"export_{year}_{m:02d}_*"))) > 0

        mois_data.append({
            "mois": m,
            "label": MOIS_FR[m - 1].capitalize(),
            "has_releve": m_status["has_releve"],
            "nb_operations": m_status["nb_operations"],
            "taux_lettrage": m_status["taux_lettrage"],
            "taux_justificatifs": m_status["taux_justificatifs"],
            "taux_categorisation": round(taux_cat, 4),
            "taux_rapprochement": round(taux_rapp, 4),
            "has_export": has_export,
            "total_credit": round(total_credit, 2),
            "total_debit": round(total_debit, 2),
            "bnc_recettes_pro": bnc_m["bnc"]["recettes_pro_bancaires"],
            "bnc_charges_pro": bnc_m["bnc"]["charges_pro"],
            "bnc_solde": bnc_m["bnc"]["solde_bnc"],
            "filename": m_status.get("filename"),
        })

    # b) KPIs annuels — BNC propre (exclut perso, applique CA liasse si saisi)
    recettes_pro_bancaires = sum(m["bnc_recettes_pro"] for m in mois_data)
    total_charges = sum(m["bnc_charges_pro"] for m in mois_data)

    if ca_liasse is not None:
        total_recettes = float(ca_liasse)
        base_recettes = "liasse"
    else:
        total_recettes = recettes_pro_bancaires
        base_recettes = "bancaire"

    # Dotations + forfaits annuels via bnc_service (source unique fiscale)
    from backend.services import bnc_service
    try:
        bnc_breakdown = bnc_service.compute_bnc(year, ca_liasse=ca_liasse)
        dotations_year = bnc_breakdown.dotations_amortissements
        forfaits_year = bnc_breakdown.forfaits_total
        bnc_estime = bnc_breakdown.bnc
    except Exception as e:
        logger.warning(f"bnc_service.compute_bnc({year}) failed in year_overview: {e}")
        dotations_year = 0.0
        forfaits_year = 0.0
        bnc_estime = total_recettes - total_charges

    nb_operations = sum(m["nb_operations"] for m in mois_data)
    nb_mois_actifs = sum(1 for m in mois_data if m["nb_operations"] > 0)
    # bnc_mensuel = vraie série BNC mensuelle (bancaire — la liasse étant annuelle par définition)
    bnc_mensuel = [m["bnc_solde"] for m in mois_data]

    kpis = {
        "total_recettes": round(total_recettes, 2),
        "total_charges": round(total_charges, 2),
        "dotations_amortissements": round(dotations_year, 2),
        "forfaits_total": round(forfaits_year, 2),
        "bnc_estime": round(bnc_estime, 2),
        "nb_operations": nb_operations,
        "nb_mois_actifs": nb_mois_actifs,
        "bnc_mensuel": [round(v, 2) for v in bnc_mensuel],
        "ca_liasse": round(float(ca_liasse), 2) if ca_liasse is not None else None,
        "base_recettes": base_recettes,
        "recettes_pro_bancaires": round(recettes_pro_bancaires, 2),
    }

    # c) Delta N-1 — utilise le BNC propre (exclut perso)
    delta_n1 = None
    prev_year = year - 1
    prev_files = [f for f in files if f.get("year") == prev_year]
    if prev_files:
        prev_all_ops: list[dict] = []
        for pf in prev_files:
            try:
                prev_all_ops.extend(operation_service.load_operations(pf["filename"]))
            except Exception:
                pass
        prev_ca_liasse = liasse_scp_service.get_ca_for_bnc(prev_year)
        prev_bnc_m = _bnc_metrics_from_operations(prev_all_ops, ca_liasse=prev_ca_liasse)
        prev_credit = prev_bnc_m["bnc"]["recettes_pro"]
        prev_debit = prev_bnc_m["bnc"]["charges_pro"]
        prev_bnc = prev_bnc_m["bnc"]["solde_bnc"]
        delta_n1 = {
            "prev_total_recettes": round(prev_credit, 2),
            "prev_total_charges": round(prev_debit, 2),
            "prev_bnc": round(prev_bnc, 2),
            "delta_recettes_pct": round((total_recettes - prev_credit) / prev_credit * 100, 1) if prev_credit else 0,
            "delta_charges_pct": round((total_charges - prev_debit) / prev_debit * 100, 1) if prev_debit else 0,
            "delta_bnc_pct": round((bnc_estime - prev_bnc) / abs(prev_bnc) * 100, 1) if prev_bnc else 0,
        }

    # d) Alertes pondérées
    alertes = []
    for md in mois_data:
        m = md["mois"]
        if m > current_month:
            continue  # pas d'alerte pour les mois futurs

        if not md["has_releve"]:
            alertes.append({
                "type": "releve_manquant", "mois": m, "year": year,
                "impact": 100, "message": "Relevé bancaire manquant",
                "detail": f"{md['label']} — aucun relevé importé",
                "count": 0,
            })
            continue  # pas d'autres alertes sans relevé

        if md["taux_lettrage"] >= 1.0 and md["taux_justificatifs"] >= 1.0 and not md["has_export"]:
            alertes.append({
                "type": "export_manquant", "mois": m, "year": year,
                "impact": 80, "message": "Export comptable manquant",
                "detail": f"{md['label']} — mois complet, export non généré",
                "count": 0,
            })

        if md["taux_justificatifs"] < 1.0:
            nb_manquants = md["nb_operations"] - int(md["nb_operations"] * md["taux_justificatifs"])
            alertes.append({
                "type": "justificatifs_manquants", "mois": m, "year": year,
                "impact": min(99, 55 + nb_manquants), "message": "Justificatifs manquants",
                "detail": f"{md['label']} — {nb_manquants} justificatif(s) manquant(s)",
                "count": nb_manquants,
            })

        if md["taux_categorisation"] < 1.0:
            nb_non_cat = md["nb_operations"] - int(md["nb_operations"] * md["taux_categorisation"])
            alertes.append({
                "type": "categorisation_incomplete", "mois": m, "year": year,
                "impact": 40, "message": "Catégorisation incomplète",
                "detail": f"{md['label']} — {nb_non_cat} opération(s) non catégorisée(s)",
                "count": nb_non_cat,
            })

        if md["taux_lettrage"] < 1.0:
            nb_non_let = md["nb_operations"] - int(md["nb_operations"] * md["taux_lettrage"])
            alertes.append({
                "type": "lettrage_incomplet", "mois": m, "year": year,
                "impact": 25, "message": "Lettrage incomplet",
                "detail": f"{md['label']} — {nb_non_let} opération(s) non lettrée(s)",
                "count": nb_non_let,
            })

    alertes.sort(key=lambda a: a["impact"], reverse=True)
    alertes = alertes[:10]

    # e) Progression globale
    mois_actifs = [m for m in mois_data if m["nb_operations"] > 0]
    nb_active = len(mois_actifs) or 1

    criteres = {
        "releves": sum(1 for m in mois_data if m["has_releve"]) / 12 * 100,
        "categorisation": sum(m["taux_categorisation"] for m in mois_actifs) / nb_active * 100 if mois_actifs else 0,
        "lettrage": sum(m["taux_lettrage"] for m in mois_actifs) / nb_active * 100 if mois_actifs else 0,
        "justificatifs": sum(m["taux_justificatifs"] for m in mois_actifs) / nb_active * 100 if mois_actifs else 0,
        "rapprochement": sum(m["taux_rapprochement"] for m in mois_actifs) / nb_active * 100 if mois_actifs else 0,
        "exports": sum(1 for m in mois_data if m["has_export"]) / 12 * 100,
    }
    progression_globale = sum(criteres.values()) / len(criteres) if criteres else 0

    progression = {
        "globale": round(progression_globale, 1),
        "criteres": {k: round(v, 1) for k, v in criteres.items()},
    }

    # f) Activité récente
    activite = []
    # Imports
    if IMPORTS_OPERATIONS_DIR.exists():
        for f in sorted(IMPORTS_OPERATIONS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:5]:
            if f.suffix == ".json":
                stat = f.stat()
                activite.append({
                    "type": "import",
                    "message": f"Import relevé — {f.name}",
                    "timestamp": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "detail": f.name,
                })

    # Exports
    if EXPORTS_DIR.exists():
        for f in sorted(EXPORTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:3]:
            if f.suffix == ".zip":
                stat = f.stat()
                activite.append({
                    "type": "export",
                    "message": f"Export comptable — {f.name}",
                    "timestamp": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "detail": f.name,
                })

    # Justificatifs rapprochés
    if JUSTIFICATIFS_TRAITES_DIR.exists():
        for f in sorted(JUSTIFICATIFS_TRAITES_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:3]:
            if f.suffix == ".pdf":
                stat = f.stat()
                activite.append({
                    "type": "rapprochement",
                    "message": f"Justificatif rapproché — {f.name}",
                    "timestamp": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "detail": f.name,
                })

    activite.sort(key=lambda a: a["timestamp"], reverse=True)
    activite = activite[:10]

    return {
        "year": year,
        "mois": mois_data,
        "kpis": kpis,
        "delta_n1": delta_n1,
        "alertes": alertes,
        "progression": progression,
        "activite_recente": activite,
        "pending_reports": _get_pending_reports_safe(year),
    }


def _get_pending_reports_safe(year: int) -> list[dict]:
    """Get pending reports, return empty list on error."""
    try:
        from backend.services.report_service import get_pending_reports
        return get_pending_reports(year)
    except Exception:
        return []
