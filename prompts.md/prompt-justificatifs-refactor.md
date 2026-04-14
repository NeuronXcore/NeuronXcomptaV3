# Refonte Page Justificatifs — Vue opérations-centrée avec drawer attribution

> **Lire `CLAUDE.md` en premier.**

## Contexte

La page Justificatifs (`/justificatifs`) est actuellement une galerie de justificatifs. On la refond en **vue opérations-centrée** : tableau des opérations bancaires avec sélecteur année/mois, tri/recherche, et un drawer d'attribution manuelle au clic sur la colonne justificatif.

## Ordre d'implémentation

1. Nouveau hook `useJustificatifsPage.ts`
2. Composant `JustificatifAttributionDrawer.tsx`
3. Refonte `JustificatifsPage.tsx`
4. Ajustements backend (endpoint suggestions enrichi)

---

## 1. Hook `frontend/src/hooks/useJustificatifsPage.ts`

Nouveau hook dédié à la page refondée. Réutilise les hooks existants (`useOperationFiles`, `useOperations`, `useYearOperations`) + logique locale.

```typescript
import { useState, useMemo, useCallback } from 'react'
import { useFiscalYearStore } from '../stores/useFiscalYearStore'
import { useOperationFiles, useOperations, useYearOperations } from './useOperations'

type SortKey = 'date' | 'libelle' | 'debit' | 'credit' | 'categorie'
type SortOrder = 'asc' | 'desc'
type JustifFilter = 'all' | 'sans' | 'avec'

export function useJustificatifsPage() {
  const { year, setYear } = useFiscalYearStore()
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [justifFilter, setJustifFilter] = useState<JustifFilter>('sans') // défaut: sans justificatif
  const [selectedOpIndex, setSelectedOpIndex] = useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Fichiers disponibles
  const { data: files = [] } = useOperationFiles()

  // Années et mois disponibles (même pattern que EditorPage)
  const availableYears = useMemo(() => {
    const years = [...new Set(files.map(f => f.year))].sort((a, b) => b - a)
    return years
  }, [files])

  const monthsForYear = useMemo(() => {
    return files
      .filter(f => f.year === year)
      .sort((a, b) => a.month - b.month)
  }, [files, year])

  // Fichier sélectionné
  const selectedFile = useMemo(() => {
    if (selectedMonth === null) return monthsForYear[0] ?? null
    return monthsForYear.find(f => f.month === selectedMonth) ?? null
  }, [monthsForYear, selectedMonth])

  // Chargement opérations (fichier unique ou année complète)
  const isYearWide = selectedMonth === 0 // 0 = "Toute l'année"
  const { data: singleOps } = useOperations(
    !isYearWide && selectedFile ? selectedFile.filename : ''
  )
  const filesForYear = useMemo(() =>
    isYearWide ? monthsForYear.map(f => f.filename) : [],
    [isYearWide, monthsForYear]
  )
  const { data: yearOps, isLoading: yearLoading } = useYearOperations(filesForYear, isYearWide)

  const rawOperations = isYearWide ? yearOps : (singleOps ?? [])

  // Filtrage + tri + recherche
  const operations = useMemo(() => {
    let ops = [...rawOperations]

    // Filtre justificatif
    if (justifFilter === 'sans') {
      ops = ops.filter(op => !op.justificatif)
    } else if (justifFilter === 'avec') {
      ops = ops.filter(op => !!op.justificatif)
    }

    // Recherche libre (libellé, catégorie, sous-catégorie)
    if (search.trim()) {
      const q = search.toLowerCase()
      ops = ops.filter(op =>
        (op.libelle ?? '').toLowerCase().includes(q) ||
        (op.categorie ?? '').toLowerCase().includes(q) ||
        (op.sous_categorie ?? '').toLowerCase().includes(q)
      )
    }

    // Tri
    ops.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date': cmp = (a.date ?? '').localeCompare(b.date ?? ''); break
        case 'libelle': cmp = (a.libelle ?? '').localeCompare(b.libelle ?? ''); break
        case 'debit': cmp = (a.debit ?? 0) - (b.debit ?? 0); break
        case 'credit': cmp = (a.credit ?? 0) - (b.credit ?? 0); break
        case 'categorie': cmp = (a.categorie ?? '').localeCompare(b.categorie ?? ''); break
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })

    return ops
  }, [rawOperations, justifFilter, search, sortKey, sortOrder])

  // Stats
  const stats = useMemo(() => {
    const total = rawOperations.length
    const avec = rawOperations.filter(op => !!op.justificatif).length
    const sans = total - avec
    const taux = total > 0 ? Math.round((avec / total) * 100) : 0
    return { total, avec, sans, taux }
  }, [rawOperations])

  // Toggle tri
  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }, [sortKey])

  // Ouvrir drawer pour une opération
  const openDrawer = useCallback((opIndex: number) => {
    setSelectedOpIndex(opIndex)
    setDrawerOpen(true)
  }, [])

  // Navigation post-attribution : sauter à la prochaine op sans justificatif
  const goToNextWithout = useCallback(() => {
    if (selectedOpIndex === null) return
    const currentIdx = operations.findIndex((_, i) => i === selectedOpIndex)
    for (let i = currentIdx + 1; i < operations.length; i++) {
      if (!operations[i].justificatif) {
        setSelectedOpIndex(i)
        return
      }
    }
    // Aucune suivante → fermer le drawer
    setDrawerOpen(false)
    setSelectedOpIndex(null)
  }, [selectedOpIndex, operations])

  return {
    // État
    year, setYear, selectedMonth, setSelectedMonth,
    search, setSearch,
    sortKey, sortOrder, toggleSort,
    justifFilter, setJustifFilter,
    selectedOpIndex, drawerOpen, setDrawerOpen,
    // Données
    availableYears, monthsForYear, selectedFile,
    operations, rawOperations, stats,
    isYearWide, isLoading: yearLoading,
    // Actions
    openDrawer, goToNextWithout,
  }
}
```

