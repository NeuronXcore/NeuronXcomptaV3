# Prompt Claude Code — Module Dotations aux Amortissements

## Pré-requis

**Lire `CLAUDE.md` en premier** pour charger toutes les conventions du projet.

Ce prompt implémente le module complet des dotations aux amortissements : registre des immobilisations, calcul des dotations, détection automatique des opérations candidates, drawer de confirmation, page dédiée avec 4 onglets, et intégration dans le simulateur BNC + EditorPage + Alertes.

---

## ÉTAPE 1 — Configuration (`backend/core/config.py`)

Ajouter les chemins et constantes :

```python
# Après les autres DIR
AMORTISSEMENTS_DIR = DATA_DIR / "amortissements"

# Dans ensure_directories(), ajouter :
AMORTISSEMENTS_DIR.mkdir(parents=True, exist_ok=True)
```

Constantes à ajouter :

```python
# Amortissements
SEUIL_IMMOBILISATION = 500  # € TTC (médecin exonéré TVA)

CATEGORIES_IMMOBILISABLES = [
    "Matériel", "Informatique", "Véhicule", "Mobilier", "Travaux"
]

SOUS_CATEGORIES_EXCLUES_IMMO = [
    "Carburant", "Entretien", "Assurance", "Consommables",
    "Péage", "Parking", "Location", "Leasing", "Loyer"
]

DUREES_AMORTISSEMENT_DEFAUT = {
    "materiel-medical": 5,
    "informatique": 3,
    "vehicule": 5,
    "mobilier": 10,
    "telephone": 3,
    "travaux": 10,
    "logiciel": 1,
    "materiel": 5,
}

# Plafonds fiscaux véhicules (barème CO2)
PLAFONDS_VEHICULE = [
    {"label": "Électrique (≤ 20g CO2)", "co2_max": 20, "plafond": 30000},
    {"label": "Hybride (20-50g CO2)", "co2_max": 50, "plafond": 20300},
    {"label": "Standard (50-130g CO2)", "co2_max": 130, "plafond": 18300},
    {"label": "Polluant (> 130g CO2)", "co2_max": 9999, "plafond": 9900},
]

# Coefficients dégressif
COEFFICIENTS_DEGRESSIF = {
    3: 1.25, 4: 1.25,
    5: 1.75, 6: 1.75,
    7: 2.25, 8: 2.25, 9: 2.25, 10: 2.25,
}
```

---

## ÉTAPE 2 — Modèles Pydantic (`backend/models/amortissement.py`)

Créer `backend/models/amortissement.py` :

```python
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class OperationSource(BaseModel):
    file: str
    index: int


class Immobilisation(BaseModel):
    id: str                                  # "immo_YYYYMMDD_XXXX"
    libelle: str
    date_acquisition: str                    # YYYY-MM-DD
    valeur_origine: float
    duree_amortissement: int                 # années
    methode: str = "lineaire"                # "lineaire" | "degressif"
    poste_comptable: str                     # id du poste GED
    date_mise_en_service: Optional[str] = None  # YYYY-MM-DD, défaut = date_acquisition
    date_sortie: Optional[str] = None
    motif_sortie: Optional[str] = None       # "cession" | "rebut" | "vol"
    prix_cession: Optional[float] = None
    quote_part_pro: int = 100                # % usage professionnel
    plafond_fiscal: Optional[float] = None   # pour véhicules
    co2_classe: Optional[str] = None         # label classe CO2

    operation_source: Optional[OperationSource] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None

    created_at: str = ""
    statut: str = "en_cours"                 # "en_cours" | "amorti" | "sorti"
    notes: Optional[str] = None


class ImmobilisationCreate(BaseModel):
    libelle: str
    date_acquisition: str
    valeur_origine: float
    duree_amortissement: int
    methode: str = "lineaire"
    poste_comptable: str
    date_mise_en_service: Optional[str] = None
    quote_part_pro: int = 100
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None
    operation_source: Optional[OperationSource] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None
    notes: Optional[str] = None


class ImmobilisationUpdate(BaseModel):
    libelle: Optional[str] = None
    duree_amortissement: Optional[int] = None
    methode: Optional[str] = None
    poste_comptable: Optional[str] = None
    date_mise_en_service: Optional[str] = None
    quote_part_pro: Optional[int] = None
    plafond_fiscal: Optional[float] = None
    co2_classe: Optional[str] = None
    date_sortie: Optional[str] = None
    motif_sortie: Optional[str] = None
    prix_cession: Optional[float] = None
    justificatif_id: Optional[str] = None
    ged_doc_id: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None


class LigneAmortissement(BaseModel):
    exercice: int
    jours: int
    base_amortissable: float
    dotation_brute: float
    quote_part_pro: int
    dotation_deductible: float
    amortissements_cumules: float
    vnc: float


class AmortissementConfig(BaseModel):
    seuil_immobilisation: int = 500
    durees_par_defaut: dict = Field(default_factory=dict)
    methode_par_defaut: str = "lineaire"
    categories_immobilisables: list[str] = Field(default_factory=list)
    sous_categories_exclues: list[str] = Field(default_factory=list)
    exercice_cloture: str = "12-31"


class CessionResult(BaseModel):
    vnc_sortie: float
    plus_value: Optional[float] = None
    moins_value: Optional[float] = None
    duree_detention_mois: int
    regime: str   # "court_terme" | "long_terme"
```

