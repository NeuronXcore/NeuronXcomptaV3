# Édition manuelle des données OCR depuis l'aperçu justificatif

## Contexte

Quand l'OCR échoue ou extrait des données incorrectes (`best_amount`, `best_date`, `supplier`), l'utilisateur doit pouvoir corriger manuellement depuis le drawer preview PDF de la page Justificatifs. Pour le montant, il doit pouvoir **choisir parmi les montants détectés par l'OCR** (chips cliquables) ou **saisir manuellement**.

Actuellement : aucun moyen d'éditer le `.ocr.json` depuis le frontend. Les justificatifs avec OCR échoué ont des scores de rapprochement à 0 et ne remontent jamais en suggestion.

## Instructions

1. Lire `CLAUDE.md`

## A — Backend

### A1. Vérifier `GET /api/ocr/result/{filename}` (existant)

Fichier : `backend/routers/ocr.py`

S'assurer qu'il retourne bien `extracted_data.amounts` (liste complète des montants) et `extracted_data.dates` (liste complète) en plus de `best_amount`, `best_date`, `supplier`. Si ces champs ne sont pas exposés, les ajouter à la réponse.

### A2. Nouvel endpoint `PATCH /api/ocr/{filename}/extracted-data`

Fichier : `backend/routers/ocr.py`

**Body** :
```json
{
  "best_amount": 1439.87,
  "best_date": "2025-01-18",
  "supplier": "FCE Bank plc"
}
```

Tous les champs optionnels — on ne met à jour que ceux envoyés.

**Modèle Pydantic** (dans `backend/models/ocr.py`) :
```python
class OcrManualEdit(BaseModel):
    best_amount: Optional[float] = None
    best_date: Optional[str] = None
    supplier: Optional[str] = None
```

### A3. Logique service

Fichier : `backend/services/ocr_service.py`

Nouvelle fonction `update_extracted_data(filename: str, edits: OcrManualEdit)` :

1. Chercher le fichier `.ocr.json` correspondant dans `en_attente/` ET `traites/` (le justificatif peut être dans l'un ou l'autre)
2. Charger le JSON
3. Mettre à jour `extracted_data.best_amount`, `extracted_data.best_date`, `extracted_data.supplier` avec les valeurs non-None reçues
4. Si `best_amount` modifié et pas déjà dans `extracted_data.amounts` → l'ajouter à `amounts`
5. Si `best_date` modifié et pas déjà dans `extracted_data.dates` → l'ajouter à `dates`
6. Ajouter `"manual_edit": true` et `"manual_edit_at": "<ISO timestamp>"` à la racine du JSON pour traçabilité
7. Sauvegarder le `.ocr.json`
8. Retourner `extracted_data` complet

### A4. Enrichir `GET /api/justificatifs/`

Fichier : `backend/services/justificatif_service.py` (ou le service qui construit la liste)

Pour chaque justificatif retourné, charger le `.ocr.json` compagnon et ajouter 3 champs à la réponse :
- `ocr_amount`: `best_amount` ou `null`
- `ocr_date`: `best_date` ou `null`
- `ocr_supplier`: `supplier` ou `null`

Si le `.ocr.json` n'existe pas → les 3 champs à `null`.

Ceci permet au frontend d'afficher le badge "OCR incomplet" sans appel supplémentaire.

## B — Frontend

### B1. Type TypeScript

Fichier : `frontend/src/types/index.ts`

Ajouter :
```typescript
interface OcrManualEdit {
  best_amount?: number | null
  best_date?: string | null
  supplier?: string | null
}
```

Vérifier que l'interface `Justificatif` existante inclut `ocr_amount`, `ocr_date`, `ocr_supplier` (sinon les ajouter comme optionnels).

### B2. Hooks

Fichier : `frontend/src/hooks/useOcr.ts`

Ajouter :
```typescript
export function useOcrResult(filename: string | null) {
  return useQuery({
    queryKey: ['ocr', 'result', filename],
    queryFn: () => api.get(`/ocr/result/${filename}`),
    enabled: !!filename,
  })
}

export function useUpdateOcrData() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, data }: { filename: string; data: OcrManualEdit }) =>
      api.patch(`/ocr/${filename}/extracted-data`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ocr'] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement'] })
      toast.success('Données OCR mises à jour')
    },
  })
}
```

### B3. Composant `OcrDataEditor`

Fichier : `frontend/src/components/justificatifs/OcrDataEditor.tsx`

**Props** :
```typescript
interface OcrDataEditorProps {
  filename: string
  currentData: {
    best_amount: number | null
    best_date: string | null
    supplier: string | null
    amounts: number[]
    dates: string[]
  }
  onUpdated?: () => void
}
```

**Layout** — section verticale sous l'iframe PDF :

**En-tête** : label "Données extraites" avec icône `FileSearch` (Lucide). Badge "Manuel" (ambre) si `manual_edit: true` dans les données, badge "OCR" (bleu) sinon.

