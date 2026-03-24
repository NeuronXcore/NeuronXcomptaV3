"""
Service pour l'analytique financière.
Refactoré depuis utils/analytics.py de V2.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def get_category_summary(operations: list[dict]) -> list[dict]:
    """Résumé des dépenses par catégorie."""
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

    return summary.reset_index().to_dict(orient="records")


def get_monthly_trends(operations: list[dict], nb_months: int = 6) -> list[dict]:
    """Tendances mensuelles."""
    df = pd.DataFrame(operations)
    if df.empty:
        return []

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)

    df = df.dropna(subset=["Date"])
    if df.empty:
        return []

    if nb_months > 0:
        start_date = datetime.now() - timedelta(days=30 * nb_months)
        df = df[df["Date"] >= start_date]

    df["Mois"] = df["Date"].dt.to_period("M")
    monthly = df.groupby(["Mois", "Catégorie"]).agg({
        "Crédit": "sum", "Débit": "sum",
    }).reset_index()
    monthly["Mois"] = monthly["Mois"].astype(str)

    return monthly.to_dict(orient="records")


def get_dashboard_data(all_operations: list[dict]) -> dict:
    """Données agrégées pour le dashboard."""
    df = pd.DataFrame(all_operations)
    if df.empty:
        return {
            "total_debit": 0, "total_credit": 0, "solde": 0,
            "nb_operations": 0, "category_summary": [],
            "recent_operations": [], "monthly_evolution": [],
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

    return {
        "total_debit": total_debit,
        "total_credit": total_credit,
        "solde": total_credit - total_debit,
        "nb_operations": len(df),
        "category_summary": cat_summary,
        "recent_operations": recent_list,
        "monthly_evolution": monthly_list,
    }


def get_category_detail(operations: list[dict], category: str) -> dict:
    """Détail d'une catégorie : sous-catégories, évolution mensuelle, opérations."""
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
        ops_list.append({
            "date": str(row.get("Date", ""))[:10],
            "libelle": str(row.get("Libellé", "")),
            "debit": float(row.get("Débit", 0)),
            "credit": float(row.get("Crédit", 0)),
            "sous_categorie": str(row.get("Sous-catégorie", "")) if pd.notna(row.get("Sous-catégorie")) else "",
        })

    return {
        "category": category,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "nb_operations": len(cat_df),
        "subcategories": subcategories,
        "monthly_evolution": monthly_evolution,
        "operations": ops_list,
    }


def detect_anomalies(operations: list[dict], threshold_factor: float = 2.0) -> list[dict]:
    """Détecte les opérations anormales."""
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
    df = pd.DataFrame(operations)
    if df.empty:
        return {"total_debit": 0.0, "total_credit": 0.0, "solde": 0.0, "nb_operations": 0}
    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)
    td = float(df["Débit"].sum())
    tc = float(df["Crédit"].sum())
    return {"total_debit": td, "total_credit": tc, "solde": tc - td, "nb_operations": len(df)}


def compare_periods(ops_a: list[dict], ops_b: list[dict]) -> dict:
    """Compare deux ensembles d'opérations : KPIs + ventilation par catégorie."""
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
        "period_a": totals_a,
        "period_b": totals_b,
        "delta": delta,
        "categories": categories,
    }
