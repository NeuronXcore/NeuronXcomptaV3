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
