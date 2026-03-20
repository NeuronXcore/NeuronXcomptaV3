"""Router pour l'analytique et le dashboard."""

from fastapi import APIRouter

from backend.services import operation_service, analytics_service

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/dashboard")
async def get_dashboard():
    """Données agrégées pour le dashboard."""
    # Charger toutes les opérations de tous les fichiers
    files = operation_service.list_operation_files()
    all_ops = []
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            all_ops.extend(ops)
        except Exception:
            continue

    return analytics_service.get_dashboard_data(all_ops)


@router.get("/summary")
async def get_summary():
    """Résumé par catégorie de toutes les opérations."""
    files = operation_service.list_operation_files()
    all_ops = []
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            all_ops.extend(ops)
        except Exception:
            continue

    return analytics_service.get_category_summary(all_ops)


@router.get("/trends")
async def get_trends(months: int = 6):
    """Tendances mensuelles."""
    files = operation_service.list_operation_files()
    all_ops = []
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            all_ops.extend(ops)
        except Exception:
            continue

    return analytics_service.get_monthly_trends(all_ops, months)


@router.get("/anomalies")
async def get_anomalies(threshold: float = 2.0):
    """Détecte les anomalies."""
    files = operation_service.list_operation_files()
    all_ops = []
    for f in files:
        try:
            ops = operation_service.load_operations(f["filename"])
            all_ops.extend(ops)
        except Exception:
            continue

    return analytics_service.detect_anomalies(all_ops, threshold)
