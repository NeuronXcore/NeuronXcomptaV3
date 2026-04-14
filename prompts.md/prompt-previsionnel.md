# Prompt Claude Code — Module "Prévisionnel"

## Pré-requis

Lis `CLAUDE.md` à la racine du projet avant toute implémentation.

---

## Objectif

Créer un module **Prévisionnel** qui fusionne et remplace l'Échéancier actuel. C'est un calendrier prévisionnel annuel de trésorerie qui croise trois sources :

1. **Charges attendues** — providers récurrents configurés (URSSAF, CARMF, assurance…) + agrégation par catégorie des opérations N-1 (filtré par seuil montant)
2. **Recettes projetées** — régression linéaire + coefficients saisonniers depuis les exercices précédents
3. **Réalisé** — opérations bancaires effectivement importées pour l'année en cours

Affiché sur une **timeline horizontale 12 mois** avec barres empilées (charges/recettes), expansion inline au clic, et courbe de trésorerie cumulée togglable.

Le module intègre aussi le **suivi des factures** (providers récurrents, scan OCR, matching prélèvements vs opérations bancaires) — pas de page Suivi Factures séparée.

---

## Ordre d'implémentation

1. Models Pydantic
2. Config
3. Service backend
4. Router backend
5. Intégrations (OCR, sandbox, GED, scheduler)
6. Types TypeScript
7. Hooks frontend
8. Composants page (3 onglets)
9. Routing + sidebar
10. Suppression ancien Échéancier
11. Mise à jour CLAUDE.md

---

## PHASE 1 — Suppression de l'ancien Échéancier

### Backend

- Supprimer `backend/routers/echeancier.py` (si existant)
- Supprimer `backend/services/echeancier_service.py` (si existant)
- Supprimer les models échéancier dans `backend/models/` (si existant)
- Retirer l'import et `include_router` de l'échéancier dans `backend/main.py`

### Frontend

- Supprimer `frontend/src/components/echeancier/EcheancierPage.tsx` (et tout le dossier `echeancier/`)
- Supprimer le hook `useEcheancier` dans `frontend/src/hooks/` (si fichier dédié)
- Supprimer la route `/echeancier` dans `App.tsx`
- Supprimer l'entrée "Échéancier" dans la sidebar (`Sidebar.tsx` → `NAV_SECTIONS`)
- Supprimer les types Échéancier dans `types/index.ts`

**Ne casser aucun import** — vérifier qu'aucun autre fichier ne référence l'Échéancier.

---

## PHASE 2 — Backend

### 2.1 Models (`backend/models/previsionnel.py`)

