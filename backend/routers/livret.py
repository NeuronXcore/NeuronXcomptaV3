"""
Router /api/livret — Livret comptable vivant.

Phase 1 — 3 endpoints livret :
  - GET /api/livret/{year}             → Livret complet
  - GET /api/livret/{year}/metadata    → Métadonnées seules (pour live indicator)
  - GET /api/livret/{year}/projection  → ProjectionResult brut

Phase 3 — 6 endpoints snapshots (sous /api/livret/snapshots/*) :
  - GET    /snapshots                       → liste filtrable (?year=)
  - POST   /snapshots/{year}                → création manuelle
  - GET    /snapshots/{snapshot_id}         → métadonnées
  - GET    /snapshots/{snapshot_id}/html    → fichier HTML autonome (inline)
  - GET    /snapshots/{snapshot_id}/pdf     → fichier PDF (inline)
  - DELETE /snapshots/{snapshot_id}         → suppression (?force=true pour cloture)

**IMPORTANT — ordre des routes** : les routes `/snapshots/*` doivent être déclarées
AVANT les routes dynamiques `/{year}` pour éviter que FastAPI ne tente de parser
"snapshots" comme un int.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.models.livret import (
    CreateSnapshotRequest,
    Livret,
    LivretMetadata,
    LivretSnapshotMetadata,
    ProjectionResult,
    SnapshotsListResponse,
)
from backend.services import livret_service, livret_snapshot_service, projection_service

router = APIRouter(prefix="/api/livret", tags=["livret"])


def _parse_as_of(as_of: Optional[str]) -> Optional[date]:
    if not as_of:
        return None
    try:
        return datetime.strptime(as_of, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Paramètre `as_of` invalide (format attendu YYYY-MM-DD) : {as_of}")


# ═══════════════════════════════════════════════════════════════════
# Snapshots — déclarés AVANT les routes /{year} dynamiques
# ═══════════════════════════════════════════════════════════════════

@router.get("/snapshots", response_model=SnapshotsListResponse)
async def list_snapshots(
    year: Optional[int] = Query(None, description="Filtre par année. Sans param = tous."),
) -> SnapshotsListResponse:
    """Liste les snapshots, triés par date de figeage décroissante."""
    snaps = livret_snapshot_service.list_snapshots(year)
    return SnapshotsListResponse(snapshots=snaps)


@router.post("/snapshots/{year}", response_model=LivretSnapshotMetadata)
async def create_snapshot(year: int, body: CreateSnapshotRequest) -> LivretSnapshotMetadata:
    """Crée un snapshot manuel (par défaut) pour `year` à `as_of_date` (défaut hier).

    Lève 400 pour année future ou date invalide, 423 si un autre snapshot est en cours.
    """
    parsed_as_of = _parse_as_of(body.as_of_date)
    try:
        return livret_snapshot_service.create_snapshot(
            year=year,
            snapshot_type=body.snapshot_type,
            comment=body.comment,
            as_of_date=parsed_as_of,
            include_comparison=body.include_comparison,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except BlockingIOError as e:
        raise HTTPException(status_code=423, detail=str(e))
    except RuntimeError as e:
        # Génération HTML/PDF échouée — propage avec 500
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/snapshots/{snapshot_id}", response_model=LivretSnapshotMetadata)
async def get_snapshot_metadata(snapshot_id: str) -> LivretSnapshotMetadata:
    """Métadonnées d'un snapshot. 404 si absent."""
    meta = livret_snapshot_service.get_snapshot(snapshot_id)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Snapshot inconnu : {snapshot_id}")
    return meta


