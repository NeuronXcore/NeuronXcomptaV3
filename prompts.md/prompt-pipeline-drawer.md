# Prompt Claude Code — Pipeline Comptable Drawer

## Contexte

NeuronXcompta V3 est une application full-stack React 19 + FastAPI de gestion comptable pour cabinet dentaire. L'app a 15 pages fonctionnelles (import PDF, éditeur, catégorisation IA, justificatifs/OCR, rapprochement, lettrage, clôture, exports...) mais le workflow mensuel est dispersé entre ces pages. L'utilisateur doit naviguer mentalement pour reconstituer le flux comptable.

## Objectif

Créer un **drawer latéral "Pipeline Comptable"** accessible depuis toutes les pages, qui unifie le workflow mensuel en une roadmap visuelle à deux niveaux. Ce drawer transforme la clôture d'un constat passif en un objectif actionnable avec des étapes claires.

## Spécifications fonctionnelles

### Concept : le cycle de vie d'un mois comptable

Chaque mois suit un pipeline en 6 étapes séquentielles :

1. **Relevé importé** — Le PDF bancaire est chargé et les opérations sont extraites
2. **Vérification** — Toutes les lignes comptables sont vérifiées (montant, date, libellé)
3. **Catégorisation** — Chaque opération a une catégorie + sous-catégorie (IA ou manuel)
4. **Justificatifs** — Un justificatif PDF est associé à chaque opération (via OCR matching)
5. **Lettrage** — Chaque opération est marquée comme traitée/validée
6. **Clôture** — Export ZIP généré, mois verrouillé (requiert étapes 3-4-5 à 100%)

### Niveau 1 — Vue mois (affichage initial du drawer)

- Header avec titre "Pipeline comptable", mois/année en cours, et navigation ← →
- Barre de progression globale (moyenne pondérée des 6 étapes)
- Pipeline vertical : 6 étapes reliées par une ligne verticale
- Chaque étape affiche :
  - Pastille numérotée (grise = à faire, verte avec ✓ = terminée)
  - Nom de l'étape
  - Ratio `ok/total` avec couleur sémantique (vert ≥100%, orange >50%, rouge ≤50%, gris = 0)
  - Barre de progression fine
  - Texte "N restant(s)" si incomplet
- Cliquer sur une étape ouvre le Niveau 2

### Niveau 2 — Drill-down par étape

Le drawer slide pour afficher le détail de l'étape cliquée :

- Bouton retour ← vers le Niveau 1
- Titre de l'étape + ratio + pourcentage

Contenu spécifique par étape :

**Étape 1 (Relevé)** : Statut "importé" avec date et nombre d'opérations. Si absent : bouton "Importer un relevé" qui redirige vers `/import`.

**Étape 2 (Vérification)** : Statut auto-validé (basé sur les données extraites). Note : dans V3 il n'y a pas de validation manuelle ligne par ligne — cette étape est informative.

**Étape 3 (Catégorisation)** : Liste scrollable des opérations non catégorisées (libellé tronqué + montant). Chaque ligne a un dropdown rapide pour attribuer une catégorie. Deux boutons en bas :
- "IA auto-catégoriser" → appelle `POST /api/operations/{filename}/categorize`
- "Ouvrir éditeur" → navigue vers `/editor` avec le fichier pré-sélectionné

**Étape 4 (Justificatifs)** : Liste des opérations sans justificatif. Badge "Suggestion OCR disponible" si un match existe. Deux boutons :
- "Rapprochement auto" → appelle `POST /api/rapprochement/{filename}/auto`
- "Page justificatifs" → navigue vers `/justificatifs`

**Étape 5 (Lettrage)** : Nombre d'opérations non lettrées. Action bulk : "Lettrer les N opérations complètes" (celles qui sont catégorisées ET justifiées). Bouton vers l'éditeur pour le lettrage manuel.

**Étape 6 (Clôture)** : Si prérequis non remplis → affiche les dépendances manquantes (icône verrou). Si prérequis OK → bouton "Générer l'export ZIP" qui appelle `POST /api/exports/generate` et bouton "Clôturer le mois".

## Spécifications techniques

### Nouveaux fichiers à créer

```
frontend/src/components/PipelineDrawer.tsx     # Drawer principal (les 2 niveaux)
frontend/src/components/PipelineStep.tsx       # Composant d'une étape (Niveau 1)
frontend/src/components/PipelineDetail.tsx     # Contenu drill-down (Niveau 2)
frontend/src/components/PipelineTrigger.tsx    # Bouton flottant pour ouvrir le drawer
frontend/src/hooks/usePipeline.ts              # Hook d'agrégation des données pipeline
```

### Hook `usePipeline(year: number, month: number)`

Ce hook agrège les données de plusieurs endpoints existants :

