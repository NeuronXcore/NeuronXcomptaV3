# Prompt Claude Code — Module GED (Bibliothèque Documentaire)

## Instruction initiale

Lis `CLAUDE.md` à la racine du projet avant de commencer. Respecte toutes les conventions (Python 3.9 + `from __future__ import annotations`, dark theme CSS variables, TanStack Query, PageHeader avec `actions`, drawers translateX, Lucide icons, react-hot-toast).

---

## Objectif

Créer un module **GED (Gestion Électronique de Documents)** = page unique de bibliothèque documentaire qui **indexe** tous les documents existants (relevés, justificatifs, rapports) + permet l'**upload de documents libres** (courriers fiscaux, contrats, etc.). Chaque document est rattaché à un **poste comptable** avec un **% de déductibilité** configurable par slider.

Aucune duplication de fichier — la GED lit les documents depuis leurs emplacements existants et stocke uniquement les métadonnées enrichies dans `data/ged/ged_metadata.json`.

---

## 1. Backend — Models

### Fichier : `backend/models/ged.py`

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional

class PosteComptable(BaseModel):
    id: str
    label: str
    deductible_pct: int  # 0-100, pas de 5
    categories_associees: list[str]  # catégories ML liées
    notes: str = ""
    is_system: bool = True  # False pour les postes custom

class PostesConfig(BaseModel):
    version: int = 1
    exercice: int
    postes: list[PosteComptable]

class GedDocument(BaseModel):
    doc_id: str  # chemin relatif = clé unique
    type: str  # "releve", "justificatif", "rapport", "document_libre"
    year: Optional[int] = None
    month: Optional[int] = None
    poste_comptable: Optional[str] = None  # id du poste
    montant_brut: Optional[float] = None
    deductible_pct_override: Optional[int] = None  # surcharge du % poste, null = hérite
    tags: list[str] = []
    notes: str = ""
    added_at: str = ""
    original_name: Optional[str] = None
    ocr_file: Optional[str] = None

class GedMetadata(BaseModel):
    version: int = 1
    documents: dict[str, GedDocument] = {}

class GedTreeNode(BaseModel):
    id: str
    label: str
    count: int = 0
    children: list[GedTreeNode] = []
    icon: Optional[str] = None  # nom icône Lucide

class GedUploadRequest(BaseModel):
    type: str = "document_libre"
    year: Optional[int] = None
    month: Optional[int] = None
    poste_comptable: Optional[str] = None
    tags: list[str] = []
    notes: str = ""

class GedDocumentUpdate(BaseModel):
    poste_comptable: Optional[str] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None
    montant_brut: Optional[float] = None
    deductible_pct_override: Optional[int] = None

class GedSearchResult(BaseModel):
    doc_id: str
    document: GedDocument
    match_context: str = ""  # extrait OCR ou nom fichier
    score: float = 0.0