---

## ÉTAPE 3 — Service (`backend/services/amortissement_service.py`)

Créer `backend/services/amortissement_service.py`.

### 3.1 — Gestion du registre

```python
from __future__ import annotations
import json
import uuid
from datetime import datetime, date
from pathlib import Path
from typing import Optional
from backend.core.config import (
    AMORTISSEMENTS_DIR, SEUIL_IMMOBILISATION,
    CATEGORIES_IMMOBILISABLES, SOUS_CATEGORIES_EXCLUES_IMMO,
    DUREES_AMORTISSEMENT_DEFAUT, PLAFONDS_VEHICULE,
    COEFFICIENTS_DEGRESSIF, ensure_directories
)

IMMOBILISATIONS_FILE = AMORTISSEMENTS_DIR / "immobilisations.json"
CONFIG_FILE = AMORTISSEMENTS_DIR / "config.json"
```

Fonctions CRUD :

- `_load_immobilisations() -> list[dict]` : charge `immobilisations.json`, retourne `[]` si inexistant.
- `_save_immobilisations(data: list[dict])` : écrit le fichier JSON.
- `_load_config() -> dict` : charge `config.json` avec defaults depuis `config.py`.
- `_save_config(data: dict)` : écrit la config.

- `get_all_immobilisations(statut: Optional[str], poste: Optional[str], year: Optional[int]) -> list[dict]` : filtrage optionnel par statut/poste/année d'acquisition. Retourne la liste enrichie avec le champ calculé `avancement_pct` (amortissements cumulés / valeur origine × 100) et `vnc_actuelle` (valeur origine − amortissements cumulés à la date du jour).

- `get_immobilisation(immo_id: str) -> dict` : retourne l'immobilisation avec son tableau d'amortissement complet calculé.

- `create_immobilisation(data: ImmobilisationCreate) -> dict` :
  - Génère l'id : `f"immo_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:4]}"`
  - Si `date_mise_en_service` est None, utiliser `date_acquisition`
  - Si `plafond_fiscal` n'est pas fourni et `poste_comptable == "vehicule"`, appliquer le plafond par défaut 18 300€
  - Ajoute `created_at = datetime.now().isoformat()`
  - Statut = `"en_cours"`
  - Sauvegarde et retourne l'immobilisation créée

- `update_immobilisation(immo_id: str, data: ImmobilisationUpdate) -> dict` : mise à jour partielle. Si `date_sortie` est renseignée, passer le statut à `"sorti"`. Si la VNC atteint 0, passer à `"amorti"`.

- `delete_immobilisation(immo_id: str) -> bool` : suppression du registre.

### 3.2 — Moteur de calcul des dotations

**Fonction centrale : `calc_tableau_amortissement(immo: dict) -> list[dict]`**

Logique pour la méthode **linéaire** :
1. `annuite = base_amortissable / duree` où `base_amortissable = min(valeur_origine, plafond_fiscal or valeur_origine)`
2. Année 1 : pro rata temporis = jours restants dans l'exercice depuis `date_mise_en_service` / 360
3. Années intermédiaires : annuité pleine
4. Dernière année : complément pour atteindre `base_amortissable` (VNC → 0)
5. Si `date_sortie` existe : tronquer le tableau à cette date, dernière dotation au pro rata
6. Chaque ligne : `dotation_deductible = dotation_brute × quote_part_pro / 100`
7. Arrondir toutes les valeurs à 2 décimales