```typescript
// Données nécessaires :
// 1. GET /api/cloture/{year} → statut mensuel (nb_operations, nb_lettrees, taux_lettrage, etc.)
// 2. GET /api/operations/{filename} → opérations du mois (pour filtrer non-catégorisées)
// 3. GET /api/rapprochement/{filename}/stats → taux rapprochement
// 4. GET /api/lettrage/{filename}/stats → taux lettrage
// 5. GET /api/categories → liste des catégories (pour le dropdown)

// Retour :
interface PipelineData {
  month: number;
  year: number;
  filename: string | null;         // fichier d'opérations du mois
  globalProgress: number;          // 0-100, moyenne pondérée
  steps: PipelineStep[];           // 6 étapes avec ok/total/status
  uncategorized: Operation[];      // opérations sans catégorie
  unmatched: Operation[];          // opérations sans justificatif
  unlettered: Operation[];         // opérations non lettrées
  categories: Category[];          // pour le dropdown rapide
}
```

Utiliser `useQuery` de TanStack Query avec des `queryKey` combinés. `staleTime: 30s` par défaut (cohérent avec le QueryClient existant).

### Drawer

- Position : `fixed right-0 top-0 h-full` avec `z-index: 50`
- Largeur : `400px` (Niveau 1) → `400px` (Niveau 2 remplace le contenu, pas de double panneau)
- Animation : `translateX(100%)` → `translateX(0)` avec `transition: transform 300ms ease`
- Backdrop : `bg-black/30` avec `onClick` pour fermer
- Le Niveau 2 remplace le Niveau 1 avec une transition slide interne

### Bouton déclencheur (PipelineTrigger)

- Bouton flottant `fixed bottom-6 right-6` avec `z-index: 40`
- Icône pipeline/fusée + badge avec le pourcentage global du mois en cours
- Badge coloré selon le statut (vert/orange/rouge)
- `onClick` → ouvre le drawer

### Fichiers à modifier

```
frontend/src/App.tsx               # Ajouter <PipelineDrawer /> et <PipelineTrigger /> au layout global
```

### Patterns à respecter (existants dans le projet)

- **Styling** : Tailwind classes uniquement, `cn()` pour conditionnel, dark theme via CSS variables (`bg-background`, `bg-surface`, `text-text`, `border-border`)
- **Data fetching** : TanStack Query (`useQuery`, `useMutation`, `useQueryClient`) — jamais de `fetch` direct
- **Mutations** : `onSuccess` → `queryClient.invalidateQueries(...)` pour rafraîchir les données
- **Navigation** : `useNavigate()` de react-router-dom
- **Icons** : Lucide React (`CheckCircle2`, `Circle`, `Lock`, `ChevronLeft`, `ChevronRight`, `Rocket`, etc.)
- **Toasts** : `react-hot-toast` (`toast.success()`, `toast.error()`) — le `<Toaster />` est déjà dans App.tsx
- **Drawers existants** : pattern `fixed right-0` avec `translateX` transition + backdrop (voir JustificatifsPage pour référence)

### API existantes utilisées (ne pas créer de nouveau endpoint backend)

| Donnée | Endpoint | Déjà implémenté |
|--------|----------|:---:|
| Statut annuel avec stats par mois | `GET /api/cloture/{year}` | ✅ |
| Opérations d'un fichier | `GET /api/operations/{filename}` | ✅ |
| Catégorisation auto | `POST /api/operations/{filename}/categorize` | ✅ |
| Stats rapprochement | `GET /api/rapprochement/{filename}/stats` | ✅ |
| Rapprochement auto | `POST /api/rapprochement/{filename}/auto` | ✅ |
| Stats lettrage | `GET /api/lettrage/{filename}/stats` | ✅ |
| Lettrage bulk | `POST /api/lettrage/{filename}/bulk` | ✅ |
| Liste catégories | `GET /api/categories` | ✅ |
| Générer export | `POST /api/exports/generate` | ✅ |
| Suggestions justificatifs | `GET /api/justificatifs/{filename}/suggestions` | ✅ |

### Calcul de la progression globale

```
globalProgress = moyenne pondérée :
  - Relevé importé : 10% (0 ou 100)
  - Vérification : 5% (toujours 100 si relevé importé)  
  - Catégorisation : 30% (nb_categorisées / nb_total)
  - Justificatifs : 25% (nb_rapprochées / nb_total)
  - Lettrage : 25% (nb_lettrées / nb_total)
  - Clôture : 5% (0 ou 100, dépend des 3 précédents à 100%)
```

## Critères d'acceptance

1. Le drawer s'ouvre depuis le bouton flottant visible sur toutes les pages
2. Le Niveau 1 affiche correctement les 6 étapes avec progression temps réel
3. Cliquer sur une étape affiche le drill-down correspondant
4. Les actions rapides (dropdown catégorie, boutons IA/rapprochement/lettrage) fonctionnent et rafraîchissent les données
5. Les liens "Ouvrir éditeur" / "Page justificatifs" naviguent correctement
6. L'étape Clôture est verrouillée tant que les prérequis ne sont pas à 100%
7. La navigation mois ← → met à jour toutes les données
8. Le drawer respecte le dark theme existant
9. Aucun nouveau endpoint backend n'est nécessaire
10. Le code suit les patterns existants (TanStack Query, Tailwind, Lucide, react-hot-toast)
