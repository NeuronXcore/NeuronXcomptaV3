"""Router pour l'analytique et le dashboard."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from backend.services import operation_service, analytics_service

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _load_all_ops(
    year: Optional[int] = None,
    quarter: Optional[int] = None,
    month: Optional[int] = None,
) -> list[dict]:
    """Load all operations, optionally filtered by year/quarter/month."""
    files = operation_service.list_operation_files()
    if year is not None:
        files = [f for f in files if f.get("year") == year]
    all_ops = []
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            all_ops.extend(ops)
        except Exception:
            continue

    # Filter by quarter or month on the Date field
    if quarter is not None or month is not None:
        filtered = []
        for op in all_ops:
            date_str = op.get("Date", "")
            if not date_str or len(date_str) < 7:
                continue
            try:
                op_month = int(date_str[5:7])
            except (ValueError, IndexError):
                continue

            if month is not None:
                if op_month != month:
                    continue
            elif quarter is not None:
                q_start = (quarter - 1) * 3 + 1
                q_end = q_start + 2
                if not (q_start <= op_month <= q_end):
                    continue
            filtered.append(op)
        return filtered

    return all_ops


@router.get("/dashboard")
async def get_dashboard(
    year: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    """Données agrégées pour le dashboard, filtrées par période."""
    all_ops = _load_all_ops(year, quarter, month)
    return analytics_service.get_dashboard_data(all_ops)


@router.get("/summary")
async def get_summary(
    year: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    """Résumé par catégorie, filtrées par période."""
    all_ops = _load_all_ops(year, quarter, month)
    return analytics_service.get_category_summary(all_ops)


@router.get("/trends")
async def get_trends(
    months: int = 6,
    year: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    """Tendances mensuelles, filtrées par période."""
    all_ops = _load_all_ops(year, quarter, month)
    return analytics_service.get_monthly_trends(all_ops, months)


@router.get("/anomalies")
async def get_anomalies(
    threshold: float = 2.0,
    year: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    """Détecte les anomalies, filtrées par période."""
    all_ops = _load_all_ops(year, quarter, month)
    return analytics_service.detect_anomalies(all_ops, threshold)


@router.get("/category-detail")
async def get_category_detail(
    category: str = Query(...),
    year: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    """Détail d'une catégorie : sous-catégories, évolution, opérations."""
    all_ops = _load_all_ops(year, quarter, month)
    return analytics_service.get_category_detail(all_ops, category)


@router.get("/compare")
async def compare_periods(
    year_a: Optional[int] = Query(None),
    quarter_a: Optional[int] = Query(None),
    month_a: Optional[int] = Query(None),
    year_b: Optional[int] = Query(None),
    quarter_b: Optional[int] = Query(None),
    month_b: Optional[int] = Query(None),
):
    """Compare deux périodes : KPIs, ventilation par catégorie."""
    ops_a = _load_all_ops(year_a, quarter_a, month_a)
    ops_b = _load_all_ops(year_b, quarter_b, month_b)
    return analytics_service.compare_periods(ops_a, ops_b)


@router.get("/year-overview")
async def get_year_overview(
    year: Optional[int] = Query(None, description="Année (défaut = année courante)"),
):
    """Cockpit annuel : mois, KPIs, alertes, progression, activité."""
    from datetime import datetime
    if year is None:
        year = datetime.now().year
    return analytics_service.get_year_overview(year)
