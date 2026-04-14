# Prompt : Amélioration scoring rapprochement justificatifs

## Contexte

Le scoring actuel dans `rapprochement_service.py` utilise 3 critères avec pondération fixe :
- **Montant** (45%) : comparaison directe `ocr_montant` vs `op_montant`
- **Date** (35%) : proximité `ocr_date` vs `op_date`
- **Fournisseur** (20%) : `score_fournisseur()` avec Jaccard + substring matching

**Objectif** : enrichir le scoring avec un 4ème critère (catégorie), passer à un scoring graduel (non binaire), et redistribuer les poids dynamiquement.

---

## Étape 1 — Refactorer `score_montant()` en scoring graduel

Fichier : `backend/services/rapprochement_service.py`

### Avant (binaire)
Le score montant est probablement 1.0 si exact, 0.0 sinon (ou tolérance fixe).

### Après (dégradation progressive)
```python
def score_montant(ocr_montant: float, op_montant: float) -> float:
    """Score montant avec dégradation progressive.
    
    - Exact (écart 0%) → 1.0
    - Écart ≤ 1% → 0.95
    - Écart ≤ 2% → 0.85
    - Écart ≤ 5% → 0.60
    - Écart > 5% → 0.0
    """
    if ocr_montant is None or op_montant is None:
        return 0.0
    if ocr_montant == 0 and op_montant == 0:
        return 1.0
    if op_montant == 0:
        return 0.0
    
    ecart = abs(ocr_montant - abs(op_montant)) / abs(op_montant)
    
    if ecart == 0:
        return 1.0
    elif ecart <= 0.01:
        return 0.95
    elif ecart <= 0.02:
        return 0.85
    elif ecart <= 0.05:
        return 0.60
    else:
        return 0.0
```

**Note** : utiliser `abs(op_montant)` car les débits sont négatifs dans les opérations.

---

## Étape 2 — Refactorer `score_date()` en scoring non-linéaire

```python
def score_date(ocr_date: str, op_date: str) -> float:
    """Score date avec dégradation non-linéaire.
    
    - ±0 jour → 1.0
    - ±1 jour → 0.95
    - ±3 jours → 0.80
    - ±7 jours → 0.50
    - ±14 jours → 0.20
    - >14 jours → 0.0
    """
    if not ocr_date or not op_date:
        return 0.0
    
    try:
        from datetime import datetime
        d1 = datetime.strptime(ocr_date, "%Y-%m-%d") if isinstance(ocr_date, str) else ocr_date
        d2 = datetime.strptime(op_date, "%Y-%m-%d") if isinstance(op_date, str) else op_date
        delta = abs((d1 - d2).days)
    except (ValueError, TypeError):
        return 0.0
    
    if delta == 0:
        return 1.0
    elif delta <= 1:
        return 0.95
    elif delta <= 3:
        return 0.80
    elif delta <= 7:
        return 0.50
    elif delta <= 14:
        return 0.20
    else:
        return 0.0
```

---

## Étape 3 — Enrichir `score_fournisseur()` avec fuzzy matching

Conserver la logique existante (Jaccard + substring) et **ajouter un fallback Levenshtein** pour les cas partiels.

```python
def score_fournisseur(ocr_fournisseur: str, op_libelle: str) -> float:
    """Score fournisseur multi-stratégie.
    
    Stratégies (prend le max) :
    1. Substring match (existant) → 1.0
    2. Jaccard similarity (existant)
    3. Levenshtein ratio (nouveau fallback)
    """
    if not ocr_fournisseur or not op_libelle:
        return 0.0
    
    from difflib import SequenceMatcher
    
    ocr_norm = _normalize_for_matching(ocr_fournisseur)
    op_norm = _normalize_for_matching(op_libelle)
    
    # Stratégie 1 : substring (existant — conserver tel quel)
    score_sub = 1.0 if ocr_norm in op_norm or op_norm in ocr_norm else 0.0
    
    # Stratégie 2 : Jaccard (existant — conserver tel quel)
    tokens_ocr = set(ocr_norm.split())
    tokens_op = set(op_norm.split())
    if tokens_ocr and tokens_op:
        intersection = tokens_ocr & tokens_op
        union = tokens_ocr | tokens_op
        score_jaccard = len(intersection) / len(union) if union else 0.0
    else:
        score_jaccard = 0.0
    
    # Stratégie 3 : Levenshtein ratio (nouveau)
    score_lev = SequenceMatcher(None, ocr_norm, op_norm).ratio()
    # Seuil : en dessous de 0.5 on considère que c'est du bruit
    score_lev = score_lev if score_lev >= 0.5 else 0.0
    
    return max(score_sub, score_jaccard, score_lev)


def _normalize_for_matching(text: str) -> str:
    """Normalise un texte pour le matching fournisseur.
    
    Si cette fonction existe déjà (ex: normalize_supplier), la réutiliser.
    Sinon créer cette version minimale.
    """
    import re
    text = text.lower().strip()
    # Retirer caractères spéciaux sauf espaces
    text = re.sub(r'[^a-z0-9àâäéèêëïîôùûüÿçœæ\s]', '', text)
    # Compresser les espaces multiples
    text = re.sub(r'\s+', ' ', text)
    return text
```

