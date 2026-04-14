# Prompt Claude Code — Monitoring Agent IA (logging + dashboard)

> Lis d'abord `CLAUDE.md` pour le contexte projet.

## Objectif

Ajouter un système de monitoring de l'agent IA avec :
1. **Logging des prédictions** à chaque catégorisation
2. **Tracking des corrections** manuelles au save dans l'éditeur
3. **Onglet "Monitoring"** dans la page Agent IA avec tous les indicateurs
4. **Carte KPI "Agent IA"** dans le Dashboard

---

## Ordre d'implémentation

### 1. Backend — Modèle de données logging

**Fichier : `backend/models/ml.py`** (nouveau ou ajout dans le fichier models existant pour ML)

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional
from enum import Enum

class PredictionSource(str, Enum):
    exact_match = "exact_match"
    keywords = "keywords"
    sklearn = "sklearn"
    simple = "simple"  # _categorize_simple at import

class PredictionLog(BaseModel):
    """Log d'une prédiction individuelle."""
    libelle: str
    predicted_category: str
    predicted_subcategory: Optional[str] = None
    confidence: float
    source: PredictionSource
    hallucination_risk: bool

class PredictionBatchLog(BaseModel):
    """Log d'un batch de catégorisation."""
    timestamp: str  # ISO
    filename: str
    mode: str  # "empty_only" | "all"
    total_operations: int
    predicted: int  # nb opérations effectivement prédites
    high_confidence: int  # > 0.8
    medium_confidence: int  # 0.5 - 0.8
    low_confidence: int  # < 0.5
    hallucination_flags: int
    predictions: list[PredictionLog]  # détail par opération prédite

class CorrectionLog(BaseModel):
    """Log d'une correction manuelle."""
    timestamp: str
    filename: str
    operation_index: int
    libelle: str
    predicted_category: str
    predicted_subcategory: Optional[str] = None
    corrected_category: str
    corrected_subcategory: Optional[str] = None
    prediction_source: Optional[PredictionSource] = None

class TrainingLog(BaseModel):
    """Log d'un entraînement."""
    timestamp: str
    examples_count: int
    accuracy: Optional[float] = None
    rules_count: int
    keywords_count: int

class MLMonitoringStats(BaseModel):
    """Stats agrégées pour le dashboard monitoring."""
    # Performance instantanée
    coverage_rate: float  # % opérations catégorisées (ni vide ni Autres)
    avg_confidence: float
    confidence_distribution: dict  # {"high": N, "medium": N, "low": N}

    # Fiabilité
    correction_rate: float  # % prédictions corrigées manuellement
    hallucination_rate: float
    top_errors: list[dict]  # [{"libelle": "...", "predicted": "...", "corrected": "...", "count": N}]

    # Progression
    training_history: list[TrainingLog]
    correction_rate_history: list[dict]  # [{"month": "2026-01", "rate": 0.12}]
    knowledge_base: dict  # {"rules": N, "keywords": N, "examples": N}

    # Diagnostic
    confusion_pairs: list[dict]  # [{"from": "Véhicule", "to": "Matériel", "count": N}]
    orphan_categories: list[dict]  # [{"category": "...", "examples_count": N}]
    unknown_libelles_count: int

class MLHealthKPI(BaseModel):
    """KPI résumé pour le Dashboard."""
    coverage_rate: float
    correction_rate: float
    correction_trend: str  # "improving" | "stable" | "degrading"
    hallucination_rate: float
    last_training: Optional[str] = None  # ISO date
    alert: Optional[str] = None  # message si problème détecté
```

### 2. Backend — Service logging

**Fichier : `backend/services/ml_monitoring_service.py`** (nouveau)

Responsabilités :
- Écriture/lecture des logs dans `data/ml/logs/`
- Calcul des stats agrégées

**Stockage :**
```
data/ml/logs/
├── predictions/
│   └── pred_YYYYMMDD_HHMMSS_{filename}.json   # PredictionBatchLog
├── corrections/
│   └── corrections_YYYY_MM.json                # CorrectionLog[] groupé par mois
└── trainings.json                              # TrainingLog[] (append)
```

**Fonctions :**

```python
def log_prediction_batch(batch: PredictionBatchLog) -> None:
    """Sauvegarde un batch de prédictions."""