```python
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


# ─── Providers (configuration fournisseurs récurrents) ───

class PrevProvider(BaseModel):
    id: str
    fournisseur: str
    label: str
    mode: str = "facture"  # "facture" ou "echeancier"
    periodicite: str  # "mensuel", "bimestriel", "trimestriel", "semestriel", "annuel"
    mois_attendus: list[int]  # [1..12] pour mensuel, [1,4,7,10] pour trimestriel, etc.
    jour_attendu: int  # jour du mois
    delai_retard_jours: int  # jours après date_attendue pour passer en "en_retard"
    montant_estime: Optional[float] = None
    categorie: Optional[str] = None  # catégorie comptable
    keywords_ocr: list[str] = []  # mots-clés pour matching documents OCR/GED
    keywords_operations: list[str] = []  # mots-clés pour matching libellés bancaires (mode echeancier)
    tolerance_montant: float = 5.0  # tolérance € pour matching montant (mode echeancier)
    poste_comptable: Optional[str] = None
    actif: bool = True


class PrevProviderCreate(BaseModel):
    fournisseur: str
    label: str
    mode: str = "facture"
    periodicite: str
    mois_attendus: list[int]
    jour_attendu: int = 15
    delai_retard_jours: int = 15
    montant_estime: Optional[float] = None
    categorie: Optional[str] = None
    keywords_ocr: list[str] = []
    keywords_operations: list[str] = []
    tolerance_montant: float = 5.0
    poste_comptable: Optional[str] = None
    actif: bool = True


class PrevProviderUpdate(BaseModel):
    fournisseur: Optional[str] = None
    label: Optional[str] = None
    mode: Optional[str] = None
    periodicite: Optional[str] = None
    mois_attendus: Optional[list[int]] = None
    jour_attendu: Optional[int] = None
    delai_retard_jours: Optional[int] = None
    montant_estime: Optional[float] = None
    categorie: Optional[str] = None
    keywords_ocr: Optional[list[str]] = None
    keywords_operations: Optional[list[str]] = None
    tolerance_montant: Optional[float] = None
    poste_comptable: Optional[str] = None
    actif: Optional[bool] = None


# ─── Échéances (instances par période) ───

class PrevPrelevement(BaseModel):
    mois: int
    mois_label: str
    montant_attendu: float
    date_prevue: str  # YYYY-MM-DD
    statut: str  # "attendu", "verifie", "ecart", "non_preleve", "manuel"
    source: str = "manuel"  # "ocr" ou "manuel"
    ocr_confidence: Optional[float] = None
    operation_file: Optional[str] = None
    operation_index: Optional[int] = None
    operation_libelle: Optional[str] = None
    operation_date: Optional[str] = None
    montant_reel: Optional[float] = None
    ecart: Optional[float] = None
    match_auto: bool = False


class OcrExtractionResult(BaseModel):
    success: bool
    nb_lignes_extraites: int
    lignes: list[PrelevementLine]
    raw_text_snippet: str = ""
    warnings: list[str] = []


class PrevEcheance(BaseModel):
    id: str  # "{provider_id}-{year}-{periode}"
    provider_id: str
    periode_label: str
    date_attendue: str
    statut: str  # "attendu", "recu", "en_retard", "non_applicable"
    date_reception: Optional[str] = None
    document_ref: Optional[str] = None
    document_source: Optional[str] = None  # "justificatif" ou "ged"
    montant_reel: Optional[float] = None
    match_score: Optional[float] = None
    match_auto: bool = False
    note: str = ""
    # Mode écheancier uniquement :
    prelevements: list[PrevPrelevement] = []
    nb_prelevements_verifies: int = 0
    nb_prelevements_total: int = 0
    ocr_extraction: Optional[OcrExtractionResult] = None


class PrelevementLine(BaseModel):
    mois: int
    montant: float
    jour: Optional[int] = None
    ocr_confidence: Optional[float] = None


class PrelevementsInput(BaseModel):
    prelevements: list[PrelevementLine]


class LinkBody(BaseModel):
    document_ref: str
    document_source: str
    montant_reel: Optional[float] = None


# ─── Timeline (vue calendrier) ───

class TimelinePoste(BaseModel):
    id: str  # "provider:{provider_id}" ou "cat:{category_name}"
    label: str
    montant: float
    source: str  # "provider", "moyenne_n1", "realise", "projete"
    statut: str  # "verifie", "attendu", "ecart", "estime", "realise", "projete"
    provider_id: Optional[str] = None  # si source == "provider"
    document_ref: Optional[str] = None
    confidence: Optional[float] = None  # pour projections


class TimelineMois(BaseModel):
    mois: int
    label: str
    statut_mois: str  # "futur", "en_cours", "clos"
    charges: list[TimelinePoste]
    charges_total: float
    recettes: list[TimelinePoste]
    recettes_total: float
    solde: float
    solde_cumule: float


class TimelineResponse(BaseModel):
    year: int
    mois: list[TimelineMois]
    # KPIs annuels
    charges_annuelles: float
    recettes_annuelles: float
    solde_annuel: float
    taux_verification: float  # charges vérifiées / total charges providers


# ─── Paramètres du module ───

class PrevSettings(BaseModel):
    seuil_montant: float = 200.0  # minimum pour afficher une catégorie
    categories_exclues: list[str] = []
    categories_recettes: list[str] = []  # override auto-détection
    annees_reference: list[int] = []  # pour régression (ex: [2024, 2025])
    overrides_mensuels: dict[str, float] = {}  # "recettes-7": 8000 (override juillet)


# ─── Dashboard providers ───

class PrevDashboard(BaseModel):
    total_echeances: int
    recues: int
    en_attente: int
    en_retard: int
    non_applicable: int
    taux_completion: float
    montant_total_estime: float
    montant_total_reel: float
    prelevements_verifies: int
    prelevements_total: int
    prelevements_en_ecart: int
    taux_prelevements: float
```

**Note** : déclarer `PrelevementLine` avant `OcrExtractionResult` dans le fichier.

### 2.2 Config (`backend/core/config.py`)

Ajouter :

```python
PREVISIONNEL_DIR = DATA_DIR / "previsionnel"
PREV_PROVIDERS_FILE = PREVISIONNEL_DIR / "providers.json"
PREV_ECHEANCES_FILE = PREVISIONNEL_DIR / "echeances.json"
PREV_SETTINGS_FILE = PREVISIONNEL_DIR / "settings.json"
```

Ajouter `PREVISIONNEL_DIR` dans `ensure_directories()`.

### 2.3 Service (`backend/services/previsionnel_service.py`)

Service unifié. Fichiers JSON créés avec structure vide au premier accès.

#### Stockage

- `data/previsionnel/providers.json` : `{ "version": 1, "providers": [...] }`
- `data/previsionnel/echeances.json` : `{ "echeances": [...] }`
- `data/previsionnel/settings.json` : `PrevSettings` sérialisé

#### CRUD Providers

- `get_providers() -> list[PrevProvider]`
- `add_provider(data: PrevProviderCreate) -> PrevProvider` — id = slug de `fournisseur-periodicite`, suffixe numérique si conflit.
- `update_provider(provider_id, data: PrevProviderUpdate) -> PrevProvider`
- `delete_provider(provider_id)` — supprime aussi les échéances liées.

#### Échéances

