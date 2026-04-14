# Refactor complet OCR — Fix extraction + Convention filename + Édition manuelle

## Contexte

L'extraction OCR présente 3 problèmes majeurs :
1. **Parsing cassé** : `amounts: []`, `best_amount: null`, `supplier: null` alors que le `raw_text` contient les données en clair
2. **Aucun fallback filename** : les justificatifs nommés selon une convention (`fournisseur_YYYYMMDD_montant.pdf`) ne sont pas exploités
3. **Aucune correction manuelle** : impossible d'éditer le `.ocr.json` depuis le frontend quand l'OCR échoue

Exemple réel de raw_text (facture leasing) :
```
gord
Credit
FCE Bank plc -
France
...
Financier  1163.08  20.00%  232.62  1395.70
Perte fi flcb  44.17  0.00%  0.00  44.17
Total  1207.25  232.62  1439.87
Total facture  7
439.87 €
...
Date  18 janvier 2025
...
Prochaine échéance : 18/01/2025
Date de Ière mise en circulation  28/12/2023
```
Résultat actuel : `amounts: [], best_amount: null, supplier: null, best_date: "2025-01-18"`

## Instructions

1. Lire `CLAUDE.md`
2. Ouvrir `backend/services/ocr_service.py`
3. Identifier les fonctions d'extraction (amounts, dates, supplier) dans le flux `extract_or_cached()`

---

## PARTIE 1 — Fix extraction OCR de base

### 1A — Regex montants robuste

Trouver la regex/logique qui peuple `extracted_data["amounts"]`. La remplacer par :

**Pattern** : `r'\b(\d{1,3}(?:[\s\u00a0]\d{3})*[.,]\d{2})\b'`

**Post-filtrage** (sur chaque match + son contexte dans la ligne) :
- Exclure si suivi immédiat de `%` → c'est un taux TVA
- Exclure si le match fait partie d'un pattern date (`\d{2}[/\-]\d{2}[/\-]\d{2,4}`)
- Convertir en float (remplacer espace par rien, virgule par point)
- Garder si `0 < value < 1_000_000`
- Dédupliquer

### 1B — Sélection `best_amount` (= montant TTC)

L'objectif est d'extraire le **montant TTC** de la facture. Travailler ligne par ligne sur `raw_text`, case-insensitive :

1. Ligne contenant `"ttc"` → prendre le **dernier** montant de cette ligne
2. Ligne contenant `"total"` + `"facture"` → dernier montant de la ligne
3. Ligne contenant `"total"` seul (pas "sous-total", pas "total ht") → dernier montant de la ligne
4. Montant le plus proche du symbole `€` dans le texte
5. Fallback : `max(amounts)`

**Exclusion** : ignorer les lignes contenant `"ht"` seul (sans "ttc") ou `"hors taxe"` pour éviter de sélectionner le HT comme best_amount.

### 1C — Sélection `best_date`

Améliorer la logique de sélection de `best_date` quand `dates` contient plusieurs valeurs. Travailler ligne par ligne, case-insensitive :

**Prioriser** : ligne contenant `"date"` + (`"facture"` ou `"émission"` ou `":"` ou `"du"`)
**Accepter** : ligne contenant `"date"` seul
**Exclure** : lignes contenant `"échéance"`, `"règlement"`, `"mise en circulation"`, `"naissance"`, `"création"`, `"prochaine"`
**Fallback** : date la plus récente ≤ aujourd'hui

### 1D — Extraction `supplier` fallback

Si le parsing actuel retourne `None`, ajouter un fallback :

1. Scanner les 10 premières lignes non-vides de `raw_text`
2. Chercher une ligne contenant un mot-clé société : `"Bank"`, `"SAS"`, `"SARL"`, `"SA "`, `"SCI"`, `"EURL"`, `"SCP"`, `"SELARL"`, `"plc"`, `"GmbH"`, `"Ltd"`, `"Inc"`
3. Si trouvé → retourner la ligne nettoyée (strip + collapse whitespace)
4. Sinon → prendre la première ligne non-vide qui ne contient PAS de code postal (`r'\b\d{5}\b'`) ni de date ni de montant seul

---

## PARTIE 2 — Parsing convention de nommage des justificatifs

### Convention de nommage

```
fournisseur_YYYYMMDD_montant.pdf
```

