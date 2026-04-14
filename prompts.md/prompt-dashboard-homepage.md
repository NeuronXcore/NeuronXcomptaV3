# Tâche : Refonte complète de HomePage (Dashboard)

## Avant de commencer
Lis **CLAUDE.md** en entier. Il contient les conventions critiques du projet :
CSS variables, composant `PageHeader`, patterns TanStack Query, style des modales,
`formatCurrency()`, `cn()`, etc. Respecte-les à la lettre.

---

## Objectif
Remplacer le contenu de `frontend/src/pages/HomePage.tsx` par un dashboard de pilotage
comptable organisé autour d'un calendrier annuel interactif avec graphiques et modales.

---

## Layout général

```
┌─────────────────────────────────────────────────────────────┐
│  KPI Strip : 4 MetricCard cliquables (grid 4 colonnes)      │
├──────────────────────────┬──────────────────────────────────┤
│                          │  Card : Évolution mensuelle      │
│  CalendrierAnnuel        ├──────────────────────────────────┤
│  (col-span ~5/12)        │  Card : Répartition catégories   │
│                          ├──────────────────────────────────┤
│                          │  Card : Rapprochement + Anomalies│
└──────────────────────────┴──────────────────────────────────┘
```

---

## Fichiers à créer / modifier

| Action | Fichier |
|--------|---------|
| **Modifier** | `frontend/src/pages/HomePage.tsx` |
| **Créer** | `frontend/src/components/CalendrierAnnuel.tsx` |
| **Créer** | `frontend/src/components/ModaleMois.tsx` |
| **Créer** | `frontend/src/components/ModaleGraph.tsx` |
| **Créer** | `frontend/src/hooks/useDashboard.ts` |

---

## Hook : useDashboard.ts

Centralise tous les appels API du dashboard avec TanStack Query.
`selectedYear` est un `useState` initialisé à `new Date().getFullYear()`.
La query cloture dépend de `selectedYear` via `queryKey: ['cloture', selectedYear]`.

```typescript
// Ce hook retourne :
{
  dashboard,      // GET /api/analytics/dashboard
  trends,         // GET /api/analytics/trends?months=12
  summary,        // GET /api/analytics/summary
  anomalies,      // GET /api/analytics/anomalies?threshold=2.0
  justifStats,    // GET /api/justificatifs/stats
  mlModel,        // GET /api/ml/model
  cloture,        // GET /api/cloture/{selectedYear}
  selectedYear,
  setSelectedYear,
  isLoading,
}
```

Chaque `useQuery` a `staleTime: 60_000`. Les queries indépendantes de l'année
(dashboard, trends, summary, anomalies, justifStats, mlModel) ne se re-fetchent
pas quand `selectedYear` change.

---

## Composant 1 : KPI Strip (dans HomePage.tsx)

4 `MetricCard` en `grid grid-cols-2 lg:grid-cols-4 gap-4`.

Chaque card est **cliquable** : ajoute `cursor-pointer` et
`hover:ring-2 hover:ring-primary/40 transition-all` sur le wrapper.

| Métrique | Valeur | Icône | Clic |
|----------|--------|-------|------|
| Solde YTD | `formatCurrency(dashboard.solde)` | `TrendingUp` / `TrendingDown` | Ouvre `ModaleGraph` → GraphEvolution |
| Opérations | `dashboard.nb_operations` | `FileText` | `navigate('/editor')` |
| Justificatifs en attente | `justifStats.en_attente` | `Clock` | `navigate('/justificatifs')` |
| Précision IA | `mlModel.stats?.accuracy` en % | `Brain` | `navigate('/agent-ai')` |

- Solde positif → `text-green-400`, négatif → `text-red-400`
- Si `justifStats.en_attente > 0` → badge rouge sur la card
- Si `mlModel.stats?.accuracy < 0.7` → badge orange sur la card

---

## Composant 2 : CalendrierAnnuel.tsx

### Props
```typescript
interface CalendrierAnnuelProps {
  cloture: ClotureMois[]
  selectedYear: number
  onYearChange: (year: number) => void
  isLoading: boolean
}
```

### Sélecteur d'année
Centré en haut du composant :
```
  [ChevronLeft]  2024  [ChevronRight]
```
- Plage : `currentYear - 4` → `currentYear`
- Désactiver `ChevronRight` si année = année courante
- Boutons `ghost`, année en `font-bold text-lg`

### Grille des mois
`grid grid-cols-4 gap-3` — 4 colonnes × 3 lignes = 12 tuiles.

**Structure d'une tuile :**
```
┌──────────────────────┐
│ Janvier      [badge] │
│ ─────────────────── │
│ ⟳ Lettrage  ████░ 67%│
│ 📎 Justif.  ██░░░ 38%│
└──────────────────────┘
```

**Badge statut** (coin haut droite) :
| `statut` | Couleur | Texte |
|----------|---------|-------|
| `manquant` | gris | "—" |
| `partiel` (taux = 0) | bleu | "Importé" |
| `partiel` (taux > 0) | orange | "En cours" |
| `complet` | vert | "✓ Clôturé" |

**Progress bars** (visibles seulement si relevé présent) :
- 2 mini barres `h-1.5 rounded-full`
- Lettrage → `bg-blue-400`
- Justificatifs → `bg-violet-400`
- Pourcentage en `text-xs text-text-muted` à droite

**Interactions :**
- Tuile avec relevé → `cursor-pointer hover:bg-surface/80` → ouvre `ModaleMois`
- Tuile `manquant` → `opacity-50`, non interactive
- Mois futurs (année courante, mois > mois actuel) → `opacity-40 cursor-not-allowed`