- `refresh_echeances(year: int) -> dict` :
  - Mode `facture` : une échéance par mois dans `mois_attendus`.
  - Mode `echeancier` : une seule échéance par an.
  - ID : `{provider_id}-{year}-{periode}` (T1/T2/S1/01/02…). Mode écheancier : `{provider_id}-{year}`.
  - Ne pas écraser les échéances existantes.
  - Après génération, appeler `update_statuts_retard()`.

- `update_statuts_retard()` — `attendu` → `en_retard` si `date_attendue + delai_retard_jours < today`.

- `get_echeances(year, statut) -> list[PrevEcheance]`
- `link_echeance(echeance_id, body: LinkBody) -> PrevEcheance`
- `unlink_echeance(echeance_id) -> PrevEcheance`
- `dismiss_echeance(echeance_id, note) -> PrevEcheance`
- `get_dashboard(year) -> PrevDashboard`

#### Scan documents (OCR/GED → échéances)

- `scan_matching() -> dict` — parcourt `.ocr.json` (justificatifs) et `ged_metadata.json`, matche contre échéances `attendu`/`en_retard` par keywords OCR + date + montant. Seuil auto-association : **score >= 0.75 et match unique**. Score = 50% keywords + 30% date + 20% montant.

- `check_single_document(filename, source)` — version ciblée post-OCR.

**Chaînage mode écheancier** : quand un document est auto-associé à une échéance de type `echeancier`, appeler automatiquement `auto_populate_from_ocr(echeance_id)`.

#### Parsing OCR échéancier

```python
def parse_echeancier_ocr(ocr_text: str, provider: PrevProvider, year: int) -> OcrExtractionResult:
    """
    Parse le texte OCR d'un document échéancier pour extraire les lignes mensuelles.
    
    3 formats supportés :
    
    Format 1 (tableau mois + montant) :
        Janvier     15/01/2026     850,00
        Février     15/02/2026     850,00
    
    Format 2 (ligne compacte avec date) :
        Prélèvement du 15/01/2026 : 850,00 €
    
    Format 3 (mois numérique) :
        01/2026    850,00 €
        02/2026    920,00 €
    
    Algorithme :
    1. Pour chaque ligne, chercher un mois (texte ou numérique) ET un montant
    2. Patterns :
       - Mois texte : r'(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)'
         (+ variantes sans accents : fevrier, aout)
       - Mois numérique : r'(\d{2})[/-](?:\d{2}[/-])?\d{4}'
       - Montant : r'(\d[\d\s]*\d),(\d{2})' ou r'(\d+),(\d{2})'
    3. Confiance : 1.0 si mois texte clair, 0.7 si mois numérique, 0.5 si ambigu
    4. Dédupliquer par mois (garder meilleure confiance)
    5. Succès si >= 6 mois trouvés sur 12
    6. Warnings pour chaque mois manquant
    """
```

- `auto_populate_from_ocr(echeance_id) -> OcrExtractionResult` :
  1. Charger le texte OCR du document lié (`document_ref`)
  2. Appeler `parse_echeancier_ocr()`
  3. Si succès : `set_prelevements()` avec `source="ocr"` puis `scan_prelevements()`
  4. Stocker `OcrExtractionResult` dans l'échéance

#### Prélèvements (mode écheancier)

- `set_prelevements(echeance_id, data, source="manuel")` — crée/MAJ les prélèvements mensuels. Ne pas écraser les prélèvements déjà `verifie`/`ecart`/`manuel`.

- `scan_prelevements(echeance_id) -> dict` — pour chaque prélèvement `attendu`, chercher dans les opérations bancaires :
  - Filtrer par mois (metadata year/month du fichier)
  - Match : libellé contient un `keywords_operations` ET `abs(debit - montant_attendu) <= tolerance_montant`
  - Match unique → `verifie` (ou `ecart` si écart != 0)
  - Retourne `{ "scanned": N, "matched": M, "ecarts": E }`

- `scan_all_prelevements(year) -> dict` — lance scan_prelevements pour toutes les échéances mode écheancier de l'année.

- `verify_prelevement(echeance_id, mois, operation_file?, operation_index?, montant_reel?)` — override manuel.
- `unverify_prelevement(echeance_id, mois)` — repasse en `attendu`.

#### Timeline (calcul principal)