**Règles** :
- **Fournisseur** : minuscules, sans espaces ni accents, tirets pour mots composés → `ford-credit`, `total-energies`, `urssaf`
- **Date** : `YYYYMMDD` (date de facture)
- **Montant** : TTC, point décimal, pas d'espace → `1439.87`
- **Séparateur** : `_` entre les 3 champs
- Chaque champ peut être vide si inconnu : `_20250118_1439.87.pdf`, `ford-credit_20250118_.pdf`

**Exemples** :
```
ford-credit_20250118_1439.87.pdf     ← complet
urssaf_20250415_3500.00.pdf          ← complet
_20250118_1439.87.pdf                ← fournisseur inconnu
ford-credit_20250118_.pdf            ← montant inconnu
ford-credit__1439.87.pdf             ← date inconnue
```

### 2A — Nouvelle fonction `_parse_filename_convention(filename: str)`

Fichier : `backend/services/ocr_service.py`

**Input** : nom de fichier (sans le chemin), ex: `ford-credit_20250118_1439.87.pdf`

**Logique** :
1. Retirer l'extension (`.pdf`)
2. Split par `_` — on attend exactement 3 parties : `[fournisseur, date, montant]`
3. Si le split ne donne pas 3 parties → retourner `None` (ne suit pas la convention)
4. Parser chaque partie :

**Fournisseur** (partie 0) :
- Si vide → `None`
- Sinon → capitaliser et remplacer les tirets par des espaces : `ford-credit` → `Ford Credit`

**Date** (partie 1) :
- Si vide → `None`
- Valider format `YYYYMMDD` (8 chiffres, date valide via `datetime.strptime`)
- Convertir en `YYYY-MM-DD`
- Si format invalide → `None`

**Montant** (partie 2) :
- Si vide → `None`
- Valider format numérique avec point décimal : `r'^\d+\.\d{2}$'`
- Convertir en `float`
- Si format invalide → `None`

**Retour** : `dict` avec clés `supplier`, `date`, `amount` (chacune `Optional`), ou `None` si pas la convention.

### 2B — Intégrer le parsing filename dans le flux d'extraction

Dans la fonction qui construit `extracted_data` (appelée par `extract_or_cached()`) :

**Ordre de priorité pour chaque champ** :
```
best_amount = filename.amount  OU  ocr_best_amount  OU  None
best_date   = filename.date    OU  ocr_best_date    OU  None
supplier    = filename.supplier OU  ocr_supplier     OU  None
```

1. Appeler `_parse_filename_convention(filename)` au début
2. Exécuter l'OCR normalement
3. À la fin, pour chaque champ : si la valeur du filename est non-None, elle **remplace** la valeur OCR
4. Si la valeur du filename est None, garder la valeur OCR

**Enrichir les listes** :
- Si `filename.amount` non-None et pas déjà dans `amounts` → l'ajouter en premier
- Si `filename.date` non-None et pas déjà dans `dates` → l'ajouter en premier

### 2C — Traçabilité `filename_parsed`

Ajouter un champ `"filename_parsed"` dans le `.ocr.json` sauvegardé :

```json
{
  "filename": "ford-credit_20250118_1439.87.pdf",
  "filename_parsed": {
    "supplier": "Ford Credit",
    "date": "2025-01-18",
    "amount": 1439.87
  },
  "extracted_data": { ... }
}
```

Si le filename ne suit pas la convention → `"filename_parsed": null`.

### 2D — Appliquer dans tous les points d'entrée

Le parsing doit utiliser le **nom original du fichier** (avant renommage) :

1. **Upload batch OCR** (`POST /api/ocr/batch-upload`) : utiliser `original_name` pour le parsing, pas le nom `justificatif_YYYYMMDD_HHMMSS_*.pdf` généré
2. **Sandbox watchdog** : parser le nom du fichier déposé **avant** le move/renommage vers `en_attente/`
3. **Upload justificatifs classique** (`POST /api/justificatifs/upload`) : idem

Stocker le nom original dans le `.ocr.json` si pas déjà fait (champ `original_filename`).

### 2E — Gestion des cas limites

- `ford-credit_20250118_1439.87.pdf` → 3 champs OK
- `facture_random.pdf` → 2 segments → `filename_parsed: null`, OCR seul
- `justificatif_20250118_143022_ford.pdf` → 4 segments → ne matche pas → `null`
- `_20250118_1439.87.pdf` → 3 segments, fournisseur vide → `supplier: null`
- `ford-credit_baddate_1439.87.pdf` → date invalide → `date: null`
- `ford-credit_20250118_notanumber.pdf` → montant invalide → `amount: null`
- Les fichiers existants (`justificatif_YYYYMMDD_HHMMSS_*.pdf`) → 4+ segments → **aucune régression**

