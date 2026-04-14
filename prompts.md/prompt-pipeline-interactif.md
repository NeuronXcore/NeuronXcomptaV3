# Prompt : Pipeline Comptable Interactif — Page complète

## Contexte

Créer une page `/pipeline` qui répond à la question "Où j'en suis ce mois-ci ?" avec un stepper vertical de 6 étapes, chacune alimentée en temps réel par les APIs existantes. **Zéro nouveau endpoint backend.** Toute la logique est frontend.

**Lire CLAUDE.md avant de commencer.**

---

## 1. Types — `frontend/src/types/index.ts`

Ajouter à la fin du fichier :

```typescript
// Pipeline Comptable
export type PipelineStepStatus = 'not_started' | 'in_progress' | 'complete'

export interface PipelineStep {
  id: string
  number: number
  title: string
  description: string
  status: PipelineStepStatus
  progress: number // 0-100
  metrics: PipelineMetric[]
  actionLabel: string
  actionRoute: string
  secondaryActions?: { label: string; route: string }[]
}

export interface PipelineMetric {
  label: string
  value: string | number
  total?: number
  variant?: 'default' | 'success' | 'warning' | 'danger'
}

export interface PipelineState {
  year: number
  month: number
  steps: PipelineStep[]
  globalProgress: number // 0-100, moyenne pondérée
}
```

---

## 2. Hook — `frontend/src/hooks/usePipeline.ts`

Nouveau fichier. Ce hook orchestre les appels API existants et calcule l'état de chaque étape.

### Sources de données (APIs existantes, aucun nouvel endpoint)

| Étape | API | Données extraites |
|-------|-----|-------------------|
| 1. Import | `GET /api/operations/files` | Fichier existe pour mois/année sélectionné |
| 2. Catégorisation | `GET /api/operations/{filename}` | Compter ops sans catégorie (vide, null, "Autres") |
| 3. Justificatifs | `GET /api/cloture/{year}` | `taux_justificatifs` du mois |
| 4. Rapprochement | `GET /api/cloture/{year}` | `taux_lettrage` du mois |
| 5. Vérification | `GET /api/alertes/summary` | Compter alertes pour le fichier du mois |
| 6. Clôture | `GET /api/cloture/{year}` | `statut` du mois |

### Logique