Logique pour la méthode **dégressive** :
1. Coefficient = `COEFFICIENTS_DEGRESSIF.get(duree, 2.25)`
2. Taux dégressif = (1 / duree) × coefficient
3. Année 1 : `base_amortissable × taux_degressif × pro_rata_mois / 12`
4. Années suivantes : `vnc_debut × taux_degressif`
5. Bascule en linéaire quand `vnc / nb_annees_restantes > vnc × taux_degressif`
6. Même logique pro rata et quote-part que linéaire

**Fonction : `get_dotations_exercice(year: int) -> dict`**

Parcourt toutes les immobilisations actives, calcule le tableau pour chacune, extrait la ligne de l'exercice demandé. Retourne :
```python
{
    "year": 2024,
    "total_dotations_brutes": 15800.00,
    "total_dotations_deductibles": 14217.00,
    "detail": [
        {
            "immo_id": "immo_xxx",
            "libelle": "Échographe",
            "poste_comptable": "materiel-medical",
            "dotation_brute": 1700.00,
            "dotation_deductible": 1700.00,
            "vnc": 5100.00
        }
    ]
}
```

**Fonction : `get_projections(years: int = 5) -> list[dict]`**

Pour chaque année de l'année courante à +N, calcule `get_dotations_exercice()`. Retourne un tableau pour le graphe projection.

### 3.3 — Détection des candidates

**Fonction : `detect_candidates(operations: list[dict], filename: str) -> list[dict]`**

Pour chaque opération :
1. Vérifier `debit > seuil_immobilisation` (charger seuil depuis config)
2. Vérifier `categorie in categories_immobilisables`
3. Vérifier `sous_categorie not in sous_categories_exclues`
4. Vérifier `immobilisation_id` n'est pas déjà renseigné
5. Vérifier `immobilisation_ignored` n'est pas `True`
6. Si toutes les conditions sont remplies → candidat

Retourne la liste des candidats avec `{filename, index, date, libelle, categorie, sous_categorie, debit}`.

**Fonction : `get_all_candidates() -> list[dict]`**

Parcourt tous les fichiers d'opérations via `operation_service`, appelle `detect_candidates` pour chacun. Retourne la liste agrégée triée par date.

**Fonction : `ignore_candidate(filename: str, index: int) -> dict`**

Charge le fichier d'opérations, ajoute `"immobilisation_ignored": True` à l'opération, sauvegarde. Retourne l'opération mise à jour.

**Fonction : `link_operation_to_immobilisation(filename: str, index: int, immo_id: str) -> dict`**

Charge le fichier d'opérations, ajoute `"immobilisation_id": immo_id` et `"immobilisation_candidate": False` à l'opération. Change la catégorie à `"Immobilisations"` et la sous-catégorie au poste comptable de l'immobilisation. Sauvegarde et retourne l'opération.

### 3.4 — Cession / sortie d'actif

**Fonction : `calculer_cession(immo_id: str, date_sortie: str, prix_cession: float) -> dict`**

1. Calcule le tableau d'amortissement jusqu'à `date_sortie`
2. VNC à la date de sortie = dernière VNC du tableau tronqué
3. Plus-value = `prix_cession - vnc_sortie` si > 0
4. Moins-value = `vnc_sortie - prix_cession` si > 0
5. Durée de détention en mois (depuis date_acquisition)
6. Régime : `"court_terme"` si < 2 ans, `"long_terme"` si ≥ 2 ans

Retourne un `CessionResult`.

### 3.5 — KPIs

**Fonction : `get_kpis(year: Optional[int] = None) -> dict`**

```python
{
    "nb_actives": 12,
    "nb_amorties": 3,
    "nb_sorties": 1,
    "nb_candidates": 3,
    "dotation_exercice": 14217.00,  # dotation déductible de l'année
    "total_vnc": 45833.00,          # somme VNC de toutes les actives
    "total_valeur_origine": 78000.00,
    "postes": [
        {"poste": "materiel-medical", "nb": 4, "vnc": 12000, "dotation": 3400}
    ]
}
```

---

## ÉTAPE 4 — Router (`backend/routers/amortissements.py`)

Créer `backend/routers/amortissements.py` avec prefix `/api/amortissements`.

### Endpoints

