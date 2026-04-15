# Prompt — Bulk-lock des opérations dans JustificatifsPage

Lis `CLAUDE.md` avant de commencer.

## Contexte

Le verrouillage unitaire est implémenté (`LockCell`, `useToggleLock`, `PATCH /api/operations/{filename}/{index}/lock`).  
L'objectif est d'ajouter un **bulk-lock** : sélection de N opérations ayant déjà un justificatif → les verrouiller toutes en une action depuis JustificatifsPage.

---

## 1. Backend — Nouveau endpoint bulk-lock

### Fichier : `backend/routers/operations.py`

Ajouter un endpoint :

```
PATCH /api/operations/bulk-lock
```

**Modèles Pydantic** (dans le router ou `backend/models.py`) :

```python
class BulkLockItem(BaseModel):
    filename: str
    index: int
    locked: bool

class BulkLockRequest(BaseModel):
    items: list[BulkLockItem]

class BulkLockResultItem(BaseModel):
    filename: str
    index: int
    locked: bool
    locked_at: Optional[str]
    error: Optional[str] = None

class BulkLockResponse(BaseModel):
    results: list[BulkLockResultItem]
    success_count: int
    error_count: int
```

**Logique** :
- Grouper les items par `filename` pour éviter de charger/sauver le même fichier N fois.
- Pour chaque groupe : charger les ops du fichier, appliquer `locked` + `locked_at` (si `locked=True`) ou `locked_at=None` (si `locked=False`) sur chaque index, sauver une seule fois.
- Si un index est hors bornes ou fichier introuvable → remplir `error`, ne pas crasher les autres.
- Retourner `BulkLockResponse`.

---

## 2. Frontend — Hook `useBulkLock`

### Fichier : `frontend/src/hooks/useBulkLock.ts`

```typescript
interface BulkLockItem {
  filename: string
  index: number
  locked: boolean
}

export function useBulkLock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (items: BulkLockItem[]) =>
      api.patch('/operations/bulk-lock', { items }),
    onSuccess: (data, items) => {
      // Invalider toutes les queries opérations concernées (filenames uniques)
      const filenames = [...new Set(items.map(i => i.filename))]
      filenames.forEach(f => queryClient.invalidateQueries({ queryKey: ['operations', f] }))
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
    },
  })
}
```

---

## 3. Frontend — Sélection dans JustificatifsPage

### Contexte existant

`JustificatifsPage` a déjà un mécanisme de multi-sélection pour le **batch reconstitution fac-similé** (ops sans justificatif, `selectableOps`).  
Le bulk-lock cible des ops **avec justificatif** (`filter=avec` ou `filter=tous`).

### Modification de `useJustificatifsPage`

Ajouter un deuxième ensemble de sélection **indépendant** pour le bulk-lock :

```typescript
// Sélection bulk-lock (ops avec justificatif)
const [lockSelectedOps, setLockSelectedOps] = useState<Set<string>>(new Set())
// clé = `${op._filename ?? selectedFile?.filename}::${op._originalIndex ?? index}`
```

Exposer depuis le hook :
- `lockSelectedOps: Set<string>`
- `lockableOps` — ops filtrées : `hasJustificatif === true && !isOpExempt(op)` (opérations lockables)
- `toggleLockSelection(key: string): void`
- `toggleAllLockSelection(): void` — select all si aucun sélectionné, deselect all sinon
- `clearLockSelection(): void`

Reset `lockSelectedOps` au changement de `selectedFile` ou `selectedMonth`.

### Checkbox dans la table

Dans la colonne de rendu des rows de `JustificatifsPage` :

- Afficher une **checkbox** (même style que les checkboxes batch existantes, 22px) dans la colonne Lock **à la place du `LockCell`** uniquement quand :
  - `lockSelectedOps.size > 0` (mode sélection actif) **OU** au hover de la row
  - ET `op` est dans `lockableOps`
- Sinon afficher `LockCell` comme avant.
- La checkbox reflète `lockSelectedOps.has(key)`.
- Checkbox en header de la colonne Lock : `toggleAllLockSelection()` sur les `lockableOps` visibles.

> Pattern identique au toggle entre checkbox et icône trombone existant dans la page.

---

## 4. Frontend — Barre flottante bulk-lock

### Fichier : `frontend/src/components/BulkLockBar.tsx` (nouveau)

Barre flottante positionnée en bas de page (`fixed bottom-6 left-1/2 -translate-x-1/2 z-50`), visible quand `lockSelectedOps.size > 0`.

**Contenu** :
```
[Lock icon]  Verrouiller (N)    [×]
```

- Bouton principal : `Lock` orange `text-warning` + label `Verrouiller (N)` — déclenche `handleBulkLock`.
- Bouton × : `clearLockSelection()`.
- Pendant le loading : spinner + label `Verrouillage…`, boutons disabled.

**`handleBulkLock`** :
1. Construire `items: BulkLockItem[]` depuis `lockSelectedOps` (parser `filename::index`).
2. Appeler `bulkLockMutation.mutateAsync(items)`.
3. Toast succès : `"N opération(s) verrouillée(s)"` avec détail si erreurs partielles.
4. `clearLockSelection()`.

**Style** : cohérent avec la barre flottante `BatchReconstituerBar` existante — fond `bg-surface border border-border shadow-xl rounded-2xl px-4 py-3 flex items-center gap-3`.

---

## 5. Intégration dans `JustificatifsPage`

- Importer `BulkLockBar` et le rendre en bas de page sous les autres barres flottantes.
- Passer `lockSelectedOps`, `clearLockSelection`, `lockableOps`, `bulkLockMutation` en props ou via le hook directement.
- S'assurer que les deux barres (`BatchReconstituerBar` et `BulkLockBar`) ne se superposent pas : décaler `BulkLockBar` à `bottom-20` si `BatchReconstituerBar` est visible (`selectedOps.size > 0`).

---

## 6. Checklist de vérification

- [ ] `PATCH /api/operations/bulk-lock` enregistré dans le router FastAPI (`include_router` dans `main.py` si router séparé ou inline dans `operations.py`).
- [ ] Groupement par filename : un seul `save` par fichier dans le bulk.
- [ ] `locked_at` set à `datetime.now().isoformat(timespec="seconds")` si `locked=True`, `None` si `locked=False`.
- [ ] Reset `lockSelectedOps` au changement de mois/fichier.
- [ ] Checkbox header colonne Lock : sélectionne uniquement les `lockableOps` visibles (filtrés + paginés).
- [ ] `LockCell` affiché normalement quand mode sélection inactif et pas en hover.
- [ ] `BulkLockBar` disparaît après succès (`clearLockSelection`).
- [ ] Pas de régression sur `BatchReconstituerBar` (sélection fac-similé indépendante).
- [ ] Toast partiel si `error_count > 0` : `"N verrouillée(s), M erreur(s)"`.
- [ ] TypeScript strict, aucun `any`.
