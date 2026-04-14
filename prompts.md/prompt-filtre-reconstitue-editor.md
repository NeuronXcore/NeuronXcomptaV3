# Filtre "Reconstitué" + Badge 😈 dans EditorPage

## Objectif

Ajouter dans la page Édition (`EditorPage.tsx`) un badge visuel 😈 sur les opérations dont le justificatif est un fac-similé reconstitué, et un filtre pour n'afficher que ces lignes.

## Contexte technique

- Les justificatifs reconstitués ont un nom de fichier commençant par `reconstitue_`
- La détection est purement frontend : `typeof op.Justificatif === 'string' && op.Justificatif.startsWith('reconstitue_')`
- EditorPage a déjà le pattern `?filter=uncategorized` avec : state booléen, columnFilter custom avec `filterFn`, bandeau warning avec compteur + bouton retirer, init depuis `searchParams`
- Colonnes badge existantes : Justificatif (trombone), Important (étoile), À revoir (triangle), Pointée (cercle) — toutes triables avec `sortingFn` custom
- Panel Filtres existant : dropdown catégorie, dropdown sous-catégorie, grille layout
- **Aucune modification backend requise**

## Implémentation

### Étape 1 — Badge 😈 sur la colonne Justificatif

Dans le rendu de la colonne Justificatif (celle du trombone) :

- Quand l'opération a un justificatif reconstitué (`Justificatif.startsWith('reconstitue_')`) :
  - Wrapper `relative` autour de l'icône trombone existante
  - Badge `absolute` coin bas-droit : emoji `😈` en `text-[10px]` ou `text-xs`
  - Le trombone reste vert (justificatif associé), le diablotin s'ajoute par-dessus
- Tooltip au hover sur le badge : `"Justificatif reconstitué (fac-similé)"`
- Ne pas casser le comportement existant du clic trombone (preview PDF / drawer attribution)

### Étape 2 — State filtre reconstitué

Dans le composant EditorPage :

```typescript
const [filterReconstitue, setFilterReconstitue] = useState<boolean>(
  searchParams.get('filter') === 'reconstitue'
);
```

Quand `filterReconstitue` change :
- Si `true` → appliquer column filter sur colonne Justificatif avec valeur `'__reconstitue__'`
- Si `false` → retirer ce column filter (sans toucher les autres filtres actifs)

### Étape 3 — filterFn custom

Ajouter une `filterFn` sur la colonne Justificatif (ou étendre celle existante) :

```typescript
filterFn: (row, columnId, filterValue) => {
  if (filterValue === '__reconstitue__') {
    const val = row.getValue(columnId);
    return typeof val === 'string' && val.startsWith('reconstitue_');
  }
  // ... autres filtres existants si applicable
  return true;
},
```

### Étape 4 — Chip filtre dans le panel Filtres

Ajouter dans la grille du panel Filtres existant un bouton toggle :

- Label : `😈 Reconstitué`
- Style inactif : `bg-surface border border-border text-secondary rounded-lg px-3 py-1.5 cursor-pointer`
- Style actif : `bg-accent text-white rounded-lg px-3 py-1.5 cursor-pointer`
- `onClick` → toggle `filterReconstitue`
- Positionnement : après les dropdowns catégorie/sous-catégorie, dans la même grille

### Étape 5 — Bandeau warning filtre actif

Réutiliser le pattern exact du bandeau "Non catégorisées" existant :

- Condition : `filterReconstitue === true`
- Texte : `"Filtre actif : justificatifs reconstitués 😈 (N résultats)"`
- `N` = nombre de lignes filtrées visibles (`table.getFilteredRowModel().rows.length`)
- Bouton "Retirer le filtre" :
  - `setFilterReconstitue(false)`
  - Retirer le column filter `__reconstitue__`
  - Nettoyer le search param `filter` de l'URL

Si le filtre uncategorized est aussi actif, les deux bandeaux doivent pouvoir coexister (chacun retire seulement le sien).

### Étape 6 — URL param `?filter=reconstitue`

- Au montage, lire `searchParams.get('filter')` — si `'reconstitue'`, activer le filtre
- Ouvrir automatiquement le panel Filtres quand activé par URL (même pattern que uncategorized)
- Compatible avec navigation depuis Pipeline, Alertes, ou tout autre lien externe

## Cas particuliers

- **Mode année complète (lecture seule)** : le filtre doit fonctionner aussi en mode year-wide view avec `useYearOperations`
- **Opérations ventilées** : vérifier les sous-lignes ventilation — si une sous-ligne a un justificatif reconstitué, le badge 😈 doit apparaître sur cette sous-ligne
- **Coexistence filtres** : le filtre reconstitué coexiste avec catégorie, sous-catégorie, et uncategorized sans conflit

## Fichiers à modifier

1. `frontend/src/pages/EditorPage.tsx` — state, chip, bandeau, URL param, column filter
2. La colonne Justificatif (dans la définition des colonnes TanStack Table de EditorPage) — badge 😈, filterFn

## Vérification

- [ ] Badge 😈 visible en coin du trombone vert pour chaque opération avec justificatif `reconstitue_*`
- [ ] Tooltip "Justificatif reconstitué (fac-similé)" au hover du badge
- [ ] Chip "😈 Reconstitué" dans le panel Filtres, toggle actif/inactif
- [ ] Filtre actif → seules les lignes reconstitué visibles
- [ ] Bandeau warning avec compteur N et bouton "Retirer le filtre"
- [ ] `?filter=reconstitue` fonctionne en navigation directe
- [ ] Panel Filtres s'ouvre auto quand filtre activé par URL
- [ ] Compatible mode année complète (lecture seule)
- [ ] Coexistence OK avec filtre uncategorized
- [ ] Clic trombone toujours fonctionnel (preview PDF)
- [ ] `npx tsc --noEmit` passe sans erreur