---

## 2. Composant `frontend/src/components/justificatifs/JustificatifAttributionDrawer.tsx`

Drawer 800px avec split resizable : liste justificatifs à gauche, iframe PDF preview à droite.

### Spécifications

- **Largeur** : 800px fixe, split resizable (poignée drag verticale au milieu)
  - Panneau gauche : min 300px, liste des justificatifs suggestions
  - Panneau droit : min 250px, iframe PDF preview
  - Poignée : `div` 4px, `cursor: col-resize`, `bg-border hover:bg-primary`, mousedown → mousemove → mouseup
  - Persister le ratio dans `localStorage('neuronx-justif-drawer-split')`

- **En-tête drawer** :
  - Titre : "Attribution justificatif"
  - Sous-titre : date + libellé + montant de l'opération sélectionnée
  - Bouton fermer (X)
  - Si l'opération a déjà un justificatif : afficher le justificatif lié avec bouton "Dissocier"

- **Panneau gauche — Liste justificatifs** :
  - Barre recherche en haut (recherche dans noms fichiers)
  - Select tri : "Par score ↓", "Par date ↓", "Par montant ↓"
  - Liste scrollable de cartes justificatif :
    - Nom fichier (tronqué)
    - Date OCR, montant OCR, fournisseur OCR
    - Badge score coloré (≥80% vert, ≥50% ambre, <50% gris)
    - Bouton "Attribuer"
  - **Hover 300ms** sur une carte → affiche le PDF dans l'iframe droite (utiliser `setTimeout` + `onMouseEnter`/`onMouseLeave` pour debounce)
  - En bas : `ReconstituerButton` si l'opération n'a pas de justificatif

- **Panneau droit — Preview PDF** :
  - `iframe` pleine hauteur, `src` = `/api/justificatifs/{filename}/preview`
  - Placeholder quand rien n'est survolé : icône FileText + "Survoler un justificatif pour prévisualiser"
  - Si l'opération a déjà un justificatif lié : afficher ce PDF par défaut

- **Post-attribution** :
  - Après `associate` mutation `onSuccess` :
    - Toast success
    - Invalider queries (`justificatifs`, `operations`)
    - Appeler `onNextWithout()` (prop) → saute à l'opération sans justificatif suivante
    - Flash highlight sur la nouvelle opération dans le tableau (via ref/scroll)