```python
def get_timeline(year: int) -> TimelineResponse:
    """
    Construit la vue timeline 12 mois.
    
    Pour chaque mois 1-12 :
    
    1. STATUT MOIS :
       - "clos" si mois < mois_courant (ou si un relevé importé existe)
       - "en_cours" si mois == mois_courant
       - "futur" si mois > mois_courant
    
    2. CHARGES :
       a. Providers (mode facture) : montant de l'échéance du mois
          - statut = statut de l'échéance ("verifie"/"attendu"/"ecart"/etc.)
       b. Providers (mode echeancier) : montant du prélèvement du mois
          - statut = statut du prélèvement
       c. Catégories N-1 au-dessus du seuil :
          - Charger les opérations de l'année N-1 (et N-2 si disponible)
          - Grouper par catégorie × mois
          - Pour chaque catégorie où la moyenne mensuelle > seuil :
            - Si mois clos → montant réel depuis les opérations importées de l'année en cours
            - Si mois futur → moyenne du même mois en N-1 (source="moyenne_n1", statut="estime")
          - Exclure les catégories dans settings.categories_exclues
          - Exclure les catégories identifiées comme recettes
    
    3. RECETTES :
       a. Déterminer les catégories recettes :
          - Si settings.categories_recettes non vide → utiliser cette liste
          - Sinon → auto-détection : catégories où total_credit > total_debit historiquement
       b. Pour chaque catégorie recettes :
          - Si mois clos → montant réel (credit) depuis les opérations importées
          - Si mois futur → projection via régression linéaire + saisonnalité :
            - Charger les données mensuelles des années dans settings.annees_reference
              (si vide, utiliser toutes les années disponibles)
            - Régression linéaire : trend = slope × mois_absolu + intercept
            - Coefficient saisonnier : moyenne(mois_M) / moyenne_globale
            - Projection = trend × coeff_saisonnier
            - Confidence = R² de la régression (clampé 0-1)
          - Si override dans settings.overrides_mensuels → utiliser l'override (source="override")
    
    4. SOLDE : recettes_total - charges_total
    5. SOLDE CUMULÉ : somme des soldes depuis janvier
    
    Retourne TimelineResponse avec les 12 mois + KPIs annuels.
    """
```

#### Paramètres

- `get_settings() -> PrevSettings`
- `update_settings(data: PrevSettings) -> PrevSettings`

### 2.4 Router (`backend/routers/previsionnel.py`)

Préfixe : `/api/previsionnel`

| Méthode | Route | Description |
|---------|-------|-------------|
| **Timeline** | | |
| `GET` | `/timeline` | Vue 12 mois. Query: `year` (int, required) |
| **Providers** | | |
| `GET` | `/providers` | Liste providers |
| `POST` | `/providers` | Ajouter (body: `PrevProviderCreate`) |
| `PUT` | `/providers/{id}` | Modifier (body: `PrevProviderUpdate`) |
| `DELETE` | `/providers/{id}` | Supprimer + échéances liées |
| **Échéances** | | |
| `GET` | `/echeances` | Filtrées. Query: `year`, `statut` (optional) |
| `GET` | `/dashboard` | KPIs. Query: `year` (required) |
| `POST` | `/scan` | Scanner documents + prélèvements |
| `POST` | `/refresh` | Régénérer échéances. Query: `year` (required) |
| `POST` | `/echeances/{id}/link` | Association manuelle (body: `LinkBody`) |
| `POST` | `/echeances/{id}/unlink` | Dissociation |
| `POST` | `/echeances/{id}/dismiss` | Non applicable. Body: `{ "note": "..." }` |
| **Prélèvements** | | |
| `POST` | `/echeances/{id}/prelevements` | Saisir montants (body: `PrelevementsInput`) |
| `POST` | `/echeances/{id}/auto-populate` | Forcer re-parsing OCR |
| `POST` | `/echeances/{id}/scan-prelevements` | Scanner vs opérations |
| `POST` | `/echeances/{id}/prelevements/{mois}/verify` | Vérification manuelle |
| `POST` | `/echeances/{id}/prelevements/{mois}/unverify` | Annuler vérification |
| **Paramètres** | | |
| `GET` | `/settings` | Charger paramètres |
| `PUT` | `/settings` | Sauvegarder (body: `PrevSettings`) |

### 2.5 Enregistrement (`backend/main.py`)

```python
from backend.routers import previsionnel
app.include_router(previsionnel.router, prefix="/api/previsionnel", tags=["previsionnel"])
```

### 2.6 Intégration APScheduler

Dans le `lifespan` de `main.py` (à côté du watchdog) :

```python
from apscheduler.schedulers.background import BackgroundScheduler
from backend.services import previsionnel_service

scheduler = BackgroundScheduler()

def scheduled_prev_scan():
    import datetime
    year = datetime.date.today().year
    previsionnel_service.refresh_echeances(year)
    previsionnel_service.update_statuts_retard()
    previsionnel_service.scan_matching()
    previsionnel_service.scan_all_prelevements(year)

scheduler.add_job(scheduled_prev_scan, 'interval', hours=1, id='previsionnel_scan')
scheduler.start()
# shutdown dans le finally du lifespan
```

### 2.7 Intégration post-OCR

Dans `backend/routers/ocr.py` (après extraction réussie dans `batch_upload` et `extract`) :

```python
try:
    previsionnel_service.check_single_document(filename, "justificatif")
except Exception:
    pass  # ne pas bloquer le pipeline
```

Idem dans `backend/services/sandbox_service.py` après traitement sandbox.
Idem dans `backend/routers/ged.py` après `POST /upload`.

---

## PHASE 3 — Frontend

### 3.1 Types (`frontend/src/types/index.ts`)

Supprimer les types Échéancier existants. Ajouter :