def log_corrections(filename: str, corrections: list[CorrectionLog]) -> None:
    """Enregistre les corrections détectées au save."""

def log_training(log: TrainingLog) -> None:
    """Append un log d'entraînement."""

def detect_corrections(filename: str, operations: list[dict]) -> list[CorrectionLog]:
    """Compare les opérations sauvegardées avec le dernier batch de prédictions du même fichier.
    Pour chaque opération dont la catégorie diffère de la prédiction → correction."""

def get_monitoring_stats(year: Optional[int] = None) -> MLMonitoringStats:
    """Calcule tous les indicateurs agrégés."""

def get_health_kpi() -> MLHealthKPI:
    """KPI résumé pour le Dashboard."""

def get_confusion_matrix(year: Optional[int] = None) -> list[dict]:
    """Matrice de confusion depuis les corrections loggées."""

def get_correction_rate_history() -> list[dict]:
    """Taux de correction par mois."""
```

**Logique `detect_corrections` :**
1. Charger le dernier log de prédiction pour `filename` dans `data/ml/logs/predictions/`
2. Pour chaque opération sauvegardée, chercher la prédiction correspondante (par index ou libellé)
3. Si `operation.categorie != prediction.predicted_category` → c'est une correction
4. Retourner la liste des corrections

**Logique `get_monitoring_stats` :**
- **coverage_rate** : charger les fichiers d'opérations de l'année, compter celles avec catégorie remplie (ni vide, ni "Autres", ni null) / total
- **avg_confidence** : moyenne des `confidence` dans les logs de prédiction récents
- **confidence_distribution** : comptage high/medium/low sur les prédictions récentes
- **correction_rate** : total corrections / total prédictions (depuis les logs)
- **hallucination_rate** : total hallucination_flags / total prédictions
- **top_errors** : grouper les corrections par (libellé simplifié, predicted → corrected), trier par count desc, top 10
- **confusion_pairs** : grouper les corrections par (predicted_category, corrected_category), trier par count desc
- **orphan_categories** : catégories avec < 5 exemples dans training_data
- **unknown_libelles_count** : dans les dernières prédictions, compter celles avec source="sklearn" et confidence < 0.3

**Logique `correction_trend` dans `get_health_kpi` :**
- Comparer le taux de correction des 2 derniers mois
- Si baisse > 5% → "improving"
- Si hausse > 5% → "degrading"  
- Sinon → "stable"

**Logique `alert` dans `get_health_kpi` :**
- Si correction_rate > 0.25 → "Taux d'erreur élevé (>25%)"
- Si hallucination_rate > 0.10 → "Hallucinations fréquentes (>10%)"
- Si coverage_rate < 0.70 → "Couverture faible (<70%)"
- Sinon → null

### 3. Backend — Intégration du logging dans les flux existants

**Fichier : `backend/services/operation_service.py`** ou le service qui gère `categorize_operations`

Après chaque catégorisation, appeler `ml_monitoring_service.log_prediction_batch()` :

```python
# Dans categorize_file() ou categorize_operations()
# Après avoir catégorisé, construire le PredictionBatchLog :
batch_log = PredictionBatchLog(
    timestamp=datetime.now().isoformat(),
    filename=filename,
    mode=mode,
    total_operations=len(operations),
    predicted=nb_predicted,
    high_confidence=count_high,
    medium_confidence=count_medium,
    low_confidence=count_low,
    hallucination_flags=count_hallucination,
    predictions=prediction_logs
)
ml_monitoring_service.log_prediction_batch(batch_log)
```

**Fichier : `backend/routers/operations.py`** — dans le handler `PUT /{filename}`

Au save des opérations, détecter les corrections :

```python
# Avant de sauvegarder, détecter les corrections
corrections = ml_monitoring_service.detect_corrections(filename, operations)
if corrections:
    ml_monitoring_service.log_corrections(filename, corrections)
