# Prompt — Titre automatique des rapports générés

## Contexte

Page ReportsPage (`frontend/src/pages/ReportsPage.tsx`). Actuellement le titre du rapport est saisi manuellement ou construit avec une logique basique. On veut que le titre se compose **automatiquement** à partir des filtres sélectionnés (catégories + période).

## Règles de nommage du titre

Le titre est composé de **catégories + période**, séparés par " — ".

### Partie catégories

| Cas | Titre |
|-----|-------|
| 1 catégorie | Nom exact de la catégorie (`URSSAF`, `CARMF`, `Honoraires`) |
| 2-4 catégories | Liste séparée par virgule (`URSSAF, CARMF, Honoraires`) |
| 5+ catégories | 3 premières + compteur (`URSSAF, CARMF, Honoraires… (+3)`) |
| Toutes catégories cochées | `Toutes catégories` |
| Aucune catégorie | `Rapport` (fallback) |

### Partie période

| Cas | Période |
|-----|---------|
| Année + mois | Nom du mois capitalisé + année (`Janvier 2025`, `Mars 2026`) |
| Année seule (pas de mois) | Année seule (`2025`) |
| Ni année ni mois | Omise (titre = catégories seules) |

### Exemples

- 1 catégorie, mois : `URSSAF — Janvier 2025`
- 1 catégorie, année : `CARMF — 2025`
- 3 catégories, mois : `URSSAF, CARMF, Honoraires — Mars 2025`
- 6 catégories, mois : `URSSAF, CARMF, Honoraires… (+3) — Mars 2025`
- Toutes, année : `Toutes catégories — 2025`

## Implémentation

### Fichier : `frontend/src/pages/ReportsPage.tsx`

1. **Créer une fonction utilitaire `buildReportTitle`** dans le même fichier (ou dans un utils si déjà existant) :

```typescript
const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

function buildReportTitle(
  selectedCategories: string[],
  allCategoriesCount: number,
  year?: number,
  month?: number
): string {
  // Partie catégories
  let catPart: string;
  if (selectedCategories.length === 0) {
    catPart = 'Rapport';
  } else if (selectedCategories.length === allCategoriesCount) {
    catPart = 'Toutes catégories';
  } else if (selectedCategories.length <= 4) {
    catPart = selectedCategories.join(', ');
  } else {
    const displayed = selectedCategories.slice(0, 3).join(', ');
    catPart = `${displayed}… (+${selectedCategories.length - 3})`;
  }

  // Partie période
  let periodPart = '';
  if (year && month) {
    periodPart = `${MONTH_NAMES_FR[month - 1]} ${year}`;
  } else if (year) {
    periodPart = `${year}`;
  }

  return periodPart ? `${catPart} — ${periodPart}` : catPart;
}
```

2. **Appeler `buildReportTitle`** dans un `useEffect` ou `useMemo` qui réagit aux changements de `selectedCategories`, `year`, `month`. Mettre à jour le champ `title` du state du formulaire automatiquement.

3. **Le champ titre reste éditable** : l'utilisateur peut le modifier après auto-génération. L'auto-génération ne se déclenche que si le titre n'a pas été modifié manuellement (flag `titleManuallyEdited`). Si l'utilisateur efface le titre et change un filtre, l'auto-génération reprend.

4. **Batch 12 mois** : la fonction batch existante doit utiliser `buildReportTitle(selectedCategories, allCategoriesCount, year, monthIndex)` pour chaque mois au lieu de sa logique actuelle.

## Vérification

- [ ] 1 catégorie + mois → titre = `NomCatégorie — Mois Année`
- [ ] 1 catégorie + année seule → titre = `NomCatégorie — Année`
- [ ] 3 catégories + mois → titre = `Cat1, Cat2, Cat3 — Mois Année`
- [ ] 6 catégories → 3 affichées + `(+3)`
- [ ] Toutes cochées → `Toutes catégories — ...`
- [ ] Batch 12 mois utilise `buildReportTitle` par mois
- [ ] Titre reste éditable manuellement
- [ ] `npx tsc --noEmit` passe sans erreur
