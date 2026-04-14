# Prompt — GED Search Bar + Thumbnail Badges

Lis `CLAUDE.md` avant de commencer.

---

## Objectif

1. **Backend** : ajouter `montant_min` / `montant_max` à `GET /api/ged/documents`
2. **Frontend** : nouveau composant `GedSearchBar` qui remplace intégralement `GedFilterBar`
3. **Frontend** : badges overlay sur les thumbnails des justificatifs dans `GedDocumentCard`

---

## 1. Backend — `backend/routers/ged.py`

### 1.1 Nouveaux query params sur `GET /documents`

Ajouter dans la signature du handler :

```python
montant_min: float | None = Query(default=None)
montant_max: float | None = Query(default=None)
```

Appliquer le filtre dans `ged_service.get_documents()` (ou inline dans le router selon l'architecture actuelle) après les filtres existants :

```python
if montant_min is not None:
    docs = [d for d in docs if d.montant is not None and d.montant >= montant_min]
if montant_max is not None:
    docs = [d for d in docs if d.montant is not None and d.montant <= montant_max]
```

Passer `montant_min` et `montant_max` à `ged_service.get_documents()` si la fonction est séparée.

---

## 2. Frontend — `GedSearchBar`

### 2.1 Types — `frontend/src/types/index.ts`

Étendre `GedFilters` (interface existante) :

```typescript
montant_min?: number;
montant_max?: number;
```

### 2.2 Nouveau composant — `frontend/src/components/ged/GedSearchBar.tsx`

Ce composant **remplace `GedFilterBar`** complètement. Props :

```typescript
interface GedSearchBarProps {
  filters: GedFilters;
  onChange: (filters: GedFilters) => void;
  categories: string[];           // liste dédupliquée depuis stats GED
  subcategories: string[];        // filtrée selon catégorie sélectionnée
  fournisseurs: string[];         // liste dédupliquée depuis stats GED
  resultCount: number;            // nombre de documents après filtres
}
```

#### Structure visuelle

Un bloc `<div>` avec `background: var(--color-background-primary)`, `border: 0.5px solid var(--color-border-tertiary)`, `border-radius: var(--border-radius-lg)`, `padding: 12px 14px`.

**Ligne principale** (flex, gap 8px, alignItems center) :

```
[🔍 input texte "Fournisseur, nom de fichier, contenu OCR…"  flex:1]
[divider vertical]
[label "Montant"] [input min 72px] [–] [input max 72px] [€]
[divider vertical]
[bouton FilterIcon toggle filtres avancés]
```

- Champ texte : debounce 250 ms sur `onChange` → met à jour `filters.search`
- Champs montant : `type="number"`, `step="0.01"`, `min="0"`, `placeholder="min"` / `"max"` → met à jour `filters.montant_min` / `filters.montant_max` au blur ou Enter, debounce 400 ms
- Bouton FilterIcon (`lucide-react`) : toggle `showAdvanced` (état local), actif si au moins un filtre avancé est défini (classe active avec `color: #378ADD`)

**Ligne filtres avancés** (visible si `showAdvanced`, `border-top: 0.5px solid var(--color-border-tertiary)`, `padding-top: 10px`, `margin-top: 10px`, flex, gap 8px, flexWrap wrap) :

```
[label "Type"] [select type]
[select catégorie] [select sous-catégorie (cascade)]
[divider]
[label "Période"] [select année] [select mois]
[flex:1]
[bouton "Réinitialiser" si hasActiveFilters]
```

- `select` sous-catégorie : options filtrées selon la catégorie sélectionnée (props `subcategories` recalculées par le parent)
- `select` type : options `{ "": "Tous les types", justificatif: "Justificatifs", releve: "Relevés", rapport: "Rapports", document_libre: "Documents libres" }`
- `select` année : années dynamiques de `new Date().getFullYear() - 2` à `new Date().getFullYear()`
- `select` mois : Janvier … Décembre

**Ligne chips actifs** (visible si `hasActiveFilters`, `margin-top: 8px`, flex, gap 6px, flexWrap wrap, alignItems center) :

```
[label "Filtres actifs :"] [chip search] [chip montant] [chip type] [chip catégorie] [chip sous-cat] [chip période]
```

Chaque chip : `border-radius: 100px`, `height: 24px`, `padding: 0 8px 0 10px`, `font-size: 12px`, bouton `✕` qui clear le filtre correspondant.

Couleurs chips :
- search (texte libre) : `--color-background-secondary` / `--color-text-secondary`
- montant : amber (`#FAEEDA` bg, `#854F0B` text, `#FAC775` border)
- type : purple (`#EEEDFE` bg, `#3C3489` text, `#CECBF6` border)
- catégorie / sous-catégorie : blue (`#E6F1FB` bg, `#185FA5` text, `#B5D4F4` border)
- période : green (`#EAF3DE` bg, `#3B6D11` text, `#C0DD97` border)

**`hasActiveFilters`** : true si au moins un champ de `filters` est non-vide/non-nul (search, montant_min, montant_max, type, categorie, sous_categorie, year, month, fournisseur, favorite).

Fonction `resetAll()` : appelle `onChange({})` (reset total).

**Compteur résultats** sous le bloc (hors du bloc blanc) :

```tsx
<p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
  <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{resultCount} document{resultCount !== 1 ? 's' : ''}</span>
  {hasActiveFilters ? ' correspondent aux filtres' : ' dans la bibliothèque'}
</p>
```

### 2.3 Intégration dans `GedPage.tsx`

- **Supprimer** `<GedFilterBar>` et tous ses imports
- **Ajouter** `<GedSearchBar>` dans la zone header de la page, **au-dessus** du split layout (arbre + contenu), pas à l'intérieur du panneau de contenu
- Le clic sur un nœud de `GedTreePanel` appelle `deriveFiltersFromNode(nodeId)` comme avant → mais maintenant le résultat est mergé dans `GedFilters` via `setFilters` → les chips actifs reflètent automatiquement la sélection arbre

Position dans le JSX de `GedPage` :

```tsx
<div className="...">          {/* page wrapper */}
  <div className="...">        {/* page header row : titre + boutons vue */}
    ...
  </div>

  <GedSearchBar                {/* ← ICI, pleine largeur avant le split */}
    filters={filters}
    onChange={setFilters}
    categories={categoriesList}
    subcategories={subcatForSelected}
    fournisseurs={fournisseursList}
    resultCount={documents.length}
  />

  <div className="...">        {/* split layout : arbre 260px + grille */}
    <GedTreePanel ... />
    <div>...</div>
  </div>
</div>
```

`categoriesList` et `fournisseursList` : extraits des stats GED (`GET /api/ged/stats`) — `stats.par_categorie.map(c => c.categorie)` et `stats.par_fournisseur.map(f => f.fournisseur)`.

`subcatForSelected` : à construire côté `GedPage` depuis les documents chargés quand une catégorie est active, sinon liste vide.

---

## 3. Frontend — Badges thumbnail dans `GedDocumentCard`

### 3.1 Composant `GedDocumentCard.tsx`

Pour les documents de type `justificatif`, superposer des badges **en overlay** sur le `PdfThumbnail` via `position: relative` sur le conteneur thumbnail + `position: absolute` sur les badges.

#### Déterminer le statut associé/en attente

```typescript
const isJustificatif = doc.type === 'justificatif';
const isPending = doc.doc_id?.includes('en_attente/') ?? false;
// associé = justificatif traité avec operation_ref présent
const isAssociated = !isPending && !!doc.operation_ref;
```

#### Structure du conteneur thumbnail

```tsx
<div style={{ position: 'relative' }}>
  <PdfThumbnail docId={doc.doc_id} className="..." />

  {isJustificatif && (
    <>
      {/* Badge statut — top-right */}
      <div style={{
        position: 'absolute', top: 6, right: 6,
        display: 'flex', alignItems: 'center', gap: 4,
        height: 20, padding: '0 7px',
        borderRadius: 100, fontSize: 10, fontWeight: 500,
        ...(isPending
          ? { background: '#FAEEDA', color: '#854F0B', border: '0.5px solid #FAC775' }
          : isAssociated
            ? { background: '#EAF3DE', color: '#3B6D11', border: '0.5px solid #C0DD97' }
            : null
        ),
        backdropFilter: 'none',
      }}>
        {isPending && <LinkIcon size={10} />}
        {isAssociated && <CheckCircle2 size={10} />}
        <span>{isPending ? 'En attente' : isAssociated ? 'Associé' : ''}</span>
      </div>

      {/* Badge montant — bottom-left */}
      {doc.montant != null && (
        <div style={{
          position: 'absolute', bottom: 6, left: 6,
          height: 20, padding: '0 7px',
          borderRadius: 100, fontSize: 10, fontWeight: 500,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
        }}>
          {doc.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
        </div>
      )}

      {/* Badge date — bottom-right */}
      {(doc.date_document || doc.date_operation) && (
        <div style={{
          position: 'absolute', bottom: 6, right: 6,
          height: 20, padding: '0 7px',
          borderRadius: 100, fontSize: 10, fontWeight: 500,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
        }}>
          {formatDateShort(doc.date_document ?? doc.date_operation!)}
        </div>
      )}
    </>
  )}
</div>
```

`formatDateShort` : convertit `"2025-03-07"` → `"07/03/25"` (6 chars, compact pour overlay).

Imports Lucide à ajouter : `LinkIcon`, `CheckCircle2`.

**Ne pas afficher** de badge statut si ni `isPending` ni `isAssociated` (justificatif dissocié sans opération).

---

## 4. Checklist de vérification

- [ ] `GET /api/ged/documents?montant_min=20&montant_max=200` filtre correctement
- [ ] Champ texte search debounce 250 ms, pas de requête à chaque frappe
- [ ] Champs montant debounce 400 ms, mise à jour au blur ou Enter
- [ ] Select sous-catégorie se vide quand catégorie change
- [ ] Clic nœud arbre GedTreePanel → chips apparaissent dans GedSearchBar
- [ ] Bouton ✕ sur un chip supprime ce seul filtre
- [ ] Bouton "Réinitialiser" → `onChange({})` → tous les chips disparaissent
- [ ] Chips période : format "Mars 2025" (nom mois + année)
- [ ] Chips montant : format "20 – 200 €"
- [ ] GedFilterBar supprimé (import + JSX + fichier)
- [ ] Badge "En attente" (amber) visible sur justificatifs `en_attente/`
- [ ] Badge "Associé" (vert) visible sur justificatifs `traites/` avec `operation_ref`
- [ ] Badge montant overlay (dark semi-transparent, bottom-left)
- [ ] Badge date overlay (dark semi-transparent, bottom-right)
- [ ] Aucun badge overlay sur relevés, rapports, documents libres
- [ ] `from __future__ import annotations` présent si modif Python
- [ ] Pas de `any` TypeScript
