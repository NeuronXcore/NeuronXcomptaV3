# Prompt Claude Code — RapprochementWorkflowDrawer

## Contexte

Fusionner `RapprochementManuelDrawer` (EditorPage) et `JustificatifAttributionDrawer` (JustificatifsPage) en un composant unique `RapprochementWorkflowDrawer` avec navigation séquentielle entre opérations sans justificatif.

Le drawer reste ouvert entre les attributions — l'utilisateur traite N opérations en flux sans ouvrir/fermer à chaque fois.

Lire CLAUDE.md avant de commencer.

---

## Fichiers à créer

### 1. Hook — `frontend/src/hooks/useRapprochementWorkflow.ts`

```typescript
interface UseRapprochementWorkflowProps {
  operations: Operation[];
  initialIndex?: number;          // si fourni → mode "ciblée", sinon → mode "toutes"
  onClose: () => void;
}

interface UseRapprochementWorkflowReturn {
  // Navigation
  mode: 'all' | 'single';
  setMode: (m: 'all' | 'single') => void;
  currentOp: Operation | null;
  currentIndex: number;
  currentFile: string;            // _sourceFile ou filename selon contexte
  totalOps: number;
  unmatchedCount: number;         // ops sans justificatif restantes
  doneCount: number;              // ops attribuées dans cette session
  progressPct: number;            // doneCount / totalOps * 100
  canPrev: boolean;
  canNext: boolean;
  goNext: () => void;
  goPrev: () => void;
  skipToNextUnmatched: () => void;

  // Ventilation
  currentOpVentilated: boolean;
  ventilationLines: VentilationLine[];
  selectedVentilationIndex: number | null;  // null = op complète
  setSelectedVentilationIndex: (idx: number | null) => void;

  // Suggestions
  suggestions: RapprochementSuggestion[];
  suggestionsLoading: boolean;
  selectedSuggestion: RapprochementSuggestion | null;
  setSelectedSuggestion: (s: RapprochementSuggestion | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: Justificatif[];
  searchLoading: boolean;

  // Actions
  attribuer: () => Promise<void>;
  attribuerLoading: boolean;
  isCurrentDone: boolean;         // déjà attribué (justificatif présent)
}
```

**Logique interne :**

- Maintenir `currentIndex` dans le tableau `operations`
- `unmatchedIndices` = indices des ops sans justificatif (ni `Lien justificatif`, ni dans ventilation). Recalculé quand les mutations invalident le cache.
- Mode "all" : navigation ‹ › parcourt TOUTES les ops (matchées et non matchées). `skipToNextUnmatched` saute à la prochaine non matchée. Après attribution → auto `skipToNextUnmatched`.
- Mode "single" : navigation ‹ › désactivée. Après attribution → rester sur place (op marquée "attribué").
- **Suggestions** : `GET /api/rapprochement/{currentFile}/{currentIndex}/suggestions` avec `ventilation_index` si sélectionné. Paramètre `search` forwarded si `searchQuery` non vide.
- **Recherche libre** : si `searchQuery.length >= 2`, appel `GET /api/justificatifs/?status=en_attente&search={query}` avec debounce 300ms. Résultats affichés sous les suggestions.
- **Attribution** : `POST /api/rapprochement/associate-manual` avec body `{ justificatif_filename, operation_file, operation_index, rapprochement_score, ventilation_index }`. Puis invalidation TanStack Query : `['operations']`, `['justificatifs']`, `['rapprochement']`, `['pipeline']`, `['cloture']`.
- La première suggestion est auto-sélectionnée quand les suggestions chargent.
- Quand `currentIndex` change → reset `selectedVentilationIndex` à null, reset `searchQuery`, reset `selectedSuggestion`.

**Imports :**
- `useQuery`, `useMutation`, `useQueryClient` depuis `@tanstack/react-query`
- `apiClient` depuis `../api/client`
- Types depuis `../types`

---

### 2. Composant — `frontend/src/components/rapprochement/RapprochementWorkflowDrawer.tsx`

