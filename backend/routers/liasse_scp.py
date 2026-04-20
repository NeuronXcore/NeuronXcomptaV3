"""Router pour la gestion des liasses fiscales SCP (déclaration 2035 annuelle)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models.liasse_scp import LiasseScp, LiasseScpCreate, LiasseComparator
from backend.services import liasse_scp_service, analytics_service, operation_service

router = APIRouter(prefix="/api/liasse-scp", tags=["liasse-scp"])


@router.get("/")
def list_all() -> list[dict]:
    """Liste toutes les liasses enregistrées, triées par année DESC."""
    return liasse_scp_service.list_liasses()


@router.get("/{year}", response_model=LiasseScp)
def get_year(year: int):
    """Retourne la liasse d'une année précise. 404 si absente."""
    liasse = liasse_scp_service.get_liasse(year)
    if not liasse:
        raise HTTPException(status_code=404, detail=f"Aucune liasse pour {year}")
    return liasse


@router.post("/", response_model=LiasseScp)
def upsert(payload: LiasseScpCreate):
    """Crée ou met à jour la liasse d'une année (écrase si existante)."""
    return liasse_scp_service.save_liasse(
        year=payload.year,
        ca_declare=payload.ca_declare,
        ged_document_id=payload.ged_document_id,
        note=payload.note,
    )


@router.delete("/{year}")
def delete(year: int):
    """Supprime la liasse d'une année. 404 si absente."""
    if not liasse_scp_service.delete_liasse(year):
        raise HTTPException(status_code=404, detail=f"Aucune liasse pour {year}")
    return {"deleted": year}


@router.get("/{year}/comparator", response_model=LiasseComparator)
def comparator(year: int):
    """Compare le CA liasse avec les honoraires bancaires crédités de l'année."""
    liasse = liasse_scp_service.get_liasse(year)
    if not liasse:
        raise HTTPException(status_code=404, detail=f"Aucune liasse pour {year}")

    # Charger toutes les ops de l'année pour calculer les honoraires bancaires réels
    files = operation_service.list_operation_files()
    all_ops: list[dict] = []
    for f in files:
        if f.get("year") == year:
            try:
                all_ops.extend(operation_service.load_operations(f["filename"]))
            except Exception:
                continue

    # Honoraires bancaires = recettes_pro_bancaires (crédits pro uniquement, hors perso/attente)
    bnc_metrics = analytics_service._bnc_metrics_from_operations(all_ops, ca_liasse=None)
    honoraires_bancaires = float(bnc_metrics["bnc"]["recettes_pro_bancaires"])
    ca = float(liasse["ca_declare"])
    ecart = ca - honoraires_bancaires
    ecart_pct = (ecart / honoraires_bancaires * 100) if honoraires_bancaires else 0.0

    return LiasseComparator(
        year=year,
        ca_liasse=ca,
        honoraires_bancaires=round(honoraires_bancaires, 2),
        ecart_absolu=round(ecart, 2),
        ecart_pct=round(ecart_pct, 2),
    )