**Important** : vérifier si `normalize_supplier()` existe déjà dans un service dédié (ex: `rename_service.py`, `ocr_service.py`). Si oui, l'importer et l'utiliser au lieu de `_normalize_for_matching()`.

---

## Étape 4 — Nouveau critère `score_categorie()`

```python
def score_categorie(ocr_fournisseur: str, op_categorie: str, op_sous_categorie: str = None) -> float | None:
    """Score catégorie basé sur l'inférence fournisseur → catégorie.
    
    Utilise le ML service pour inférer la catégorie probable du justificatif
    à partir du fournisseur OCR, puis compare avec la catégorie de l'opération.
    
    Retourne None si la catégorie ne peut pas être inférée (critère neutre).
    
    - Catégorie exacte → 1.0
    - Même catégorie, sous-catégorie différente → 0.6
    - Catégorie différente → 0.0
    """
    if not ocr_fournisseur or not op_categorie:
        return None  # Critère neutre — pas de pénalité
    
    # Inférer la catégorie à partir du fournisseur OCR via le ML service
    from backend.services.ml_service import MLService
    ml = MLService()
    prediction = ml.predict_category(ocr_fournisseur)
    
    if not prediction or not prediction.get("categorie"):
        return None  # Impossible d'inférer → critère neutre
    
    predicted_cat = prediction["categorie"]
    predicted_confidence = prediction.get("confiance", 0)
    
    # Ignorer les prédictions à faible confiance
    if predicted_confidence < 0.5:
        return None
    
    # Comparaison
    if predicted_cat.lower() == op_categorie.lower():
        # Si on a aussi une sous-catégorie prédite, vérifier
        predicted_subcat = prediction.get("sous_categorie")
        if predicted_subcat and op_sous_categorie:
            if predicted_subcat.lower() == op_sous_categorie.lower():
                return 1.0
            else:
                return 0.6  # Même catégorie, sous-catégorie différente
        return 1.0  # Catégorie match, pas de sous-catégorie à comparer
    else:
        return 0.0
```

---

## Étape 5 — Nouveau calcul du score total avec pondération dynamique

Remplacer le calcul de score total existant par cette logique :

```python
def compute_total_score(
    s_montant: float,
    s_date: float,
    s_fournisseur: float,
    s_categorie: float | None
) -> float:
    """Score total avec pondération dynamique.
    
    Poids de base : montant=0.35, fournisseur=0.25, date=0.20, catégorie=0.20
    Si catégorie est None (non inférable), redistribuer son poids sur les 3 autres.
    """
    if s_categorie is not None:
        # 4 critères actifs
        total = (
            0.35 * s_montant +
            0.25 * s_fournisseur +
            0.20 * s_date +
            0.20 * s_categorie
        )
    else:
        # 3 critères — redistribuer le poids catégorie proportionnellement
        # Ratios originaux : montant=0.35, fournisseur=0.25, date=0.20 → somme=0.80
        # Normalisé : montant=0.4375, fournisseur=0.3125, date=0.25
        total = (
            0.4375 * s_montant +
            0.3125 * s_fournisseur +
            0.25 * s_date
        )
    
    return round(total, 4)
```

---

## Étape 6 — Intégrer dans les fonctions de scoring existantes

### 6a — Fonction principale de scoring

Localiser la fonction qui calcule le score pour un couple (opération, justificatif). Elle est probablement dans `rapprochement_service.py` et appelée par les endpoints `suggestions/operation/` et `suggestions/justificatif/`.

Modifier cette fonction pour :
1. Appeler les 4 fonctions de scoring individuelles
2. Appeler `compute_total_score()` avec les 4 scores
3. **Retourner les scores détaillés** dans la réponse (pas seulement le total)

Structure de réponse enrichie :
```python
{
    "filename": "justificatif_xxx.pdf",
    "ocr_date": "2024-04-10",
    "ocr_montant": 500.00,
    "ocr_fournisseur": "Fournisseur XYZ",
    "score": {
        "total": 0.87,
        "montant": 0.95,
        "date": 0.80,
        "fournisseur": 1.0,
        "categorie": 0.6  # ou null si non inférable
    },
    "size_human": "245.3 Ko"
}
```