```typescript
interface RapprochementWorkflowDrawerProps {
  isOpen: boolean;
  operations: Operation[];        // toutes les ops du mois (ou de l'année)
  initialIndex?: number;          // index dans le tableau operations
  onClose: () => void;
  onAttribution?: () => void;     // callback additionnel post-attribution (ex: refresh stats)
}
```

**Structure du drawer (700px, translateX pattern) :**

```
┌─────────────────────────────────────────┐
│  ‹  │  3 / 10 · 7 restants  │  ›  │ × │   ← Navigator
├─────────────────────────────────────────┤
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░  30%  │   ← Barre progression (3px, bg-success)
├─────────────────────────────────────────┤
│ [Toutes sans justificatif] [Op ciblée]  │   ← Tabs mode
├─────────────────────────────────────────┤
│ 12/03/2026  PRLV SEPA AMAZON  -89,99 € │   ← Contexte opération (bg-secondary)
│             Fournitures · Consommables  │
├─────────────────────────────────────────┤  ← (conditionnel si op ventilée)
│ Sous-lignes ventilées                   │
│ [Op complète -89,99€] [Cart. -54,99€]  │   ← Pills sélecteur ventilation
│ [Ramettes -35,00€]                      │
├─────────────────────────────────────────┤
│ SUGGESTIONS                             │   ← Section label
│ [🔍 Rechercher un justificatif...]      │   ← Input recherche
│ ┌ 93% │ amazon_20260312_89.99.pdf │ ... │   ← Liste suggestions (max-h 180px scroll)
│ │ 67% │ amazon_20260310_92.50.pdf │ ... │
│ └ 41% │ fourniture_20260315_88..  │ ... │
│ ── Autres justificatifs ──              │   ← (si searchResults non vide)
│   fourniture_20260320_95.pdf   Attrib.  │
├─────────────────────────────────────────┤
│                                         │
│         PDF PREVIEW                     │   ← object type="application/pdf" pleine largeur
│         (flex: 1)                       │
│                                         │
├─────────────────────────────────────────┤
│ [Attribuer ⏎]  [Reconstituer]  Passer →│   ← Barre actions
└─────────────────────────────────────────┘
```

**Détails d'implémentation :**

#### Navigator
- `‹` et `›` : boutons 28px, `border rounded`, disabled quand `!canPrev`/`!canNext` ou mode "single"
- Compteur centre : `{currentIndex + 1} / {totalOps} · {unmatchedCount} restant(s)` en mode "all", `Opération ciblée · {unmatchedCount} restant(s)` en mode "single"
- `×` ferme le drawer

#### Barre de progression
- 3px de haut. Fond `var(--color-border-tertiary)`. Fill `bg-success` (vert). Largeur = `progressPct%`. Transition `width 0.4s ease`.

#### Tabs mode
- 2 boutons pleine largeur, `border-bottom: 2px solid transparent`, actif = `border-bottom-color: var(--color-border-info)` + `font-weight: 500`
- Labels : "Toutes sans justificatif" / "Opération ciblée"
- Tab "Opération ciblée" uniquement affichée si `initialIndex` a été fourni

#### Contexte opération
- Background `var(--color-background-secondary)`, padding `10px 16px`
- Ligne 1 : date (12px, text-secondary) + libellé (13px, font-500, truncate) + montant (14px, font-500, rouge si débit, vert si crédit)
- Ligne 2 : catégorie · sous-catégorie (11px, text-secondary, padding-left 80px)
- Si `isCurrentDone` : badge "attribué" vert à côté du montant (`bg-success/10 text-success text-xs px-2 py-0.5 rounded-full`)

#### Sélecteur ventilation (conditionnel)
- Visible uniquement si `currentOpVentilated === true`
- Label "Sous-lignes ventilées" (11px, text-secondary)
- Pills horizontaux wrap : chaque pill = `padding 4px 10px, rounded-full, border, text-xs`
  - Actif : `bg-info/10 border-info text-info font-500`
  - Inactif : `bg-background border-border-tertiary text-secondary`
  - Contenu : label tronqué + montant en font-500