```typescript
// ─── Prévisionnel ───

export interface PrevProvider {
  id: string;
  fournisseur: string;
  label: string;
  mode: 'facture' | 'echeancier';
  periodicite: 'mensuel' | 'bimestriel' | 'trimestriel' | 'semestriel' | 'annuel';
  mois_attendus: number[];
  jour_attendu: number;
  delai_retard_jours: number;
  montant_estime: number | null;
  categorie: string | null;
  keywords_ocr: string[];
  keywords_operations: string[];
  tolerance_montant: number;
  poste_comptable: string | null;
  actif: boolean;
}

export interface PrevProviderCreate {
  fournisseur: string;
  label: string;
  mode?: string;
  periodicite: string;
  mois_attendus: number[];
  jour_attendu?: number;
  delai_retard_jours?: number;
  montant_estime?: number | null;
  categorie?: string | null;
  keywords_ocr?: string[];
  keywords_operations?: string[];
  tolerance_montant?: number;
  poste_comptable?: string | null;
  actif?: boolean;
}

export interface PrevPrelevement {
  mois: number;
  mois_label: string;
  montant_attendu: number;
  date_prevue: string;
  statut: 'attendu' | 'verifie' | 'ecart' | 'non_preleve' | 'manuel';
  source: 'ocr' | 'manuel';
  ocr_confidence: number | null;
  operation_file: string | null;
  operation_index: number | null;
  operation_libelle: string | null;
  operation_date: string | null;
  montant_reel: number | null;
  ecart: number | null;
  match_auto: boolean;
}

export interface OcrExtractionResult {
  success: boolean;
  nb_lignes_extraites: number;
  lignes: PrelevementLine[];
  raw_text_snippet: string;
  warnings: string[];
}

export interface PrelevementLine {
  mois: number;
  montant: number;
  jour?: number;
  ocr_confidence?: number;
}

export interface PrevEcheance {
  id: string;
  provider_id: string;
  periode_label: string;
  date_attendue: string;
  statut: 'attendu' | 'recu' | 'en_retard' | 'non_applicable';
  date_reception: string | null;
  document_ref: string | null;
  document_source: string | null;
  montant_reel: number | null;
  match_score: number | null;
  match_auto: boolean;
  note: string;
  prelevements: PrevPrelevement[];
  nb_prelevements_verifies: number;
  nb_prelevements_total: number;
  ocr_extraction: OcrExtractionResult | null;
}

export interface TimelinePoste {
  id: string;
  label: string;
  montant: number;
  source: 'provider' | 'moyenne_n1' | 'realise' | 'projete' | 'override';
  statut: 'verifie' | 'attendu' | 'ecart' | 'estime' | 'realise' | 'projete';
  provider_id: string | null;
  document_ref: string | null;
  confidence: number | null;
}

export interface TimelineMois {
  mois: number;
  label: string;
  statut_mois: 'futur' | 'en_cours' | 'clos';
  charges: TimelinePoste[];
  charges_total: number;
  recettes: TimelinePoste[];
  recettes_total: number;
  solde: number;
  solde_cumule: number;
}

export interface TimelineResponse {
  year: number;
  mois: TimelineMois[];
  charges_annuelles: number;
  recettes_annuelles: number;
  solde_annuel: number;
  taux_verification: number;
}

export interface PrevSettings {
  seuil_montant: number;
  categories_exclues: string[];
  categories_recettes: string[];
  annees_reference: number[];
  overrides_mensuels: Record<string, number>;
}

export interface PrevDashboard {
  total_echeances: number;
  recues: number;
  en_attente: number;
  en_retard: number;
  non_applicable: number;
  taux_completion: number;
  montant_total_estime: number;
  montant_total_reel: number;
  prelevements_verifies: number;
  prelevements_total: number;
  prelevements_en_ecart: number;
  taux_prelevements: number;
}
```

### 3.2 Hooks (`frontend/src/hooks/usePrevisionnel.ts`)

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  PrevProvider, PrevProviderCreate, PrevEcheance, PrevDashboard,
  TimelineResponse, PrevSettings, PrelevementLine, OcrExtractionResult,
} from '../types';

const KEY = ['previsionnel'];

// ─── Timeline ───

export function useTimeline(year: number) {
  return useQuery<TimelineResponse>({
    queryKey: [...KEY, 'timeline', year],
    queryFn: () => api.get(`/previsionnel/timeline?year=${year}`),
  });
}

// ─── Providers ───

export function useProviders() {
  return useQuery<PrevProvider[]>({
    queryKey: [...KEY, 'providers'],
    queryFn: () => api.get('/previsionnel/providers'),
  });
}