```typescript
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { PipelineStep, PipelineState, PipelineStepStatus } from '../types'

// Pondération pour le calcul de progression globale
const STEP_WEIGHTS = [10, 20, 25, 25, 10, 10] // total = 100

export function usePipeline() {
  const currentDate = new Date()
  const [year, setYear] = useState(currentDate.getFullYear())
  const [month, setMonth] = useState(currentDate.getMonth() + 1)

  // 1. Liste des fichiers d'opérations
  const filesQuery = useQuery({
    queryKey: ['operations-files'],
    queryFn: () => api.get('/operations/files'),
  })

  // Identifier le fichier du mois sélectionné
  const currentFile = useMemo(() => {
    if (!filesQuery.data) return null
    return (filesQuery.data as any[]).find(
      (f: any) => f.year === year && f.month === month
    ) || null
  }, [filesQuery.data, year, month])

  // 2. Charger les opérations du fichier (si existe)
  const operationsQuery = useQuery({
    queryKey: ['operations', currentFile?.filename],
    queryFn: () => api.get(`/operations/${currentFile.filename}`),
    enabled: !!currentFile?.filename,
  })

  // 3. Données de clôture pour l'année
  const clotureQuery = useQuery({
    queryKey: ['cloture', year],
    queryFn: () => api.get(`/cloture/${year}`),
  })

  // 4. Alertes
  const alertesQuery = useQuery({
    queryKey: ['alertes-summary'],
    queryFn: () => api.get('/alertes/summary'),
  })

  // Données clôture du mois sélectionné
  const clotureMonth = useMemo(() => {
    if (!clotureQuery.data) return null
    return (clotureQuery.data as any[]).find((m: any) => m.mois === month) || null
  }, [clotureQuery.data, month])

  // Alertes du fichier courant
  const alertesForFile = useMemo(() => {
    if (!alertesQuery.data || !currentFile) return { count: 0 }
    const summary = alertesQuery.data as any
    const fileEntry = (summary.par_fichier || []).find(
      (f: any) => f.filename === currentFile.filename
    )
    return { count: fileEntry?.nb_alertes || 0 }
  }, [alertesQuery.data, currentFile])

  // Calcul catégorisation
  const categorizationStats = useMemo(() => {
    if (!operationsQuery.data) return { total: 0, categorized: 0, uncategorized: 0, taux: 0 }
    const ops = operationsQuery.data as any[]
    const total = ops.length
    const uncategorized = ops.filter(
      (op: any) => !op.categorie || op.categorie === '' || op.categorie === 'Autres'
    ).length
    const categorized = total - uncategorized
    return {
      total,
      categorized,
      uncategorized,
      taux: total > 0 ? categorized / total : 0,
    }
  }, [operationsQuery.data])

  // Années disponibles (extraites des fichiers)
  const availableYears = useMemo(() => {
    if (!filesQuery.data) return [currentDate.getFullYear()]
    const years = [...new Set((filesQuery.data as any[]).map((f: any) => f.year))]
    return years.sort((a, b) => b - a)
  }, [filesQuery.data])

  // Construire les 6 étapes
  const steps: PipelineStep[] = useMemo(() => {
    // --- ÉTAPE 1 : Import ---
    const step1Status: PipelineStepStatus = currentFile ? 'complete' : 'not_started'
    const step1Progress = currentFile ? 100 : 0

    // --- ÉTAPE 2 : Catégorisation ---
    const step2Progress = Math.round(categorizationStats.taux * 100)
    const step2Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      step2Progress === 100 ? 'complete' :
      step2Progress > 0 ? 'in_progress' : 'not_started'

    // --- ÉTAPE 3 : Justificatifs ---
    const tauxJustificatifs = clotureMonth?.taux_justificatifs ?? 0
    const step3Progress = Math.round(tauxJustificatifs * 100)
    const step3Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      step3Progress === 100 ? 'complete' :
      step3Progress > 0 ? 'in_progress' : 'not_started'

    // --- ÉTAPE 4 : Rapprochement ---
    const tauxLettrage = clotureMonth?.taux_lettrage ?? 0
    const step4Progress = Math.round(tauxLettrage * 100)
    const step4Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      step4Progress === 100 ? 'complete' :
      step4Progress > 0 ? 'in_progress' : 'not_started'

    // --- ÉTAPE 5 : Vérification ---
    const nbAlertes = alertesForFile.count
    const step5Progress = !currentFile ? 0 : nbAlertes === 0 ? 100 : Math.max(0, 100 - nbAlertes * 5)
    const step5Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      nbAlertes === 0 ? 'complete' : 'in_progress'

    // --- ÉTAPE 6 : Clôture ---
    const statut = clotureMonth?.statut ?? 'manquant'
    const step6Progress = statut === 'complet' ? 100 : statut === 'partiel' ? 50 : 0
    const step6Status: PipelineStepStatus =
      statut === 'complet' ? 'complete' :
      statut === 'partiel' ? 'in_progress' : 'not_started'

    return [
      {
        id: 'import',
        number: 1,
        title: 'Import du relevé bancaire',
        description: 'Importer le relevé PDF du mois. Le système extrait automatiquement les opérations et détecte les doublons.',
        status: step1Status,
        progress: step1Progress,
        metrics: [
          {
            label: 'Relevé',
            value: currentFile ? 'Importé' : 'Manquant',
            variant: currentFile ? 'success' : 'danger',
          },
          ...(currentFile ? [{
            label: 'Opérations extraites',
            value: currentFile.count,
            variant: 'default' as const,
          }] : []),
        ],
        actionLabel: currentFile ? 'Voir les opérations' : 'Importer un relevé',
        actionRoute: currentFile ? '/editor' : '/import',
      },
      {
        id: 'categorization',
        number: 2,
        title: 'Catégorisation des opérations',
        description: 'Vérifier et corriger les catégories attribuées par l\'IA. Les opérations sans catégorie ou classées "Autres" nécessitent une revue manuelle.',
        status: step2Status,
        progress: step2Progress,
        metrics: [
          {
            label: 'Catégorisées',
            value: categorizationStats.categorized,
            total: categorizationStats.total,
            variant: step2Progress === 100 ? 'success' : step2Progress > 50 ? 'warning' : 'danger',
          },
          {
            label: 'À traiter',
            value: categorizationStats.uncategorized,
            variant: categorizationStats.uncategorized === 0 ? 'success' : 'warning',
          },
        ],
        actionLabel: 'Ouvrir l\'éditeur',
        actionRoute: '/editor',
      },
      {
        id: 'justificatifs',
        number: 3,
        title: 'Justificatifs & OCR',
        description: 'Scanner et associer les justificatifs (factures, reçus) aux opérations. L\'OCR extrait automatiquement montant, date et fournisseur.',
        status: step3Status,
        progress: step3Progress,
        metrics: [
          {
            label: 'Taux justificatifs',
            value: `${step3Progress}%`,
            variant: step3Progress === 100 ? 'success' : step3Progress > 50 ? 'warning' : 'danger',
          },
          {
            label: 'Avec justificatif',
            value: clotureMonth?.nb_justificatifs_ok ?? 0,
            total: clotureMonth?.nb_justificatifs_total ?? 0,
            variant: 'default',
          },
        ],
        actionLabel: 'Upload & OCR',
        actionRoute: '/ocr',
        secondaryActions: [{ label: 'Voir justificatifs', route: '/justificatifs' }],
      },
      {
        id: 'rapprochement',
        number: 4,
        title: 'Rapprochement bancaire',
        description: 'Lettrer les opérations en les associant aux justificatifs correspondants. Le rapprochement auto gère les cas évidents (score ≥ 0.95).',
        status: step4Status,
        progress: step4Progress,
        metrics: [
          {
            label: 'Taux lettrage',
            value: `${step4Progress}%`,
            variant: step4Progress === 100 ? 'success' : step4Progress > 50 ? 'warning' : 'danger',
          },
          {
            label: 'Lettrées',
            value: clotureMonth?.nb_lettrees ?? 0,
            total: clotureMonth?.nb_operations ?? 0,
            variant: 'default',
          },
        ],
        actionLabel: 'Rapprochement',
        actionRoute: '/rapprochement',
      },
      {
        id: 'verification',
        number: 5,
        title: 'Vérification & alertes',
        description: 'Traiter les alertes du compte d\'attente : justificatifs manquants, opérations non catégorisées, montants suspects, doublons potentiels.',
        status: step5Status,
        progress: step5Progress,
        metrics: [
          {
            label: 'Alertes restantes',
            value: nbAlertes,
            variant: nbAlertes === 0 ? 'success' : nbAlertes <= 5 ? 'warning' : 'danger',
          },
        ],
        actionLabel: 'Voir les alertes',
        actionRoute: '/alertes',
      },
      {
        id: 'cloture',
        number: 6,
        title: 'Clôture & export',
        description: 'Finaliser le mois : vérifier que lettrage et justificatifs sont à 100%, puis générer l\'archive comptable ZIP.',
        status: step6Status,
        progress: step6Progress,
        metrics: [
          {
            label: 'Statut',
            value: statut === 'complet' ? 'Complet' : statut === 'partiel' ? 'Partiel' : 'Manquant',
            variant: statut === 'complet' ? 'success' : statut === 'partiel' ? 'warning' : 'danger',
          },
        ],
        actionLabel: 'Exporter',
        actionRoute: '/export',
        secondaryActions: [{ label: 'Vue clôture', route: '/cloture' }],
      },
    ]
  }, [currentFile, categorizationStats, clotureMonth, alertesForFile])

  // Progression globale pondérée
  const globalProgress = useMemo(() => {
    return Math.round(
      steps.reduce((acc, step, i) => acc + step.progress * STEP_WEIGHTS[i], 0) / 100
    )
  }, [steps])

  const isLoading = filesQuery.isLoading || clotureQuery.isLoading || alertesQuery.isLoading

  return {
    year,
    setYear,
    month,
    setMonth,
    availableYears,
    steps,
    globalProgress,
    isLoading,
    currentFile,
  }
}
```

