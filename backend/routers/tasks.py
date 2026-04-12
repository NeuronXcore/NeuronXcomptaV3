from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from pydantic import BaseModel as _BaseModel

from backend.core.config import TASKS_FILE
from backend.models.task import Task, TaskCreate, TaskSource, TaskStatus, TaskUpdate
from backend.services import task_service


class ReorderPayload(_BaseModel):
    ordered_ids: list[str]

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _load_tasks() -> List[Task]:
    if not TASKS_FILE.exists():
        return []
    try:
        data = json.loads(TASKS_FILE.read_text(encoding="utf-8"))
        return [Task(**t) for t in data]
    except Exception as e:
        logger.warning("Erreur chargement tasks.json: %s", e)
        return []


def _save_tasks(tasks: List[Task]) -> None:
    TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    TASKS_FILE.write_text(
        json.dumps([t.model_dump() for t in tasks], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@router.get("/")
async def list_tasks(year: Optional[int] = Query(None), include_dismissed: bool = Query(False)):
    tasks = _load_tasks()
    if not include_dismissed:
        tasks = [t for t in tasks if not t.dismissed]
    if year is not None:
        tasks = [t for t in tasks if t.year == year]
    return tasks


@router.post("/")
async def create_task(data: TaskCreate):
    tasks = _load_tasks()
    # New task goes to the end of its column
    max_order = max((t.order for t in tasks if t.status == data.status), default=-1)
    task = Task(
        title=data.title,
        description=data.description,
        status=data.status,
        priority=data.priority,
        year=data.year,
        due_date=data.due_date,
        source=TaskSource.manual,
        order=max_order + 1,
    )
    tasks.append(task)
    _save_tasks(tasks)
    return task


@router.patch("/{task_id}")
async def update_task(task_id: str, data: TaskUpdate):
    tasks = _load_tasks()
    task = next((t for t in tasks if t.id == task_id), None)
    if not task:
        raise HTTPException(404, "Tâche non trouvée")

    update_data = data.model_dump(exclude_none=True)

    # Gérer completed_at automatiquement
    if "status" in update_data:
        new_status = update_data["status"]
        if new_status != task.status:
            # Assign order at the end of the target column
            max_order = max((t.order for t in tasks if t.status == new_status), default=-1)
            update_data["order"] = max_order + 1
        if new_status == TaskStatus.done and task.status != TaskStatus.done:
            update_data["completed_at"] = datetime.now().isoformat()
        elif new_status != TaskStatus.done and task.status == TaskStatus.done:
            update_data["completed_at"] = None

    for key, value in update_data.items():
        setattr(task, key, value)

    _save_tasks(tasks)
    return task


@router.delete("/{task_id}")
async def delete_task(task_id: str):
    tasks = _load_tasks()
    task = next((t for t in tasks if t.id == task_id), None)
    if not task:
        raise HTTPException(404, "Tâche non trouvée")
    if task.source == TaskSource.auto:
        raise HTTPException(400, "Impossible de supprimer une tâche auto. Utilisez dismiss.")
    tasks = [t for t in tasks if t.id != task_id]
    _save_tasks(tasks)
    return {"success": True}


@router.post("/reorder")
async def reorder_tasks(payload: ReorderPayload):
    """Persist the visual ordering of tasks (within or across columns)."""
    tasks = _load_tasks()
    id_to_task = {t.id: t for t in tasks}
    for idx, tid in enumerate(payload.ordered_ids):
        if tid in id_to_task:
            id_to_task[tid].order = idx
    _save_tasks(tasks)
    return {"success": True}


@router.post("/refresh")
async def refresh_auto_tasks(year: int = Query(...)):
    """Régénère les tâches auto pour l'année donnée et applique la déduplication."""
    candidates = task_service.generate_auto_tasks(year)
    existing = _load_tasks()

    # Index des tâches auto existantes par auto_key (même année)
    auto_lookup: dict[str, Task] = {}
    for t in existing:
        if t.source == TaskSource.auto and t.auto_key and t.year == year:
            auto_lookup[t.auto_key] = t

    candidate_keys = {c.auto_key for c in candidates if c.auto_key}
    added = 0
    updated = 0
    removed = 0

    for candidate in candidates:
        if not candidate.auto_key:
            continue
        if candidate.auto_key in auto_lookup:
            ex = auto_lookup[candidate.auto_key]
            # Ne pas recréer les tâches done ou dismissed
            if ex.status == TaskStatus.done or ex.dismissed:
                continue
            # Mettre à jour titre, description, priorité
            ex.title = candidate.title
            ex.description = candidate.description
            ex.priority = candidate.priority
            updated += 1
        else:
            existing.append(candidate)
            added += 1

    # Supprimer les tâches auto de cette année dont le problème n'existe plus
    to_remove = []
    for t in existing:
        if (
            t.source == TaskSource.auto
            and t.auto_key
            and t.year == year
            and t.auto_key not in candidate_keys
            and t.status != TaskStatus.done
            and not t.dismissed
        ):
            to_remove.append(t.id)
            removed += 1

    existing = [t for t in existing if t.id not in to_remove]
    _save_tasks(existing)

    return {"added": added, "updated": updated, "removed": removed}
