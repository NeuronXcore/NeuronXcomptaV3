# JustifToOpDrawer — Association sens inverse (justificatif → opération)

## Objectif

Drawer dédié à l'association dans le sens **justificatif → opération**, symétrique de `ManualAssociationDrawer`. L'utilisateur part d'un justificatif en attente, consulte les opérations candidates scorées, et associe directement ou navigue vers l'opération.

**Endpoint backend symétrique déjà existant :**
`GET /api/rapprochement/suggestions/justificatif/{filename}`
→ retourne les ops candidates scorées pour un justificatif donné (même format score que le sens inverse).

**Points d'entrée :**
- Onglet OCR (`/ocr`) → Gestion OCR : bouton "Associer" par row + bouton bulk sur sélection
- GED (`/ged`) → `GedDocumentDrawer` : bouton "Associer à une opération" dans les Actions, visible si `status === 'en_attente'`

---

## 1. Fichiers à créer

1. **`frontend/src/components/justificatifs/JustifToOpDrawer.tsx`** — composant principal (~450 LOC)
2. **`frontend/src/hooks/useJustifToOp.ts`** — hook données + logique (~180 LOC)

## 2. Fichiers à modifier

1. **`frontend/src/components/ged/GedDocumentDrawer.tsx`** — bouton Actions pour justifs en attente + state + édition inline OCR

## 3. Fichiers à ne pas toucher

- `backend/` (aucun endpoint nouveau)
- `ManualAssociationDrawer.tsx`
- `RapprochementWorkflowDrawer.tsx`

---

## Hook `useJustifToOp`

### Signature

```typescript
interface UseJustifToOpArgs {
  open: boolean
  initialFilename?: string   // justificatif pré-sélectionné à l'ouverture (depuis OCR/GED)
}

export function useJustifToOp({ open, initialFilename }: UseJustifToOpArgs)
```

### State interne

```typescript
const [selectedFilename, setSelectedFilename] = useState<string | null>(initialFilename ?? null)
const [justifSearch, setJustifSearch] = useState('')    // filtre liste gauche
const [previewFilename, setPreviewFilename] = useState<string | null>(null)
```

`useEffect` : quand `open` passe à `true` et `initialFilename` fourni → `setSelectedFilename(initialFilename)` + `setPreviewFilename(initialFilename)` (auto-preview du justif pré-sélectionné).

### Données — liste justificatifs en attente (panneau gauche)

```typescript
const justifListQuery = useQuery({
  queryKey: ['justif-en-attente'],
  queryFn: () => api.get<JustificatifInfo[]>('/api/justificatifs/?status=en_attente'),
  enabled: open,
  staleTime: 30_000,
})
```

Filtre local : `justifSearch` sur `filename` + `supplier` (OCR data).

### Données — ops candidates (panneau droit)

```typescript
const suggestionsQuery = useQuery({
  queryKey: ['justif-to-op-suggestions', selectedFilename],
  queryFn: () =>
    api.get<JustifToOpSuggestion[]>(
      `/api/rapprochement/suggestions/justificatif/${encodeURIComponent(selectedFilename!)}`
    ),
  enabled: !!selectedFilename,
  staleTime: 30_000,
})
```