---

## 3. Composant — `frontend/src/components/pipeline/PipelineStepCard.tsx`

Nouveau dossier `pipeline/`. Card expandable pour chaque étape du stepper.

### Spécifications visuelles

- **Conteneur** : `bg-surface border border-border rounded-lg`, transition expand/collapse 200ms
- **Barre verticale de connexion** : ligne `border-l-2` entre les steps, couleur selon statut (vert/ambre/gris)
- **Cercle numéro** : 40px, couleur de fond selon statut :
  - `not_started` → `bg-gray-600 text-gray-400`
  - `in_progress` → `bg-amber-900/50 text-amber-400 border border-amber-500`
  - `complete` → `bg-emerald-900/50 text-emerald-400 border border-emerald-500`
- **Header cliquable** : flex row avec cercle, titre, mini barre de progression (120px), chevron
- **Mini barre de progression** : hauteur 6px, `bg-gray-700` fond, remplissage couleur selon statut
- **Zone expandée** (collapse par défaut) :
  - Description en `text-text-muted text-sm`
  - Grille de métriques (flex wrap, gap-3)
  - Bouton action principal (`bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded-md`)
  - Actions secondaires en liens `text-primary text-sm underline`

### Props

```typescript
interface PipelineStepCardProps {
  step: PipelineStep
  isFirst: boolean
  isLast: boolean
  isExpanded: boolean
  onToggle: () => void
}
```