export function useAddProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PrevProviderCreate) => api.post('/previsionnel/providers', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PrevProvider> }) =>
      api.put(`/previsionnel/providers/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/previsionnel/providers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

// ─── Échéances ───

export function useEcheances(year?: number, statut?: string) {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (statut) params.set('statut', statut);
  const qs = params.toString();
  return useQuery<PrevEcheance[]>({
    queryKey: [...KEY, 'echeances', year, statut],
    queryFn: () => api.get(`/previsionnel/echeances${qs ? `?${qs}` : ''}`),
  });
}

export function usePrevDashboard(year: number) {
  return useQuery<PrevDashboard>({
    queryKey: [...KEY, 'dashboard', year],
    queryFn: () => api.get(`/previsionnel/dashboard?year=${year}`),
  });
}

// ─── Actions ───

export function useScanPrev() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/previsionnel/scan'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useRefreshEcheances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => api.post(`/previsionnel/refresh?year=${year}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useLinkEcheance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { document_ref: string; document_source: string; montant_reel?: number } }) =>
      api.post(`/previsionnel/echeances/${id}/link`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useUnlinkEcheance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/previsionnel/echeances/${id}/unlink`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useDismissEcheance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/previsionnel/echeances/${id}/dismiss`, { note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

// ─── Prélèvements ───

export function useSetPrelevements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, prelevements }: { id: string; prelevements: PrelevementLine[] }) =>
      api.post(`/previsionnel/echeances/${id}/prelevements`, { prelevements }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useAutoPopulateOcr() {
  const qc = useQueryClient();
  return useMutation<OcrExtractionResult, Error, string>({
    mutationFn: (id: string) => api.post(`/previsionnel/echeances/${id}/auto-populate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useScanPrelevements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/previsionnel/echeances/${id}/scan-prelevements`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useVerifyPrelevement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mois, body }: {
      id: string; mois: number;
      body?: { operation_file?: string; operation_index?: number; montant_reel?: number };
    }) => api.post(`/previsionnel/echeances/${id}/prelevements/${mois}/verify`, body ?? {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useUnverifyPrelevement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mois }: { id: string; mois: number }) =>
      api.post(`/previsionnel/echeances/${id}/prelevements/${mois}/unverify`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

// ─── Settings ───

export function usePrevSettings() {
  return useQuery<PrevSettings>({
    queryKey: [...KEY, 'settings'],
    queryFn: () => api.get('/previsionnel/settings'),
  });
}

export function useUpdatePrevSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PrevSettings) => api.put('/previsionnel/settings', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}
```

### 3.3 Page — Structure (`frontend/src/components/previsionnel/`)

Créer les fichiers suivants dans `frontend/src/components/previsionnel/` :

| Fichier | Description |
|---------|-------------|
| `PrevisionnelPage.tsx` | Page principale avec 3 onglets |
| `TimelineTab.tsx` | Onglet Timeline (graphique + expansion) |
| `TimelineChart.tsx` | Le ComposedChart Recharts |
| `MonthExpansion.tsx` | Zone d'expansion inline sous le graphique |
| `FournisseursTab.tsx` | Onglet Fournisseurs (cartes + CRUD) |
| `ProviderDrawer.tsx` | Drawer ajout/édition provider (600px) |
| `PrelevementsGrid.tsx` | Grille 12 mois prélèvements |
| `PrelevementsDrawer.tsx` | Saisie/correction montants (600px) |
| `PrelevementOperationDrawer.tsx` | Lier un prélèvement à une opération (600px) |
| `LinkDocumentDrawer.tsx` | Lier un document à une échéance (600px) |
| `SettingsTab.tsx` | Onglet Paramètres |
| `StatusBadge.tsx` | Badge statut réutilisable |

### 3.4 Onglet Timeline (`TimelineTab.tsx`)

#### En-tête

- Sélecteur année (select)
- Seuil montant (input number, valeur depuis `usePrevSettings`, onChange met à jour via `useUpdatePrevSettings`)
- Toggle "Trésorerie cumulée" (état local `useState`)
- Bouton "Scanner" (icône `Search`) → `useScanPrev` → toast résultat
- Bouton "Actualiser" (icône `RefreshCw`) → `useRefreshEcheances(year)` → toast

#### KPIs

4 `MetricCard` en `grid grid-cols-4 gap-4` :
- Charges prévues (icône `ArrowDownCircle`, rouge)
- Recettes projetées (icône `ArrowUpCircle`, vert)
- Solde prévisionnel (icône `Scale`, couleur selon signe)
- Taux vérification charges (icône `ShieldCheck`, pourcentage)

#### Graphique (`TimelineChart.tsx`)

Utiliser Recharts `ComposedChart` avec `ResponsiveContainer` :

```tsx
<ComposedChart data={chartData}>
  <XAxis dataKey="label" />
  <YAxis />
  <Tooltip />
  {/* Barres empilées vers le haut = recettes */}
  <Bar dataKey="recettes_total" stackId="a" fill="var(--color-green)" fillOpacity={/* 1 si clos, 0.4 si futur */} />
  {/* Barres empilées vers le bas = charges (valeurs négatives) */}
  <Bar dataKey="charges_neg" stackId="a" fill="var(--color-red)" fillOpacity={/* 1 si clos, 0.4 si futur */} />
  {/* Courbe trésorerie cumulée (togglable) */}
  {showCumul && <Line type="monotone" dataKey="solde_cumule" stroke="var(--color-primary)" strokeDasharray="5 5" dot={false} />}
  {/* Référence line à 0 */}
  <ReferenceLine y={0} stroke="var(--color-border)" />
</ComposedChart>
```

**Transformation des données** : `charges_neg = -charges_total` pour que les barres descendent sous l'axe 0.

Chaque barre est cliquable (`onClick`) → met à jour `selectedMonth` (état remonté depuis `TimelineTab`).

Mois en cours : barre avec `stroke` blanc épais (`strokeWidth: 2`).

**Labels** : au-dessus de chaque barre, afficher le `solde` formaté (positif vert, négatif rouge). Utiliser Recharts `<Label>` ou une custom `renderCustomBarLabel`.

#### Expansion inline (`MonthExpansion.tsx`)

S'affiche sous le graphique quand `selectedMonth !== null`. Transition `max-height` + `opacity` pour smooth open/close.

**Layout** : `grid grid-cols-2 gap-6`

**Colonne Charges** :
- Titre "Charges — {mois_label}" avec total
- Liste des `TimelinePoste` charges, triés par montant décroissant :
  - Chaque ligne : icône source (provider = `Building2`, estimé = `Calculator`, réalisé = `Receipt`), label, montant formaté, `StatusBadge`
  - Cliquable si `provider_id` → toggle expansion sous-détail (document lié, opération, écart)

**Colonne Recettes** :
- Titre "Recettes — {mois_label}" avec total
- Liste des `TimelinePoste` recettes :
  - Chaque ligne : label catégorie, montant, badge source (`réalisé` vert / `projeté` bleu / `override` violet)
  - Si `confidence` < 0.5 → icône warning
  
**Ligne résumé** en bas : Total charges | Total recettes | **Solde mois** (gras, couleur selon signe)

**Bouton fermer** : `X` en haut à droite.

### 3.5 Onglet Fournisseurs (`FournisseursTab.tsx`)

**Bouton "Ajouter"** (icône `Plus`) → ouvre `ProviderDrawer`.

**Liste providers** : `grid grid-cols-1 lg:grid-cols-2 gap-4`, cartes :
- Header : nom fournisseur + badge mode (`facture` / `échéancier`) + badge périodicité
- Body : label, keywords OCR comme tags, catégorie, montant estimé
- Footer : toggle actif + boutons Modifier / Supprimer
- Inactive : `opacity-50`

**Pour les providers mode échéancier**, sous chaque carte : section expandable avec les échéances de l'année courante :
- Statut réception document + barre progression prélèvements
- `PrelevementsGrid` (grille 12 mois) si prélèvements saisis
- Boutons "Scanner opérations" / "Corriger montants" / "Re-extraire OCR"

#### `ProviderDrawer.tsx` (600px)

Formulaire avec :
- **Mode** : select "Facture récurrente" / "Échéancier de prélèvements"
- **Fournisseur** : input text (required)
- **Label** : input text (required)
- **Périodicité** : select → pré-remplit `mois_attendus` auto (mensuel=[1..12], trimestriel=[1,4,7,10], etc.)
- **Mois attendus** : multi-select 12 mois (masqué en mode écheancier)
- **Jour du mois** : input number 1-28 (défaut 15)
- **Délai retard** : input number (défaut 15)
- **Montant estimé** : input number (optional)
- **Catégorie** : select depuis `GET /api/categories`
- **Keywords OCR** : input tags (Enter pour ajouter)
- Champs **mode écheancier uniquement** :
  - **Keywords opérations** : input tags
  - **Tolérance montant (€)** : input number (défaut 5)
- **Poste comptable** : select depuis `GET /api/ged/postes`
- **Actif** : toggle

#### `PrelevementsGrid.tsx`

Grille `grid grid-cols-6 gap-2` (2 lignes de 6) :
- Mini-carte par mois avec : label mois, montant attendu, statut (badge + fond coloré)
- Fond vert = vérifié, orange = écart, transparent = attendu, rouge = non_preleve, bleu = manuel
- OCR confiance < 0.7 → `⚠` orange à côté du montant
- Clic → popover avec actions (vérifier manuellement, lier opération, non prélevé, annuler)

#### `PrelevementsDrawer.tsx` (600px)

- 12 lignes : mois, input montant, input jour, indicateur confiance OCR
- Bandeau bleu si source OCR
- Raccourci "Appliquer à tous" : un input → remplit les 12
- Raccourci "Deux montants" : S1/S2
- Enregistrer → `useSetPrelevements` + auto `useScanPrelevements`

### 3.6 Onglet Paramètres (`SettingsTab.tsx`)

Formulaire avec `usePrevSettings` / `useUpdatePrevSettings` :

- **Seuil montant minimum** : input number + slider (0-1000€, step 50). "Les catégories sous ce seuil n'apparaissent pas dans la timeline."
- **Catégories à exclure** : multi-select depuis la liste des catégories
- **Catégories recettes** : multi-select. Note "Laisser vide pour auto-détection (crédit > débit)."
- **Années de référence** : multi-select des années disponibles (depuis `GET /api/operations/files`). Note "Pour la régression et les moyennes N-1."
- **Coefficients saisonniers** : tableau lecture seule 12 mois (calculés par le backend), affichés pour vérification. Valeurs entre 0.5 et 1.5 typiquement.
- **Overrides mensuels** : grille 12 mois avec inputs. Clé = `"recettes-{mois}"` ou `"charges-{mois}"`. Vide = pas d'override.

Bouton "Enregistrer" en bas.

### 3.7 Routing (`frontend/src/App.tsx`)

```tsx
import PrevisionnelPage from './components/previsionnel/PrevisionnelPage';

<Route path="/previsionnel" element={<PrevisionnelPage />} />
```

Supprimer la route `/echeancier`.

### 3.8 Sidebar (`frontend/src/components/layout/Sidebar.tsx`)

Dans `NAV_SECTIONS` :

1. **Supprimer** l'entrée Échéancier du groupe TRAITEMENT
2. **Ajouter** dans le groupe ANALYSE, entre Dashboard et Compta Analytique :

```tsx
{ path: '/previsionnel', label: 'Prévisionnel', icon: TrendingUp }
```

Importer `TrendingUp` depuis `lucide-react`.

---

## PHASE 4 — Mise à jour CLAUDE.md

Mettre à jour les sections suivantes de `CLAUDE.md` :

- **Sidebar Navigation** : remplacer "Échéancier" par "Prévisionnel" dans le groupe ANALYSE
- **Backend API Endpoints** : supprimer la ligne échéancier, ajouter la ligne previsionnel
- **Frontend Routes** : remplacer `/echeancier` par `/previsionnel` avec la bonne description
- **Hooks** : remplacer `useEcheancier` par `usePrevisionnel`
- **Project Structure** : mettre à jour les compteurs fichiers si nécessaire

---

## Conventions

- **Python 3.9** : `from __future__ import annotations` en tête de tous les fichiers backend
- **Optional** : `Optional[X]` et non `X | None`
- **PageHeader** : prop `actions` pour les boutons
- **Dark theme** : classes CSS custom (`bg-background`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`)
- **Toasts** : `react-hot-toast` (`toast.success()`, `toast.error()`)
- **Drawers** : pattern `translateX` + backdrop, transition 300ms
- **Icônes** : Lucide React
- **TanStack Query** : invalidation sur `['previsionnel']`
- **Pas de `any`** en TypeScript
- **Formatage** : `formatCurrency` depuis `lib/utils.ts`
- **Recharts** : `ComposedChart` avec `ResponsiveContainer`, couleurs via CSS variables

---

## Checklist de vérification

### Suppressions
- [ ] Ancien échéancier backend (router, service, models) supprimé
- [ ] Ancien échéancier frontend (page, hooks, types, route, sidebar) supprimé
- [ ] Aucun import cassé après suppression

### Backend Prévisionnel
- [ ] `providers.json`, `echeances.json`, `settings.json` créés auto au premier accès
- [ ] CRUD providers fonctionne
- [ ] `POST /refresh?year=2026` génère les échéances (mode facture : N par an, mode echeancier : 1 par an)
- [ ] Échéances existantes non écrasées par refresh
- [ ] `POST /scan` parcourt OCR + GED, auto-associe documents score >= 0.75
- [ ] Chaînage mode échéancier : association document → parse OCR → populate prélèvements → scan opérations
- [ ] `parse_echeancier_ocr` gère les 3 formats
- [ ] Scan prélèvements matche par keywords_operations + montant ± tolérance
- [ ] Statuts `en_retard` mis à jour automatiquement
- [ ] Scheduler APScheduler toutes les heures sans bloquer
- [ ] `check_single_document` post-OCR/sandbox/GED en try/except
- [ ] `GET /timeline?year=2026` retourne 12 mois avec charges + recettes + soldes cumulés
- [ ] Mois clos : données réelles depuis opérations importées
- [ ] Mois futurs : moyennes N-1 pour charges, régression + saisonnalité pour recettes
- [ ] Seuil montant filtre les catégories correctement
- [ ] Categories_exclues et categories_recettes respectées
- [ ] Overrides mensuels appliqués quand renseignés

### Frontend Prévisionnel
- [ ] 3 onglets fonctionnels (Timeline, Fournisseurs, Paramètres)
- [ ] Timeline : barres empilées charges (rouge bas) / recettes (vert haut)
- [ ] Mois futurs en opacité réduite, mois en cours avec bordure
- [ ] Courbe trésorerie cumulée togglable
- [ ] Clic barre → expansion inline avec détail charges/recettes
- [ ] KPIs annuels corrects
- [ ] Fournisseurs : CRUD complet avec drawer
- [ ] Mode écheancier : grille 12 mois, auto-extraction OCR, scan opérations
- [ ] Paramètres : seuil, exclusions, recettes, années référence, overrides
- [ ] Route `/previsionnel` accessible
- [ ] Sidebar : entrée dans ANALYSE entre Dashboard et Compta Analytique
- [ ] `npx tsc --noEmit` passe sans erreur
- [ ] Le backend démarre sans erreur