Type retourné (adapter depuis l'api-reference) :

```typescript
interface JustifToOpSuggestion {
  filename: string           // fichier d'opérations
  index: number
  libelle: string
  date: string
  montant: number
  categorie?: string
  score: number
  score_detail?: JustificatifScoreDetail
  locked?: boolean
}
```

### Mutation — association

Réutiliser `useManualAssociate()` (`hooks/useRapprochement.ts:78-99`) tel quel.

```typescript
function associate(op: JustifToOpSuggestion) {
  mutate({
    justificatif_filename: selectedFilename!,
    operation_file: op.filename,
    operation_index: op.index,
    rapprochement_score: op.score ?? null,
    force: false,
  }, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justif-en-attente'] })
      toast.success('Justificatif associé')
      // passer au justificatif suivant dans la liste
      goToNextJustif()
    },
    onError: (err: any) => {
      if (err?.response?.status === 423) {
        toast.error('Opération verrouillée — déverrouillez d\'abord')
      } else {
        toast.error('Erreur lors de l\'association')
      }
    },
  })
}
```

### Navigation

```typescript
function goToNextJustif() {
  const list = filteredJustifs
  const idx = list.findIndex(j => j.filename === selectedFilename)
  if (idx < list.length - 1) {
    setSelectedFilename(list[idx + 1].filename)
    setPreviewFilename(list[idx + 1].filename)  // auto-preview du suivant
  } else {
    onClose()  // dernier justif traité → ferme
  }
}

function togglePreview(filename: string) {
  setPreviewFilename(prev => prev === filename ? null : filename)
}
```

### Helpers exposés

`filteredJustifs`, `selectedJustif`, `suggestions`, `associate`, `goToNextJustif`, `togglePreview`, `previewFilename`, `justifSearch`, `setJustifSearch`

---

## Composant `JustifToOpDrawer`

### Props

```typescript
interface JustifToOpDrawerProps {
  open: boolean
  onClose: () => void
  initialFilename?: string    // pré-sélection depuis OCR/GED
}
```

### Layout

```
Backdrop (bg-black/30, z-40) + Drawer 1000px max-w-[95vw] (z-50)
├── Header (border-b, px-5 py-4)
│   ├── h2 "Rechercher une opération pour ce justificatif"
│   └── btn × (aligned end)
├── Body (flex row, flex-1, min-h-0)
│   ├── PreviewPanel (width: previewFilename ? 320px : 0, transition .25s, border-r)
│   │   [header: filename parsé + btn × | <object PDF preview> | filename footer]
│   ├── JustifPanel (280px, border-r, flex flex-col)
│   │   [sub-header "Justificatifs en attente (N)" + input search]
│   │   [ul scrollable: row justif (PdfThumbnail cliquable, supplier, date, montant, badge OCR partiel)]
│   └── OpsPanel (flex-1, flex flex-col)
│       [sub-header "Opérations candidates (N)" + label tri "meilleur score"]
│       [Hint italique : "Justificatif sélectionné : {supplier} · {date} · {montant}"]
│       [ul scrollable: row op (date, libellé, cat, montant, ScorePills, btn Associer, btn Voir)]
└── Footer (border-t, px-5 py-3, flex justify-between)
    ├── "{N} justificatifs en attente · {M} opérations candidates"
    └── btns [Ignorer] [Suivant →]
```

### Rows justificatifs (panneau gauche)

- `PdfThumbnail` 32×38px — clic → `togglePreview(filename)` (ouvre le preview PDF)
- Clic sur la row → `setSelectedFilename(filename)` (charge les suggestions à droite)
- Row `.selected` → `bg-primary/10 border-l-2 border-primary`
- Row `.previewing` → même style si preview ouvert sur ce justif
- Badge "OCR partiel" amber si `!ocr_data?.best_date || !ocr_data?.best_amount`
- Affichage : supplier · date courte · montant

### Rows opérations candidates (panneau droit)

- Affichage : date · libellé tronqué · catégorie · montant rouge · `ScorePills`
- Badge `locked` orange si `op.locked === true`
- **Bouton "Associer"** (primary, `Link2` icon) → `associate(op)` ; désactivé si `op.locked`
- **Bouton "Voir"** (ghost, `ExternalLink` icon) → navigation vers JustificatifsPage :

```typescript
function navigateToOp(op: JustifToOpSuggestion) {
  // Construire l'URL avec highlight
  const params = new URLSearchParams({
    file: op.filename,
    highlight: String(op.index),
    filter: 'sans',
  })
  window.location.href = `/justificatifs?${params}`
  onClose()
}
```

- Première ligne (score >= 0.80) : `bg-emerald-500/10 border-l-2 border-emerald-500`

### Panneau preview PDF

Identique à `ManualAssociationDrawer` § 9 :
- `<object type="application/pdf" data="/api/justificatifs/{previewFilename}/preview#toolbar=1">`
- Header : supplier parsé depuis filename + btn ×
- Instance unique → `<object>` autorisé (règle CLAUDE.md)
- Auto-ouverte sur `initialFilename` si fourni

### Footer navigation

- **"Ignorer"** → `goToNextJustif()` sans association
- **"Suivant →"** → `goToNextJustif()`
- Après `associate()` → auto `goToNextJustif()`

### Raccourcis clavier

- `Esc` → `onClose()`
- `↓` / `↑` → navigue dans la liste justificatifs (panneau gauche)
- `→` → `goToNextJustif()`
- `Enter` → associe la première suggestion si score >= 0.80
- Désactivés si focus dans un `<input>`

---

## Intégration GED uniquement — `GedDocumentDrawer.tsx`

Dans le panneau Actions du drawer, si le document est un justificatif `en_attente` :

```tsx
{doc.type === 'justificatif' && doc.association_status === 'en_attente' && (
  <button
    onClick={() => { setJustifToOpFilename(doc.filename); setJustifToOpOpen(true) }}
    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-surface rounded-md transition-colors"
  >
    <Link2 size={14} />
    Associer à une opération
  </button>
)}
```

State à ajouter dans `GedDocumentDrawer` :

```typescript
const [justifToOpOpen, setJustifToOpOpen] = useState(false)
const [justifToOpFilename, setJustifToOpFilename] = useState<string | undefined>()
```

Mount en overlay sur le drawer existant (z-index supérieur) :

```tsx
<JustifToOpDrawer
  open={justifToOpOpen}
  onClose={() => { setJustifToOpOpen(false); setJustifToOpFilename(undefined) }}
  initialFilename={justifToOpFilename}
/>
```

---

## Tests manuels

1. **Depuis GED** — justif `en_attente`, clic "Associer à une opération" → drawer s'ouvre, justif pré-sélectionné + preview auto ouvert, ops candidates chargées.
2. **Édition inline date** — saisir une date corrigée → blur → `PATCH /api/ocr/{filename}/extracted-data` → suggestions rechargées automatiquement.
3. **Édition inline montant** — idem, suggestions rechargées avec nouveau score.
4. **Édition inline supplier** — correction du fournisseur → rechargement.
5. **Navigation liste gauche** — sélectionner un autre justif → suggestions rechargées, champs inline mis à jour, preview bascule.
6. **Association directe** — clic "Associer" → mutation → toast → justif suivant auto-sélectionné.
7. **Navigation vers JustificatifsPage** — clic "Voir" → redirect `?file=X&highlight=Y&filter=sans`.
8. **Locked 423** — op verrouillée → bouton "Associer" désactivé (badge orange) + toast si tentative.
9. **Fin de liste** — dernier justif traité → drawer ferme automatiquement.
10. **Preview toggle** — clic thumbnail → panel slide 250ms, re-clic → ferme.
11. **Régression** — `ManualAssociationDrawer`, `RapprochementWorkflowDrawer`, `OcrEditDrawer` non affectés.

---

## Non-goals (v1)

- Pas de filtre libre date/montant côté ops (v2 si besoin)
- Point d'entrée OCR tab non implémenté (GED suffit pour v1)
- Pas de mode élargi (toutes les ops) — le cas inverse (OCR justif bon, op mal catégorisée) est moins fréquent
- Pas de multi-sélection de justificatifs
- Pas de bulk association

---

## Édition inline OCR — panneau justificatif sélectionné

Quand un justificatif est sélectionné dans le panneau gauche, afficher sous sa row (ou dans un mini-panel dédié entre les deux colonnes) **3 champs éditables** pour corriger les données OCR sans quitter le drawer.

### Affichage

```
┌─────────────────────────────────────────────┐
│ [PdfThumb]  amazon_20250312_xxxx.pdf         │  ← row sélectionnée
│             ⚠ OCR partiel                    │
├─────────────────────────────────────────────┤
│ Corriger les données OCR                     │  ← zone inline (visible si selected)
│                                              │
│  Date      [  15/03/2025  ]                  │
│  Montant   [  124,99      ]  €               │
│  Fournisseur [ Amazon     ]                  │
│                                    [Appliquer] │
└─────────────────────────────────────────────┘
```

Zone collapsée sur les autres rows, expansée sur la row `.selected`.

### State local

```typescript
const [editDate, setEditDate] = useState('')
const [editAmount, setEditAmount] = useState('')
const [editSupplier, setEditSupplier] = useState('')
const [isSavingOcr, setIsSavingOcr] = useState(false)
```

`useEffect` sur `selectedFilename` → initialise les 3 champs depuis `selectedJustif.ocr_data` :
```typescript
setEditDate(selectedJustif?.ocr_data?.best_date ?? '')
setEditAmount(selectedJustif?.ocr_data?.best_amount?.toString() ?? '')
setEditSupplier(selectedJustif?.ocr_data?.supplier ?? '')
```

### Mutation OCR

Bouton "Appliquer" (ou `onBlur` sur chaque champ) → `PATCH /api/ocr/{filename}/extracted-data` :

```typescript
async function saveOcrEdit() {
  if (!selectedFilename) return
  setIsSavingOcr(true)
  try {
    await api.patch(`/api/ocr/${encodeURIComponent(selectedFilename)}/extracted-data`, {
      best_date: editDate || undefined,
      best_amount: editAmount ? parseFloat(editAmount.replace(',', '.')) : undefined,
      supplier: editSupplier || undefined,
    })
    // Recharger les suggestions avec les nouvelles données
    queryClient.invalidateQueries({ queryKey: ['justif-to-op-suggestions', selectedFilename] })
    queryClient.invalidateQueries({ queryKey: ['justif-en-attente'] })
    toast.success('Données OCR corrigées')
  } catch {
    toast.error('Erreur lors de la correction OCR')
  } finally {
    setIsSavingOcr(false)
  }
}
```

### UX

- Bouton "Appliquer" : spinner si `isSavingOcr`, disabled pendant la requête
- Champ date : `type="text"` placeholder `jj/mm/aaaa` (cohérent avec `ManualAssociationDrawer`)
- Champ montant : `type="number"` step `0.01`
- Badge "OCR partiel" sur la row disparaît après correction réussie (via invalidation query)
- Si tous les champs identiques aux valeurs initiales → bouton "Appliquer" disabled (pas de requête inutile)
- Rechargement suggestions auto après succès → scores mis à jour visuellement sans action supplémentaire