- Pill "Opération complète" pour `ventilation_index = null` + un pill par sous-ligne

#### Section suggestions
- Label "SUGGESTIONS" (11px uppercase tracking-wide text-secondary)
- Input recherche : pleine largeur, 12px, placeholder "Rechercher un justificatif...", `border-tertiary`, focus `border-info`
- Liste : `max-height: 180px`, `overflow-y: auto`, `border-bottom`
- Chaque item : flex row, `padding 7px 16px`, `border-left: 3px solid transparent`, hover `bg-secondary`, actif `bg-info/5 border-left-color: var(--color-border-info)`
  - Score badge : `text-xs font-500 px-1.5 py-0.5 rounded-full min-w-[36px] text-center`
    - `>= 80` : `bg-success/10 text-success`
    - `>= 60` : `bg-warning/10 text-warning`
    - `< 60` : `bg-secondary text-secondary`
  - Nom fichier : `text-sm truncate flex-1`
  - Date OCR : `text-xs text-tertiary`
  - Montant OCR : `text-xs text-secondary`
- Clic sur un item → `setSelectedSuggestion` + charge le PDF dans la preview
- Si `searchResults` non vide → séparateur texte "Autres justificatifs correspondants" + items similaires avec bouton "Attribuer" orange inline

#### PDF Preview
- `flex: 1`, `min-height: 0` (pour que flex fonctionne)
- `<object data={previewUrl} type="application/pdf" width="100%" height="100%">` dans un conteneur avec `margin: 10px 16px`, `border-radius: var(--border-radius-md)`, `overflow: hidden`
- `previewUrl` = `/api/justificatifs/${selectedSuggestion.filename}/preview`
- Si aucune suggestion sélectionnée : placeholder centré avec icône `FileSearch` (Lucide) + texte "Sélectionnez un justificatif"

#### Barre actions
- `border-top`, `padding 10px 16px`, flex row, gap 8px
- **Attribuer** : `bg-warning text-white font-500 px-4 py-1.5 rounded-md hover:bg-warning/90`. Masqué si `isCurrentDone` ou aucune suggestion sélectionnée. Suffixe `⏎` dans un `<kbd>` discret.
- **Reconstituer** : bouton outline (border-secondary, text-secondary). Ouvre `ReconstituerDrawer` par-dessus (z-index supérieur), pré-rempli avec les données de l'op courante. Callback `onGenerated` → invalidation caches + marquage op comme done + auto-next en mode "all".
- **Passer** : `ml-auto`, texte seul discret, text-secondary. Suffixe `→` dans `<kbd>`. Appelle `skipToNextUnmatched`. Masqué en mode "single".

#### Raccourcis clavier
- `useEffect` avec `keydown` listener quand `isOpen === true`
- `Enter` → attribuer (si suggestion sélectionnée et pas déjà done)
- `ArrowRight` → skipToNextUnmatched (mode "all" uniquement)
- `ArrowLeft` → goPrev (mode "all" uniquement)
- `Escape` → onClose
- Ignorer si `event.target` est un `<input>` (ne pas interférer avec la recherche)

#### Backdrop
- `fixed inset-0 bg-black/30 z-40`, clic → onClose
- Drawer : `fixed right-0 top-0 h-full w-[700px] z-50 bg-background border-l shadow-xl`
- Transition : `translateX(100%)` → `translateX(0)` avec `transition: transform 0.3s ease`

---

### 3. Types — ajouter dans `frontend/src/types/index.ts`

```typescript
// Si pas déjà présent, ajouter :
interface RapprochementSuggestion {
  filename: string;
  ocr_date: string | null;
  ocr_montant: number | null;
  ocr_fournisseur: string | null;
  score: number;              // 0-1 depuis le backend
  size_human: string;
}
```

---

## Fichiers à modifier

### 4. `frontend/src/pages/EditorPage.tsx`

