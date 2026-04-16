# Fix — JustificatifDrawer legacy + rapprochement_service

## Contexte

NeuronXcompta V3. Deux bugs identifiés après audit du code.

---

## Bug 1 — `get_batch_justificatif_scores()` : `override_sous_categorie` manquant

**Fichier :** `backend/services/rapprochement_service.py`

Dans `get_batch_justificatif_scores()`, la boucle de scoring des ops ventilées
ne propage pas `override_sous_categorie` à `compute_score()`, contrairement à
`get_batch_hints()` qui le fait correctement.

**Localiser le code :**
```python
# Chercher dans get_batch_justificatif_scores() :
result = compute_score(
    ocr_data, op,
    override_montant=override_m,
    override_categorie=override_c,
    # ← override_sous_categorie absent
)
```

**Fix :**

1. Modifier le tuple `all_targets` pour inclure `override_sous_categorie` :

```python
# Avant — tuple à 5 éléments
all_targets: list[tuple[str, int, dict, Optional[float], Optional[str]]] = []
# ...
all_targets.append((
    f["filename"], idx, op,
    vl.get("montant", 0),
    vl.get("categorie", ""),
))

# Après — tuple à 6 éléments
all_targets: list[tuple[str, int, dict, Optional[float], Optional[str], Optional[str]]] = []
# ...
all_targets.append((
    f["filename"], idx, op,
    vl.get("montant", 0),
    vl.get("categorie", ""),
    vl.get("sous_categorie", ""),
))
# Pour les ops non ventilées :
all_targets.append((f["filename"], idx, op, None, None, None))
```

2. Propager dans `compute_score()` :

```python
# Avant
for _, _, op, override_m, override_c in all_targets:
    result = compute_score(
        ocr_data, op,
        override_montant=override_m,
        override_categorie=override_c,
    )

# Après
for _, _, op, override_m, override_c, override_sc in all_targets:
    result = compute_score(
        ocr_data, op,
        override_montant=override_m,
        override_categorie=override_c,
        override_sous_categorie=override_sc,
    )
```

---

## Bug 2 — `JustificatifDrawer.tsx` : drawer legacy avec 3 bugs

**Fichier :** `frontend/src/components/justificatifs/JustificatifDrawer.tsx`

### Étape 0 — Vérifier si le drawer est encore utilisé

```bash
grep -r "JustificatifDrawer" frontend/src --include="*.tsx" -l
```

**Si aucun fichier ne l'importe → supprimer `JustificatifDrawer.tsx` directement.**
C'est le cas idéal — le drawer principal est `RapprochementWorkflowDrawer`.

**Si des fichiers l'importent encore → appliquer les 3 fixes ci-dessous.**

---

### Fix 2a — `handleDissociate` cassé (bug critique)

```tsx
// AVANT — envoie toujours operation_file="" et operation_index=0
const handleDissociate = () => {
  if (!justificatif) return
  dissociateMutation.mutate(
    {
      operation_file: '',   // ← FAUX
      operation_index: 0,   // ← FAUX
    },
    ...
  )
}
```

Le drawer reçoit `justificatif.linked_operation` (string libellé) mais pas les
coordonnées exactes (file + index). Pour dissocier correctement, utiliser
l'endpoint dédié qui prend le filename du justificatif :

```tsx
// APRÈS — dissociation par filename justificatif
const handleDissociate = () => {
  if (!justificatif) return
  // useDisassociateByFilename utilise POST /api/justificatifs/dissociate
  // avec { justificatif_filename } au lieu de { operation_file, operation_index }
  dissociateByFilenameMutation.mutate(
    { justificatif_filename: justificatif.filename },
    {
      onSuccess: () => {
        setSuccessMsg('Justificatif dissocié')
        setTimeout(() => setSuccessMsg(''), 3000)
      },
    }
  )
}
```

Vérifier la signature exacte de `useDisassociate` / `useDissociate` dans
`frontend/src/hooks/useJustificatifs.ts` — adapter selon ce qui existe.
Si l'endpoint `/api/justificatifs/dissociate` accepte `justificatif_filename`
seul (sans operation_file/index), utiliser cette forme.
Sinon, ajouter `linked_operation_file` et `linked_operation_index` sur
`JustificatifInfo` côté backend pour les exposer au frontend.

### Fix 2b — `score_detail` affiché comme `[object Object]`

```tsx
// AVANT ligne ~349
<span className="ml-auto">{s.score_detail}</span>

// APRÈS — utiliser ScorePills si score_detail est un objet, sinon % simple
{s.score_detail && typeof s.score_detail === 'object' ? (
  <ScorePills
    detail={s.score_detail}
    total={s.score ?? 0}
    className="mt-1"
  />
) : (
  <span className="text-[10px] text-text-muted">
    {Math.round((s.score ?? 0) * 100)}%
  </span>
)}
```

Ajouter l'import : `import ScorePills from '@/components/justificatifs/ScorePills'`

### Fix 2c — Gestion HTTP 423 sur `handleAssociate`

```tsx
// AVANT — pas de gestion 423
const handleAssociate = (suggestion: OperationSuggestion) => {
  if (!justificatif) return
  associateMutation.mutate(
    { ... },
    { onSuccess: () => { setSuccessMsg('Justificatif associé avec succès') ... } }
  )
}

// APRÈS — intercepter l'erreur 423
const handleAssociate = (suggestion: OperationSuggestion) => {
  if (!justificatif) return
  associateMutation.mutate(
    { ... },
    {
      onSuccess: () => {
        setSuccessMsg('Justificatif associé avec succès')
        setTimeout(() => setSuccessMsg(''), 3000)
      },
      onError: (error: Error) => {
        const msg = error.message?.includes('423') || error.message?.includes('verrouill')
          ? 'Opération verrouillée — déverrouillez avant de modifier l\'association'
          : `Erreur : ${error.message}`
        setSuccessMsg('')
        // Afficher l'erreur dans le drawer (réutiliser le même state avec couleur rouge)
        toast.error(msg)
      },
    }
  )
}
```

Ajouter `import toast from 'react-hot-toast'` si absent.

---

## Ordre d'implémentation

1. Vérifier si `JustificatifDrawer` est importé quelque part
2. Si non utilisé → supprimer le fichier
3. Si utilisé → appliquer fixes 2a, 2b, 2c dans cet ordre
4. Appliquer fix rapprochement_service (Bug 1) — indépendant

## Contraintes

- `from __future__ import annotations` en tête de `rapprochement_service.py`
- Ne pas modifier `RapprochementWorkflowDrawer.tsx` — il est correct
- Ne pas modifier l'interface publique de `compute_score()` ni `get_batch_hints()`
- Backward compatible : `all_targets` est une variable locale, pas d'impact externe
