# Prompt Claude Code — Navigation bidirectionnelle Justificatif ↔ Opération

> **Lire `CLAUDE.md` en premier** avant toute implémentation.

## Contexte

Actuellement on navigue d'une opération vers son justificatif (colonne trombone dans l'éditeur, drawer attribution). On veut le **chemin inverse** : depuis n'importe quel endroit affichant un justificatif, voir ou associer l'opération correspondante.

**Deux états** selon que le justificatif est associé ou non :
- **Associé (traité)** → bouton "Voir l'opération" qui navigue vers l'éditeur avec scroll + flash highlight sur la ligne
- **En attente (non associé)** → mini-liste des 2-3 meilleures suggestions d'opérations avec bouton "Associer" one-click + fallback "Rechercher manuellement" vers `/justificatifs`

## Vue d'ensemble des modifications

| Fichier | Action | Description |
|---------|--------|-------------|
| `backend/services/justificatif_service.py` | **Modifier** | Ajouter `find_operations_by_justificatif()` |
| `backend/routers/justificatifs.py` | **Modifier** | Ajouter `GET /reverse-lookup/{filename}` |
| `frontend/src/types/index.ts` | **Modifier** | Ajouter `ReverseLookupResult` |
| `frontend/src/hooks/useJustificatifs.ts` | **Modifier** | Ajouter `useReverseLookup` + `useJustificatifSuggestions` |
| `frontend/src/components/shared/JustificatifOperationLink.tsx` | **Créer** | Composant unifié (2 états) |
| `frontend/src/components/editor/EditorPage.tsx` | **Modifier** | Support `?file=X&highlight=Y`, `data-row-index` sur les `<tr>` |
| `frontend/src/components/ged/GedDocumentDrawer.tsx` | **Modifier** | Intégrer `JustificatifOperationLink` |
| `frontend/src/components/ocr/OcrPage.tsx` | **Modifier** | Intégrer dans l'onglet Historique |
| `frontend/src/components/rapprochement/RapprochementPage.tsx` | **Modifier** | Intégrer dans le log des associations |

## Phase 1 — Backend : reverse lookup

### 1.1 Service (`backend/services/justificatif_service.py`)

Ajouter la fonction `find_operations_by_justificatif` :

```python
def find_operations_by_justificatif(justificatif_filename: str) -> list[dict]:
    """Parcourt tous les fichiers d'opérations pour trouver ceux liés au justificatif."""
    from backend.services import operation_service
    results = []
    # Normaliser : le champ "Lien justificatif" peut contenir un chemin avec dossier (traites/xxx.pdf)
    basename = justificatif_filename.split("/")[-1]

    for file_info in operation_service.list_operation_files():
        ops = operation_service.load_operations(file_info["filename"])
        for idx, op in enumerate(ops):
            # Vérifier le lien direct sur l'opération
            lien = op.get("Lien justificatif", "") or ""
            if lien and lien.split("/")[-1] == basename:
                results.append({
                    "operation_file": file_info["filename"],
                    "operation_index": idx,
                    "date": op.get("Date", ""),
                    "libelle": op.get("Libelle", ""),
                    "debit": op.get("Debit", 0),
                    "credit": op.get("Credit", 0),
                    "categorie": op.get("Categorie", ""),
                    "sous_categorie": op.get("Sous-categorie", ""),
                    "ventilation_index": None,
                })
            # Vérifier les sous-lignes ventilées
            for vl_idx, vl in enumerate(op.get("ventilation", []) or []):
                vl_lien = vl.get("justificatif", "") or ""
                if vl_lien and vl_lien.split("/")[-1] == basename:
                    results.append({
                        "operation_file": file_info["filename"],
                        "operation_index": idx,
                        "date": op.get("Date", ""),
                        "libelle": vl.get("libelle", op.get("Libelle", "")),
                        "debit": vl.get("montant", 0) if op.get("Debit") else 0,
                        "credit": vl.get("montant", 0) if op.get("Credit") else 0,
                        "categorie": vl.get("categorie", ""),
                        "sous_categorie": vl.get("sous_categorie", ""),
                        "ventilation_index": vl_idx,
                    })
    return results
```

**Important** : utiliser `from __future__ import annotations` en tête du fichier (déjà présent normalement). Gérer les valeurs NaN avec `_sanitize_value()` si nécessaire sur debit/credit.

### 1.2 Router (`backend/routers/justificatifs.py`)

Ajouter l'endpoint :

```python
@router.get("/reverse-lookup/{filename:path}")
async def reverse_lookup_justificatif(filename: str):
    """Trouve les opérations associées à un justificatif donné."""
    return justificatif_service.find_operations_by_justificatif(filename)
```