- **Supprimer** l'import et l'usage de `RapprochementManuelDrawer`
- **Importer** `RapprochementWorkflowDrawer`
- Le bouton trombone (colonne Justificatif) ouvre le workflow drawer avec `initialIndex = index de l'op cliquée`
- Props : `operations = operations du fichier courant`, `initialIndex = clickedIndex`, `onClose`, `onAttribution` (invalide les queries ops)
- L'état `isDrawerOpen` + `drawerInitialIndex` restent dans EditorPage

### 5. `frontend/src/pages/JustificatifsPage.tsx`

- **Supprimer** l'import et l'usage de `JustificatifAttributionDrawer`
- **Importer** `RapprochementWorkflowDrawer`
- Le bouton "Associer automatiquement" (bandeau CTA) ouvre le drawer **sans** `initialIndex` → mode "toutes"
- Le clic sur une ligne du tableau ouvre le drawer **avec** `initialIndex` → mode "ciblée"
- Props : `operations = ops enrichies du hook useJustificatifsPage`, `onAttribution` appelle le refresh des stats MetricCards
- Conserver le bandeau CTA existant, juste changer le handler d'ouverture

### 6. `frontend/src/components/rapprochement/RapprochementManuelDrawer.tsx`

- **Supprimer ce fichier**

### 7. `frontend/src/components/justificatifs/JustificatifAttributionDrawer.tsx`

- **Supprimer ce fichier**

### 8. `frontend/src/hooks/useRapprochementManuel.ts`

- **Supprimer ce fichier** (logique fusionnée dans `useRapprochementWorkflow`)

---

## Endpoints backend utilisés (aucun nouveau)

| Endpoint | Usage |
|----------|-------|
| `GET /api/rapprochement/{file}/{index}/suggestions?search=&ventilation_index=` | Suggestions scorées |
| `GET /api/justificatifs/?status=en_attente&search=` | Recherche libre |
| `POST /api/rapprochement/associate-manual` | Attribution |
| `GET /api/justificatifs/{filename}/preview` | Preview PDF inline |
| `GET /api/templates/suggest/{file}/{idx}` | Suggestion template (pour ReconstituerDrawer) |

**Zéro nouveau endpoint backend.**

---

## Ordre d'implémentation

1. Types (`index.ts`) — vérifier que `RapprochementSuggestion` et `VentilationLine` existent
2. Hook `useRapprochementWorkflow.ts`
3. Composant `RapprochementWorkflowDrawer.tsx`
4. Modifier `EditorPage.tsx` — remplacer ancien drawer
5. Modifier `JustificatifsPage.tsx` — remplacer ancien drawer
6. Supprimer `RapprochementManuelDrawer.tsx`
7. Supprimer `JustificatifAttributionDrawer.tsx`
8. Supprimer `useRapprochementManuel.ts`
9. Vérifier qu'aucun autre fichier n'importe les composants supprimés (grep)

---

## Vérification

- [ ] Drawer s'ouvre depuis EditorPage (clic trombone) en mode "ciblée"
- [ ] Drawer s'ouvre depuis JustificatifsPage (bouton CTA) en mode "toutes"
- [ ] Drawer s'ouvre depuis JustificatifsPage (clic ligne) en mode "ciblée"
- [ ] Navigation ‹ › fonctionne en mode "toutes", désactivée en mode "single"
- [ ] Barre de progression avance à chaque attribution
- [ ] Compteur "X restants" se met à jour
- [ ] Attribution → auto-skip vers prochaine op sans justif (mode "all")
- [ ] Attribution → reste sur place avec badge "attribué" (mode "single")
- [ ] Sélecteur ventilation visible uniquement sur ops ventilées
- [ ] Ventilation index transmis au backend
- [ ] Recherche libre debounce 300ms fonctionne
- [ ] Preview PDF charge quand on clique une suggestion
- [ ] Raccourci ⏎ attribue, → passe, ← précédent, Esc ferme
- [ ] Raccourcis ignorés quand le focus est dans l'input recherche
- [ ] Bouton Reconstituer ouvre ReconstituerDrawer par-dessus
- [ ] Reconstitution → auto-attribution + auto-next
- [ ] Aucune référence résiduelle aux fichiers supprimés (grep)
- [ ] `npm run build` passe sans erreur TypeScript