---

## PARTIE 3 — Édition manuelle des données OCR depuis le frontend

### 3A — Nouvel endpoint `PATCH /api/ocr/{filename}/extracted-data`

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

### 3B — Logique service `update_extracted_data()`

Fichier : `backend/services/ocr_service.py`

Nouvelle fonction `update_extracted_data(filename: str, edits: OcrManualEdit)` :

1. Chercher le `.ocr.json` correspondant dans `en_attente/` ET `traites/`
2. Charger le JSON
3. Mettre à jour `extracted_data.best_amount`, `extracted_data.best_date`, `extracted_data.supplier` avec les valeurs non-None
4. Si `best_amount` modifié et pas déjà dans `amounts` → l'ajouter
5. Si `best_date` modifié et pas déjà dans `dates` → l'ajouter
6. Ajouter `"manual_edit": true` et `"manual_edit_at": "<ISO timestamp>"` à la racine pour traçabilité
7. Sauvegarder le `.ocr.json`
8. Retourner `extracted_data` complet

### 3C — Vérifier `GET /api/ocr/result/{filename}`

S'assurer qu'il retourne `extracted_data.amounts` (liste complète) et `extracted_data.dates` (liste complète) en plus de `best_amount`, `best_date`, `supplier`. Si pas exposés, les ajouter.

### 3D — Enrichir `GET /api/justificatifs/`

Fichier : `backend/services/justificatif_service.py`

Pour chaque justificatif retourné, charger le `.ocr.json` compagnon et ajouter :
- `ocr_amount`: `best_amount` ou `null`
- `ocr_date`: `best_date` ou `null`
- `ocr_supplier`: `supplier` ou `null`

Si `.ocr.json` inexistant → les 3 à `null`. Permet le badge "OCR incomplet" sans appel supplémentaire.

### 3E — Type TypeScript

Fichier : `frontend/src/types/index.ts`

```typescript
interface OcrManualEdit {
  best_amount?: number | null
  best_date?: string | null
  supplier?: string | null
}
```

Ajouter `ocr_amount?: number | null`, `ocr_date?: string | null`, `ocr_supplier?: string | null` à l'interface `Justificatif` existante.

### 3F — Hooks

Fichier : `frontend/src/hooks/useOcr.ts`

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

### 3G — Composant `OcrDataEditor`

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

**Layout** — section verticale sous l'iframe PDF du drawer :

**En-tête** : label "Données extraites" avec icône `FileSearch` (Lucide). Badge "Manuel" (ambre) si `manual_edit: true`, badge "OCR" (bleu) sinon.

**Ligne 1 — Montant TTC** :
- Label "Montant TTC" à gauche
- **Chips cliquables** : un chip par valeur dans `amounts[]`, formaté en EUR (`1 439,87 €`) via `formatCurrency` de `lib/utils.ts`
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

### 3H — Badge "OCR incomplet" dans la galerie Justificatifs

Fichier : `frontend/src/components/justificatifs/JustificatifsPage.tsx`

Sur chaque vignette/ligne de justificatif :
- Si `ocr_amount === null` OU `ocr_date === null` → badge visible
- Badge : icône `AlertTriangle` (Lucide, taille 14) + texte "OCR incomplet"
- Style : `bg-amber-500/20 text-amber-400 text-xs px-2 py-0.5 rounded-full`
- Position : coin supérieur droit (grille) ou inline à droite du nom (liste)

### 3I — Intégration dans le drawer justificatif

Dans le drawer preview de la page Justificatifs :
1. Quand le drawer s'ouvre, appeler `useOcrResult(selectedFilename)`
2. Sous l'iframe PDF, afficher `<OcrDataEditor>` avec les données retournées
3. `onUpdated` → drawer reste ouvert, données se rafraîchissent

---

## Flux utilisateur complet