```
GET    /                          → get_all_immobilisations(statut?, poste?, year?)
GET    /kpis                      → get_kpis(year?)
GET    /{immo_id}                 → get_immobilisation (avec tableau complet)
POST   /                          → create_immobilisation (body: ImmobilisationCreate)
PATCH  /{immo_id}                 → update_immobilisation (body: ImmobilisationUpdate)
DELETE /{immo_id}                 → delete_immobilisation

GET    /dotations/{year}          → get_dotations_exercice
GET    /projections               → get_projections(years=5 query param)
GET    /tableau/{immo_id}         → calc_tableau_amortissement (retourne le tableau seul)

GET    /candidates                → get_all_candidates
POST   /candidates/ignore         → ignore_candidate (body: {filename, index})
POST   /candidates/immobiliser    → create immobilisation + link_operation (body: ImmobilisationCreate avec operation_source)

POST   /cession/{immo_id}         → calculer_cession (body: {date_sortie, prix_cession})
                                    + update_immobilisation (date_sortie, motif_sortie, prix_cession, statut="sorti")

GET    /config                    → _load_config
PUT    /config                    → _save_config (body: AmortissementConfig)
```

**L'endpoint `POST /candidates/immobiliser`** est le plus important. Il :
1. Crée l'immobilisation via `create_immobilisation`
2. Lie l'opération via `link_operation_to_immobilisation`
3. Retourne l'immobilisation créée avec son tableau

### Enregistrement du router

Dans `backend/main.py`, ajouter :
```python
from backend.routers import amortissements
app.include_router(amortissements.router)
```

---

## ÉTAPE 5 — Intégration alertes (`backend/services/alertes_service.py`)

Dans `refresh_alertes_fichier()`, ajouter un 6ème type d'alerte **après les alertes existantes** :

```python
# 6. Immobilisation suggérée (montant > seuil + catégorie éligible)
from backend.services.amortissement_service import detect_candidates

candidates = detect_candidates(operations, filename)
for c in candidates:
    alertes.append({
        "index": c["index"],
        "type": "immobilisation_suggeree",
        "message": f"Montant {c['debit']}€ > seuil {SEUIL_IMMOBILISATION}€ — immobilisation suggérée",
        "severity": "info"
    })
```

**NE PAS modifier** le reste de la logique existante. Juste ajouter ce bloc à la fin.

---

## ÉTAPE 6 — Types TypeScript (`frontend/src/types/index.ts`)

Ajouter les interfaces suivantes **à la fin du fichier** :

```typescript
// ============================================================
// Amortissements
// ============================================================

export interface OperationSource {
  file: string
  index: number
}

export interface Immobilisation {
  id: string
  libelle: string
  date_acquisition: string
  valeur_origine: number
  duree_amortissement: number
  methode: 'lineaire' | 'degressif'
  poste_comptable: string
  date_mise_en_service: string | null
  date_sortie: string | null
  motif_sortie: string | null
  prix_cession: number | null
  quote_part_pro: number
  plafond_fiscal: number | null
  co2_classe: string | null
  operation_source: OperationSource | null
  justificatif_id: string | null
  ged_doc_id: string | null
  created_at: string
  statut: 'en_cours' | 'amorti' | 'sorti'
  notes: string | null
  // Champs calculés ajoutés par le backend
  avancement_pct?: number
  vnc_actuelle?: number
  tableau?: LigneAmortissement[]
}

export interface ImmobilisationCreate {
  libelle: string
  date_acquisition: string
  valeur_origine: number
  duree_amortissement: number
  methode?: string
  poste_comptable: string
  date_mise_en_service?: string | null
  quote_part_pro?: number
  plafond_fiscal?: number | null
  co2_classe?: string | null
  operation_source?: OperationSource | null
  justificatif_id?: string | null
  ged_doc_id?: string | null
  notes?: string | null
}

export interface LigneAmortissement {
  exercice: number
  jours: number
  base_amortissable: number
  dotation_brute: number
  quote_part_pro: number
  dotation_deductible: number
  amortissements_cumules: number
  vnc: number
}

export interface AmortissementCandidate {
  filename: string
  index: number
  date: string
  libelle: string
  categorie: string
  sous_categorie: string
  debit: number
}

export interface AmortissementKpis {
  nb_actives: number
  nb_amorties: number
  nb_sorties: number
  nb_candidates: number
  dotation_exercice: number
  total_vnc: number
  total_valeur_origine: number
  postes: Array<{
    poste: string
    nb: number
    vnc: number
    dotation: number
  }>
}

export interface DotationsExercice {
  year: number
  total_dotations_brutes: number
  total_dotations_deductibles: number
  detail: Array<{
    immo_id: string
    libelle: string
    poste_comptable: string
    dotation_brute: number
    dotation_deductible: number
    vnc: number
  }>
}

export interface AmortissementConfig {
  seuil_immobilisation: number
  durees_par_defaut: Record<string, number>
  methode_par_defaut: string
  categories_immobilisables: string[]
  sous_categories_exclues: string[]
  exercice_cloture: string
}

export interface CessionResult {
  vnc_sortie: number
  plus_value: number | null
  moins_value: number | null
  duree_detention_mois: number
  regime: 'court_terme' | 'long_terme'
}
```

