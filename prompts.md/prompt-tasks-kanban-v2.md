# Prompt Claude Code — Module Tâches (Kanban semi-automatique)

**Lire `CLAUDE.md` en premier.**

## Contexte

Ajouter un module Tâches avec vue kanban 3 colonnes (To do / In progress / Done). Drag & drop entre colonnes. Deux types de tâches coexistent :

- **Tâches auto** (`source: "auto"`) : générées par scan de l'état applicatif (justificatifs manquants, opérations non catégorisées, clôture incomplète, etc.). Rafraîchies à l'ouverture de la page. L'utilisateur peut les déplacer, les compléter, les ignorer (dismiss).
- **Tâches manuelles** (`source: "manual"`) : créées librement par l'utilisateur, totalement indépendantes des autres modules.

Stockage JSON unique pour les deux types.

---

## 1. Backend

### 1.1 Config

**Fichier : `backend/core/config.py`**

Ajouter :
```python
TASKS_FILE = DATA_DIR / "tasks.json"
```

### 1.2 Modèle Pydantic

**Créer : `backend/models/task.py`**

```python
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
import uuid
from datetime import datetime

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
    auto_key: Optional[str] = None  # clé unique pour dédoublonner les tâches auto (ex: "categorize:2024-03")
    due_date: Optional[str] = None  # YYYY-MM-DD
    dismissed: bool = False  # tâches auto ignorées par l'utilisateur
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    completed_at: Optional[str] = None

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.normale
    due_date: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    due_date: Optional[str] = None
    dismissed: Optional[bool] = None
```

### 1.3 Service tâches auto

**Créer : `backend/services/task_service.py`**

```python
from __future__ import annotations
from typing import Optional
from backend.models.task import Task, TaskStatus, TaskPriority, TaskSource
```

Fonction principale : `generate_auto_tasks() -> list[Task]`

Scanne l'état de l'app et produit une liste de tâches suggérées. Chaque tâche a un `auto_key` unique pour la déduplication.

**Détections à implémenter (5 types) :**

1. **Opérations non catégorisées** — pour chaque fichier d'opérations :
   - Compter les opérations sans catégorie ou catégorie "Autres"
   - Si count > 0 → tâche "Catégoriser {count} opérations — {mois} {année}"
   - `auto_key`: `"categorize:{filename}"`
   - Priorité : haute si count > 20, normale sinon
   - Utiliser `operation_service.load_operations(filename)` pour charger

2. **Justificatifs en attente de rapprochement** — compter les fichiers dans `JUSTIFICATIFS_EN_ATTENTE_DIR` :
   - Si count > 0 → tâche "Rapprocher {count} justificatifs en attente"
   - `auto_key`: `"rapprochement:pending"`
   - Priorité : haute si count > 10, normale sinon

3. **Clôture incomplète** — pour chaque mois avec relevé chargé (via `cloture_service.get_annual_status`) :
   - Si `statut == "partiel"` → tâche "Clôturer {mois} {année} (lettrage {taux_l}%, justificatifs {taux_j}%)"
   - `auto_key`: `"cloture:{year}-{month}"`
   - Priorité : haute si les deux taux < 50%, normale sinon

4. **Mois sans relevé importé** — pour l'année en cours, mois passés sans fichier d'opérations :
   - Tâche "Importer le relevé de {mois} {année}"
   - `auto_key`: `"import:{year}-{month}"`
   - Priorité : haute si retard > 2 mois, normale sinon

5. **Alertes non résolues** — via `alerte_service.compute_alertes_summary()` :
   - Si `total_en_attente > 0` → tâche "Traiter {count} alertes en compte d'attente"
   - `auto_key`: `"alertes:pending"`
   - Priorité : haute si count > 50, normale sinon

**Logique de déduplication dans le router** (pas dans le service) :
- Charger les tâches existantes
- Pour chaque tâche auto générée, vérifier si une tâche avec le même `auto_key` existe déjà
- Si oui et `status == done` ou `dismissed == true` → ne pas recréer
- Si oui et `status != done` → mettre à jour title/description/priority (les données ont pu changer)
- Si non → insérer comme nouvelle tâche
- Supprimer les tâches auto dont le `auto_key` n'est plus dans la liste générée (le problème a été résolu par un autre moyen)

### 1.4 Router

**Créer : `backend/routers/tasks.py`**

Helpers internes :
- `_load_tasks() -> list[Task]` : lit `TASKS_FILE`, retourne `[]` si inexistant
- `_save_tasks(tasks: list[Task])` : écrit le JSON