### Implémentation

```tsx
import { ChevronDown, ChevronRight, Check, Circle, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import type { PipelineStep, PipelineStepStatus } from '../../types'

// Icône dans le cercle selon statut
function StepIcon({ status, number }: { status: PipelineStepStatus; number: number }) {
  if (status === 'complete') return <Check className="w-5 h-5" />
  if (status === 'in_progress') return <span className="text-sm font-bold">{number}</span>
  return <span className="text-sm font-bold">{number}</span>
}

// Couleurs du cercle
const circleClasses: Record<PipelineStepStatus, string> = {
  not_started: 'bg-gray-700 text-gray-400',
  in_progress: 'bg-amber-900/50 text-amber-400 border border-amber-500',
  complete: 'bg-emerald-900/50 text-emerald-400 border border-emerald-500',
}

// Couleurs de la barre de progression
const barClasses: Record<PipelineStepStatus, string> = {
  not_started: 'bg-gray-600',
  in_progress: 'bg-amber-500',
  complete: 'bg-emerald-500',
}

// Couleurs des métriques par variant
const metricVariantClasses = {
  default: 'text-text',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
}
```

Implémenter le composant avec :
- `onClick` sur le header pour toggle expand
- `max-height` + `overflow-hidden` + `transition-all duration-200` pour l'animation expand/collapse
- `useNavigate` pour les boutons d'action
- Barre de connexion verticale : `div` absolu entre les steps (sauf isLast), couleur selon le statut du step suivant

---

## 4. Page — `frontend/src/components/pipeline/PipelinePage.tsx`

### Layout