### Scénario 1 : fichier nommé selon la convention
1. L'utilisateur dépose `ford-credit_20250118_1439.87.pdf` dans le sandbox
2. Le watchdog parse le filename → `supplier: "Ford Credit"`, `date: "2025-01-18"`, `amount: 1439.87`
3. L'OCR tourne quand même (enrichissement) mais les valeurs du filename priment
4. `.ocr.json` sauvegardé avec `filename_parsed` + `extracted_data` corrects
5. Le rapprochement fonctionne immédiatement avec un bon score

### Scénario 2 : fichier sans convention, OCR OK
1. L'utilisateur uploade `facture_novembre.pdf` via batch OCR
2. Filename ne matche pas la convention (2 segments) → `filename_parsed: null`
3. L'OCR extrait correctement amounts, date, supplier grâce au fix regex
4. Tout fonctionne comme avant mais mieux

### Scénario 3 : fichier sans convention, OCR échoué
1. L'utilisateur uploade un PDF mal scanné → OCR partiel
2. Page `/justificatifs` → badge orange "OCR incomplet"
3. Clic → drawer avec PDF + section "Données extraites"
4. Chips montants affichés (ceux que l'OCR a trouvé, même partiellement)
5. L'utilisateur clique le bon chip ou tape le montant manuellement
6. Enregistrer → `.ocr.json` mis à jour → scores recalculés

---

## Résultats attendus

### Avec le raw_text de l'exemple (partie 1)
```json
{
  "amounts": [1163.08, 232.62, 1395.70, 44.17, 1207.25, 1439.87],
  "best_amount": 1439.87,
  "best_date": "2025-01-18",
  "supplier": "FCE Bank plc - France"
}
```
Les taux `20.00%` et `0.00%` ne sont PAS dans amounts.

### Avec filename convention (partie 2)
```json
{
  "filename": "ford-credit_20250118_1439.87.pdf",
  "filename_parsed": {
    "supplier": "Ford Credit",
    "date": "2025-01-18",
    "amount": 1439.87
  },
  "extracted_data": {
    "best_amount": 1439.87,
    "best_date": "2025-01-18",
    "supplier": "Ford Credit"
  }
}
```

---

## Checklist

### Général
- [ ] `CLAUDE.md` lu en premier
- [ ] `from __future__ import annotations` dans tous les fichiers Python modifiés
- [ ] Python 3.9 compatible (`Optional[X]`, pas `X | None`)
- [ ] Strict TypeScript, zéro `any`
- [ ] Icônes Lucide React uniquement
- [ ] Toast via `react-hot-toast`
- [ ] Dark theme (CSS variables uniquement, pas de couleurs hardcodées)
- [ ] `PageHeader` utilise `actions` prop si modifié

### Partie 1 — Fix OCR
- [ ] Regex amounts est un superset de l'ancienne (pas de régression)
- [ ] Les cas simples (1 seul montant, 1 seule date) continuent de fonctionner
- [ ] `best_amount` = montant TTC (pas le HT, pas la TVA)
- [ ] `best_date` = date de facture (pas l'échéance, pas la mise en circulation)
- [ ] `supplier` = nom société émettrice
- [ ] Corrections 100% génériques, aucune logique spécifique à un fournisseur

### Partie 2 — Convention filename
- [ ] `_parse_filename_convention()` est une pure function
- [ ] Les fichiers existants (`justificatif_YYYYMMDD_HHMMSS_*.pdf`) ne matchent PAS → aucune régression
- [ ] Le nom original (avant renommage) est utilisé pour le parsing
- [ ] Priorité : filename > OCR pour chaque champ individuellement
- [ ] `filename_parsed` sauvegardé dans le `.ocr.json`
- [ ] Cas limites gérés (champs vides, formats invalides, noms non conventionnels)

### Partie 3 — Édition manuelle
- [ ] Endpoint `PATCH` idempotent
- [ ] Cherche `.ocr.json` dans `en_attente/` ET `traites/`
- [ ] `GET /api/ocr/result/{filename}` retourne `amounts` et `dates` complets
- [ ] `GET /api/justificatifs/` retourne `ocr_amount`, `ocr_date`, `ocr_supplier`
- [ ] Chips montants formatés en EUR via `formatCurrency`
- [ ] Chips dates formatés en `DD/MM/YYYY`
- [ ] Sélection chip OU input manuel mutuellement exclusifs pour le montant
- [ ] Badge "OCR incomplet" visible dans la galerie
- [ ] Invalidation TanStack Query sur `ocr`, `justificatifs`, `rapprochement`
- [ ] Pas de régression sur le flux OCR automatique existant
