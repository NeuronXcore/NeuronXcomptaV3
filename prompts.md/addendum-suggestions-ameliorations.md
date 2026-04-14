# Addendum — Améliorations Suggestions Rapprochement

À appliquer APRÈS le prompt principal `prompt-rapprochement-workflow-drawer.md`.

---

## 1. Scoring backend — `backend/services/rapprochement_service.py`

### A. Score montant : test HT/TTC

Dans la fonction de scoring montant, après le calcul ratio classique, ajouter un test TVA :

```python
TVA_RATES = [1.20, 1.10, 1.055]  # 20%, 10%, 5.5%

def score_montant(montant_op: float, montant_ocr: float) -> float:
    if montant_op == 0 or montant_ocr is None:
        return 0.0
    # Match direct
    ratio = 1.0 - abs(montant_op - montant_ocr) / max(abs(montant_op), abs(montant_ocr))
    # Test HT/TTC : si montant_ocr / taux_tva ≈ montant_op (±0.02€)
    for tva in TVA_RATES:
        ht = montant_ocr / tva
        if abs(ht - abs(montant_op)) <= 0.02:
            ratio = max(ratio, 0.95)  # pas 1.0, léger malus vs match exact
            break
    return max(0.0, min(1.0, ratio))
```

### B. Score date : tolérance asymétrique

Le justificatif (facture) précède normalement le prélèvement bancaire. Tolérance : justif 0-15 jours AVANT l'op = score 1.0, au-delà décroissance linéaire sur 30 jours.

```python
def score_date(date_op: date, date_ocr: date | None) -> float:
    if date_ocr is None:
        return 0.0
    delta = (date_op - date_ocr).days  # positif si justif avant op
    if 0 <= delta <= 15:
        return 1.0  # fenêtre normale facture → prélèvement
    elif delta < 0 and delta >= -5:
        return 0.8  # justif légèrement après op (rare mais possible)
    else:
        distance = abs(delta) - (15 if delta > 0 else 5)
        return max(0.0, 1.0 - distance / 30.0)
```

### C. Bonus catégorie

Si l'opération a une catégorie et que le fournisseur OCR a déjà été associé à cette catégorie dans le passé, bonus +0.10 sur le score final.

```python
def _bonus_categorie(categorie_op: str, fournisseur_ocr: str) -> float:
    """Lookup dans rapprochement_log : ce fournisseur a-t-il déjà été associé à cette catégorie ?"""
    if not categorie_op or not fournisseur_ocr:
        return 0.0
    # Charger le log (ou cache en mémoire au boot)
    # Si >= 2 associations passées fournisseur_ocr → categorie_op : return 0.10
    return 0.0  # fallback
```

Ajouter au score final : `score_total = min(1.0, score_weighted + _bonus_categorie(...))`

### D. Détail du score dans la réponse API

Enrichir la réponse de `GET /{file}/{index}/suggestions` pour inclure le détail par composante :

```python
# Ajouter au dict de réponse de chaque suggestion :
{
    "score": 0.85,
    "score_detail": {
        "montant": 0.99,    # 0-1
        "date": 0.73,       # 0-1
        "fournisseur": 0.85 # 0-1
    },
    # ... champs existants
}
```

Modifier le modèle Pydantic si nécessaire (champ optionnel `score_detail: dict | None`).

---

## 2. UX affichage — `RapprochementWorkflowDrawer.tsx`

### A. Mise en avant du meilleur match

Si la première suggestion a un score ≥ 0.80, lui donner un style distinct :

```tsx
<div className={cn(
  "si-item",
  isActive && "active",
  index === 0 && suggestion.score >= 0.80 && "best-match"
)}>
```

CSS : `.best-match` → `border-left: 3px solid var(--color-success)` + fond `bg-success/5`. Label discret "Meilleur match" en `text-xs text-success` si score ≥ 0.95.

### B. Micro-détail score

