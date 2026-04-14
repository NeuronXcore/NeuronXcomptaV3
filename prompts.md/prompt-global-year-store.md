# Prompt Claude Code — Sélecteur Année Global Sidebar + Store Zustand

## Contexte

L'utilisateur doit re-sélectionner l'année à chaque page. On veut :
1. Un **sélecteur d'année dans la sidebar**, toujours visible, qui sert de contrôle global
2. Les **sélecteurs année sur chaque page restent en place**, mais lisent/écrivent le **même store Zustand**
3. Changer l'année dans la sidebar → toutes les pages suivent
4. Changer l'année sur une page → la sidebar et les autres pages suivent aussi
5. L'année persiste en localStorage (survit au refresh)

**Le mois/trimestre restent en `useState` local par page — non concernés par ce changement.**

---

## Lire en premier

```
CLAUDE.md
```

---

## Ordre d'implémentation

### 1. Créer le store `frontend/src/stores/useFiscalYearStore.ts`

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FiscalYearState {
  selectedYear: number
  setYear: (year: number) => void
}

export const useFiscalYearStore = create<FiscalYearState>()(
  persist(
    (set) => ({
      selectedYear: new Date().getFullYear(),
      setYear: (year: number) => set({ selectedYear: year }),
    }),
    {
      name: 'neuronx-fiscal-year',
    }
  )
)
```

- `selectedYear` initialisé à l'année courante (fallback si rien en localStorage)
- Pas de `null` — toujours une année valide

---

### 2. Ajouter le sélecteur année dans la Sidebar

**Fichier : `frontend/src/components/layout/Sidebar.tsx`**

Ajouter un sélecteur d'année **au-dessus des groupes de navigation** (après le logo/titre, avant les `NAV_SECTIONS`).

#### Calcul des années disponibles

La sidebar doit connaître les années disponibles. Utiliser le hook existant pour récupérer la liste des fichiers :

```typescript
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useOperationFiles } from '@/hooks/useOperations' // ou useApi selon le nom exact

const { selectedYear, setYear } = useFiscalYearStore()
const { data: files } = useOperationFiles() // GET /api/operations/files

const availableYears = useMemo(() => {
  if (!files?.length) return [new Date().getFullYear()]
  const years = [...new Set(files.map((f: any) => f.year))].sort((a, b) => b - a)
  return years.length > 0 ? years : [new Date().getFullYear()]
}, [files])
```

#### UI — Compact, intégré au style sidebar

Design : boutons `◀ 2024 ▶` compacts, même style que la sidebar (dark theme, `bg-surface`, `text-text`, `border-border`).

```tsx
<div className="px-3 py-2 mb-2">
  <div className="flex items-center justify-between bg-surface/50 rounded-lg px-2 py-1.5 border border-border/50">
    <button
      onClick={() => {
        const idx = availableYears.indexOf(selectedYear)
        if (idx < availableYears.length - 1) setYear(availableYears[idx + 1])
      }}
      disabled={availableYears.indexOf(selectedYear) >= availableYears.length - 1}
      className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text transition-colors"
    >
      <ChevronLeft size={14} />
    </button>
    <span className="text-sm font-semibold text-text tabular-nums">{selectedYear}</span>
    <button
      onClick={() => {
        const idx = availableYears.indexOf(selectedYear)
        if (idx > 0) setYear(availableYears[idx - 1])
      }}
      disabled={availableYears.indexOf(selectedYear) <= 0}
      className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text transition-colors"
    >
      <ChevronRight size={14} />
    </button>
  </div>