**Attention** : cet endpoint doit être déclaré **avant** les routes `/{filename}/preview` et `/{filename}/suggestions` pour éviter les conflits de routing FastAPI. Le placer juste après les routes statiques (`/stats`, `/reverse-lookup/...`) et avant les routes dynamiques `/{filename}`.

## Phase 2 — Frontend : types et hooks

### 2.1 Types (`frontend/src/types/index.ts`)

Ajouter :

```typescript
export interface ReverseLookupResult {
  operation_file: string
  operation_index: number
  date: string
  libelle: string
  debit: number
  credit: number
  categorie: string
  sous_categorie: string
  ventilation_index: number | null
}
```

### 2.2 Hooks (`frontend/src/hooks/useJustificatifs.ts`)

Ajouter deux hooks :

```typescript
// Reverse lookup : justificatif → opération(s) associée(s)
export function useReverseLookup(justificatifFilename: string | null) {
  return useQuery({
    queryKey: ['justificatif-reverse-lookup', justificatifFilename],
    queryFn: () => api.get<ReverseLookupResult[]>(
      `/justificatifs/reverse-lookup/${justificatifFilename}`
    ),
    enabled: !!justificatifFilename,
  })
}

// Suggestions d'opérations pour un justificatif non associé
// Utilise l'endpoint existant GET /rapprochement/suggestions/justificatif/{filename}
export function useJustificatifOperationSuggestions(justificatifFilename: string | null) {
  return useQuery({
    queryKey: ['justificatif-operation-suggestions', justificatifFilename],
    queryFn: () => api.get(
      `/rapprochement/suggestions/justificatif/${justificatifFilename}`
    ),
    enabled: !!justificatifFilename,
  })
}
```

**Note** : le type de retour de `useJustificatifOperationSuggestions` dépend de ce que retourne déjà `GET /rapprochement/suggestions/justificatif/{filename}`. Vérifier le type existant dans le code et l'utiliser.

## Phase 3 — Composant unifié `JustificatifOperationLink`

### 3.1 Créer `frontend/src/components/shared/JustificatifOperationLink.tsx`

**Props** :

```typescript
interface JustificatifOperationLinkProps {
  justificatifFilename: string
  isAssociated: boolean  // true = traité, false = en attente
  className?: string
}
```

**Comportement état "Associé"** (`isAssociated === true`) :

- Appeler `useReverseLookup(justificatifFilename)`
- Si résultats vides → ne rien afficher (return null)
- Si résultats → afficher un bouton "Voir l'opération" avec :
  - Icône `ExternalLink` (Lucide) 14px
  - Style : `bg-primary/10 text-primary hover:bg-primary/20`, font-medium, text-sm, px-3 py-1.5, rounded-md, transition-colors
  - Sous le bouton : texte gris `text-xs text-text-muted` avec date + libellé tronqué + montant formaté
  - Au clic : `navigate(\`/editor?file=${encodeURIComponent(result.operation_file)}&highlight=${result.operation_index}\`)`
  - Si `ventilation_index !== null`, ajouter `&vl=${result.ventilation_index}` au query string (pour usage futur)

**Comportement état "En attente"** (`isAssociated === false`) :

- Appeler `useJustificatifOperationSuggestions(justificatifFilename)`
- Si loading → petit spinner inline
- Si aucune suggestion → afficher uniquement le lien "Rechercher manuellement"
- Si suggestions → afficher les **3 premières** max, chacune dans une row :
  - Layout : flex row, gap-2, items-center, bg-surface rounded-md p-2
  - Badge score : `text-xs font-medium px-1.5 py-0.5 rounded` avec couleur dynamique :
    - score >= 80 : `bg-success/10 text-success`
    - score >= 60 : `bg-warning/10 text-warning`
    - sinon : `bg-surface text-text-muted`
    - **Attention** : le score backend est entre 0 et 1, multiplier par 100 pour l'affichage
  - Contenu : libellé (font-medium, text-sm, truncate) + ligne gris (date · montant · catégorie)
  - Bouton "Associer" : `bg-warning text-background text-xs font-medium px-2.5 py-1 rounded-md hover:scale-105 transition-transform`
  - Au clic "Associer" : appeler la mutation `POST /rapprochement/associate-manual` avec `{ justificatif_filename, operation_file, operation_index }`, puis invalider les query keys : `['justificatif-reverse-lookup']`, `['justificatif-operation-suggestions']`, `['justificatifs']`, `['rapprochement']`, `['operations']`
  - Utiliser la mutation existante dans `useRapprochement.ts` si disponible, sinon créer une mutation locale