Ajouter aussi dans l'interface `Operation` existante (si pas déjà présent) :

```typescript
// Dans l'interface Operation existante, ajouter :
immobilisation_id?: string
immobilisation_candidate?: boolean
immobilisation_ignored?: boolean
```

---

## ÉTAPE 7 — Hook (`frontend/src/hooks/useAmortissements.ts`)

Créer `frontend/src/hooks/useAmortissements.ts` avec TanStack Query.

### Queries

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type {
  Immobilisation, ImmobilisationCreate, AmortissementKpis,
  DotationsExercice, AmortissementCandidate, AmortissementConfig,
  LigneAmortissement, CessionResult
} from '../types'
```

Hooks à implémenter :

- `useImmobilisations(statut?: string, poste?: string, year?: number)` → `useQuery` clé `['amortissements', statut, poste, year]`, GET `/api/amortissements`
- `useImmobilisation(immoId: string | null)` → `useQuery` clé `['amortissement', immoId]`, GET `/api/amortissements/{immoId}`, `enabled: !!immoId`
- `useAmortissementKpis(year?: number)` → `useQuery` clé `['amortissement-kpis', year]`, GET `/api/amortissements/kpis`
- `useDotationsExercice(year: number)` → `useQuery` clé `['dotations', year]`, GET `/api/amortissements/dotations/{year}`
- `useProjections(years?: number)` → `useQuery` clé `['amortissement-projections', years]`, GET `/api/amortissements/projections`
- `useCandidates()` → `useQuery` clé `['amortissement-candidates']`, GET `/api/amortissements/candidates`
- `useAmortissementConfig()` → `useQuery` clé `['amortissement-config']`, GET `/api/amortissements/config`

### Mutations

- `useCreateImmobilisation()` → POST `/api/amortissements`, onSuccess invalide `['amortissements']`, `['amortissement-kpis']`, `['amortissement-candidates']`
- `useUpdateImmobilisation()` → PATCH `/api/amortissements/{id}`, onSuccess invalide `['amortissements']`, `['amortissement', id]`, `['amortissement-kpis']`
- `useDeleteImmobilisation()` → DELETE `/api/amortissements/{id}`, onSuccess invalide `['amortissements']`, `['amortissement-kpis']`
- `useImmobiliserCandidate()` → POST `/api/amortissements/candidates/immobiliser`, onSuccess invalide `['amortissements']`, `['amortissement-candidates']`, `['amortissement-kpis']`, `['operations']` (car l'opération est modifiée), `['alertes']`
- `useIgnoreCandidate()` → POST `/api/amortissements/candidates/ignore`, onSuccess invalide `['amortissement-candidates']`, `['operations']`, `['alertes']`
- `useCession()` → POST `/api/amortissements/cession/{id}`, onSuccess invalide `['amortissements']`, `['amortissement', id]`, `['amortissement-kpis']`
- `useSaveAmortissementConfig()` → PUT `/api/amortissements/config`, onSuccess invalide `['amortissement-config']`, `['amortissement-candidates']`

---

## ÉTAPE 8 — Moteur de calcul TypeScript (`frontend/src/lib/amortissement-engine.ts`)

Créer ce fichier pour les calculs temps réel côté client (même logique que le backend).

### Fonctions

```typescript
export interface CalcAmortissementParams {
  valeur_origine: number
  duree: number
  methode: 'lineaire' | 'degressif'
  date_mise_en_service: string    // YYYY-MM-DD
  quote_part_pro: number          // 0-100
  plafond_fiscal?: number | null
  exercice_cloture?: string       // "12-31"
}