**Ligne 1 — Montant TTC** :
- Label "Montant TTC" à gauche
- **Chips cliquables** : un chip par valeur dans `amounts[]`, formaté en EUR (`1 439,87 €`)
- Le chip correspondant à `best_amount` actuel est en surbrillance (`bg-primary text-white border-primary`)
- Clic sur un chip → sélectionne cette valeur (état local), désélectionne l'input manuel
- **Input manuel** à droite des chips : `input type="number" step="0.01"` placeholder "Autre montant"
- Si l'utilisateur tape dans l'input → les chips se désélectionnent
- Si `amounts[]` est vide → afficher seulement l'input avec texte "Aucun montant détecté"
- Chips style : `px-3 py-1 rounded-full text-sm cursor-pointer border border-border hover:border-primary transition-colors`

**Ligne 2 — Date** :
- Label "Date facture" à gauche
- **Chips cliquables** : un chip par date dans `dates[]`, format `DD/MM/YYYY`
- Le chip correspondant à `best_date` est en surbrillance
- Clic → sélectionne
- **Input date** à droite : `input type="date"` pour saisie manuelle
- Exclure des chips les dates avant 2020 ou après aujourd'hui + 1 an (mais accessibles via input)

**Ligne 3 — Fournisseur** :
- Label "Fournisseur" à gauche
- `input type="text"` pré-rempli avec `supplier` actuel ou vide
- Placeholder "Nom du fournisseur"

**Bouton "Enregistrer"** :
- Icône `Save` (Lucide) + texte "Enregistrer"
- Désactivé tant qu'aucune modification (comparer état local vs valeurs initiales des props)
- Appelle `useUpdateOcrData` avec les valeurs modifiées uniquement
- Le callback `onUpdated` est appelé après succès

**Style global** :
- `bg-surface border border-border rounded-lg p-4 mt-4`
- Chaque ligne : `flex items-center gap-3 mb-3`
- Labels : `text-text-muted text-sm w-28 shrink-0`
- Inputs : `bg-background border border-border rounded px-3 py-1.5 text-sm text-text`
- Dark theme via CSS variables

### B4. Badge "OCR incomplet" dans la galerie Justificatifs

Fichier : `frontend/src/components/justificatifs/JustificatifsPage.tsx`

Sur chaque vignette/ligne de justificatif dans la galerie :
- Si `ocr_amount === null` OU `ocr_date === null` → afficher un badge
- Badge : icône `AlertTriangle` (Lucide, taille 14) + texte "OCR incomplet"
- Style : `bg-amber-500/20 text-amber-400 text-xs px-2 py-0.5 rounded-full`
- Position : coin supérieur droit de la vignette (mode grille) ou inline à droite du nom (mode liste)

### B5. Intégration dans le drawer justificatif

Fichier : `frontend/src/components/justificatifs/JustificatifsPage.tsx` (ou le composant drawer existant)

Dans le drawer preview du justificatif :
1. Quand le drawer s'ouvre, appeler `useOcrResult(selectedFilename)`
2. Sous l'iframe PDF, afficher `<OcrDataEditor>` avec les données retournées
3. `onUpdated` → le drawer reste ouvert, les données se rafraîchissent (le chip sélectionné reflète la nouvelle valeur)

## Flux utilisateur attendu

1. Page `/justificatifs` → badge orange "OCR incomplet" visible sur certains justificatifs
2. Clic sur un justificatif → drawer s'ouvre, PDF en iframe en haut
3. Sous le PDF : section "Données extraites"
   - Chips montants : `[1 163,08 €] [232,62 €] [1 395,70 €] [44,17 €] [1 207,25 €] [1 439,87 €]`
   - Aucun n'est en surbrillance (car `best_amount` était null)
4. L'utilisateur regarde le PDF, clique sur `1 439,87 €` → chip surligné
5. Chips dates : `[18/01/2025] [18/02/2025] [28/12/2023]` → clic `18/01/2025`
6. Fournisseur : tape "Ford Credit"
7. Clic "Enregistrer" → toast succès → badge "OCR incomplet" disparaît de la galerie
8. Les scores de rapprochement sont recalculés avec les bonnes valeurs

## Checklist

- [ ] `CLAUDE.md` lu en premier
- [ ] `from __future__ import annotations` dans tous les fichiers Python modifiés
- [ ] Endpoint `PATCH` idempotent (re-sauver les mêmes valeurs ne casse rien)
- [ ] Cherche `.ocr.json` dans `en_attente/` ET `traites/`
- [ ] `GET /api/ocr/result/{filename}` retourne `amounts` et `dates` complets
- [ ] `GET /api/justificatifs/` retourne `ocr_amount`, `ocr_date`, `ocr_supplier` par justificatif
- [ ] Chips montants formatés en EUR (`1 439,87 €`) via `formatCurrency` de `lib/utils.ts`
- [ ] Chips dates formatés en `DD/MM/YYYY`
- [ ] Sélection chip OU input manuel mutuellement exclusifs pour le montant
- [ ] Badge "OCR incomplet" visible dans la galerie
- [ ] Invalidation TanStack Query sur `ocr`, `justificatifs`, `rapprochement`
- [ ] Dark theme respecté (CSS variables uniquement, pas de couleurs hardcodées)
- [ ] Python 3.9 compatible (`Optional[X]`, pas `X | None`)
- [ ] Strict TypeScript, zéro `any`
- [ ] Icônes Lucide React uniquement
- [ ] Toast via `react-hot-toast`
- [ ] Pas de régression sur le flux OCR automatique existant
- [ ] `PageHeader` utilise `actions` prop si modifié