- En dessous des suggestions, lien "Rechercher manuellement" :
  - Icône `Search` (Lucide) 12px + texte `text-xs text-text-muted`
  - Style : bouton ghost avec border subtle, hover bg-surface
  - Au clic : `navigate('/justificatifs')`

**Label de section** au-dessus des suggestions : "Opérations correspondantes" en `text-xs font-medium text-text-muted mb-2`

### 3.2 Structure HTML simplifiée

```
<div className={cn("...", className)}>
  {isAssociated ? (
    // État associé
    <div>
      <button onClick={navigateToEditor}>
        <ExternalLink /> Voir l'opération
      </button>
      <span className="text-xs text-text-muted">
        {result.date} — {result.libelle} — {formatCurrency(montant)}
      </span>
    </div>
  ) : (
    // État en attente
    <div>
      <span className="text-xs font-medium text-text-muted">Opérations correspondantes</span>
      {suggestions.slice(0, 3).map(s => (
        <div key={...} className="flex items-center gap-2 bg-surface rounded-md p-2">
          <span className={scoreBadgeClass}>{Math.round(s.score * 100)}%</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{s.libelle}</div>
            <div className="text-xs text-text-muted">{s.date} · {formatCurrency(...)} · {s.categorie}</div>
          </div>
          <button onClick={() => associate(s)} className="bg-warning ...">Associer</button>
        </div>
      ))}
      <button onClick={() => navigate('/justificatifs')} className="ghost...">
        <Search /> Rechercher manuellement
      </button>
    </div>
  )}
</div>
```

## Phase 4 — EditorPage : support `?file=X&highlight=Y`

### 4.1 Modifier `frontend/src/components/editor/EditorPage.tsx`

**Lire les query params** (en haut du composant, à côté du `?filter=uncategorized` existant) :

```typescript
const [searchParams, setSearchParams] = useSearchParams()
const highlightFile = searchParams.get('file')
const highlightIndex = searchParams.get('highlight')
```

**Sélectionner le bon fichier** : si `highlightFile` est présent au montage :

```typescript
const highlightFileRef = useRef(false)

useEffect(() => {
  if (highlightFile && !highlightFileRef.current && files?.length) {
    // Trouver le fichier dans la liste
    const targetFile = files.find((f: any) => f.filename === highlightFile)
    if (targetFile) {
      // Mettre à jour l'année dans le store global
      setFiscalYear(targetFile.year)
      // Sélectionner le mois (via le state local existant)
      setSelectedMonth(targetFile.month)
      // Sélectionner le fichier
      setSelectedFile(targetFile.filename)
      highlightFileRef.current = true
    }
  }
}, [highlightFile, files])
```

**Note** : adapter les noms exacts des setters selon le code actuel de EditorPage. Le pattern avec `useRef` anti-boucle est déjà utilisé pour l'auto-catégorisation (`lastAutoCategorizedFile`).

**Scroll + flash** après chargement des opérations :

```typescript
const highlightDoneRef = useRef(false)

useEffect(() => {
  if (highlightIndex != null && operations?.length && !highlightDoneRef.current) {
    const idx = parseInt(highlightIndex)
    highlightDoneRef.current = true
    // Laisser le tableau se rendre
    setTimeout(() => {
      const row = document.querySelector(`[data-row-index="${idx}"]`)
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        row.classList.add('flash-highlight')
        setTimeout(() => row.classList.remove('flash-highlight'), 2500)
      }
    }, 400)
  }
}, [operations, highlightIndex])
```

**Ajouter `data-row-index`** sur chaque `<tr>` du tableau d'opérations. Trouver le `<tr>` dans le rendu TanStack Table et ajouter :

```tsx
<tr
  key={row.id}
  data-row-index={row.original._originalIndex ?? row.index}
  // ... autres props existantes
>
```

### 4.2 CSS flash-highlight

Vérifier que la classe `flash-highlight` existe dans `frontend/src/index.css`. Si elle n'existe pas (elle est peut-être uniquement dans JustificatifsPage en inline), l'ajouter dans `index.css` :

```css
@keyframes flash-highlight-anim {
  0% { background-color: rgb(245 158 11 / 0.25); }
  100% { background-color: transparent; }
}

.flash-highlight {
  animation: flash-highlight-anim 2.5s ease-out forwards;
}
```

### 4.3 Nettoyage des params après navigation

Après le flash, nettoyer les query params pour ne pas re-flasher au re-render :

```typescript
// Dans le useEffect du flash, après le setTimeout du flash
setTimeout(() => {
  searchParams.delete('file')
  searchParams.delete('highlight')
  setSearchParams(searchParams, { replace: true })
}, 3000)
```