```
┌─────────────────────────────────────────────────────┐
│ PageHeader: "Pipeline Comptable"                    │
│   actions: sélecteur [Année ▼] [Mois ▼]            │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─ Barre progression globale ─────────────── 67% ─┐ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│  ① Import du relevé bancaire              ✅ 100%  │
│  │  (expanded: description, métriques, action)     │
│  │                                                  │
│  ② Catégorisation des opérations          🟡  85%  │
│  │                                                  │
│  ③ Justificatifs & OCR                    🟡  60%  │
│  │                                                  │
│  ④ Rapprochement bancaire                 🔴   0%  │
│  │                                                  │
│  ⑤ Vérification & alertes                🔴   0%  │
│  │                                                  │
│  ⑥ Clôture & export                      🔴   0%  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Implémentation

- Importer `usePipeline` et `PipelineStepCard`
- État local `expandedStep: string | null` (un seul step ouvert à la fois, accordion)
- Auto-expand du premier step non-complet au chargement (via `useEffect`)
- **Sélecteur mois/année** : réutiliser le pattern cascade d'EditorPage (année → mois). Utiliser `MOIS_FR` de `lib/utils.ts`. Deux `<select>` dans le `actions` du PageHeader.
- **Barre globale** : div 100% largeur, hauteur 8px, `bg-gray-700 rounded-full`, inner div avec `transition-all duration-500`. Texte pourcentage à droite.
- **Liste des steps** : `div` avec `space-y-0` (les steps gèrent leur propre espacement via la barre de connexion)
- **Loading** : `LoadingSpinner` si `isLoading`
- **État vide** : si aucun fichier pour l'année sélectionnée, message informatif + bouton "Importer un relevé"

---

## 5. Routing — `frontend/src/App.tsx`

**Pipeline devient la page d'accueil.** Dashboard migre vers `/dashboard`.

```tsx
import PipelinePage from './components/pipeline/PipelinePage'
import DashboardPage from './components/dashboard/DashboardPage'

// Modifier les routes existantes :
<Route path="/" element={<PipelinePage />} />        // NOUVEAU — remplace DashboardPage
<Route path="/dashboard" element={<DashboardPage />} /> // DÉPLACÉ depuis "/"
```

**Attention** : supprimer l'ancien `<Route path="/" element={<DashboardPage />} />` et vérifier qu'aucun `<Navigate to="/" />` ne crée de conflit.

---

## 6. Sidebar — `frontend/src/components/layout/Sidebar.tsx`

### 6a. Pipeline en première position (hors-groupe)

Ajouter un item standalone **au-dessus** de `NAV_SECTIONS`, rendu séparément avant la boucle des groupes :

```typescript
import { ListChecks } from 'lucide-react'

// Item principal hors-groupe
const PIPELINE_ITEM = { icon: ListChecks, label: 'Pipeline', path: '/' }
```

Utiliser l'icône `ListChecks` de Lucide React (ou `Workflow` si disponible dans la version installée).

**Style différencié** : fond `bg-primary/10` + `text-primary` quand actif, `font-weight: 500` toujours. Séparateur `border-b border-border` en dessous avant les groupes SAISIE etc.

### 6b. Dashboard migre dans le groupe ANALYSE

Dans `NAV_SECTIONS`, déplacer l'entrée Dashboard :

```typescript
// Groupe ANALYSE — ajouter Dashboard en première position
{
  label: 'ANALYSE',
  items: [
    { icon: LayoutDashboard, label: 'Tableau de bord', path: '/dashboard' }, // path modifié de "/" à "/dashboard"
    { icon: BarChart3, label: 'Compta Analytique', path: '/visualization' },
    { icon: FileBarChart, label: 'Rapports', path: '/reports' },
  ]
}
```

**Vérifier** : mettre à jour le `path` de Dashboard dans NAV_SECTIONS de `'/'` à `'/dashboard'`.

### 6c. Supprimer le drawer Pipeline et convertir le badge

Le drawer Pipeline Comptable existant (side drawer fixe avec 6 étapes) est remplacé par la page. À supprimer / modifier :

**1. Supprimer le composant drawer** — identifier et supprimer le composant du drawer Pipeline (probablement dans `components/` ou `components/layout/`). Supprimer aussi son import et son rendu dans le layout parent.

**2. Convertir le badge en raccourci navigation** — le badge qui déclenchait l'ouverture du drawer devient un simple lien vers `/` :

```tsx
import { useNavigate } from 'react-router-dom'
import { usePipeline } from '../../hooks/usePipeline'

// Dans le composant sidebar ou header où le badge est rendu :
const navigate = useNavigate()
const { globalProgress } = usePipeline()