Endpoints :

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET /` | Liste les tâches | Retourne `list[Task]` (exclut `dismissed == true` sauf si `?include_dismissed=true`) |
| `POST /` | Créer une tâche manuelle | Body: `TaskCreate`. Force `source = "manual"`. Retourne `Task` |
| `PATCH /{task_id}` | Modifier une tâche | Body: `TaskUpdate`. Si `status` passe à `done` → set `completed_at`. Si quitte `done` → clear `completed_at`. Retourne `Task`. 404 si non trouvée |
| `DELETE /{task_id}` | Supprimer une tâche | Tâches manuelles uniquement. Pour les tâches auto → utiliser PATCH `dismissed: true`. 400 si tentative de delete une tâche auto. 404 si non trouvée |
| `POST /refresh` | Rafraîchir les tâches auto | Appelle `generate_auto_tasks()`, applique la logique de déduplication, sauvegarde. Retourne `{ "added": N, "updated": N, "removed": N }` |

**Enregistrer dans `backend/main.py`** :
```python
from backend.routers import tasks
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
```

---

## 2. Frontend

### 2.1 Dépendance

```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### 2.2 Types

**Fichier : `frontend/src/types/index.ts`**

Ajouter :
```typescript
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'haute' | 'normale' | 'basse';
export type TaskSource = 'manual' | 'auto';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  auto_key?: string;
  due_date?: string;
  dismissed: boolean;
  created_at: string;
  completed_at?: string;
}

export interface TaskCreate {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string;
  dismissed?: boolean;
}
```

### 2.3 Hook

**Créer : `frontend/src/hooks/useTasks.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Task, TaskCreate, TaskUpdate } from '../types';

export function useTasks() {
  return useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: () => api.get('/tasks'),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TaskCreate) => api.post('/tasks', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TaskUpdate }) =>
      api.patch(`/tasks/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useRefreshAutoTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/tasks/refresh'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
```

> **Note** : vérifier que `api.patch` existe dans `api/client.ts`. Si absent, l'ajouter sur le modèle de `api.put`.

### 2.4 Composants

#### 2.4.1 Carte tâche

**Créer : `frontend/src/components/tasks/TaskCard.tsx`**

Props : `{ task: Task, onEdit: (task: Task) => void, onDelete: (id: string) => void, onDismiss: (id: string) => void }`

- Utilise `useSortable` de `@dnd-kit/sortable` avec `id = task.id`
- Attributs drag : `{...attributes}`, `{...listeners}`, `ref`, `style` avec `transform` et `transition`
- Affichage :
  - `border-left: 3px solid` couleur selon priorité (haute → `#E24B4A`, normale → `#EF9F27`, basse → `#1D9E75`). En colonne "done" : toujours vert `#1D9E75`
  - Titre (barré si done), description tronquée 1 ligne si présente
  - **Indicateur source** : si `source === "auto"` → petit badge "Auto" discret (pill, background `var(--color-background-info)`, color `var(--color-text-info)`, font-size 10px) à côté du badge priorité
  - Badge priorité (pill colorée)
  - Date d'échéance. Si en retard (< aujourd'hui et status ≠ done) → texte rouge
  - Opacité 0.55 si status = done
  - Boutons au hover (icônes 14px) :
    - Edit (Pencil) — tâches manuelles uniquement
    - Delete (Trash2) — tâches manuelles uniquement
    - Dismiss (EyeOff) — tâches auto uniquement, appelle `onDismiss`
  - `cursor: grab`

#### 2.4.2 Colonne kanban

**Créer : `frontend/src/components/tasks/KanbanColumn.tsx`**

Props : `{ status: TaskStatus, title: string, tasks: Task[], color: string, onEdit, onDelete, onDismiss, onAddClick }`

- Utilise `useDroppable` de `@dnd-kit/core` avec `id = status`
- Header : pastille couleur (8px) + titre + compteur badge
- Liste de `TaskCard` triée par : priorité (haute > normale > basse) puis `due_date` (ascendant, nulls last)
- Bouton "+ Ajouter" en bas (dashed border), appelle `onAddClick(status)` — tâche manuelle
- Highlight quand `isOver` (background légèrement teinté via `var(--color-background-secondary)`)

#### 2.4.3 Formulaire inline

**Créer : `frontend/src/components/tasks/TaskInlineForm.tsx`**

Props : `{ task?: Task, defaultStatus?: TaskStatus, onSubmit: (data: TaskCreate | TaskUpdate) => void, onCancel: () => void }`

- Mode édition si `task` fourni, sinon mode création
- Champs :
  - `title` : input text, autofocus, requis
  - `description` : textarea, 2 lignes, optionnel
  - `priority` : select (Haute / Normale / Basse), défaut Normale
  - `due_date` : input date, optionnel
- Boutons : Enregistrer (fond violet `#534AB7`) + Annuler (outline)
- Submit sur Enter dans le champ titre (si non vide)
- Apparaît inline dans la colonne (remplace le bouton "+ Ajouter")

#### 2.4.4 Page kanban

**Créer : `frontend/src/components/tasks/TasksPage.tsx`**

