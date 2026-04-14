# Feature : Verrouillage des opérations validées

> Lire `CLAUDE.md` avant de commencer.

## Objectif

Ajouter un champ `locked` par opération pour protéger les associations justificatif ↔ opération validées manuellement contre l'écrasement par le rapprochement automatique.

**Règles métier :**
- Toute association via `associate-manual` → `locked: true` automatiquement
- Le rapprochement auto (`run_auto`) **skip silencieusement** les ops lockées
- Le CTA "Associer automatiquement" **exclut** les ops lockées
- Dissocier ou ré-associer une op lockée → bloqué côté backend (HTTP 423)
- Unlock uniquement via un endpoint dédié, déclenché par une popup de confirmation dans l'UI
- L'édition de catégorie/commentaire reste autorisée même lockée (le lock concerne uniquement le justificatif)

---

## 1. Modèle de données

### Backend — champ opération

Dans `backend/models/operation.py` (ou l'équivalent), ajouter au modèle Pydantic :

```python
locked: Optional[bool] = False
locked_at: Optional[str] = None  # ISO datetime string
```

Ces champs sont stockés directement dans les fichiers `operations_*.json` existants.

### Frontend — type Operation

Dans `frontend/src/types/index.ts`, ajouter à l'interface `Operation` :

```typescript
locked?: boolean
locked_at?: string
```

---

## 2. Backend

### 2.1 `rapprochement_service.py` — `run_auto()`

Dans la boucle d'itération des opérations candidates, ajouter **avant le calcul de score** :

```python
if op.get("locked"):
    continue  # skip silencieusement
```

### 2.2 `rapprochement_service.py` — `associate_manual()`

Après l'association réussie, **ajouter** :

```python
op["locked"] = True
op["locked_at"] = datetime.now().isoformat(timespec="seconds")
```

### 2.3 `rapprochement_service.py` — `associate_manual()` et `dissociate()`

En tête des deux fonctions, **avant toute modification**, ajouter une garde :

```python
if op.get("locked"):
    raise HTTPException(status_code=423, detail="Opération verrouillée — déverrouillez avant de modifier l'association.")
```

Pour `associate_manual`, ajouter un paramètre optionnel `force: bool = False` dans le body. Si `force=True`, ignorer la garde (utilisé par l'endpoint unlock+réassocier si besoin futur).

### 2.4 Nouveau endpoint `PATCH /api/operations/{filename}/{index}/lock`

Dans `backend/routers/operations.py` (ou le router approprié), ajouter :

**Request body Pydantic :**
```python
class LockRequest(BaseModel):
    locked: bool
```

**Handler :**
```python
@router.patch("/{filename}/{index}/lock")
async def toggle_lock(filename: str, index: int, body: LockRequest):
    ops = load_operations(filename)  # helper existant
    op = ops[index]
    op["locked"] = body.locked
    if body.locked:
        op["locked_at"] = datetime.now().isoformat(timespec="seconds")
    else:
        op["locked_at"] = None
    save_operations(filename, ops)  # helper existant
    return {"locked": op["locked"], "locked_at": op.get("locked_at")}
```

Utiliser les helpers existants de chargement/sauvegarde des opérations (même pattern que le toggle `lettre`).

---

## 3. Frontend

### 3.1 Hook `useToggleLock`

Créer `frontend/src/hooks/useToggleLock.ts` :

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface ToggleLockParams {
  filename: string
  index: number
  locked: boolean
}

export function useToggleLock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ filename, index, locked }: ToggleLockParams) =>
      api.patch(`/operations/${filename}/${index}/lock`, { locked }),
    onSuccess: (_data, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
    },
  })
}
```

### 3.2 Composant `UnlockConfirmModal`

Créer `frontend/src/components/UnlockConfirmModal.tsx` :

```tsx
import { Lock } from 'lucide-react'

interface Props {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function UnlockConfirmModal({ open, onConfirm, onCancel, loading }: Props) {
  if (!open) return null

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl p-6 w-[380px] space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Icône + titre */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center">
            <Lock className="w-5 h-5 text-warning" />
          </div>
          <h3 className="text-text font-semibold text-base">Déverrouiller l'association ?</h3>
        </div>

        {/* Message */}
        <p className="text-text-muted text-sm leading-relaxed">
          Cette opération est verrouillée. La déverrouiller permettra au rapprochement
          automatique de modifier ou supprimer son justificatif associé.
        </p>

