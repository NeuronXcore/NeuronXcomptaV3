# Fix — Agent IA : bouton "Lancer l'entraînement" retourne 400 + modèle sklearn dégradé

## Contexte

NeuronXcompta V3 — FastAPI (port 8000) + React 19/TypeScript (port 5173).
Stack ML : scikit-learn + règles JSON dans `data/ml/model.json`, modèle sérialisé dans `data/ml/sklearn_model.pkl`.

**Deux bugs constatés :**

1. `POST /api/ml/train` retourne **400 Bad Request** depuis le frontend (curl direct → 200 OK ✅)
2. Le modèle entraîné a une **accuracy test à 29%** — quasiment toutes les prédictions tombent sur la classe `"perso"` (déséquilibre de classes)

---

## Diagnostic à effectuer avant tout patch

### Étape 1 — Router backend

Lire `backend/routers/ml.py` et identifier la signature de l'endpoint `POST /train` :
- A-t-il un body Pydantic obligatoire ?
- A-t-il un `Content-Type` attendu ?
- Y a-t-il une validation qui échoue quand le body est vide ?

### Étape 2 — Client API frontend

Lire `frontend/src/api/client.ts` et identifier :
- Comment `api.post('/ml/train')` est appelé sans body (payload `undefined` ou `{}` ?)
- Est-ce que le client force `Content-Type: application/json` même sans body ?
- FastAPI rejette-t-il un body JSON vide `{}` si l'endpoint ne l'attend pas, ou l'inverse ?

### Étape 3 — Distribution des classes

Lire `data/ml/model.json` et calculer :
- Distribution des catégories dans `training_data`
- Nombre d'exemples pour `"perso"` vs les autres classes
- Identifier si `"perso"` représente >30% des exemples

---

## Patches à appliquer

### Fix 1 — Résoudre le 400 (selon diagnostic)

**Cas A** — Le router attend un body Pydantic alors que le frontend n'en envoie pas :

```python
# backend/routers/ml.py
@router.post("/train")
async def train_model():
    # Pas de paramètre body
    result = ml_service.train()
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Échec entraînement"))
    return result
```

**Cas B** — Le client envoie `Content-Type: application/json` avec body `undefined` :

```typescript
// frontend/src/api/client.ts
// Dans la méthode post(), si payload est undefined/null,
// ne pas mettre de body et ne pas forcer Content-Type
```

Appliquer le fix adapté au diagnostic réel.

### Fix 2 — `class_weight='balanced'` dans ml_service.py

Dans `backend/services/ml_service.py`, trouver l'instanciation du classifier sklearn (probablement `LogisticRegression` ou `LinearSVC`) et ajouter `class_weight='balanced'` :

```python
# Avant
clf = LogisticRegression(max_iter=1000)

# Après
clf = LogisticRegression(max_iter=1000, class_weight='balanced')
```

Si c'est un `Pipeline` sklearn, appliquer sur le step classifier :
```python
Pipeline([
    ('tfidf', TfidfVectorizer(...)),
    ('clf', LogisticRegression(max_iter=1000, class_weight='balanced')),
])
```

### Fix 3 — Purger "perso" des training_data (si >30% des exemples)

Si la distribution montre que `"perso"` représente plus de 30% des exemples, les retirer du training set car :
- Les ops perso sont déjà gérées via règle exacte / catégorie explicite
- Elles polluent le modèle sklearn et biaisent toutes les prédictions

```python
# backend/services/ml_service.py — dans la méthode train()
# Filtrer "perso" du training set sklearn uniquement
# (ne pas modifier model.json, juste exclure de X/y pour fit)
training_filtered = [
    ex for ex in training_data
    if ex.get("categorie") not in ("perso", "Perso")
]
```

Ne pas supprimer de `model.json` — juste exclure du fit sklearn.

### Fix 4 — Feedback UI si success=false (ActionsRapides.tsx)

Dans `frontend/src/components/agent-ia/ActionsRapides.tsx`, après le bloc `{trainResult && trainResult.success && (...)}`, ajouter :

```tsx
{trainResult && !trainResult.success && (
  <p className="text-xs text-red-400 flex items-center gap-1">
    <XCircle size={12} /> Entraînement échoué — vérifier les logs backend
  </p>
)}
```

---

## Ordre d'implémentation

1. Lire `backend/routers/ml.py` + `frontend/src/api/client.ts` → diagnostiquer la cause exacte du 400
2. Appliquer Fix 1 (résoudre le 400)
3. Appliquer Fix 2 (class_weight='balanced')
4. Appliquer Fix 3 si perso > 30% des exemples
5. Appliquer Fix 4 (feedback UI)
6. Tester : `curl -s -X POST http://localhost:8000/api/ml/train | python3 -m json.tool` → vérifier `success: true` + accuracy_test > 50%

## Contraintes

- `from __future__ import annotations` en tête de tout fichier Python modifié
- Ne pas modifier `data/ml/model.json` directement (passer par le service)
- Pas de breaking change sur les autres endpoints ML
- Invalider les queryKeys `['ml-model']` et `['ml-model-full']` après fix frontend si nécessaire
