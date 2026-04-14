# Prompt Claude Code — Rapprochement Manuel Drawer

## Contexte

On ajoute le **rapprochement manuel** à la page `RapprochementPage`. Quand le rapprochement auto (`POST /{filename}/auto`) ne trouve pas de match pour une opération, l'utilisateur doit pouvoir associer manuellement un justificatif via un drawer latéral avec filtres, liste scorée et preview PDF.

Tout le design UX et la logique sont décrits ci-dessous. Respecte les patterns existants du projet (drawer avec translateX + backdrop, TanStack Query, hooks dédiés, Tailwind avec CSS variables dark theme, react-hot-toast, Lucide icons, `from __future__ import annotations` côté backend).

---

## 1. Backend — Nouvel endpoint suggestions filtrées

**Fichier** : `backend/routers/rapprochement.py`

Ajouter `GET /{filename}/{index}/suggestions` :

- **Params query optionnels** : `montant_min`, `montant_max`, `date_from`, `date_to`, `search` (texte fournisseur)
- **Logique** :
  1. Charger l'opération `[index]` du fichier via `operation_service`
  2. Charger tous les justificatifs `en_attente` avec leur OCR (`.ocr.json`)
  3. Pour chaque justificatif :
     - Appliquer les filtres sur les données OCR (montant, date, fournisseur). Si un filtre est actif et que la donnée OCR existe, exclure si hors range. Si la donnée OCR est absente, ne PAS exclure (on ne filtre que ce qui est connu).
     - Calculer un score de pertinence par rapport à l'opération :
       - **50%** montant : `max(0, 1 - abs(ocr_montant - op_montant) / max(op_montant, 1))`
       - **30%** date : `max(0, 1 - days_diff / 30)` (0 si > 30 jours d'écart)
       - **20%** fournisseur : 0.2 si `ocr_fournisseur.lower()` est contenu dans `operation["libelle"].lower()`
  4. Retourner la liste triée par score décroissant
- **Format réponse** : tableau de `{ filename, ocr_date, ocr_montant, ocr_fournisseur, score, size_human }`
- N'oublie pas `from __future__ import annotations` et les imports `Optional` pour Python 3.9

---

## 2. Frontend — Hook `useRapprochementManuel`

**Créer** : `frontend/src/hooks/useRapprochementManuel.ts`

```typescript
interface SuggestionFilters {
  montantMin: string
  montantMax: string
  dateFrom: string
  dateTo: string
  search: string
}

interface JustificatifSuggestion {
  filename: string
  ocr_date: string
  ocr_montant: number | null
  ocr_fournisseur: string
  score: number
  size_human: string
}
```

- `filters` : `useState<SuggestionFilters>` initialisé vide
- `queryParams` : `useMemo` qui construit les URLSearchParams à partir des filtres non-vides
- `suggestions` : `useQuery` sur `/rapprochement/{filename}/{index}/suggestions{queryParams}`, `enabled` seulement si filename et index sont définis
- `associate` : `useMutation` sur `POST /rapprochement/{filename}/manual` avec body `{ operation_index, justificatif_filename }`. `onSuccess` : invalider les queryKeys `['rapprochement']`, `['rapprochement-suggestions']`, `['operations', filename]`, `['justificatifs']`
- Exporter : `filters`, `updateFilter(key, value)`, `resetFilters()`, `suggestions`, `isLoading`, `associate`

---

## 3. Frontend — Composant `RapprochementManuelDrawer`

**Créer** : `frontend/src/components/RapprochementManuelDrawer.tsx`

### Props

```typescript
interface Props {
  isOpen: boolean
  onClose: () => void
  filename: string
  operation: { index: number; date: string; libelle: string; debit: number; credit: number } | null
}
```

### Structure du drawer

Le drawer fait **800px de large**, arrive par la droite (translateX), avec backdrop `bg-black/50`. 4 zones verticales :

#### A. Header (fixe, border-b)
- Titre "Rapprochement manuel"
- Sous-titre : `{operation.libelle} — {montant formaté} — {date formatée}`
- Bouton X pour fermer

#### B. Zone filtres (fixe, border-b, p-4)
- **Ligne 1** : input texte avec icône Search — placeholder "Rechercher par fournisseur..."
- **Ligne 2** : grille 4 colonnes — [Montant min €] [Montant max €] [Date du] [Date au]. Chaque input a une petite icône (DollarSign ou Calendar) positionnée en absolute left.
- **Ligne 3** : flex between — bouton "Réinitialiser les filtres" (icône RotateCcw) à gauche, compteur "{n} justificatif(s)" à droite

#### C. Zone scrollable split (flex-1 overflow-hidden flex)
- **Panneau gauche — Liste** : `overflow-y-auto`, largeur `w-full` si pas de preview, `w-[320px]` si preview ouvert
  - Chaque item affiche :
    - Icône FileText + nom fournisseur OCR (ou filename si pas de fournisseur) + `ScoreBadge` (badge coloré : ≥70% vert, ≥40% jaune, sinon rouge, affiche le % en font-mono)
    - Ligne secondaire : date OCR (icône Calendar) + montant OCR (icône DollarSign) + taille fichier
    - Si fournisseur affiché, le filename en tout petit dessous
    - Bouton œil (Eye) à droite pour toggle le preview
  - **Clic sur la ligne** = sélection (highlight `bg-primary/10 border-l-2 border-l-primary`)
  - **Clic sur l'œil** = toggle preview PDF (action séparée de la sélection)

- **Panneau droit — Preview PDF** : `flex-1 bg-background`, iframe pleine hauteur sur `/api/justificatifs/{filename}/preview`. N'apparaît que si un fichier est en preview.

#### D. Footer (fixe, border-t)
- Gauche : texte "Sélectionné : {filename}" avec icône Check verte, ou "Cliquez sur un justificatif..." si rien sélectionné
- Droite : bouton "Annuler" (outline) + bouton "Associer" (bg-primary, disabled si rien sélectionné, Loader2 si mutation en cours)

### Comportement
- À l'ouverture (`useEffect` sur `isOpen`) : reset preview, selection, et filtres
- `handleAssociate` : appelle `associate.mutate(selectedFile)`, `onSuccess` → `toast.success()` + `onClose()`, `onError` → `toast.error()`

### Styling
- Utiliser exclusivement les classes CSS variables du projet : `bg-surface`, `bg-background`, `text-text`, `text-text-muted`, `border-border`, `bg-primary`
- Utiliser `cn()` de `lib/utils.ts` pour les classes conditionnelles
- Icônes : Lucide React (X, Search, Calendar, DollarSign, FileText, Check, RotateCcw, Eye, ChevronRight, Loader2)

---

## 4. Intégration dans `RapprochementPage`

**Fichier** : `frontend/src/components/RapprochementPage.tsx`

- Ajouter un state `const [drawerOp, setDrawerOp] = useState<Operation | null>(null)`
- Sur chaque ligne d'opération **non rapprochée**, ajouter un bouton "Associer" qui fait `setDrawerOp(op)` (l'objet opération doit contenir son `index`)
- Rendre le drawer en bas du JSX :

```tsx
<RapprochementManuelDrawer
  isOpen={drawerOp !== null}
  onClose={() => setDrawerOp(null)}
  filename={selectedFile}
  operation={drawerOp}
/>
```

---

## 5. Vérifications

Après implémentation, vérifie :
- [ ] L'endpoint backend retourne bien les suggestions triées par score
- [ ] Les filtres fonctionnent côté backend (montant, date, recherche)
- [ ] Le hook refetch quand les filtres changent (queryKey inclut queryParams)
- [ ] Le drawer s'ouvre/ferme avec animation translateX
- [ ] La sélection (clic ligne) et le preview (clic œil) sont deux actions indépendantes
- [ ] Le bouton "Associer" est disabled tant que rien n'est sélectionné
- [ ] Après association réussie : toast success, drawer se ferme, les queries sont invalidées
- [ ] Le drawer reset son état (filtres, sélection, preview) à chaque ouverture
- [ ] Tout utilise le dark theme (CSS variables, pas de couleurs hardcodées sauf les badges score)