export function calcTableauAmortissement(params: CalcAmortissementParams): LigneAmortissement[]
```

Implémenter la même logique que le backend Python (section 3.2).

```typescript
export function calcDotationAnnee1ProRata(
  valeur: number,
  duree: number,
  dateMiseEnService: string,
  quotePartPro: number,
  plafond?: number | null
): number
```

Fonction simplifiée pour le simulateur BNC : retourne la dotation déductible de l'année 1 uniquement.

```typescript
export function isImmobilisable(montant: number, seuil: number): boolean
```

Retourne `montant > seuil`.

**Important** : tous les montants arrondis à 2 décimales. Utiliser `Math.round(x * 100) / 100`.

---

## ÉTAPE 9 — Composants frontend

### 9.1 — Page principale (`frontend/src/components/amortissements/AmortissementsPage.tsx`)

Structure :
- `PageHeader` avec titre "Dotations aux amortissements", description, actions : bouton Config (ouvre drawer config) + bouton "+ Nouvelle immobilisation" (ouvre drawer création, `btn-primary`)
- Barre d'alerte ambrée si `kpis.nb_candidates > 0` : "N opérations dépassent le seuil (500 €) et sont candidates à l'immobilisation" + bouton "Voir les candidates" qui switch sur l'onglet
- 4 `MetricCard` : Immobilisations actives, Dotation {year} (vert), VNC totale, Candidates (ambré si > 0)
- 4 onglets : Registre, Tableau annuel, Synthèse par poste, Candidates (avec badge count)

**Onglet Registre** :
- Filtres : select poste, select statut, select année, input recherche
- Tableau : Date acq. | Libellé | Poste (dot couleur + label) | Méthode | Valeur (mono) | Durée | Avancement (progress bar + %) | VNC (mono, bold) | Statut (badge) | Actions (pills vers justificatif/opération)
- Lignes `opacity-60` pour les immobilisations amorties ou sorties
- Clic sur une ligne → ouvre le drawer détail

**Onglet Tableau annuel** :
- Select exercice en haut + total dotations déductibles à droite (vert, bold)
- Tableau : Bien | Poste | Base amort. | Dotation brute | % pro | Dotation déduc. (vert) | Cumul | VNC
- Pour les véhicules : annotation sous le libellé "Plafond fiscal : X €" et sous la base amortissable "sur Y €"
- Ligne de total en pied de tableau avec bordure double

**Onglet Synthèse par poste** :
- Grid 2 colonnes
- Gauche : BarChart horizontal (Recharts, `<BarChart layout="vertical">`) dotations par poste, couleurs par poste
- Droite : liste des postes avec dot couleur, VNC, %, total VNC en bas, section "Prochaines échéances" (prochaines immobilisations arrivant à fin d'amortissement)

**Onglet Candidates** :
- Texte explicatif en haut
- Tableau : Date | Libellé | Catégorie | Montant (mono bold) | Fichier source (muted, tronqué) | Actions (boutons "Immobiliser" primary + "Ignorer" outline)
- "Immobiliser" ouvre le `ImmobilisationDrawer` pré-rempli
- "Ignorer" appelle `useIgnoreCandidate` avec confirmation

### 9.2 — Drawer immobilisation (`frontend/src/components/amortissements/ImmobilisationDrawer.tsx`)

Props : `{ isOpen, onClose, candidate?: AmortissementCandidate, immobilisation?: Immobilisation }`

- Si `candidate` fourni → mode création pré-rempli depuis l'opération
- Si `immobilisation` fourni → mode édition/consultation

Drawer fixe côté droit, 650px, translateX + backdrop (pattern existant).

Contenu :
1. **Section "Informations du bien"** : form grid 2 colonnes
   - Libellé (input), Date d'acquisition (date), Valeur d'origine (input number), Poste comptable (select, utiliser les postes GED via `GET /api/ged/postes`), Durée (select, pré-rempli par défaut du poste), Méthode (select lineaire/dégressif)
   - Slider "Usage professionnel" 0-100 step 5 avec affichage %

2. **Section conditionnelle "Véhicule"** : visible seulement si `poste_comptable === "vehicule"`
   - Select classe CO2 (4 options du barème)
   - Affichage du plafond fiscal correspondant
   - Note : "La base amortissable sera plafonnée à X €"

3. **Section "Aperçu du tableau d'amortissement"** : mini-tableau calculé en temps réel via `calcTableauAmortissement()` du moteur TS
   - Colonnes : Exercice | Dotation brute | Déduc. (%) | Cumul | VNC
   - Ligne de l'exercice courant surlignée (`bg-primary/5`)
   - **Recalcul à chaque changement de champ** via `useMemo` dépendant de tous les champs du form

4. **Section "Traçabilité"** : pills cliquables vers opération source et justificatif si renseignés

5. **Footer** : bouton Annuler + bouton "Confirmer l'immobilisation" (primary) ou "Enregistrer" en mode édition

**Comportement à la confirmation** :
- Appelle `useImmobiliserCandidate` si mode candidat (crée l'immo + lie l'opération)
- Appelle `useCreateImmobilisation` si nouvelle immo manuelle
- Appelle `useUpdateImmobilisation` si édition
- Toast success + fermeture du drawer

### 9.3 — Drawer config (`frontend/src/components/amortissements/ConfigAmortissementsDrawer.tsx`)

Drawer 500px, pattern standard.

Sections :
1. **Seuil d'immobilisation** : input number, note "En € TTC (médecin exonéré TVA)"
2. **Durées par défaut par poste** : liste des postes avec select durée (3/5/7/10 ans)
3. **Plafonds véhicules** : affichage lecture seule du barème CO2 (informatif, pas modifiable — c'est le barème fiscal)
4. **Catégories éligibles** : pills des catégories avec bouton "+ Ajouter"
5. **Sous-catégories exclues** : pills des sous-catégories exclues avec bouton "+ Ajouter"

Bouton "Enregistrer" → `useSaveAmortissementConfig`.

### 9.4 — Drawer cession (`frontend/src/components/amortissements/CessionDrawer.tsx`)

Drawer 500px. Accessible depuis le registre (bouton d'action sur une immobilisation active).

Champs : date de sortie (date), motif (select : cession/rebut/vol), prix de cession (input number, visible si motif = cession).

Section calculée :
- VNC à la date de sortie
- Plus-value ou moins-value
- Régime (court terme / long terme) avec explication

Bouton "Confirmer la sortie" → `useCession`.

---

## ÉTAPE 10 — Routing & Sidebar

### App.tsx

Ajouter la route :

```tsx
import AmortissementsPage from './components/amortissements/AmortissementsPage'

