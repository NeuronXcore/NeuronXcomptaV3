"""Router pour les snapshots (sélections nommées d'opérations)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models.snapshot import Snapshot, SnapshotCreate, SnapshotUpdate
from backend.services import snapshot_service

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


@router.get("/", response_model=list[Snapshot])
async def list_snapshots():
    """Liste tous les snapshots, triés par création desc."""
    return snapshot_service.list_snapshots()


@router.get("/{snapshot_id}", response_model=Snapshot)
async def get_snapshot(snapshot_id: str):
    snap = snapshot_service.get_snapshot(snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot introuvable")
    return snap


@router.get("/{snapshot_id}/operations")
async def get_snapshot_operations(snapshot_id: str):
    """Charge les ops réelles référencées par le snapshot.
    Retourne la liste enrichie avec _sourceFile + _index pour navigation/édition."""
    snap = snapshot_service.get_snapshot(snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot introuvable")
    ops = snapshot_service.resolve_snapshot_ops(snapshot_id)
    return {
        "snapshot": snap,
        "operations": ops,
        "resolved_count": len(ops),
        "expected_count": len(snap.ops_refs),
    }


@router.post("/", response_model=Snapshot)
async def create_snapshot(payload: SnapshotCreate):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Le nom est requis")
    if not payload.ops_refs:
        raise HTTPException(status_code=400, detail="Au moins une opération est requise")
    return snapshot_service.create_snapshot(payload)


@router.patch("/{snapshot_id}", response_model=Snapshot)
async def update_snapshot(snapshot_id: str, payload: SnapshotUpdate):
    updated = snapshot_service.update_snapshot(snapshot_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Snapshot introuvable")
    return updated


@router.delete("/{snapshot_id}")
async def delete_snapshot(snapshot_id: str):
    ok = snapshot_service.delete_snapshot(snapshot_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Snapshot introuvable")
    return {"deleted": True}
