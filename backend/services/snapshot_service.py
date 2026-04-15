"""Service de gestion des snapshots (sélections nommées d'opérations)."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import SNAPSHOTS_FILE, IMPORTS_OPERATIONS_DIR
from backend.models.snapshot import Snapshot, SnapshotCreate, SnapshotUpdate

logger = logging.getLogger(__name__)

# Dossier d'archive des fichiers ops déplacés par split/merge
_ARCHIVE_DIR = IMPORTS_OPERATIONS_DIR / "_archive"


def _op_hash(op: dict) -> tuple:
    """Identité op : Date + Libellé strip + Débit + Crédit. Miroir des scripts split/merge."""
    return (
        str(op.get("Date", "")).strip(),
        str(op.get("Libellé", "")).strip(),
        float(op.get("Débit", 0) or 0),
        float(op.get("Crédit", 0) or 0),
    )


def _ensure_file() -> None:
    """Garantit l'existence du fichier snapshots.json (vide par défaut)."""
    if not SNAPSHOTS_FILE.exists():
        SNAPSHOTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SNAPSHOTS_FILE, "w", encoding="utf-8") as f:
            json.dump({"snapshots": []}, f, ensure_ascii=False, indent=2)


def _load_all() -> list[dict]:
    _ensure_file()
    try:
        with open(SNAPSHOTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("snapshots", []) if isinstance(data, dict) else []
    except Exception as e:
        logger.warning("Impossible de lire snapshots.json: %s", e)
        return []


def _save_all(snapshots: list[dict]) -> None:
    SNAPSHOTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SNAPSHOTS_FILE, "w", encoding="utf-8") as f:
        json.dump({"snapshots": snapshots}, f, ensure_ascii=False, indent=2, default=str)


def list_snapshots() -> list[Snapshot]:
    """Retourne tous les snapshots, triés par created_at descendant (récents en premier)."""
    raw = _load_all()
    snapshots = []
    for item in raw:
        try:
            snapshots.append(Snapshot(**item))
        except Exception as e:
            logger.warning("Snapshot malformé ignoré: %s", e)
    snapshots.sort(key=lambda s: s.created_at, reverse=True)
    return snapshots


def get_snapshot(snapshot_id: str) -> Optional[Snapshot]:
    for s in list_snapshots():
        if s.id == snapshot_id:
            return s
    return None


def create_snapshot(payload: SnapshotCreate) -> Snapshot:
    snapshot = Snapshot(**payload.model_dump())
    raw = _load_all()
    raw.append(snapshot.model_dump())
    _save_all(raw)
    return snapshot


def update_snapshot(snapshot_id: str, payload: SnapshotUpdate) -> Optional[Snapshot]:
    raw = _load_all()
    found = None
    for i, item in enumerate(raw):
        if item.get("id") == snapshot_id:
            updates = payload.model_dump(exclude_unset=True)
            updates["updated_at"] = datetime.now().isoformat(timespec="seconds")
            raw[i] = {**item, **updates}
            try:
                found = Snapshot(**raw[i])
            except Exception as e:
                logger.warning("Update snapshot invalid: %s", e)
                return None
            break
    if found:
        _save_all(raw)
    return found


def delete_snapshot(snapshot_id: str) -> bool:
    raw = _load_all()
    new = [item for item in raw if item.get("id") != snapshot_id]
    if len(new) == len(raw):
        return False
    _save_all(new)
    return True


def _build_active_hash_index() -> dict[tuple, tuple[str, int]]:
    """Construit un index hash → (filename, index) sur tous les fichiers ops actifs.
    Utilisé pour retrouver une op après un split/merge.
    """
    idx: dict[tuple, tuple[str, int]] = {}
    if not IMPORTS_OPERATIONS_DIR.exists():
        return idx
    for fp in IMPORTS_OPERATIONS_DIR.iterdir():
        if fp.suffix != ".json" or fp.name.startswith("_"):
            continue
        try:
            with open(fp, "r", encoding="utf-8") as f:
                ops = json.load(f)
        except Exception:
            continue
        if not isinstance(ops, list):
            continue
        for i, op in enumerate(ops):
            # setdefault : la première occurrence gagne (déduplication implicite)
            idx.setdefault(_op_hash(op), (fp.name, i))
    return idx


