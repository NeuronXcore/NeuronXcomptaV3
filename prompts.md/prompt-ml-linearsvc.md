# ML — Migrer LogisticRegression → LinearSVC

## Contexte

NeuronXcompta V3 — `backend/services/ml_service.py`.

Le modèle sklearn actuel utilise `LogisticRegression`. L'objectif est de le remplacer par `LinearSVC` (SVM linéaire), plus performant sur les corpus courts TF-IDF à faible signal (libellés bancaires 3-5 mots, ~20 classes, ~300-500 exemples).

## Analyse préalable

Lire `backend/services/ml_service.py` et identifier :
1. L'import et l'instanciation du classifier actuel
2. Tous les appels à `.predict_proba()` — s'il en existe, `LinearSVC` ne le supporte pas nativement → wrapper `CalibratedClassifierCV` requis
3. Comment le score de confiance est calculé (via `predict_proba` ou autre méthode)
4. La structure du `Pipeline` sklearn si présent

## Patch

### Cas A — `predict_proba()` utilisé (cas le plus probable)

```python
# Remplacer
from sklearn.linear_model import LogisticRegression
clf = LogisticRegression(max_iter=1000, class_weight='balanced')

# Par
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV

clf = CalibratedClassifierCV(
    LinearSVC(max_iter=2000, class_weight='balanced', dual=True)
)
```

`CalibratedClassifierCV` expose `.predict_proba()` — aucun autre changement requis.

### Cas B — Pas de `predict_proba()`

```python
from sklearn.svm import LinearSVC
clf = LinearSVC(max_iter=2000, class_weight='balanced', dual=True)
```

### Si le classifier est dans un Pipeline sklearn

```python
Pipeline([
    ('tfidf', TfidfVectorizer(...)),
    ('clf', CalibratedClassifierCV(LinearSVC(max_iter=2000, class_weight='balanced', dual=True))),
])
```

## Après le patch

Supprimer l'ancien pkl pour forcer le re-fit :
```bash
rm -f data/ml/sklearn_model.pkl data/ml/vectorizer.pkl
```

Puis vérifier :
- `POST /api/ml/train` → `success: true` + `acc_test` > valeur précédente
- `POST /api/ml/predict` avec libellé test → score de confiance toujours retourné

## Contraintes

- `from __future__ import annotations` en tête du fichier
- Ne pas modifier l'interface publique de `ml_service.py`
- Créer un backup avant modification via `POST /api/ml/backup`
- Le `.pkl` re-généré doit rester compatible avec predict, confidence, hallucination_risk