**Attention** : ne pas supprimer le param `filter` s'il est présent (cohabitation avec `?filter=uncategorized`).

## Phase 5 — Intégrations du composant

### 5.1 GED Document Drawer (`frontend/src/components/ged/GedDocumentDrawer.tsx`)

Dans le drawer, **si le document est un justificatif** (type === "justificatif" ou doc_id contient "justificatifs/"), ajouter `<JustificatifOperationLink>` dans la section metadata, sous le nom du fichier et les infos OCR.

Déterminer `isAssociated` : si le document est dans `traites/` → true, si dans `en_attente/` → false. Le `doc_id` contient le chemin : `justificatifs/traites/xxx.pdf` ou `justificatifs/en_attente/xxx.pdf`.

```tsx
{isJustificatif && (
  <JustificatifOperationLink
    justificatifFilename={basename}  // extraire le basename du doc_id
    isAssociated={doc.doc_id.includes('/traites/')}
    className="mt-3"
  />
)}
```

Extraire le basename : `doc.doc_id.split('/').pop()`

### 5.2 OCR Historique (`frontend/src/components/ocr/OcrPage.tsx`)

Dans l'onglet Historique, chaque entrée a un nom de fichier et un statut. Ajouter le composant pour les entrées dont le fichier existe (en_attente ou traités) :

```tsx
<JustificatifOperationLink
  justificatifFilename={entry.filename}
  isAssociated={entry.status === 'traite'}  // adapter selon le champ réel
  className="mt-2"
/>
```

**Note** : vérifier le nom exact du champ statut dans le type de l'historique OCR.

### 5.3 Rapprochement log

Dans la page Rapprochement, si un historique/log des associations récentes est affiché, ajouter à côté du nom du justificatif :

```tsx
<JustificatifOperationLink
  justificatifFilename={log.justificatif_filename}
  isAssociated={true}  // le log = association faite
  className="ml-2"
/>
```

### 5.4 Drawer Attribution (`frontend/src/components/justificatifs/JustificatifAttributionDrawer.tsx`)

Dans le panneau droit du drawer, quand un justificatif **déjà associé à une autre opération** est consulté (cas rare mais possible), afficher un avertissement avec le lien vers l'opération liée.

## Phase 6 — Vérification

### Backend
- [ ] `GET /api/justificatifs/reverse-lookup/justificatif_xxx.pdf` retourne les opérations liées
- [ ] Retourne `[]` pour un justificatif non associé
- [ ] Fonctionne avec les justificatifs dans `traites/` (basename match, le champ `Lien justificatif` peut contenir `traites/xxx.pdf`)
- [ ] Fonctionne avec les sous-lignes ventilées (retourne `ventilation_index`)
- [ ] Gère les valeurs NaN dans debit/credit (sanitize)
- [ ] `from __future__ import annotations` présent
- [ ] Pas de conflit de routing avec `/{filename}/preview` et `/{filename}/suggestions`

### Frontend — composant
- [ ] `JustificatifOperationLink` avec `isAssociated=true` : affiche "Voir l'opération" si reverse lookup trouve un résultat, rien sinon
- [ ] `JustificatifOperationLink` avec `isAssociated=false` : affiche suggestions scorées avec boutons "Associer"
- [ ] Score affiché correctement en % (backend 0-1 × 100)
- [ ] Couleur du badge score dynamique (vert >= 80%, ambre >= 60%, gris sinon)
- [ ] Max 3 suggestions affichées
- [ ] Bouton "Associer" appelle `POST /rapprochement/associate-manual` et invalide les caches TanStack Query pertinents
- [ ] Lien "Rechercher manuellement" navigue vers `/justificatifs`
- [ ] Spinner pendant le chargement des suggestions

### Frontend — EditorPage
- [ ] Navigation `/editor?file=operations_xxx.json&highlight=4` sélectionne le bon fichier (année + mois + filename)
- [ ] La ligne index 4 est scrollée au centre avec `scrollIntoView`
- [ ] Flash highlight ambre 2.5s qui s'estompe
- [ ] Les query params `file` et `highlight` sont nettoyés après le flash
- [ ] Pas de conflit avec le filtre `?filter=uncategorized` existant
- [ ] `data-row-index` présent sur chaque `<tr>` du tableau
- [ ] Le `useRef` anti-boucle empêche le re-déclenchement

### Intégrations
- [ ] GED Document Drawer : composant visible pour les justificatifs (traités et en_attente)
- [ ] OCR Historique : composant visible par entrée
- [ ] Rapprochement log : composant visible avec isAssociated=true
- [ ] Aucune régression sur les fonctionnalités existantes (filtres, tri, auto-catégorisation, ventilation)