@router.get("/snapshots/{snapshot_id}/html")
async def get_snapshot_html(snapshot_id: str):
    """Sert le fichier HTML autonome inline (pour iframe/embed in-app).

    Le téléchargement forcé se fait côté frontend via fetch + blob URL.
    """
    path = livret_snapshot_service.get_snapshot_html_path(snapshot_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Snapshot HTML introuvable : {snapshot_id}")
    return FileResponse(
        path=str(path),
        media_type="text/html",
        filename=path.name,
        headers={"Content-Disposition": f'inline; filename="{path.name}"'},
    )


@router.get("/snapshots/{snapshot_id}/pdf")
async def get_snapshot_pdf(snapshot_id: str):
    """Sert le fichier PDF inline (pour PdfPreviewDrawer)."""
    path = livret_snapshot_service.get_snapshot_pdf_path(snapshot_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Snapshot PDF introuvable : {snapshot_id}")
    return FileResponse(
        path=str(path),
        media_type="application/pdf",
        filename=path.name,
        headers={"Content-Disposition": f'inline; filename="{path.name}"'},
    )


@router.delete("/snapshots/{snapshot_id}")
async def delete_snapshot(
    snapshot_id: str,
    force: bool = Query(False, description="Forcer la suppression d'un snapshot de clôture."),
) -> dict:
    """Supprime un snapshot (fichiers + manifest + GED).

    Refuse les snapshots `cloture` sauf `force=true` (HTTP 423).
    """
    try:
        return livret_snapshot_service.delete_snapshot(snapshot_id, force=force)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Snapshot inconnu : {snapshot_id}")
    except PermissionError as e:
        raise HTTPException(status_code=423, detail=str(e))


@router.get("/{year}", response_model=Livret)
async def get_livret(
    year: int,
    as_of: Optional[str] = Query(None, description="Date d'arrêt YTD (ISO YYYY-MM-DD). Défaut = today() en mode live."),
    compare_n1: Optional[str] = Query(
        None,
        description=(
            "Phase 4 — Comparaison N-1. Valeurs : 'ytd_comparable' (compare la période "
            "[01/01/N → as_of] avec [01/01/(N-1) → même date N-1]) ou 'annee_pleine' "
            "(exercice complet N vs exercice complet N-1). Défaut : pas de comparaison."
        ),
    ),
) -> Livret:
    """Vue live du Livret comptable pour `year`.

    Pour exercice clos, `as_of` est clampée au 31/12. Pour année future, au 01/01.
    Toutes les valeurs sont calculées à la volée — pas de cache disque en Phase 1.

    Phase 4 — `compare_n1` active l'annotation des deltas N-1 sur metrics, totaux
    chapitres, totaux sous-cat, et la cadence mensuelle. Performance : la double
    composition est mémoïsée 60s pour rester sous 1.5s typiquement.
    """
    parsed_as_of = _parse_as_of(as_of)

    # Validation `compare_n1`
    compare_mode = None
    if compare_n1 is not None:
        if compare_n1 not in ("ytd_comparable", "annee_pleine"):
            raise HTTPException(
                status_code=400,
                detail=f"Paramètre `compare_n1` invalide : {compare_n1} (attendu : 'ytd_comparable' | 'annee_pleine')",
            )
        compare_mode = compare_n1

    return livret_service.build_livret(
        year, as_of_date=parsed_as_of, compare_n1=compare_mode,  # type: ignore[arg-type]
    )


@router.get("/{year}/metadata", response_model=LivretMetadata)
async def get_livret_metadata(
    year: int,
    as_of: Optional[str] = Query(None),
) -> LivretMetadata:
    """Métadonnées seules — endpoint léger pour le live indicator (poll plus fréquent)."""
    parsed_as_of = _parse_as_of(as_of)
    return livret_service.get_metadata(year, as_of_date=parsed_as_of)


@router.get("/{year}/projection", response_model=ProjectionResult)
async def get_livret_projection(
    year: int,
    as_of: Optional[str] = Query(None),
) -> ProjectionResult:
    """Expose la projection seule pour debug / inspection."""
    parsed_as_of = _parse_as_of(as_of) or date.today()
    return projection_service.project(year, parsed_as_of)