**Loading :** 12 tuiles skeleton `animate-pulse bg-surface`.

---

## Composant 3 : ModaleMois.tsx

Modale centrée — pattern du projet :
`fixed inset-0 bg-black/50 z-50`, panneau `max-w-lg w-full bg-background border border-border rounded-xl p-6`.

### Props
```typescript
interface ModaleMoisProps {
  mois: ClotureMois | null
  year: number
  onClose: () => void
}
```

### Contenu
- Titre : "Janvier 2024"
- Badge statut (même logique que les tuiles)
- Stats en `grid grid-cols-2` : nb opérations, nb lettrées/total, nb justificatifs OK/total, taux global
- Barres de progression larges (lettrage + justificatifs)
- 3 boutons :
  - "Voir les opérations" → `navigate('/editor')` + `onClose()`
  - "Rapprochement" → `navigate('/rapprochement')` + `onClose()`
  - "Générer un rapport" → `navigate('/reports')` + `onClose()`
- Croix `X` en haut à droite, fermeture au clic backdrop

---

## Composant 4 : ModaleGraph.tsx (réutilisable)

Modale centrée générique, `max-w-3xl w-full`, même pattern overlay.

### Props
```typescript
interface ModaleGraphProps {
  title: string
  linkLabel?: string
  linkTo?: string
  onClose: () => void
  children: ReactNode
}
```

Titre + croix en haut, `children` au centre, bouton lien optionnel en bas.

---

## Section droite : 3 cards graphiques

### Card A — Évolution mensuelle

**Aperçu :**
- `LineChart` Recharts `height={180}`
- 2 séries : Débits `#ef4444` + Crédits `#22c55e`
- Axe X : mois courts (Jan, Fév, …), tooltip activé
- Bouton "Détail ↗" (`ExternalLink`) → ouvre `ModaleGraph`
- Source : `trends` (`{ month, debit, credit }[]`)

**Dans ModaleGraph :**
- Même chart agrandi `height={320}`
- 3ème série : Solde net `#a78bfa` + toggle checkbox
- Légende complète
- `linkLabel="Voir l'analytique complète"` → `/visualization`

### Card B — Répartition catégories

**Aperçu :**
- `PieChart` `height={180}` `innerRadius={50}`
- Top 5 catégories (tri par montant desc)
- Légende compacte avec `formatCurrency()`
- Bouton "Détail ↗" → ouvre `ModaleGraph`
- Source : `summary`

**Dans ModaleGraph :**
- `BarChart` horizontal, toutes catégories, triées desc
- `linkLabel="Générer un rapport"` → `/reports`

### Card C — Rapprochement & Anomalies

Double section séparée par un divider, pas de modale.

**Rapprochement :**
- Taux global = moyenne des `taux_lettrage` des mois avec relevé (depuis `cloture`)
- Large progress bar + texte "X% des opérations lettrées"
- Lien "→ Rapprochement" → `navigate('/rapprochement')`

**Anomalies :**
- Source : `anomalies`
- 0 anomalie → badge vert "Aucune anomalie"
- > 0 → badge rouge `"⚠ {n} anomalie(s)"` + 3 premières (libellé 30 chars + montant)
- Lien "→ Voir toutes" → `navigate('/visualization')`

---

## Conventions impératives (CLAUDE.md)

- `PageHeader` avec prop `actions` uniquement (pas de children)
- Couleurs via CSS variables : `bg-background`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`
- TanStack Query pour tous les appels API, jamais de `fetch` direct dans les composants
- `cn()` pour toutes les classes conditionnelles
- Icônes **Lucide React** uniquement
- Modales : `fixed inset-0 bg-black/50 z-50` + panneau centré `bg-background border border-border rounded-xl`
- `formatCurrency()` et `formatDate()` depuis `lib/utils.ts`
- TypeScript strict : **zéro `any`**

---

## Types à ajouter dans types/index.ts si absents

```typescript
export interface ClotureMois {
  mois: number
  label: string
  has_releve: boolean
  filename: string | null
  nb_operations: number
  nb_lettrees: number
  taux_lettrage: number
  nb_justificatifs_total: number
  nb_justificatifs_ok: number
  taux_justificatifs: number
  statut: 'complet' | 'partiel' | 'manquant'
}

export interface JustifStats {
  en_attente: number
  traites: number
  total: number
}
```

---

## Ordre d'implémentation recommandé

1. `useDashboard.ts` — data fetching en premier
2. `CalendrierAnnuel.tsx` — composant central
3. `ModaleMois.tsx` — modale détail mois
4. `ModaleGraph.tsx` — wrapper modale réutilisable
5. `HomePage.tsx` — assemble tout + 3 cards graphiques

---

## Critères de validation

- [ ] Sélecteur d'année re-fetche `/api/cloture/{year}` correctement
- [ ] 12 tuiles avec badges colorés selon statut
- [ ] Progress bars lettrage + justificatifs sur tuiles avec relevé
- [ ] Clic tuile avec relevé → `ModaleMois` avec stats correctes
- [ ] 4 KPI cards cliquables → navigation ou modale
- [ ] Graph Évolution : aperçu compact + modale agrandie + toggle solde
- [ ] Graph Catégories : donut top 5 + bar chart complet en modale
- [ ] Card Rapprochement/Anomalies : taux global + liste anomalies
- [ ] Zéro `any` TypeScript
- [ ] Toutes couleurs via CSS variables (sauf palettes Recharts)