# Puis sauvegarder normalement
```

**Fichier : `backend/routers/ml.py`** ou le service train

Après chaque entraînement, logger :

```python
training_log = TrainingLog(
    timestamp=datetime.now().isoformat(),
    examples_count=result.get("examples_count", 0),
    accuracy=result.get("accuracy"),
    rules_count=...,
    keywords_count=...
)
ml_monitoring_service.log_training(training_log)
```

### 4. Backend — Router monitoring

**Fichier : `backend/routers/ml.py`** (ajout aux endpoints existants)

```python
@router.get("/monitoring/stats")
async def get_monitoring_stats(year: Optional[int] = None) -> MLMonitoringStats:
    return ml_monitoring_service.get_monitoring_stats(year)

@router.get("/monitoring/health")
async def get_health_kpi() -> MLHealthKPI:
    return ml_monitoring_service.get_health_kpi()

@router.get("/monitoring/confusion")
async def get_confusion_matrix(year: Optional[int] = None) -> list:
    return ml_monitoring_service.get_confusion_matrix(year)

@router.get("/monitoring/correction-history")
async def get_correction_rate_history() -> list:
    return ml_monitoring_service.get_correction_rate_history()
```

### 5. Frontend — Types

**Fichier : `frontend/src/types/index.ts`**

Ajouter :

```typescript
export interface MLMonitoringStats {
  coverage_rate: number;
  avg_confidence: number;
  confidence_distribution: { high: number; medium: number; low: number };
  correction_rate: number;
  hallucination_rate: number;
  top_errors: Array<{
    libelle: string;
    predicted: string;
    corrected: string;
    count: number;
  }>;
  training_history: Array<{
    timestamp: string;
    examples_count: number;
    accuracy: number | null;
    rules_count: number;
    keywords_count: number;
  }>;
  correction_rate_history: Array<{
    month: string;
    rate: number;
  }>;
  knowledge_base: { rules: number; keywords: number; examples: number };
  confusion_pairs: Array<{
    from: string;
    to: string;
    count: number;
  }>;
  orphan_categories: Array<{
    category: string;
    examples_count: number;
  }>;
  unknown_libelles_count: number;
}

export interface MLHealthKPI {
  coverage_rate: number;
  correction_rate: number;
  correction_trend: 'improving' | 'stable' | 'degrading';
  hallucination_rate: number;
  last_training: string | null;
  alert: string | null;
}
```

### 6. Frontend — Hooks

**Fichier : `frontend/src/hooks/useApi.ts`**

```typescript
export function useMLMonitoringStats(year?: number) {
  return useQuery({
    queryKey: ['ml-monitoring', year],
    queryFn: () => api.get('/ml/monitoring/stats', { params: year ? { year } : {} }),
  });
}

export function useMLHealthKPI() {
  return useQuery({
    queryKey: ['ml-health'],
    queryFn: () => api.get('/ml/monitoring/health'),
  });
}