// Dans les routes, ajouter dans le groupe CLÔTURE :
<Route path="/amortissements" element={<AmortissementsPage />} />
```

### Sidebar.tsx

Dans `NAV_SECTIONS`, ajouter dans le groupe **CLÔTURE** :

```tsx
{
  path: '/amortissements',
  label: 'Amortissements',
  icon: Landmark,  // import { Landmark } from 'lucide-react'
}
```

Position : après "Clôture", avant le groupe "DOCUMENTS". L'ordre dans CLÔTURE devient : Export Comptable, Clôture, Amortissements.

---

## ÉTAPE 11 — Intégration EditorPage

Dans `EditorPage.tsx`, ajouter un indicateur visuel sur les opérations candidates à l'immobilisation.

Dans le tableau des opérations, ajouter une colonne ou un badge conditionnel :

```tsx
// Dans le rendu de chaque ligne d'opération
{op.immobilisation_candidate && !op.immobilisation_ignored && !op.immobilisation_id && (
  <span
    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 cursor-pointer"
    title="Montant > seuil — candidat à l'immobilisation"
    onClick={() => {/* ouvrir ImmobilisationDrawer avec les données de l'opération */}}
  >
    <Landmark className="w-3 h-3" />
    À immobiliser
  </span>
)}
{op.immobilisation_id && (
  <span
    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600"
    title="Immobilisé"
  >
    <Landmark className="w-3 h-3" />
    Immo.
  </span>
)}
```

**NE PAS casser** la logique existante de l'EditorPage. Ajouter ces badges dans la colonne existante "Libellé" ou créer une mini-colonne juste après.

---

## ÉTAPE 12 — Mise à jour CLAUDE.md

Ajouter dans la section Architecture :

```
- **Amortissements**: Registre des immobilisations avec calcul automatique des dotations (linéaire/dégressif), 
  détection des opérations candidates (montant > seuil + catégorie éligible), plafonds véhicules, 
  gestion des cessions. Données dans `data/amortissements/`. Moteur de calcul dupliqué Python/TypeScript.
