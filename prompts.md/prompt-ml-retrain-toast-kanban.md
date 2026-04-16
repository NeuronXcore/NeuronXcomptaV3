# Feature — Tâche Kanban auto "Réentraîner le modèle IA" + Toast cerveau animé

## Contexte

NeuronXcompta V3 — FastAPI + React 19/TypeScript/TailwindCSS 4.

Le module Tâches Kanban génère automatiquement des tâches via `task_service.generate_auto_tasks(year)` avec 5 détections actuelles. Ajouter une **6e détection ML** : si des corrections manuelles se sont accumulées depuis le dernier entraînement, créer une tâche "Réentraîner le modèle IA".

Au montage de l'app (`AppLayout`), afficher un **toast custom** une seule fois par session si cette tâche ML existe.

---

## Backend — `backend/services/task_service.py`

### Étape 1 — Lire le fichier et comprendre la structure

Lire `task_service.py` entier. Identifier :
- La signature de `generate_auto_tasks(year)`
- La structure d'une tâche auto (champs `auto_key`, `title`, `description`, `priority`, `source`)
- Les 5 détections existantes comme modèle à suivre

### Étape 2 — Ajouter la 6e détection ML

Après les 5 détections existantes, ajouter :

```python
# ── Détection 6 : modèle ML à réentraîner ──
try:
    from backend.services import ml_monitoring_service

    # Nombre de corrections depuis le dernier entraînement
    corrections_since_training = _count_corrections_since_last_training()

    # Jours depuis le dernier entraînement
    days_since_training = _days_since_last_training()

    # Seuil : 10+ corrections OU 14+ jours sans entraînement avec au moins 1 correction
    should_retrain = (
        corrections_since_training >= 10
        or (corrections_since_training >= 1 and days_since_training >= 14)
    )

    if should_retrain:
        auto_tasks.append({
            "auto_key": "ml_retrain",
            "title": "Réentraîner le modèle IA",
            "description": (
                f"{corrections_since_training} correction(s) depuis le dernier entraînement"
                + (f" · {days_since_training}j sans entraînement" if days_since_training else "")
            ),
            "priority": "high" if corrections_since_training >= 20 else "medium",
            "source": "auto",
            "metadata": {
                "corrections_count": corrections_since_training,
                "days_since_training": days_since_training,
                "action_url": "/agent-ai",
            },
        })
except Exception as e:
    logger.warning(f"ML retrain detection failed: {e}")
```

### Étape 3 — Helpers à ajouter dans `task_service.py`

```python
def _count_corrections_since_last_training() -> int:
    """
    Compte les corrections manuelles depuis le dernier entraînement sklearn.
    Lit data/ml/logs/trainings.json pour la date du dernier entraînement,
    puis compte les entrées dans data/ml/logs/corrections/*.json postérieures.
    Retourne 0 si impossible à déterminer.
    """
    from backend.core.config import DATA_DIR
    import json, glob
    from datetime import datetime

    # Date du dernier entraînement
    trainings_path = DATA_DIR / "ml" / "logs" / "trainings.json"
    last_training_dt = None
    try:
        trainings = json.load(open(trainings_path))
        if trainings:
            last_ts = sorted(t.get("timestamp", "") for t in trainings)[-1]
            last_training_dt = datetime.fromisoformat(last_ts)
    except Exception:
        return 0

    if not last_training_dt:
        return 0

    # Compter les corrections postérieures
    corrections_dir = DATA_DIR / "ml" / "logs" / "corrections"
    total = 0
    for f in corrections_dir.glob("corrections_*.json"):
        try:
            entries = json.load(open(f))
            for entry in entries:
                ts = entry.get("timestamp", "")
                if ts and datetime.fromisoformat(ts) > last_training_dt:
                    total += 1
        except Exception:
            continue
    return total


def _days_since_last_training() -> int:
    """Retourne le nombre de jours depuis le dernier entraînement. 999 si jamais entraîné."""
    from backend.core.config import DATA_DIR
    import json
    from datetime import datetime

    trainings_path = DATA_DIR / "ml" / "logs" / "trainings.json"
    try:
        trainings = json.load(open(trainings_path))
        if trainings:
            last_ts = sorted(t.get("timestamp", "") for t in trainings)[-1]
            last_dt = datetime.fromisoformat(last_ts)
            return (datetime.now() - last_dt).days
    except Exception:
        pass
    return 999
```