export function useCorrectionHistory() {
  return useQuery({
    queryKey: ['ml-correction-history'],
    queryFn: () => api.get('/ml/monitoring/correction-history'),
  });
}
```

### 7. Frontend — Onglet Monitoring dans Agent IA

**Fichier : `frontend/src/components/agent-ia/MLMonitoringTab.tsx`** (nouveau)

Layout en 4 sections correspondant aux 4 groupes d'indicateurs :

**Section 1 — "Performance" (haut de page, 3 MetricCards)**
- Taux de couverture : % avec jauge circulaire ou barre, couleur vert >90 / ambre >70 / rouge <70
- Confiance moyenne : % avec même logique couleur
- Distribution confiance : 3 badges inline (Haute: N, Moyenne: N, Basse: N)

**Section 2 — "Fiabilité" (3 MetricCards + table)**
- Taux de correction : % — vert <10 / ambre <25 / rouge >25
- Taux d'hallucination : % — vert <5 / ambre <10 / rouge >10
- Libellés inconnus : nombre
- **Table "Top erreurs"** : 10 lignes max, colonnes (Libellé, Prédit, Corrigé, Nb fois). Si la table est vide, message "Aucune correction enregistrée — le tracking démarre au prochain save dans l'éditeur."

**Section 3 — "Progression" (graphiques Recharts)**
- **Courbe accuracy** : LineChart, X = date d'entraînement, Y = accuracy. Points annotés avec nb exemples
- **Courbe taux de correction** : LineChart par mois, doit descendre
- **Base de connaissances** : 3 badges (Règles: N, Keywords: N, Exemples: N) avec tendance

**Section 4 — "Diagnostic"**
- **Matrice de confusion simplifiée** : pas une vraie matrice NxN (trop de catégories), mais une table des **paires confuses** triées par fréquence. Colonnes : (Catégorie prédite, Catégorie réelle, Nb confusions). Max 10 lignes. Chaque ligne a un bouton "Ajouter une règle" qui pré-remplit le formulaire d'ajout de règle avec la bonne catégorie
- **Catégories orphelines** : liste des catégories avec < 5 exemples, badge ambre "Peu de données"

**Composants à utiliser :** `MetricCard` (existant), `Recharts` (LineChart), tables HTML simples avec classes Tailwind, `Lucide` icons (TrendingUp, TrendingDown, AlertTriangle, Brain, Target, Shield)

**Le sélecteur année** du store Zustand global filtre les stats.

### 8. Frontend — Ajout onglet dans AgentIAPage

**Fichier : `frontend/src/components/agent-ia/AgentIAPage.tsx`**

Ajouter un onglet "Monitoring" (icône `Activity` de Lucide) qui affiche `<MLMonitoringTab />`.

### 9. Frontend — Carte KPI dans le Dashboard

**Fichier : `frontend/src/components/dashboard/DashboardPage.tsx`**

Ajouter une carte dans la grille KPI existante :

- Titre : "Agent IA"
- Icône : `Brain` (Lucide)
- Valeur principale : taux de couverture (ex: "92%")
- Sous-valeur : taux de correction (ex: "Corrections: 8%")
- Trend : flèche selon `correction_trend` (improving = vert ↓, degrading = rouge ↑, stable = gris →)
- Si `alert` non null : badge rouge avec le message d'alerte
- Clic sur la carte → `navigate('/agent-ai')` (onglet monitoring)

Utiliser `useMLHealthKPI()` pour les données.

### 10. Config

**Fichier : `backend/core/config.py`**

Ajouter :

```python
ML_LOGS_DIR = DATA_DIR / "ml" / "logs"
ML_PREDICTIONS_LOG_DIR = ML_LOGS_DIR / "predictions"
ML_CORRECTIONS_LOG_DIR = ML_LOGS_DIR / "corrections"
```

Ajouter ces chemins dans `ensure_directories()`.

---

## Checklist de vérification

- [ ] `from __future__ import annotations` dans tous les fichiers Python modifiés/créés
- [ ] `Optional[X]` pas `X | None`
- [ ] Répertoires `data/ml/logs/predictions/` et `data/ml/logs/corrections/` créés par `ensure_directories()`
- [ ] Le logging de prédictions se fait dans le service catégorisation, pas dans le router
- [ ] La détection de corrections se fait au `PUT /{filename}` (save éditeur), pas au chargement
- [ ] Les logs n'impactent pas les performances : écriture asynchrone ou rapide (JSON append)
- [ ] Si aucun log n'existe encore (premier usage), les indicateurs affichent des valeurs par défaut cohérentes (0%, "Aucune donnée") sans erreur
- [ ] Le store Zustand année filtre les stats monitoring
- [ ] La carte Dashboard utilise `useMLHealthKPI()` — un seul appel léger, pas les stats complètes
- [ ] Pas de `any` TypeScript
- [ ] Les corrections ne sont loggées que si une prédiction antérieure existe pour ce fichier (pas de faux positifs au premier save d'un fichier importé et catégorisé manuellement sans passage IA)
- [ ] Recharts LineChart avec `ResponsiveContainer` comme partout dans le projet
- [ ] Le bouton "Ajouter une règle" depuis la matrice de confusion pré-remplit le formulaire existant (pas de nouveau formulaire)