</div>
```

Imports nécessaires : `ChevronLeft`, `ChevronRight` de `lucide-react`.

Note : les années sont triées décroissantes dans `availableYears`. `◀` va vers le passé (index +1), `▶` va vers le futur (index -1).

#### Sync store → availableYears

```typescript
useEffect(() => {
  if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
    setYear(availableYears[0])
  }
}, [availableYears, selectedYear, setYear])
```

---

### 3. Migrer les sélecteurs année des pages

Pour **chaque page listée ci-dessous** :

1. **Garder le sélecteur année visible dans la page** (ne pas le supprimer)
2. Remplacer le `useState` local pour l'année par le store Zustand :
   ```typescript
   // AVANT
   const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
   
   // APRÈS
   import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
   const { selectedYear, setYear } = useFiscalYearStore()
   ```
3. Dans le JSX du sélecteur, remplacer `setSelectedYear` par `setYear`
4. Garder les `useState` locaux pour mois, trimestre, et tout autre filtre
5. **Conserver le useEffect de sync** `availableYears` si la page en a un (adapter pour appeler `setYear` du store)

#### Pages à migrer :

- **`frontend/src/components/editor/EditorPage.tsx`**
  - Sélecteur année → mois en cascade
  - Migrer `selectedYear` / `setSelectedYear` → store
  - Garder `selectedMonth` local

- **`frontend/src/components/alertes/AlertesPage.tsx`**
  - Sélecteur année + boutons mois
  - Migrer `selectedYear` → store
  - Garder sélection mois locale

- **`frontend/src/components/cloture/CloturePage.tsx`**
  - Sélecteur année (affiche grille 12 mois)
  - Migrer `selectedYear` → store

- **`frontend/src/components/compta-analytique/ComptaAnalytiquePage.tsx`**
  - Filtres globaux année/trimestre/mois
  - Migrer le state année → store
  - Garder trimestre et mois locaux

- **`frontend/src/components/dashboard/DashboardPage.tsx`**
  - Si a un sélecteur année → migrer vers store

- **`frontend/src/components/export/ExportPage.tsx`**
  - Si a un sélecteur année → migrer vers store
  - Garder mois local

- **`frontend/src/components/reports/ReportsPage.tsx`**
  - Si a un filtre année → migrer vers store

- **`frontend/src/components/echeancier/EcheancierPage.tsx`**
  - Si a un filtre année → migrer vers store

**Méthode pour chaque fichier :**
1. Ouvrir le fichier
2. Chercher `useState` contenant `year` ou `Year` ou `année`
3. Si trouvé → remplacer par `useFiscalYearStore()`
4. Adapter les refs à `setSelectedYear` → `setYear`
5. Conserver/adapter le useEffect sync `availableYears`
6. Si pas de useState year → ne rien faire

---

### 4. Sync bidirectionnelle sidebar ↔ pages

Comme le store est partagé (Zustand est global) :
- L'utilisateur clique `▶` dans la sidebar → `setYear(2025)` → toutes les pages qui lisent `selectedYear` re-rendent automatiquement
- L'utilisateur change l'année dans le dropdown d'une page → `setYear(2024)` → la sidebar affiche 2024

**Aucun code supplémentaire nécessaire** — c'est le comportement natif de Zustand. Un seul store, tous les composants abonnés se mettent à jour.

---

## Ce qu'il ne faut PAS faire

- Ne PAS supprimer les sélecteurs année des pages — les garder tels quels, juste rebrancher sur le store
- Ne PAS mettre le mois/trimestre dans le store global
- Ne PAS créer de context React — Zustand suffit
- Ne PAS modifier les hooks API (`useApi.ts`, `useOperations.ts`, etc.) — ils reçoivent déjà l'année en paramètre
- Ne PAS changer la logique métier des pages
- Ne PAS toucher au routing

---

## Checklist de validation

- [ ] `frontend/src/stores/useFiscalYearStore.ts` créé et exporte `useFiscalYearStore`
- [ ] Sidebar affiche le sélecteur `◀ ANNÉE ▶` au-dessus des groupes nav
- [ ] Sidebar : les boutons ◀▶ sont disabled aux bornes des années disponibles
- [ ] Changer l'année dans la sidebar → toutes les pages suivent
- [ ] Changer l'année sur EditorPage → la sidebar et les autres pages suivent
- [ ] Naviguer EditorPage (2024) → CloturePage → affiche 2024
- [ ] Refresh navigateur (F5) → l'année est conservée
- [ ] Si aucun fichier pour l'année stockée en localStorage → fallback vers la première année disponible
- [ ] Le mois de chaque page reste indépendant et local
- [ ] Les sélecteurs année sur les pages sont toujours visibles et fonctionnels
- [ ] Aucune régression visuelle ni fonctionnelle
- [ ] TypeScript compile sans erreur (`npx tsc --noEmit`)