Sous le nom du fichier dans chaque suggestion, afficher les composantes du score avec des indicateurs visuels :

```tsx
{suggestion.score_detail && (
  <div className="flex gap-2 text-[10px] mt-0.5">
    <span className={cn(
      suggestion.score_detail.montant >= 0.9 ? "text-success" :
      suggestion.score_detail.montant >= 0.6 ? "text-warning" : "text-danger"
    )}>
      {suggestion.score_detail.montant >= 0.9 ? "✓" : "~"} montant
    </span>
    <span className={...}>
      {deltaJours != null ? `${deltaJours}j` : "?"} date
    </span>
    <span className={...}>
      {suggestion.score_detail.fournisseur >= 0.5 ? "✓" : "✗"} fournisseur
    </span>
  </div>
)}
```

Fallback gracieux : si `score_detail` absent (ancien backend), ne rien afficher.

### C. Recherche exclusive

Quand `searchQuery.length >= 2` : masquer la section "Suggestions" et n'afficher que les résultats de recherche. Quand le champ est vidé : réafficher les suggestions. Pas de mélange des deux listes.

```tsx
{searchQuery.length >= 2 ? (
  <SearchResultsList results={searchResults} ... />
) : (
  <SuggestionsList suggestions={suggestions} ... />
)}
```

---

## 3. Performance — `useRapprochementWorkflow.ts`

### A. Prefetch N+1

Quand l'op courante est affichée, prefetch les suggestions de la prochaine op non matchée :

```typescript
const queryClient = useQueryClient();

useEffect(() => {
  // Trouver la prochaine op non matchée après currentIndex
  const nextUnmatched = unmatchedIndices.find(i => i > currentIndex)
    ?? unmatchedIndices[0];
  if (nextUnmatched != null && nextUnmatched !== currentIndex) {
    const nextOp = operations[nextUnmatched];
    const nextFile = nextOp._sourceFile || currentFile;
    const nextIdx = nextOp._originalIndex ?? nextUnmatched;
    queryClient.prefetchQuery({
      queryKey: ['rapprochement', 'suggestions', nextFile, nextIdx],
      queryFn: () => apiClient.get(`/rapprochement/${nextFile}/${nextIdx}/suggestions`),
      staleTime: 60_000,
    });
  }
}, [currentIndex, unmatchedIndices]);
```

### B. Recherche libre : keepPreviousData + staleTime

```typescript
const searchQuery = useQuery({
  queryKey: ['justificatifs', 'search', debouncedSearch],
  queryFn: () => apiClient.get(`/justificatifs/?status=en_attente&search=${debouncedSearch}`),
  enabled: debouncedSearch.length >= 2,
  placeholderData: keepPreviousData,  // TanStack Query 5
  staleTime: 30_000,
});
```

### C. Thumbnails dans la liste de suggestions

Si le justificatif a un thumbnail GED disponible (`/api/ged/thumbnail/{filename}`), l'afficher en mini-vignette 36×48px à gauche du nom dans la liste. Sinon, icône `FileText` (Lucide) en placeholder.

```tsx
<img
  src={`/api/ged/thumbnail/${suggestion.filename}`}
  className="w-9 h-12 rounded object-cover bg-secondary"
  onError={(e) => { e.currentTarget.style.display = 'none' }}
  loading="lazy"
/>
```

Vérifier que l'endpoint thumbnail existe — sinon utiliser `/api/justificatifs/${filename}/preview` n'est pas viable pour les vignettes (trop lourd). Si pas de thumbnail endpoint, skip cette amélioration.

---

## Ordre d'application

1. **Backend d'abord** : score_montant TVA, score_date asymétrique, score_detail dans la réponse
2. **Hook** : prefetch N+1, keepPreviousData recherche
3. **Composant** : best-match highlight, micro-détail score, recherche exclusive, thumbnails

Ces modifications sont **rétrocompatibles** — `score_detail` est optionnel, le frontend gère son absence gracieusement.