```

Ajouter dans Project Structure :

```
├── data/
│   ├── amortissements/
│   │   ├── immobilisations.json    # Registre des immobilisations
│   │   └── config.json             # Seuil, durées par défaut, catégories éligibles
```

Ajouter la route dans Frontend Routes :

```
| `/amortissements` | AmortissementsPage | Registre immobilisations, tableau annuel, synthèse par poste, candidates, drawers (immobilisation, config, cession) |
```

Ajouter le router dans Backend API Endpoints :

```
| amortissements | `/api/amortissements` | GET /, GET /kpis, POST /, PATCH /{id}, DELETE /{id}, GET /dotations/{year}, GET /projections, GET /candidates, POST /candidates/immobiliser, POST /candidates/ignore, POST /cession/{id}, GET/PUT /config |
```

Ajouter dans Sidebar Navigation :

```
| **CLÔTURE** | Export Comptable, Clôture, Amortissements |
```

Ajouter dans Key Components / Drawers :

```
- `ImmobilisationDrawer` — 650px, création/édition immobilisation, aperçu tableau temps réel, traçabilité opération/justificatif
- `ConfigAmortissementsDrawer` — 500px, seuil, durées par défaut, catégories éligibles
- `CessionDrawer` — 500px, sortie d'actif avec calcul plus/moins-value
```

Ajouter dans Patterns to Follow :

```
- **Amortissement engine**: Moteur de calcul dupliqué backend Python (`amortissement_service.py`) et frontend TypeScript (`lib/amortissement-engine.ts`). Résultats identiques. Pas d'Ollama — calcul pur.
- **Candidate detection**: Post-processing après catégorisation. Champ `immobilisation_candidate` sur l'opération. 6ème type d'alerte `immobilisation_suggeree` dans le compte d'attente.
- **Plafonds véhicules**: Base amortissable plafonnée selon CO2. Quote-part pro appliquée ensuite.
```

---

## Vérification

Après implémentation, vérifier :

- [ ] `python3 -m uvicorn backend.main:app --port 8000` démarre sans erreur
- [ ] `GET /api/amortissements` retourne `[]` (registre vide)
- [ ] `GET /api/amortissements/kpis` retourne les compteurs à 0
- [ ] `GET /api/amortissements/config` retourne la config par défaut
- [ ] `POST /api/amortissements` crée une immobilisation, vérifie le tableau calculé
- [ ] `GET /api/amortissements/candidates` détecte les opérations > seuil
- [ ] `POST /api/amortissements/candidates/immobiliser` crée l'immo + modifie l'opération
- [ ] `POST /api/amortissements/candidates/ignore` flag l'opération
- [ ] Le tableau d'amortissement linéaire est correct (pro rata année 1, VNC → 0)
- [ ] Le tableau d'amortissement dégressif bascule en linéaire au bon moment
- [ ] Les plafonds véhicules limitent la base amortissable
- [ ] La quote-part pro réduit la dotation déductible
- [ ] Le moteur TypeScript produit les mêmes résultats que le Python
- [ ] La page `/amortissements` affiche les 4 onglets
- [ ] Le drawer d'immobilisation recalcule le tableau en temps réel
- [ ] Les badges apparaissent dans EditorPage sur les opérations candidates
- [ ] L'alerte `immobilisation_suggeree` apparaît dans le compte d'attente
- [ ] La sidebar affiche "Amortissements" dans le groupe CLÔTURE avec l'icône Landmark
- [ ] `cd frontend && npx tsc --noEmit` passe sans erreur
- [ ] CLAUDE.md est à jour

---

## Ordre d'implémentation recommandé

1. Config (`config.py`)
2. Modèles (`models/amortissement.py`)
3. Service — CRUD + moteur calcul (`services/amortissement_service.py`)
4. Router (`routers/amortissements.py`) + registration dans `main.py`
5. Intégration alertes (`alertes_service.py`)
6. Types TypeScript (`types/index.ts`)
7. Moteur TS (`lib/amortissement-engine.ts`)
8. Hook (`hooks/useAmortissements.ts`)
9. Page + composants drawers (`components/amortissements/`)
10. Route + sidebar (`App.tsx`, `Sidebar.tsx`)
11. Intégration EditorPage (badges)
12. CLAUDE.md