// Badge cliquable — remplace l'onClick qui ouvrait le drawer
<button
  onClick={() => navigate('/')}
  className={cn(
    'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer',
    'transition-colors hover:bg-primary/20',
    globalProgress === 100
      ? 'bg-emerald-900/20 text-emerald-400'
      : globalProgress > 50
      ? 'bg-amber-900/20 text-amber-400'
      : 'bg-gray-700/50 text-gray-400'
  )}
>
  <div className="w-2 h-2 rounded-full" style={{
    background: globalProgress === 100 ? '#0F6E56' : globalProgress > 50 ? '#BA7517' : '#5F5E5A'
  }} />
  {globalProgress}%
</button>
```

**3. Position du badge** — le badge reste sous l'item Pipeline dans la sidebar, affiché en permanence. Il montre le % global du mois courant (auto-détecté, pas de sélecteur).

**4. Nettoyage** — supprimer tout état lié au drawer (ex: `isPipelineOpen`, `setIsPipelineOpen`) dans les composants parents.

---

## 7. Vérifications

### Checklist fonctionnelle
- [ ] Route `/` affiche PipelinePage (plus DashboardPage)
- [ ] Route `/dashboard` affiche DashboardPage
- [ ] Sidebar : Pipeline en première position avec style différencié
- [ ] Sidebar : Dashboard dans le groupe ANALYSE avec path `/dashboard`
- [ ] Sélecteur année/mois fonctionne et met à jour toutes les métriques
- [ ] Progression globale = moyenne pondérée (10/20/25/25/10/10)
- [ ] Chaque step affiche le bon statut (🔴🟡🟢) selon les données réelles
- [ ] Expand/collapse accordion (un seul ouvert)
- [ ] Auto-expand du premier step non-complet
- [ ] Boutons d'action naviguent vers les bonnes routes
- [ ] État vide quand aucun fichier pour le mois
- [ ] Loading spinner pendant le chargement
- [ ] Dark theme respecté (CSS variables)
- [ ] Pas de `any` TypeScript (typer les réponses API)
- [ ] Pas de nouveau endpoint backend
- [ ] Aucun lien cassé vers l'ancien `/` (vérifier les `<Link to="/">` et `navigate('/')` existants)
- [ ] Drawer Pipeline supprimé (composant + imports + état)
- [ ] Badge Pipeline affiché dans la sidebar avec % global, clic → navigate('/')
- [ ] Aucune référence résiduelle au drawer (isPipelineOpen, togglePipeline, etc.)

### Checklist technique
- [ ] `from __future__ import annotations` (N/A — frontend only)
- [ ] PageHeader avec `actions` prop
- [ ] TanStack Query pour tous les appels API
- [ ] Lucide React pour les icônes
- [ ] `cn()` pour les classes conditionnelles
- [ ] MOIS_FR importé de `lib/utils.ts`
- [ ] Aucune dépendance ajoutée

---

## 8. Mise à jour CLAUDE.md

Après implémentation, mettre à jour `CLAUDE.md` :

### Section "Frontend Routes"
```
| `/` | PipelinePage | Pipeline comptable interactif — stepper 6 étapes, progression globale, sélecteur mois/année |
| `/dashboard` | DashboardPage | KPIs, charts, recent operations (déplacé depuis `/`) |
```

### Section "Sidebar Navigation"
Ajouter en tête :
```
| **—** | Pipeline (hors-groupe, en tête) |
```

### Section "Key Components"
Ajouter :
```
- `PipelineStepCard` — card expandable avec cercle statut, barre progression, métriques, actions
```

### Section "Hooks"
Ajouter `usePipeline` dans la liste des hooks.

### Section "Drawers"
Supprimer la mention du drawer Pipeline Comptable (remplacé par la page).

### Section "Patterns to Follow"
Ajouter :
```
- **Pipeline badge** : badge % global dans la sidebar sous l'item Pipeline, clic → navigate('/'), couleur dynamique (vert/ambre/gris). Utilise `usePipeline` pour le mois courant auto-détecté.
```