### Props

```typescript
interface JustificatifAttributionDrawerProps {
  open: boolean
  onClose: () => void
  operation: Operation | null
  operationFile: string  // filename du fichier ops
  operationIndex: number // index dans le fichier (attention: index original, pas filtré)
  onNextWithout: () => void // callback navigation post-attribution
}
```

### Données

- Suggestions : `GET /api/rapprochement/{filename}/{index}/suggestions` (endpoint existant avec scoring)
- Association : `POST /api/justificatifs/associate` (existant)
- Dissociation : `POST /api/justificatifs/dissociate` (existant)
- Preview : `GET /api/justificatifs/{filename}/preview` (existant)

### Implémentation split resizable

Même pattern que `GedDocumentDrawer` :

```typescript
const [splitX, setSplitX] = useState(() => {
  const saved = localStorage.getItem('neuronx-justif-drawer-split')
  return saved ? parseInt(saved) : 400
})
const dragging = useRef(false)

const onMouseDown = (e: React.MouseEvent) => {
  dragging.current = true
  e.preventDefault()
  const onMove = (ev: MouseEvent) => {
    if (!dragging.current) return
    // Calculer position relative au drawer
    const drawerEl = drawerRef.current
    if (!drawerEl) return
    const rect = drawerEl.getBoundingClientRect()
    const newX = ev.clientX - rect.left
    setSplitX(Math.max(300, Math.min(newX, 550)))
  }
  const onUp = () => {
    dragging.current = false
    localStorage.setItem('neuronx-justif-drawer-split', String(splitX))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
```

---

## 3. Refonte `frontend/src/components/justificatifs/JustificatifsPage.tsx`

Réécrire complètement le composant. Supprimer l'ancienne galerie. Structure :

```
PageHeader (titre + actions: badge sandbox + bouton "Ajouter via OCR")
├── Barre filtres (année, mois, recherche, filtre justif)
├── 4 MetricCards (total ops, avec justif, sans justif, taux %)
├── Tableau opérations (triable, colonnes cliquables)
│   ├── Date (triable)
│   ├── Libellé (triable)
│   ├── Débit (triable)
│   ├── Crédit (triable)
│   ├── Catégorie (triable)
│   └── Justif. (○/✓ cliquable → ouvre drawer)
└── JustificatifAttributionDrawer
```

### Sélecteur année/mois

- Pattern identique à EditorPage : année depuis le store Zustand, mois en `useState` local
- Dropdown mois affiche `"{MOIS_FR[m]} ({count} ops)"` + option `"Toute l'année"`
- Sync bidirectionnelle avec le store année global
- `useEffect` : quand l'année change, reset `selectedMonth` au premier mois disponible

### Tableau opérations

- **Pas** TanStack Table (trop lourd pour ce cas). Simple `<table>` avec headers cliquables.
- Headers avec icône `↕` (neutre) ou `↑`/`↓` (actif). Appel `toggleSort(key)` au clic.
- Colonne "Justif." :
  - `✓` vert si `op.justificatif` existe
  - `○` ambre sinon
  - Au clic → `openDrawer(originalIndex)` (attention à l'index original dans le fichier, pas l'index filtré)
  - Au hover sur ○ : tooltip "Cliquer pour attribuer un justificatif"
- Lignes : hover highlight (`bg-surface/50`)
- **Index original** : chaque opération dans `operations` porte son index original via un champ ajouté au mapping. Pour le mode année complète (isYearWide), utiliser `_sourceFile` + index dans ce fichier.

### Gestion des index

C'est le point critique. Le drawer a besoin du `filename` + `index` original (dans le fichier JSON) pour appeler les endpoints.

Dans le hook, enrichir les opérations :

```typescript
// Dans useJustificatifsPage, lors du mapping des opérations
const enrichedOps = rawOperations.map((op, idx) => ({
  ...op,
  _originalIndex: idx,
  _filename: isYearWide ? op._sourceFile : selectedFile?.filename,
}))
```