def _try_repair_ref_via_archive(old_file: str, old_index: int, hash_idx: dict[tuple, tuple[str, int]]) -> Optional[tuple[str, int]]:
    """Tente de retrouver la nouvelle position d'une ref cassée via l'archive.
    Retourne (new_file, new_index) si trouvé, None sinon.
    """
    if not _ARCHIVE_DIR.exists():
        return None
    candidates = list(_ARCHIVE_DIR.glob(f"{old_file}.bak_*"))
    if not candidates:
        return None
    # Prend le plus récent
    archive_path = max(candidates, key=lambda p: p.stat().st_mtime)
    try:
        with open(archive_path, "r", encoding="utf-8") as f:
            archived_ops = json.load(f)
    except Exception:
        return None
    if not isinstance(archived_ops, list):
        return None
    if not (0 <= old_index < len(archived_ops)):
        return None
    h = _op_hash(archived_ops[old_index])
    return hash_idx.get(h)


def resolve_snapshot_ops(snapshot_id: str) -> list[dict]:
    """Charge les opérations réelles référencées par un snapshot.
    Retourne une liste enrichie : chaque op a `_sourceFile` et `_index`.
    Les refs cassées (fichier supprimé / index hors bornes) sont auto-réparées via lookup
    dans l'archive + match par hash (Date+Libellé+Débit+Crédit). Les nouvelles refs sont
    persistées dans le fichier snapshots.json pour éviter de répéter le lookup.
    """
    snap = get_snapshot(snapshot_id)
    if not snap:
        return []

    ops: list[dict] = []
    file_cache: dict[str, list[dict]] = {}
    hash_idx: Optional[dict[tuple, tuple[str, int]]] = None  # lazy
    refs_changed = False
    new_refs: list[dict] = []

    for ref in snap.ops_refs:
        # Charger / cacher le fichier
        if ref.file not in file_cache:
            filepath = IMPORTS_OPERATIONS_DIR / ref.file
            if filepath.exists():
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        file_cache[ref.file] = json.load(f)
                except Exception as e:
                    logger.warning("Snapshot %s : erreur lecture %s: %s", snapshot_id, ref.file, e)
                    file_cache[ref.file] = []
            else:
                file_cache[ref.file] = []  # marqueur "absent"

        file_ops = file_cache[ref.file]
        is_broken = (not file_ops) or not (0 <= ref.index < len(file_ops))

        if not is_broken:
            op = dict(file_ops[ref.index])
            op["_sourceFile"] = ref.file
            op["_index"] = ref.index
            ops.append(op)
            new_refs.append({"file": ref.file, "index": ref.index})
            continue

        # Tenter l'auto-réparation
        if hash_idx is None:
            hash_idx = _build_active_hash_index()
        repaired = _try_repair_ref_via_archive(ref.file, ref.index, hash_idx)
        if repaired:
            new_file, new_idx = repaired
            logger.info(
                "Snapshot %s : ref réparée %s[%d] → %s[%d]",
                snapshot_id, ref.file, ref.index, new_file, new_idx,
            )
            # Charger le nouveau fichier si pas déjà en cache
            if new_file not in file_cache:
                try:
                    with open(IMPORTS_OPERATIONS_DIR / new_file, "r", encoding="utf-8") as f:
                        file_cache[new_file] = json.load(f)
                except Exception:
                    file_cache[new_file] = []
            new_file_ops = file_cache[new_file]
            if 0 <= new_idx < len(new_file_ops):
                op = dict(new_file_ops[new_idx])
                op["_sourceFile"] = new_file
                op["_index"] = new_idx
                ops.append(op)
            new_refs.append({"file": new_file, "index": new_idx})
            refs_changed = True
        else:
            logger.warning(
                "Snapshot %s : ref cassée non réparable %s[%d]",
                snapshot_id, ref.file, ref.index,
            )
            # Garder l'ancienne ref pour visibilité (mais elle restera cassée)
            new_refs.append({"file": ref.file, "index": ref.index})

    # Persister les refs réparées
    if refs_changed:
        raw = _load_all()
        for i, item in enumerate(raw):
            if item.get("id") == snapshot_id:
                raw[i]["ops_refs"] = new_refs
                raw[i]["updated_at"] = datetime.now().isoformat(timespec="seconds")
                break
        _save_all(raw)

    return ops