---

## Frontend — Toast custom cerveau animé

### Nouveau composant `frontend/src/components/shared/MLRetrainToast.tsx`

Design specs (voir mockup) :
- Largeur 360px, fond `bg-surface`, border `border-border/50`, `rounded-xl`
- Barre violette 3px à gauche (`bg-[#7F77DD]`)
- Barre de progression auto-dismiss en bas (2px, opacity-40, animation 8s linear)
- Icône cerveau SVG 40×40 dans carré `bg-[#EEEDFE]` arrondi, avec **2 anneaux pulse** `border-[#7F77DD]` animés (`animate-ping` ou keyframes custom)
- Pills : corrections (violet) + jours (amber)
- Bouton "Entraîner maintenant" violet → navigate vers `/agent-ai`
- Bouton "Plus tard" ghost

```tsx
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

interface MLRetrainToastProps {
  toastId: string
  correctionsCount: number
  daysSince: number
}

export default function MLRetrainToast({ toastId, correctionsCount, daysSince }: MLRetrainToastProps) {
  const navigate = useNavigate()

  const handleRetrain = () => {
    toast.dismiss(toastId)
    navigate('/agent-ai')
  }

  return (
    <div className="relative w-[360px] bg-surface border border-border/50 rounded-xl p-3.5 flex items-start gap-3.5 overflow-hidden shadow-lg">
      {/* Barre accent gauche */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#7F77DD] rounded-l-xl" />

      {/* Barre progression auto-dismiss */}
      <div
        className="absolute bottom-0 left-0 h-[2px] bg-[#7F77DD]/40"
        style={{ animation: 'ml-toast-progress 8s linear forwards' }}
      />

      {/* Icône cerveau */}
      <div className="relative shrink-0 w-10 h-10 rounded-[10px] bg-[#EEEDFE] flex items-center justify-center">
        {/* Anneaux pulse */}
        <div className="absolute inset-[-4px] rounded-[14px] border-[1.5px] border-[#7F77DD] opacity-0"
          style={{ animation: 'ml-pulse-ring 2s ease-out infinite' }} />
        <div className="absolute inset-[-4px] rounded-[14px] border-[1.5px] border-[#7F77DD] opacity-0"
          style={{ animation: 'ml-pulse-ring 2s ease-out infinite', animationDelay: '0.7s' }} />
        {/* SVG cerveau */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M9.5 2C7.6 2 6 3.3 5.5 5.1C4.1 5.4 3 6.6 3 8c0 .9.4 1.7 1 2.3C3.4 11 3 11.9 3 13c0 1.9 1.3 3.5 3 3.9V18c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-1.1c1.7-.4 3-2 3-3.9 0-1.1-.4-2-1-2.7.6-.6 1-1.4 1-2.3 0-1.4-1.1-2.6-2.5-2.9C18 3.3 16.4 2 14.5 2c-1 0-1.9.4-2.5 1C11.4 2.4 10.5 2 9.5 2z" fill="#7F77DD" />
          <circle cx="9" cy="9" r="1.2" fill="#EEEDFE" />
          <circle cx="15" cy="9" r="1.2" fill="#EEEDFE" />
          <path d="M9 13.5c.8.8 2 1.3 3 1.3s2.2-.5 3-1.3" stroke="#EEEDFE" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text mb-0.5">Modèle IA à réentraîner</p>
        <p className="text-xs text-text-muted mb-2.5 leading-relaxed">
          {correctionsCount} correction{correctionsCount > 1 ? 's' : ''} depuis le dernier entraînement — le modèle peut être amélioré.
        </p>
        {/* Pills */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#534AB7]">
            {correctionsCount} corrections
          </span>
          {daysSince < 999 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#854F0B]">
              {daysSince}j sans entraînement
            </span>
          )}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRetrain}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7F77DD] text-white rounded-md text-xs font-medium hover:bg-[#534AB7] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" fill="white" />
            </svg>
            Entraîner maintenant
          </button>
          <button
            onClick={() => toast.dismiss(toastId)}
            className="px-2.5 py-1.5 text-xs text-text-muted border border-border rounded-md hover:bg-surface-hover transition-colors"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}
```

