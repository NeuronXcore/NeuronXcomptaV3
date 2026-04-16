from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class TaskPriority(str, Enum):
    haute = "haute"
    normale = "normale"
    basse = "basse"


class TaskSource(str, Enum):
    manual = "manual"
    auto = "auto"


class Task(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.normale
    source: TaskSource = TaskSource.manual
    year: Optional[int] = None
    auto_key: Optional[str] = None
    due_date: Optional[str] = None
    dismissed: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    completed_at: Optional[str] = None
    order: int = 0
    # Métadonnées libres (ex. ml_retrain : corrections_count, days_since_training, action_url).
    # Optional + default None pour backward-compat avec les tâches stockées.
    metadata: Optional[dict] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.normale
    year: Optional[int] = None
    due_date: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    due_date: Optional[str] = None
    dismissed: Optional[bool] = None