```

---

## 2. Backend — Service

### Fichier : `backend/services/ged_service.py`

Responsabilités :
- Charger/sauvegarder `data/ged/ged_metadata.json` et `data/ged/ged_postes.json`
- **Scanner les sources existantes** pour construire l'index (sans dupliquer les fichiers) :
  - `data/imports/releves/*.pdf` → type "releve", année/mois déduits des metadata opérations
  - `data/justificatifs/en_attente/*.pdf` + `traites/*.pdf` → type "justificatif"
  - `data/reports/*` → type "rapport", poste déduit du filtre catégorie s'il existe
- Gérer l'upload de documents libres dans `data/ged/{year}/{month}/`
- Construire l'arborescence (tree) dynamiquement
- Recherche full-text dans noms de fichiers + contenu `.ocr.json`
- Calcul des stats (totaux brut/déductible par poste)

#### Fonctions clés :

```python
def ensure_ged_directories() -> None:
    """Crée data/ged/ si nécessaire."""

def load_metadata() -> dict:
    """Charge ged_metadata.json, retourne {} si inexistant."""

def save_metadata(metadata: dict) -> None:
    """Sauvegarde ged_metadata.json."""

def load_postes(exercice: Optional[int] = None) -> dict:
    """Charge ged_postes.json. Crée avec les postes par défaut si inexistant."""

def save_postes(postes: dict) -> None:
    """Sauvegarde ged_postes.json."""

def get_default_postes(exercice: int) -> dict:
    """Retourne les postes par défaut avec % déductibilité."""

def scan_all_sources() -> dict:
    """Scanne relevés, justificatifs, rapports. Merge avec metadata existant.
    Nouveaux docs détectés = ajoutés. Docs supprimés = retirés.
    Retourne le metadata mis à jour."""

def build_tree(metadata: dict, postes: dict) -> list[dict]:
    """Construit l'arborescence pour le frontend.
    Nœuds racine : Relevés, Justificatifs, Rapports, Documents libres.
    Justificatifs a deux sous-arbres : Par date et Par poste comptable.
    Rapports classés par poste comptable (via categories_associees du poste)."""

def get_documents(
    metadata: dict,
    type_filter: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    poste_comptable: Optional[str] = None,
    tags: Optional[list[str]] = None,
    search: Optional[str] = None,
    sort_by: str = "added_at",
    sort_order: str = "desc"
) -> list[dict]:
    """Liste filtrée + triée des documents."""

def upload_document(file_content: bytes, filename: str, request: dict) -> dict:
    """Upload dans data/ged/{year}/{month}/.
    Gestion doublons filename (suffix timestamp).
    Lance OCR si disponible.
    Crée l'entrée metadata.
    Retourne le doc créé."""

def update_document(doc_id: str, updates: dict) -> dict:
    """Met à jour les metadata d'un document."""

def delete_document(doc_id: str) -> bool:
    """Supprime un document libre (fichier + metadata).
    Refuse de supprimer les relevés/justificatifs/rapports (gérés par leur module)."""

def search_fulltext(query: str, metadata: dict) -> list[dict]:
    """Recherche dans : noms fichiers, tags, notes, contenu OCR (.ocr.json).
    Retourne les résultats avec contexte (extrait)."""

def get_stats(metadata: dict, postes: dict) -> dict:
    """Stats par poste : nb docs, total brut, total déductible, espace disque."""

def resolve_poste_for_document(doc: dict, postes: dict) -> Optional[str]:
    """Pour un justificatif associé à une opération catégorisée,
    retrouve le poste comptable via categories_associees."""

def get_file_path(doc_id: str) -> Optional[str]:
    """Résout le chemin absolu d'un document pour le servir."""

def generate_thumbnail(doc_id: str) -> Optional[str]:
    """Génère un thumbnail PNG de la première page du PDF.
    Utilise pdf2image (déjà installé) : convert_from_path(path, first_page=1, last_page=1, size=(200, None)).
    Stocke dans data/ged/thumbnails/{hash_doc_id}.png.
    Retourne le chemin du thumbnail, ou None si échec (fichier non-PDF, corrompu).
    Si le thumbnail existe déjà et est plus récent que le PDF source, le retourne sans regénérer."""

def get_thumbnail_path(doc_id: str) -> Optional[str]:
    """Retourne le chemin du thumbnail s'il existe, sinon appelle generate_thumbnail().
    Fallback : retourne None (le frontend affichera une icône générique)."""

def open_in_native_app(doc_id: str) -> bool:
    """Ouvre le document dans l'application native macOS (Aperçu pour les PDF).
    Utilise subprocess.Popen(["open", absolute_path]).
    Retourne True si la commande a été lancée, False si le fichier n'existe pas.
    Note : fonctionne car le serveur tourne sur la même machine macOS."""
```

#### Postes par défaut :

```python
DEFAULT_POSTES = [
    {"id": "loyer-cabinet", "label": "Loyer & charges cabinet", "deductible_pct": 100, "categories_associees": ["Loyer"], "notes": "", "is_system": True},
    {"id": "loyer-domicile", "label": "Loyer domicile (quote-part pro)", "deductible_pct": 20, "categories_associees": [], "notes": "Prorata surface bureau / logement", "is_system": True},
    {"id": "vehicule", "label": "Véhicule (carburant, entretien, leasing)", "deductible_pct": 70, "categories_associees": ["Transport", "Véhicule"], "notes": "", "is_system": True},
    {"id": "telephone", "label": "Téléphone mobile", "deductible_pct": 60, "categories_associees": ["Téléphone", "Télécommunications"], "notes": "Usage mixte", "is_system": True},
    {"id": "internet-domicile", "label": "Internet domicile", "deductible_pct": 20, "categories_associees": ["Internet"], "notes": "= prorata surface bureau", "is_system": True},
    {"id": "assurance-rcp", "label": "Assurance RCP", "deductible_pct": 100, "categories_associees": ["Assurance"], "notes": "", "is_system": True},
    {"id": "charges-sociales", "label": "Charges sociales (URSSAF, CARMF, ODM)", "deductible_pct": 100, "categories_associees": ["Charges sociales", "URSSAF", "CARMF"], "notes": "Obligatoires", "is_system": True},
    {"id": "frais-personnel", "label": "Frais de personnel", "deductible_pct": 100, "categories_associees": ["Personnel", "Salaires"], "notes": "", "is_system": True},
    {"id": "fournitures", "label": "Achats & fournitures", "deductible_pct": 100, "categories_associees": ["Fournitures", "Matériel", "Consommables"], "notes": "", "is_system": True},
    {"id": "formation", "label": "Formation & congrès", "deductible_pct": 100, "categories_associees": ["Formation"], "notes": "DPC, séminaires", "is_system": True},
    {"id": "cotisations-pro", "label": "Cotisations professionnelles", "deductible_pct": 100, "categories_associees": ["Cotisation", "AGA", "Ordre"], "notes": "AGA, syndicat, Ordre", "is_system": True},
    {"id": "repas", "label": "Frais de repas", "deductible_pct": 100, "categories_associees": ["Repas", "Restaurant"], "notes": "Part déductible après seuil", "is_system": True},
    {"id": "honoraires-retrocedes", "label": "Honoraires rétrocédés", "deductible_pct": 100, "categories_associees": ["Rétrocession"], "notes": "", "is_system": True},
    {"id": "frais-financiers", "label": "Frais financiers", "deductible_pct": 100, "categories_associees": ["Banque", "Frais bancaires"], "notes": "Intérêts emprunt pro", "is_system": True},
    {"id": "madelin-prevoyance", "label": "Prévoyance Madelin", "deductible_pct": 100, "categories_associees": ["Madelin", "Prévoyance"], "notes": "Dans limites fiscales", "is_system": True},
    {"id": "divers", "label": "Divers / Non classé", "deductible_pct": 0, "categories_associees": [], "notes": "Non déduit par défaut", "is_system": True},
]
```

---

## 3. Backend — Router

### Fichier : `backend/routers/ged.py`

Prefix : `/api/ged`

```
GET    /tree                         → Arborescence complète (scan + build_tree)
GET    /documents                    → Liste filtrée (query params: type, year, month, poste_comptable, tags, search, sort_by, sort_order)
POST   /upload                       → Upload document libre (multipart: file + metadata JSON)
PATCH  /documents/{doc_id:path}      → Modifier metadata document
DELETE /documents/{doc_id:path}      → Supprimer document libre uniquement
GET    /documents/{doc_id:path}/preview → Servir le PDF (FileResponse)
GET    /documents/{doc_id:path}/thumbnail → Servir le thumbnail PNG (FileResponse, 200px large)
POST   /documents/{doc_id:path}/open-native → Ouvre le fichier dans l'app macOS native (Aperçu)
GET    /search                       → Recherche full-text (query param: q)
GET    /stats                        → Stats globales par poste (brut, déductible, nb docs)

GET    /postes                       → Liste postes comptables avec % déductible
PUT    /postes                       → Sauvegarder tous les postes (body: PostesConfig)
POST   /postes                       → Ajouter un poste custom
DELETE /postes/{id}                  → Supprimer un poste custom (pas les system)

POST   /bulk-tag                     → Tagger plusieurs documents (body: {doc_ids: [...], tags: [...]})
POST   /scan                         → Force un re-scan des sources (utile après import/OCR)
```

**Notes :**
- `doc_id` utilise `:path` car c'est un chemin relatif (ex: `data/imports/releves/pdf_abc123.pdf`)
- Le endpoint `/tree` appelle `scan_all_sources()` puis `build_tree()` pour toujours refléter l'état réel du filesystem
- Le endpoint `/documents/{doc_id}/preview` résout le chemin absolu via `get_file_path()` et sert avec `FileResponse(media_type="application/pdf")`
- Le endpoint `/documents/{doc_id}/thumbnail` sert le thumbnail PNG via `get_thumbnail_path()` → `FileResponse(media_type="image/png")`. Si le thumbnail n'existe pas, il est généré à la volée via `pdf2image` (première page, 200px de large). Retourne 404 si non-PDF ou échec de génération.
- Le endpoint `/documents/{doc_id}/open-native` appelle `subprocess.Popen(["open", absolute_path])` pour ouvrir le fichier dans l'application par défaut de macOS (Aperçu pour les PDF). Retourne `{"status": "opened"}` ou 404 si le fichier n'existe pas. Endpoint POST car c'est une action à effet de bord.

---

## 4. Backend — Intégration

### `backend/core/config.py`

Ajouter :
```python
GED_DIR = DATA_DIR / "ged"
GED_METADATA_FILE = GED_DIR / "ged_metadata.json"
GED_POSTES_FILE = GED_DIR / "ged_postes.json"
GED_THUMBNAILS_DIR = GED_DIR / "thumbnails"
```

Dans `ensure_directories()`, ajouter `GED_DIR.mkdir(exist_ok=True)` et `GED_THUMBNAILS_DIR.mkdir(exist_ok=True)`.

### `backend/main.py`

Ajouter :
```python
from backend.routers import ged
app.include_router(ged.router, prefix="/api/ged", tags=["ged"])
```

---

## 5. Frontend — Types

### Ajouter dans `frontend/src/types/index.ts` :

```typescript
// === GED ===

export interface PosteComptable {
  id: string;
  label: string;
  deductible_pct: number; // 0-100
  categories_associees: string[];
  notes: string;
  is_system: boolean;
}

export interface PostesConfig {
  version: number;
  exercice: number;
  postes: PosteComptable[];
}

export interface GedDocument {
  doc_id: string;
  type: 'releve' | 'justificatif' | 'rapport' | 'document_libre';
  year: number | null;
  month: number | null;
  poste_comptable: string | null;
  montant_brut: number | null;
  deductible_pct_override: number | null;
  tags: string[];
  notes: string;
  added_at: string;
  original_name: string | null;
  ocr_file: string | null;
}

export interface GedTreeNode {
  id: string;
  label: string;
  count: number;
  children: GedTreeNode[];
  icon?: string;
}

export interface GedSearchResult {
  doc_id: string;
  document: GedDocument;
  match_context: string;
  score: number;
}

export interface GedStats {
  total_documents: number;
  total_brut: number;
  total_deductible: number;
  disk_size_human: string;
  par_poste: Array<{
    poste_id: string;
    poste_label: string;
    deductible_pct: number;
    nb_docs: number;
    total_brut: number;
    total_deductible: number;
  }>;
}

export interface GedFilters {
  type?: string;
  year?: number;
  month?: number;
  poste_comptable?: string;
  tags?: string[];
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}
```

---

## 6. Frontend — Hook

### Fichier : `frontend/src/hooks/useGed.ts`

```typescript
// Queries :
// - useGedTree() → GET /api/ged/tree
// - useGedDocuments(filters: GedFilters) → GET /api/ged/documents?...
// - useGedPostes() → GET /api/ged/postes
// - useGedStats() → GET /api/ged/stats
// - useGedSearch(query: string) → GET /api/ged/search?q=...  (enabled quand query.length >= 2)

// Mutations :
// - useGedUpload() → POST /api/ged/upload (multipart)
//     onSuccess: invalidate ['ged-tree'], ['ged-documents'], ['ged-stats']
// - useGedUpdateDocument() → PATCH /api/ged/documents/{doc_id}
//     onSuccess: invalidate ['ged-documents'], ['ged-tree']
// - useGedDeleteDocument() → DELETE /api/ged/documents/{doc_id}
//     onSuccess: invalidate ['ged-tree'], ['ged-documents'], ['ged-stats']
// - useGedSavePostes() → PUT /api/ged/postes
//     onSuccess: invalidate ['ged-postes'], ['ged-stats'], toast.success()
// - useGedAddPoste() → POST /api/ged/postes
//     onSuccess: invalidate ['ged-postes']
// - useGedDeletePoste() → DELETE /api/ged/postes/{id}
//     onSuccess: invalidate ['ged-postes']
// - useGedBulkTag() → POST /api/ged/bulk-tag
//     onSuccess: invalidate ['ged-documents']
// - useGedOpenNative() → POST /api/ged/documents/{doc_id}/open-native
//     onSuccess: toast.success("Document ouvert dans Aperçu")
//     onError: toast.error("Impossible d'ouvrir le document")
// - useGedScan() → POST /api/ged/scan
//     onSuccess: invalidate ['ged-tree'], ['ged-documents'], ['ged-stats'], toast.success()
```

---

## 7. Frontend — Composants

### Structure :

```
frontend/src/components/ged/
├── GedPage.tsx
├── GedTree.tsx
├── GedToolbar.tsx
├── GedBreadcrumb.tsx
├── GedDocumentGrid.tsx
├── GedDocumentList.tsx
├── GedDocumentDrawer.tsx
├── GedUploadZone.tsx
├── GedSearchBar.tsx
├── GedPostesDrawer.tsx          ← SLIDER % DÉDUCTIBLE ICI
└── GedMetadataEditor.tsx
```

---

### `GedPage.tsx` — Page principale

Layout split horizontal :
- **Gauche (260px, border-r)** : `GedTree` + `GedSearchBar` en haut
- **Droite (flex-1)** : `GedBreadcrumb` + `GedToolbar` + zone contenu (`GedDocumentGrid` ou `GedDocumentList`)

State local :
- `selectedNode: string | null` — nœud sélectionné dans l'arbre
- `viewMode: 'grid' | 'list'` — toggle vue
- `filters: GedFilters` — filtres actifs (dérivés du nœud sélectionné)
- `selectedDoc: string | null` — document sélectionné (ouvre le drawer)
- `showPostesDrawer: boolean` — affiche le drawer postes/déductibilité
- `showUploadZone: boolean` — affiche la zone d'upload

`PageHeader` :
- title: "Bibliothèque Documents"
- actions: bouton `Upload` (icône `Upload`, ouvre `showUploadZone`), bouton `Postes` (icône `Settings2`, ouvre `showPostesDrawer`), bouton `Scanner` (icône `RefreshCw`, appelle `useGedScan`)

---

### `GedTree.tsx` — Arborescence collapsible

Props : `{ tree: GedTreeNode[], selectedNode: string | null, onSelect: (nodeId: string) => void }`

- Rendu récursif des nœuds avec indentation
- Icônes Lucide par type : `FileText` (relevés), `Receipt` (justificatifs), `BarChart3` (rapports), `FolderOpen` (docs libres)
- Badge compteur à droite de chaque nœud
- Chevron expand/collapse pour les nœuds avec enfants
- Nœud sélectionné = `bg-surface` + `border-l-2 border-primary`
- Clic sur un nœud → met à jour `selectedNode` et dérive les `filters` correspondants

---

### `GedToolbar.tsx` — Barre d'outils

Props : `{ viewMode, onViewModeChange, filters, onFiltersChange, totalCount, totalSize }`

- Toggle grille/liste (icônes `LayoutGrid` / `List`)
- Select tri : date ajout, nom, taille, type
- Stats inline : "X documents · Y Mo"

---

### `GedBreadcrumb.tsx` — Fil d'Ariane

Props : `{ path: Array<{id: string, label: string}>, onNavigate: (nodeId: string) => void }`

- Segments cliquables séparés par `ChevronRight`
- Premier segment toujours "Bibliothèque"

---

### `GedDocumentGrid.tsx` — Vue grille

Props : `{ documents: GedDocument[], postes: PosteComptable[], onSelect: (docId: string) => void }`

- Grille responsive `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`
- Chaque carte :
  - **Thumbnail** en haut (image `<img src="/api/ged/documents/{doc_id}/thumbnail" />`, ratio ~A4 portrait, `object-cover`, `rounded-t`, fond `bg-surface`)
  - Fallback si le thumbnail ne charge pas (onError) : icône générique par type (PDF=`FileText`, CSV=`Table`, XLSX=`Sheet`) avec fond coloré
  - Nom du fichier (tronqué)
  - Poste comptable (badge petit)
  - Montant brut si disponible
  - **Montant déductible** si poste avec % < 100 : afficher `XX,XX € (YY%)` en `text-text-muted`
  - Tags (petits badges)
- Clic → ouvre `GedDocumentDrawer`

---

### `GedDocumentList.tsx` — Vue liste

Props : identiques à Grid

- Tableau avec colonnes : Nom, Type, Date, Poste, Montant brut, Déductible (montant + %), Tags
- Colonnes triables
- Lignes cliquables

---

### `GedDocumentDrawer.tsx` — Drawer preview + metadata

Props : `{ docId: string | null, postes: PosteComptable[], onClose: () => void }`

Drawer **700px**, slide-in droit, pattern standard (translateX + backdrop).

Contenu :
1. **Preview PDF** en haut (iframe, hauteur ~50%). **Clic sur le thumbnail dans la grille ouvre ce drawer.**
2. **Section Informations** : nom, type, date ajout, taille
3. **Section Fiscalité** (encart `bg-surface` avec bordure) :
   - Poste comptable (select dropdown des postes)
   - % déductible : affiche le % du poste (ou override si défini)
   - Montant brut (input number)
   - Montant déductible (calculé, read-only) = `montant_brut × pct / 100`
   - Part non déductible (calculé, read-only)
   - Checkbox "Surcharger le % pour ce document" → affiche un slider local
4. **Section Tags** : tags existants (badges avec X pour supprimer) + input pour en ajouter
5. **Section Notes** : textarea
6. **Boutons** :
   - `Ouvrir dans Aperçu` (icône `ExternalLink`) → appelle `POST /api/ged/documents/{doc_id}/open-native` → ouvre le PDF dans l'app macOS native (Aperçu.app). Toast "Document ouvert dans Aperçu" ou toast erreur.
   - `Télécharger` (icône `Download`) → lien direct vers `/api/ged/documents/{doc_id}/preview` avec attribut `download`
   - `Sauvegarder` → sauvegarde les metadata modifiées
   - `Supprimer` (si document_libre uniquement)
   - `Voir dans le module` → lien vers la page source (Justificatifs, Éditeur, etc.)

---

### `GedPostesDrawer.tsx` — **DRAWER POSTES & % DÉDUCTIBLE** ⭐

Props : `{ open: boolean, onClose: () => void }`

Drawer **600px**, slide-in droit.

Header : "Postes comptables — Exercice {année}" avec select année.

Contenu = **liste scrollable de tous les postes**, chacun avec :

```
┌────────────────────────────────────────────────────┐
│  Loyer domicile (quote-part pro)            [🗑️]  │
│                                                    │
│  ○────────●──────────────────────────────○   20%   │
│  0%                                       100%     │
│                                                    │
│  📝 Prorata surface bureau / logement              │
│  🏷️ Catégories : (aucune)                          │
│                                                    │
│  Résumé : 3 docs · 3 600 € brut · 720 € déduit   │
└────────────────────────────────────────────────────┘
```

Pour chaque poste :
- **Label** : texte éditable inline (clic pour modifier, blur pour confirmer)
- **Slider** : `input type="range"` min=0 max=100 step=5, avec affichage du % à droite
  - Couleur du slider : vert (100%), orange (50-99%), rouge (0-49%)
  - Au changement → met à jour le state local (pas de save immédiat)
- **Notes** : petit texte `text-text-muted text-xs`, éditable
- **Catégories associées** : badges des catégories ML liées, avec bouton `+` pour en ajouter (select dropdown des catégories existantes via `GET /api/categories`)
- **Résumé** : stats inline (nb docs rattachés, total brut, total déduit) — read-only, vient de `useGedStats()`
- **Bouton supprimer** : uniquement sur les postes custom (`is_system: false`), avec confirmation

En bas du drawer :
- Bouton `[+ Ajouter un poste]` : crée un nouveau poste custom avec label vide, 0%, is_system: false
- Bouton `[Sauvegarder]` : appelle `useGedSavePostes()` avec tout le state local → `PUT /api/ged/postes`

**Important** : le slider est le cœur de ce drawer. Il doit être fluide, réactif, avec feedback visuel immédiat (la barre colorée change en temps réel). Le % est aussi saisissable directement dans un input number à côté du slider.

---

### `GedUploadZone.tsx` — Upload modal/zone

Props : `{ open: boolean, onClose: () => void }`

Modal ou zone expandable avec :
- Drag & drop (react-dropzone)
- Sélection du type de document (select : Courrier fiscal, Courrier social, Contrat, Attestation, Divers)
- Sélection du poste comptable (select dropdown des postes)
- Année + Mois (auto-remplis avec date du jour, éditables)
- Tags (input libre, séparés par virgule ou Enter)
- Bouton Upload → `POST /api/ged/upload`

---

### `GedSearchBar.tsx` — Recherche

Props : `{ onSearch: (query: string) => void }`

- Input avec icône `Search`
- Debounce 300ms
- Si query >= 2 chars → appelle `useGedSearch(query)` → affiche résultats dans un dropdown sous l'input
- Chaque résultat : nom fichier, extrait contexte (highlight), type badge
- Clic sur résultat → sélectionne le document (ouvre drawer)

---

### `GedMetadataEditor.tsx` — Sous-composant formulaire

Props : `{ document: GedDocument, postes: PosteComptable[], onChange: (updates) => void }`

Formulaire réutilisable pour éditer les metadata d'un document (utilisé dans le drawer et potentiellement dans l'upload).

---

## 8. Frontend — Routing

### `App.tsx`

Ajouter la route :
```tsx
<Route path="/ged" element={<GedPage />} />
```

### Sidebar — `NAV_SECTIONS`

Ajouter dans le groupe **OUTILS** (ou créer un groupe **DOCUMENTS** entre CLÔTURE et OUTILS) :

```typescript
{
  label: "DOCUMENTS",
  items: [
    { path: "/ged", label: "Bibliothèque", icon: Library }
  ]
}
```

Icône : `Library` de Lucide React.

---

## 9. Arborescence GED — Structure des nœuds

L'arbre retourné par `GET /api/ged/tree` :

```
📁 Relevés bancaires [icon: FileText]
   └─ 📁 {année}
      └─ 📁 {mois} (count)

📁 Justificatifs [icon: Receipt]
   ├─ 📁 Par date
   │    └─ 📁 {année}
   │       ├─ 📁 En attente (count)
   │       └─ 📁 Traités
   │            └─ 📁 {mois} (count)
   └─ 📁 Par poste comptable
        ├─ 📁 {poste.label} (count)    ← déduit via categories_associees
        └─ 📁 Non associés (count)     ← en_attente sans poste

📁 Rapports [icon: BarChart3]
   ├─ 📁 Tous postes (count)           ← rapports sans filtre catégorie
   └─ 📁 {poste.label} (count)         ← rapports dont le filtre catégorie matche

📁 Documents libres [icon: FolderOpen]
   ├─ 📁 Fiscal
   ├─ 📁 Social
   ├─ 📁 Contrats
   └─ 📁 Divers
```

Chaque sélection de nœud se traduit en filtres pour `GET /api/ged/documents`.

---

## 10. Calcul du montant déductible

La logique est **purement frontend** (affichage) + **backend stats** :

```
montant_deductible = montant_brut × effective_pct / 100

effective_pct = deductible_pct_override si non null
              SINON postes[poste_comptable].deductible_pct
              SINON 0 (si pas de poste)
```

Le backend calcule les totaux dans `GET /api/ged/stats` avec cette même logique.

---

## 11. Fichiers de données

### `data/ged/ged_metadata.json`

Créé au premier accès (scan initial). Contient les métadonnées enrichies de tous les documents indexés. Non destructif : si un fichier source est supprimé, son entrée est retirée au prochain scan.

### `data/ged/ged_postes.json`

Créé avec les postes par défaut au premier accès. Versionné par exercice. Structure = `PostesConfig`.

### `data/ged/{year}/{month}/`

Répertoires créés à la demande pour stocker les documents libres uploadés via la GED.

### `data/ged/thumbnails/`

Cache des thumbnails PNG générés par `pdf2image`. Nommés par hash MD5 du `doc_id` : `{md5(doc_id)}.png`. Régénérés automatiquement si le PDF source est plus récent. Peut être vidé sans perte (les thumbnails seront regénérés à la demande).

---

## 12. Vérification

Après implémentation, vérifier :

- [ ] `python3 -c "from backend.routers import ged"` → pas d'erreur d'import
- [ ] `GET /api/ged/tree` retourne une arborescence avec les 4 racines (Relevés, Justificatifs, Rapports, Documents libres)
- [ ] `GET /api/ged/documents` retourne les documents indexés depuis les sources existantes
- [ ] `GET /api/ged/postes` retourne les 16 postes par défaut avec %
- [ ] `PUT /api/ged/postes` sauvegarde les modifications de % (vérifier le fichier JSON)
- [ ] `POST /api/ged/upload` upload un PDF dans `data/ged/{year}/{month}/`
- [ ] `PATCH /api/ged/documents/{doc_id}` met à jour metadata (poste, tags, notes, montant)
- [ ] `GET /api/ged/stats` retourne les totaux brut/déductible par poste
- [ ] `GET /api/ged/documents/{doc_id}/thumbnail` retourne un PNG de la première page du PDF
- [ ] Le thumbnail est caché dans `data/ged/thumbnails/` et n'est pas regénéré si déjà présent
- [ ] Si le document n'est pas un PDF, le thumbnail retourne 404 et la grille affiche une icône fallback
- [ ] `POST /api/ged/documents/{doc_id}/open-native` ouvre le PDF dans Aperçu sur macOS (via `subprocess.Popen(["open", path])`)
- [ ] Le bouton "Ouvrir dans Aperçu" dans le drawer affiche un toast de confirmation
- [ ] La page GED s'affiche sans erreur console
- [ ] L'arborescence est cliquable et filtre les documents
- [ ] Le toggle grille/liste fonctionne
- [ ] La grille affiche les thumbnails des PDFs (première page), avec fallback icône si non-PDF
- [ ] Le drawer preview affiche le PDF + section Fiscalité avec calcul déductible
- [ ] Le drawer Postes affiche les sliders, le % se met à jour en temps réel
- [ ] Le slider est par pas de 5, de 0 à 100, avec couleur dynamique
- [ ] La saisie directe du % à côté du slider fonctionne
- [ ] La sauvegarde des postes persiste après rechargement
- [ ] La recherche full-text retourne des résultats depuis les noms et le contenu OCR
- [ ] L'upload de document libre crée le fichier + l'entrée metadata
- [ ] La suppression ne fonctionne que sur les documents libres
- [ ] `cd frontend && npx tsc --noEmit` → 0 erreur
- [ ] Sidebar affiche "Bibliothèque" dans la section DOCUMENTS avec icône Library