### Keyframes CSS à ajouter dans `frontend/src/index.css`

```css
@keyframes ml-pulse-ring {
  0%   { transform: scale(0.88); opacity: 0.7; }
  100% { transform: scale(1.18); opacity: 0; }
}
@keyframes ml-toast-progress {
  from { width: 100%; }
  to   { width: 0%; }
}
@keyframes ml-neuron-blink {
  0%, 80%, 100% { transform: scale(1); opacity: 0.4; }
  40%           { transform: scale(1.5); opacity: 1; }
}
```

### Déclenchement dans `frontend/src/components/layout/AppLayout.tsx`

**Une seule fois par session** (sessionStorage, pas localStorage — se réinitialise à chaque rechargement).

```tsx
// Dans AppLayout — après les hooks existants
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import MLRetrainToast from '@/components/shared/MLRetrainToast'

// Dans le composant AppLayout :
const mlToastShown = useRef(false)

const { data: tasks } = useQuery({
  queryKey: ['tasks-ml-check'],
  queryFn: () => api.get<{ tasks: Task[] }>(`/tasks?year=${currentYear}`),
  staleTime: 5 * 60 * 1000, // 5 min
})

useEffect(() => {
  if (mlToastShown.current) return
  if (sessionStorage.getItem('ml-retrain-toast-shown')) return

  const mlTask = tasks?.tasks?.find(t => t.auto_key === 'ml_retrain')
  if (!mlTask) return

  mlToastShown.current = true
  sessionStorage.setItem('ml-retrain-toast-shown', '1')

  const corrections = mlTask.metadata?.corrections_count ?? 0
  const days = mlTask.metadata?.days_since_training ?? 999

  const toastId = 'ml-retrain'
  toast.custom(
    (t) => (
      <MLRetrainToast
        toastId={toastId}
        correctionsCount={corrections}
        daysSince={days}
      />
    ),
    {
      id: toastId,
      duration: 8000,
      position: 'bottom-right',
    }
  )
}, [tasks])
```

---

## Type TypeScript — ajouter dans `frontend/src/types/index.ts`

```typescript
// Sur l'interface Task existante, ajouter le champ metadata optionnel :
export interface Task {
  // ... champs existants ...
  metadata?: {
    corrections_count?: number
    days_since_training?: number
    action_url?: string
    [key: string]: unknown
  }
}
```

---

## Ordre d'implémentation

1. Lire `task_service.py` pour comprendre la structure exacte des tâches auto
2. Ajouter les helpers `_count_corrections_since_last_training()` + `_days_since_last_training()`
3. Ajouter la 6e détection dans `generate_auto_tasks()`
4. Ajouter le champ `metadata` sur le modèle Pydantic `Task` (`backend/models/task.py`) si absent
5. Créer `MLRetrainToast.tsx`
6. Ajouter les keyframes dans `index.css`
7. Intégrer le déclenchement dans `AppLayout.tsx`
8. Tester : `POST /api/tasks/refresh?year=2025` → vérifier que la tâche `ml_retrain` apparaît

## Contraintes

- `from __future__ import annotations` en tête des fichiers Python modifiés
- Le toast ne se déclenche qu'**une seule fois par session** (sessionStorage)
- Ne jamais déclencher si `corrections_since_training === 0`
- `generate_auto_tasks()` est entourée d'un try/except global — la 6e détection aussi
- Ne pas modifier `useRapprochementWorkflow`, `RapprochementWorkflowDrawer` ni `ml_service`
- Le champ `metadata` sur Task doit être `Optional[dict] = None` en Python pour backward compat
- react-hot-toast est déjà installé — utiliser `toast.custom()` pour les toasts HTML custom