Puis au clic :
```typescript
const op = operations[clickedRow]
openDrawer(op._originalIndex)
// Le drawer reçoit op._filename et op._originalIndex
```

### Flash highlight post-attribution

Quand `goToNextWithout()` est appelé et change `selectedOpIndex` :

```typescript
// Dans JustificatifsPage
useEffect(() => {
  if (selectedOpIndex !== null) {
    const row = document.getElementById(`op-row-${selectedOpIndex}`)
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row.classList.add('flash-highlight')
      setTimeout(() => row.classList.remove('flash-highlight'), 1500)
    }
  }
}, [selectedOpIndex])
```

CSS (ajouter dans `index.css`) :
```css
.flash-highlight {
  animation: flash 1.5s ease-out;
}
@keyframes flash {
  0% { background-color: var(--color-amber-100); }
  100% { background-color: transparent; }
}
```

### Sandbox badge

Garder le badge SSE existant (`useSandbox`). Afficher un petit badge "Sandbox actif" vert à côté du titre si le watchdog est connecté.

---

## 4. Backend — Pas de nouveau endpoint

Tous les endpoints nécessaires existent déjà :
- `GET /api/operations/files` — liste fichiers
- `GET /api/operations/{filename}` — opérations
- `GET /api/rapprochement/{filename}/{index}/suggestions` — suggestions avec scores (supporte filtres `search`, `montant_min`, `montant_max`, `date_from`, `date_to`)
- `POST /api/justificatifs/associate` — association
- `POST /api/justificatifs/dissociate` — dissociation
- `GET /api/justificatifs/{filename}/preview` — preview PDF

Aucun nouveau endpoint backend requis.

---

## Fichiers à modifier/créer

| Action | Fichier | Description |
|--------|---------|-------------|
| **Créer** | `frontend/src/hooks/useJustificatifsPage.ts` | Hook page refondée |
| **Créer** | `frontend/src/components/justificatifs/JustificatifAttributionDrawer.tsx` | Drawer split resizable |
| **Réécrire** | `frontend/src/components/justificatifs/JustificatifsPage.tsx` | Page complète |
| **Modifier** | `frontend/src/index.css` | Ajouter animation `flash-highlight` |

### Fichiers à NE PAS toucher
- `App.tsx` (route `/justificatifs` existe déjà)
- `Sidebar.tsx` (entrée existe déjà)
- Backend (aucun changement)
- Hooks existants (`useOperations.ts`, `useJustificatifs.ts`, `useSandbox.ts`) — réutilisés tels quels

---

## Checklist de vérification

- [ ] Sélecteur année synchro avec store Zustand global
- [ ] Sélecteur mois en cascade avec option "Toute l'année" (lecture seule)
- [ ] Recherche libre filtre sur libellé, catégorie, sous-catégorie
- [ ] 5 colonnes triables (date, libellé, débit, crédit, catégorie) avec indicateur ↑↓
- [ ] Filtre "Sans justificatif" activé par défaut
- [ ] Colonne Justif. : ✓ vert / ○ ambre, cliquable
- [ ] Drawer 800px s'ouvre au clic sur ○ ou ✓
- [ ] Split resizable avec poignée drag (min gauche 300px, min droite 250px)
- [ ] Hover 300ms sur un justificatif → preview PDF iframe à droite
- [ ] Bouton "Attribuer" → association + toast + saut à l'opération suivante sans justif
- [ ] Si opération déjà liée : afficher le justificatif avec bouton "Dissocier"
- [ ] `ReconstituerButton` en bas du panneau gauche (existant)
- [ ] Badge sandbox SSE dans le header
- [ ] 4 MetricCards en haut (total, avec, sans, taux)
- [ ] Flash highlight sur la ligne active après navigation
- [ ] Index originaux correctement transmis (pas les index filtrés)
- [ ] Mode année complète : `_sourceFile` utilisé pour le filename dans le drawer
- [ ] Dark theme : aucune couleur hardcodée, CSS variables uniquement
- [ ] TypeScript strict, zéro `any`
- [ ] TanStack Query pour tous les appels API
- [ ] Lucide React pour les icônes