- `PageHeader` : titre "Tâches", description "Suivi des actions comptables", actions :
  - Bouton "Rafraîchir" (RefreshCw) → appelle `useRefreshAutoTasks`, toast avec compteurs `added/updated/removed`
  - Bouton "+ Nouvelle tâche" (fond violet) → ouvre formulaire inline dans colonne "todo"

- **Appel auto au montage** : `useEffect` qui appelle `refreshMutation.mutate()` une fois au montage de la page (avec `useRef` anti-double comme pattern EditorPage). Ainsi les tâches auto sont à jour à chaque visite.

- 3 colonnes `KanbanColumn` dans un grid `repeat(3, minmax(0, 1fr))` gap 16px :
  - To do — gris `#B4B2A9`
  - In progress — bleu `#378ADD`
  - Done — vert `#1D9E75`

- **Drag & drop** avec `DndContext` de `@dnd-kit/core` :
  - `onDragEnd` : si `over` est une colonne différente → `useUpdateTask` avec `{ status: over.id as TaskStatus }`
  - Sensors : `useSensor(PointerSensor, { activationConstraint: { distance: 5 } })`
  - `DragOverlay` avec `TaskCard` clone pendant le drag

- **Dismiss** : pour les tâches auto, PATCH `{ dismissed: true }` → la carte disparaît

- État local :
  - `addingInColumn: TaskStatus | null` — colonne avec formulaire d'ajout ouvert
  - `editingTask: Task | null` — carte en mode édition inline

- Toasts `react-hot-toast` sur : création, déplacement, suppression, dismiss, refresh

### 2.5 Routing

**Fichier : `frontend/src/App.tsx`**

```tsx
import TasksPage from './components/tasks/TasksPage';
// dans les routes :
<Route path="/tasks" element={<TasksPage />} />
```

### 2.6 Sidebar

**Fichier : `frontend/src/components/layout/Sidebar.tsx`**

Groupe **OUTILS**, avant "Agent IA" :
```typescript
{ label: 'Tâches', path: '/tasks', icon: CheckSquare }
```

Import : `import { CheckSquare } from 'lucide-react'`

---

## 3. Ordre d'implémentation

1. `backend/core/config.py` — ajouter `TASKS_FILE`
2. `backend/models/task.py` — créer
3. `backend/services/task_service.py` — créer avec `generate_auto_tasks()`
4. `backend/routers/tasks.py` — créer (CRUD + refresh)
5. `backend/main.py` — enregistrer router
6. `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
7. `frontend/src/types/index.ts` — ajouter types Task
8. `frontend/src/hooks/useTasks.ts` — créer
9. `frontend/src/api/client.ts` — ajouter `api.patch` si absent
10. `frontend/src/components/tasks/TaskCard.tsx` — créer
11. `frontend/src/components/tasks/KanbanColumn.tsx` — créer
12. `frontend/src/components/tasks/TaskInlineForm.tsx` — créer
13. `frontend/src/components/tasks/TasksPage.tsx` — créer
14. `frontend/src/App.tsx` — ajouter route
15. `frontend/src/components/layout/Sidebar.tsx` — ajouter entrée

---

## 4. Checklist de vérification

### Backend
- [ ] `from __future__ import annotations` dans tous les fichiers Python créés
- [ ] GET `/api/tasks` retourne la liste (exclut dismissed par défaut)
- [ ] POST `/api/tasks` crée une tâche manuelle, `source` forcé à `"manual"`
- [ ] PATCH `/api/tasks/{id}` met à jour, gère `completed_at` auto
- [ ] DELETE `/api/tasks/{id}` refuse sur tâches auto (400), fonctionne sur manuelles
- [ ] POST `/api/tasks/refresh` scanne l'état, dédoublonne par `auto_key`, retourne compteurs
- [ ] Tâches auto `done` ou `dismissed` ne sont pas recréées par refresh
- [ ] Tâches auto dont le `auto_key` n'est plus pertinent sont supprimées par refresh
- [ ] `data/tasks.json` persiste après redémarrage

### Frontend
- [ ] Page `/tasks` affiche 3 colonnes kanban
- [ ] Refresh auto au montage de la page (tâches auto à jour)
- [ ] Tâches triées par priorité puis date dans chaque colonne
- [ ] Drag & drop entre colonnes → PATCH status → carte déplacée
- [ ] Badge "Auto" visible sur les tâches auto-générées
- [ ] Tâches auto : pas de bouton edit/delete, bouton dismiss (EyeOff) à la place
- [ ] Tâches manuelles : boutons edit/delete, pas de dismiss
- [ ] Formulaire inline pour créer/éditer, submit sur Enter
- [ ] Cartes "Done" : opacité réduite, titre barré, border-left verte
- [ ] Dates en retard affichées en rouge
- [ ] Sidebar : "Tâches" dans OUTILS avec icône CheckSquare
- [ ] Dark theme OK (CSS variables)
- [ ] Pas de `any` en TypeScript
- [ ] Toasts sur toutes les actions
