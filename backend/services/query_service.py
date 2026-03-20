"""
Service pour les requêtes analytiques personnalisées.
Gère l'exécution de requêtes flexibles et la sauvegarde/chargement de presets.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from backend.core.config import COMPTA_ANALYTIQUE_DIR
from backend.services import operation_service

logger = logging.getLogger(__name__)

QUERIES_DIR = COMPTA_ANALYTIQUE_DIR / "queries"


def _ensure_queries_dir():
    QUERIES_DIR.mkdir(parents=True, exist_ok=True)


def _load_all_operations() -> list[dict]:
    """Charge toutes les opérations de tous les fichiers."""
    files = operation_service.list_operation_files()
    all_ops = []
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            all_ops.extend(ops)
        except Exception:
            continue
    return all_ops


def execute_query(filters: dict) -> dict:
    """Exécute une requête avec filtres flexibles."""
    all_ops = _load_all_operations()
    if not all_ops:
        return {"total_debit": 0, "total_credit": 0, "total_net": 0, "total_ops": 0, "rows": []}

    df = pd.DataFrame(all_ops)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df["Crédit"] = pd.to_numeric(df.get("Crédit", 0), errors="coerce").fillna(0)
    df["Débit"] = pd.to_numeric(df.get("Débit", 0), errors="coerce").fillna(0)

    # Filtres catégories
    categories = filters.get("categories", [])
    if categories:
        df = df[df["Catégorie"].isin(categories)]

    # Filtres dates
    date_from = filters.get("date_from")
    date_to = filters.get("date_to")
    if date_from:
        df = df[df["Date"] >= pd.to_datetime(date_from)]
    if date_to:
        df = df[df["Date"] <= pd.to_datetime(date_to)]

    # Filtres montant
    min_amount = filters.get("min_amount")
    max_amount = filters.get("max_amount")
    op_type = filters.get("type", "both")

    if op_type == "debit":
        df = df[df["Débit"] > 0]
        if min_amount is not None:
            df = df[df["Débit"] >= min_amount]
        if max_amount is not None:
            df = df[df["Débit"] <= max_amount]
    elif op_type == "credit":
        df = df[df["Crédit"] > 0]
        if min_amount is not None:
            df = df[df["Crédit"] >= min_amount]
        if max_amount is not None:
            df = df[df["Crédit"] <= max_amount]
    else:
        # both: filter on whichever is non-zero
        if min_amount is not None:
            df = df[(df["Débit"] >= min_amount) | (df["Crédit"] >= min_amount)]
        if max_amount is not None:
            df = df[(df["Débit"] <= max_amount) | (df["Crédit"] <= max_amount)]

    if df.empty:
        return {"total_debit": 0, "total_credit": 0, "total_net": 0, "total_ops": 0, "rows": []}

    # Grouping
    grouping = filters.get("grouping", "category")
    rows = []

    if grouping == "month":
        df["Mois"] = df["Date"].dt.to_period("M").astype(str)
        grouped = df.groupby("Mois").agg(
            debit=("Débit", "sum"),
            credit=("Crédit", "sum"),
            count=("Date", "count"),
        ).reset_index()
        for _, row in grouped.iterrows():
            rows.append({
                "label": row["Mois"],
                "debit": round(float(row["debit"]), 2),
                "credit": round(float(row["credit"]), 2),
                "net": round(float(row["credit"] - row["debit"]), 2),
                "count": int(row["count"]),
            })
        rows.sort(key=lambda r: r["label"])

    elif grouping == "quarter":
        df["Trimestre"] = df["Date"].dt.to_period("Q").astype(str)
        grouped = df.groupby("Trimestre").agg(
            debit=("Débit", "sum"),
            credit=("Crédit", "sum"),
            count=("Date", "count"),
        ).reset_index()
        for _, row in grouped.iterrows():
            rows.append({
                "label": row["Trimestre"],
                "debit": round(float(row["debit"]), 2),
                "credit": round(float(row["credit"]), 2),
                "net": round(float(row["credit"] - row["debit"]), 2),
                "count": int(row["count"]),
            })
        rows.sort(key=lambda r: r["label"])

    elif grouping == "month_category":
        df["Mois"] = df["Date"].dt.to_period("M").astype(str)
        grouped = df.groupby(["Mois", "Catégorie"]).agg(
            debit=("Débit", "sum"),
            credit=("Crédit", "sum"),
            count=("Date", "count"),
        ).reset_index()
        for _, row in grouped.iterrows():
            rows.append({
                "label": row["Mois"],
                "category": row["Catégorie"],
                "debit": round(float(row["debit"]), 2),
                "credit": round(float(row["credit"]), 2),
                "net": round(float(row["credit"] - row["debit"]), 2),
                "count": int(row["count"]),
            })
        rows.sort(key=lambda r: (r["label"], r.get("category", "")))

    else:  # category (default)
        grouped = df.groupby("Catégorie").agg(
            debit=("Débit", "sum"),
            credit=("Crédit", "sum"),
            count=("Date", "count"),
        ).reset_index()
        for _, row in grouped.iterrows():
            rows.append({
                "label": row["Catégorie"],
                "debit": round(float(row["debit"]), 2),
                "credit": round(float(row["credit"]), 2),
                "net": round(float(row["credit"] - row["debit"]), 2),
                "count": int(row["count"]),
            })
        rows.sort(key=lambda r: r["debit"], reverse=True)

    total_debit = round(sum(r["debit"] for r in rows), 2)
    total_credit = round(sum(r["credit"] for r in rows), 2)

    return {
        "total_debit": total_debit,
        "total_credit": total_credit,
        "total_net": round(total_credit - total_debit, 2),
        "total_ops": sum(r["count"] for r in rows),
        "rows": rows,
    }


# ─── Presets CRUD ───

def save_preset(preset_data: dict) -> dict:
    """Sauvegarde un preset de requête."""
    _ensure_queries_dir()
    preset_id = f"query_{uuid.uuid4().hex[:8]}"
    preset = {
        "id": preset_id,
        "name": preset_data.get("name", "Sans nom"),
        "filters": preset_data.get("filters", {}),
        "created_at": datetime.now().isoformat(),
    }
    filepath = QUERIES_DIR / f"{preset_id}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(preset, f, ensure_ascii=False, indent=2)
    return preset


def list_presets() -> list[dict]:
    """Liste tous les presets sauvegardés."""
    _ensure_queries_dir()
    presets = []
    for filepath in sorted(QUERIES_DIR.glob("query_*.json"), reverse=True):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                presets.append(json.load(f))
        except Exception:
            continue
    return presets


def load_preset(preset_id: str) -> dict | None:
    """Charge un preset par ID."""
    filepath = QUERIES_DIR / f"{preset_id}.json"
    if not filepath.exists():
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def delete_preset(preset_id: str) -> bool:
    """Supprime un preset."""
    filepath = QUERIES_DIR / f"{preset_id}.json"
    if filepath.exists():
        filepath.unlink()
        return True
    return False


def get_predefined_queries() -> list[dict]:
    """Retourne les requêtes prédéfinies."""
    return [
        {
            "id": "predefined_top10",
            "name": "Top 10 dépenses",
            "predefined": True,
            "filters": {
                "categories": [],
                "type": "debit",
                "grouping": "category",
            },
        },
        {
            "id": "predefined_quarters",
            "name": "Comparaison trimestres",
            "predefined": True,
            "filters": {
                "categories": [],
                "type": "both",
                "grouping": "quarter",
            },
        },
        {
            "id": "predefined_monthly_balance",
            "name": "Balance mensuelle",
            "predefined": True,
            "filters": {
                "categories": [],
                "type": "both",
                "grouping": "month",
            },
        },
        {
            "id": "predefined_cat_monthly",
            "name": "Catégories par mois",
            "predefined": True,
            "filters": {
                "categories": [],
                "type": "both",
                "grouping": "month_category",
            },
        },
        {
            "id": "predefined_big_expenses",
            "name": "Grosses dépenses (> 1000€)",
            "predefined": True,
            "filters": {
                "categories": [],
                "type": "debit",
                "min_amount": 1000,
                "grouping": "category",
            },
        },
    ]