        {/* Boutons */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-text-muted hover:bg-surface-hover transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-warning text-white hover:bg-warning/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Déverrouillage…' : 'Déverrouiller'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

### 3.3 Composant `LockCell`

Créer `frontend/src/components/LockCell.tsx` :

```tsx
import { useState } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { useToggleLock } from '@/hooks/useToggleLock'
import { UnlockConfirmModal } from './UnlockConfirmModal'
import toast from 'react-hot-toast'

interface Props {
  filename: string
  index: number
  locked: boolean
  hasJustificatif: boolean  // n'affiche rien si pas de justificatif
}

export function LockCell({ filename, index, locked, hasJustificatif }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const toggleLock = useToggleLock()

  if (!hasJustificatif) return null  // cellule vide

  const handleClick = () => {
    if (locked) {
      setConfirmOpen(true)
    } else {
      // Lock immédiat sans popup
      toggleLock.mutate(
        { filename, index, locked: true },
        { onSuccess: () => toast.success('Opération verrouillée') }
      )
    }
  }

  const handleConfirmUnlock = () => {
    toggleLock.mutate(
      { filename, index, locked: false },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          toast.success('Opération déverrouillée')
        },
        onError: () => toast.error('Erreur lors du déverrouillage'),
      }
    )
  }

  return (
    <>
      <button
        onClick={handleClick}
        title={locked ? 'Verrouillé — cliquer pour déverrouiller' : 'Cliquer pour verrouiller'}
        className="p-1 rounded hover:bg-surface-hover transition-colors"
      >
        {locked ? (
          <Lock className="w-3.5 h-3.5 text-warning" />
        ) : (
          <LockOpen className="w-3.5 h-3.5 text-text-muted/40 hover:text-text-muted" />
        )}
      </button>

      <UnlockConfirmModal
        open={confirmOpen}
        onConfirm={handleConfirmUnlock}
        onCancel={() => setConfirmOpen(false)}
        loading={toggleLock.isPending}
      />
    </>
  )
}
```

---

## 4. Intégration JustificatifsPage

Dans le tableau de la JustificatifsPage, dans la cellule qui affiche le lien/thumbnail du justificatif, ajouter `LockCell` **à droite** du lien PDF :

```tsx
// Dans la colonne justificatif existante
<div className="flex items-center gap-1.5">
  {/* lien thumbnail/nom existant */}
  <button onClick={() => setPreviewJustif(op['Lien justificatif'])} ...>
    <PdfThumbnail justificatifFilename={op['Lien justificatif']} ... />
  </button>
  
  {/* Nouveau : cadenas */}
  <LockCell
    filename={op._filename}
    index={op._originalIndex}
    locked={!!op.locked}
    hasJustificatif={!!op['Justificatif']}
  />
</div>
```

**Important** : le CTA "Associer automatiquement" (`run-auto`) côté frontend doit filtrer les ops lockées avant de les envoyer. Si le bouton déclenche une mutation backend (le backend filtre déjà), c'est suffisant — pas de changement frontend requis ici.

---

## 5. Intégration EditorPage

### 5.1 Nouvelle colonne `locked` dans la définition des colonnes

Après la colonne **Justificatif** (CheckboxCell trombone), ajouter une colonne dédiée **sans header** :

```typescript
{
  id: 'locked',
  header: '',  // pas de header
  size: 28,
  enableSorting: false,
  enableColumnFilter: false,
  cell: ({ row }) => {
    const op = row.original
    return (
      <LockCell
        filename={selectedFile!.filename}
        index={row.index}  // ou op._originalIndex si year-wide
        locked={!!op.locked}
        hasJustificatif={!!op['Justificatif']}
      />
    )
  },
}
```

Placer cette colonne immédiatement **après** la colonne `Justificatif` dans le `columnDefs` array.

### 5.2 Mode year-wide (lecture seule)

En mode "Toute l'année", le `LockCell` doit utiliser `op._filename` et `op._originalIndex` au lieu du fichier sélectionné :

```typescript
filename={op._filename ?? selectedFile!.filename}
index={op._originalIndex ?? row.index}
```

---

## 6. Checklist de vérification

- [ ] Nouveau endpoint `PATCH /api/operations/{filename}/{index}/lock` répond 200
- [ ] `associate-manual` retourne 423 sur une op lockée
- [ ] `run_auto` ne touche pas les ops lockées (vérifier dans les logs)
- [ ] `associate-manual` set `locked: true` automatiquement
- [ ] `LockCell` s'affiche dans EditorPage et JustificatifsPage
- [ ] Popup unlock : Annuler → pas de changement, Confirmer → déverrouille
- [ ] Lock immédiat (LockOpen → Lock) sans popup
- [ ] Toast success sur lock/unlock
- [ ] Invalidation query après toggle → UI se met à jour
- [ ] Mode year-wide EditorPage : lock/unlock fonctionnel via `_filename` + `_originalIndex`
- [ ] Aucune régression sur le rapprochement auto existant