### 6b — Endpoint suggestions/justificatif/{filename}

Même enrichissement des scores détaillés pour le sens inverse (justificatif → opérations).

### 6c — Auto-rapprochement (`run_auto_rapprochement`)

Utiliser le même `compute_total_score()`. Le seuil d'auto-association reste 0.80 avec écart ≥ 0.02.

---

## Étape 7 — Mettre à jour le frontend pour afficher les scores détaillés

### 7a — Types TypeScript

Fichier : `frontend/src/types/` (fichier approprié, probablement `rapprochement.ts` ou `justificatifs.ts`)

```typescript
interface ScoreDetail {
  total: number;
  montant: number;
  date: number;
  fournisseur: number;
  categorie: number | null;
}

// Mettre à jour l'interface existante de suggestion :
interface JustificatifSuggestion {
  filename: string;
  ocr_date: string | null;
  ocr_montant: number | null;
  ocr_fournisseur: string | null;
  score: ScoreDetail;  // était: score: number
  size_human: string;
}
```

### 7b — Composant ScorePills

Fichier : `frontend/src/components/justificatifs/ScorePills.tsx`

Nouveau composant réutilisable pour afficher les pills de score détaillé :

```typescript
interface ScorePillsProps {
  score: ScoreDetail;
}

export function ScorePills({ score }: ScorePillsProps) {
  // Afficher 3-4 pills colorées + score total
  // Couleurs : >= 0.80 → green, >= 0.50 → amber/warning, < 0.50 → red/danger
  // Si score.categorie === null → ne pas afficher la pill catégorie
  // Pill format : "Montant 95%" / "Date ±1j" / "Fournisseur 100%" / "Catégorie ✓"
  // Score total à droite avec la même logique de couleur
}
```

**Style** : utiliser les classes Tailwind existantes (`bg-green-500/10 text-green-400`, `bg-amber-500/10 text-amber-400`, `bg-red-500/10 text-red-400`) ou les CSS variables du thème.

### 7c — Intégrer dans JustificatifAttributionDrawer

Fichier : `frontend/src/components/justificatifs/JustificatifAttributionDrawer.tsx`

Remplacer l'affichage du score actuel (badge simple %) par le composant `ScorePills` sous chaque suggestion.

### 7d — Intégrer dans l'historique OCR (sens inverse)

Fichier : `frontend/src/components/ocr/OcrPage.tsx` (onglet Historique)

Pour chaque justificatif orphelin, si un endpoint `suggestions/justificatif/{filename}` existe, afficher les `ScorePills` des opérations candidates.

**Note** : cette intégration est préparatoire — le bouton "Rechercher opération" et le drawer inversé feront l'objet d'un prompt séparé.

---

## Étape 8 — Compatibilité ventilation

Le scoring doit gérer les opérations ventilées :
- Si l'opération a `ventilation_lines`, scorer le justificatif contre **chaque sous-ligne** individuellement
- Le montant de la sous-ligne (pas le montant parent) est utilisé pour `score_montant()`
- La catégorie de la sous-ligne (pas "Ventilé") est utilisée pour `score_categorie()`
- Vérifier que cette logique existe déjà dans les endpoints `suggestions/` — si oui, s'assurer que les nouvelles fonctions de scoring sont bien appelées avec les bons montants/catégories

---

## Vérifications

- [ ] `score_montant()` retourne des valeurs graduelles (pas binaire)
- [ ] `score_date()` retourne des valeurs graduelles avec paliers
- [ ] `score_fournisseur()` utilise 3 stratégies (substring, Jaccard, Levenshtein) et prend le max
- [ ] `score_categorie()` retourne `None` quand non inférable (pas 0.0)
- [ ] `compute_total_score()` redistribue les poids quand catégorie est `None`
- [ ] La réponse des endpoints suggestions contient `score.total`, `score.montant`, `score.date`, `score.fournisseur`, `score.categorie`
- [ ] Le frontend affiche les scores détaillés via `ScorePills`
- [ ] L'auto-rapprochement utilise le même moteur de scoring
- [ ] Les opérations ventilées sont scorées par sous-ligne
- [ ] `_normalize_for_matching()` réutilise `normalize_supplier()` si elle existe déjà
- [ ] Import `SequenceMatcher` depuis `difflib` (stdlib, pas de nouvelle dépendance)
- [ ] Aucune régression sur les tests existants de rapprochement
