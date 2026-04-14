# Prompt Claude Code — Module Templates Justificatifs

> **Lire `CLAUDE.md` en premier** pour charger les contraintes projet.

---

## Contexte

Ajouter un système de **templates de justificatifs par fournisseur** permettant de générer des justificatifs PDF quand l'original est manquant. Les templates sont créés à partir de justificatifs réels déjà scannés (OCR). Les justificatifs générés sont **strictement identiques** visuellement à de vrais justificatifs — aucun watermark, aucune mention, aucun marquage sur le PDF. La traçabilité est **exclusivement dans les métadonnées** : préfixe `reconstitue_` dans le nom de fichier et champ `"source": "reconstitue"` dans le `.ocr.json`.

---

## 1. Stockage

### Fichiers

```
data/templates/
└── justificatifs_templates.json    # Bibliothèque de templates fournisseurs
```

### Structure `justificatifs_templates.json`

```json
{
  "version": 1,
  "templates": [
    {
      "id": "tpl_<uuid8>",
      "vendor": "TotalEnergies",
      "vendor_aliases": ["total", "totalenergies", "total energies", "total access"],
      "category": "Véhicule",
      "sous_categorie": "Carburant",
      "source_justificatif": "justificatif_20260315_143022_ticket_total.pdf",
      "fields": [
        {
          "key": "station",
          "label": "Station",
          "type": "text",
          "source": "ocr",
          "required": false,
          "ocr_confidence": 0.97
        },
        {
          "key": "date",
          "label": "Date",
          "type": "date",
          "source": "operation",
          "required": true
        },
        {
          "key": "montant_ttc",
          "label": "Montant TTC",
          "type": "currency",
          "source": "operation",
          "required": true
        },
        {
          "key": "tva_rate",
          "label": "Taux TVA",
          "type": "percent",
          "source": "fixed",
          "default": 20
        },
        {
          "key": "montant_ht",
          "label": "Montant HT",
          "type": "currency",
          "source": "computed",
          "formula": "montant_ttc / (1 + tva_rate / 100)"
        },
        {
          "key": "tva",
          "label": "TVA",
          "type": "currency",
          "source": "computed",
          "formula": "montant_ttc - montant_ht"
        },
        {
          "key": "litrage",
          "label": "Litres",
          "type": "number",
          "source": "manual",
          "required": false
        },
        {
          "key": "prix_litre",
          "label": "Prix/litre",
          "type": "currency",
          "source": "manual",
          "required": false
        },
        {
          "key": "type_carburant",
          "label": "Carburant",
          "type": "select",
          "source": "manual",
          "options": ["SP95", "SP98", "Gazole", "E85"],
          "required": false
        }
      ],
      "created_at": "2026-04-05T14:30:00",
      "created_from": "scan",
      "usage_count": 0
    }
  ]
}
```

### Types de champs

| `type` | Description | Format |
|--------|-------------|--------|
| `text` | Texte libre | string |
| `date` | Date | `YYYY-MM-DD` |
| `currency` | Montant EUR | float, affiché `XX,XX €` |
| `number` | Nombre | float |
| `percent` | Pourcentage | int 0-100 |
| `select` | Choix parmi `options` | string |

### Sources de champs

| `source` | Comportement |
|----------|-------------|
| `operation` | Auto-rempli depuis l'opération bancaire (date, montant) |
| `ocr` | Pré-rempli depuis le libellé OCR de l'opération |
| `manual` | L'utilisateur remplit manuellement |
| `computed` | Calculé via `formula` (expressions simples : +, -, *, /) |
| `fixed` | Valeur par défaut fixe (modifiable) |

### Fichiers générés

Le justificatif reconstitué produit 2 fichiers dans `data/justificatifs/en_attente/` :

```
reconstitue_YYYYMMDD_HHMMSS_<vendor_slug>.pdf
reconstitue_YYYYMMDD_HHMMSS_<vendor_slug>.ocr.json
```

Le `.ocr.json` a la même structure que ceux des vrais justificatifs + un champ `"source": "reconstitue"` :

```json
{
  "best_date": "2026-03-15",
  "best_amount": 72.45,
  "supplier": "TotalEnergies",
  "source": "reconstitue",
  "template_id": "tpl_abc12345",
  "generated_at": "2026-04-05T14:30:00",
  "operation_ref": {
    "file": "operations_20260320_xxx.json",
    "index": 12
  }
}
```

---

## 2. Backend

### Config (`backend/core/config.py`)

Ajouter :

```python
TEMPLATES_DIR = DATA_DIR / "templates"
TEMPLATES_FILE = TEMPLATES_DIR / "justificatifs_templates.json"
```

Ajouter `TEMPLATES_DIR` dans `ensure_directories()`.

### Modèle Pydantic (`backend/models/template.py`) — CRÉER

```python
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel

class TemplateField(BaseModel):
    key: str
    label: str
    type: str  # text, date, currency, number, percent, select
    source: str  # operation, ocr, manual, computed, fixed
    required: bool = False
    default: Optional[float] = None
    formula: Optional[str] = None
    options: Optional[list[str]] = None
    ocr_confidence: Optional[float] = None

class JustificatifTemplate(BaseModel):
    id: str
    vendor: str
    vendor_aliases: list[str]
    category: Optional[str] = None
    sous_categorie: Optional[str] = None
    source_justificatif: Optional[str] = None
    fields: list[TemplateField]
    created_at: str
    created_from: str  # "scan" ou "manual"
    usage_count: int = 0

class TemplateStore(BaseModel):
    version: int = 1
    templates: list[JustificatifTemplate] = []

class ExtractFieldsRequest(BaseModel):
    filename: str  # justificatif existant

class GenerateRequest(BaseModel):
    template_id: str
    operation_file: str
    operation_index: int
    field_values: dict  # champs manuels remplis par l'utilisateur
    auto_associate: bool = False

class TemplateCreateRequest(BaseModel):
    vendor: str
    vendor_aliases: list[str]
    category: Optional[str] = None
    sous_categorie: Optional[str] = None
    source_justificatif: Optional[str] = None
    fields: list[TemplateField]

class TemplateSuggestion(BaseModel):
    template_id: str
    vendor: str
    match_score: float
    matched_alias: str
    fields_count: int
```

### Service (`backend/services/template_service.py`) — CRÉER

Fonctions :

#### `load_templates() -> TemplateStore`
Charge `justificatifs_templates.json`. Si n'existe pas, retourne store vide.

#### `save_templates(store: TemplateStore)`
Sauvegarde dans `justificatifs_templates.json`.

#### `get_template(template_id: str) -> Optional[JustificatifTemplate]`
Retourne un template par ID.

#### `create_template(request: TemplateCreateRequest) -> JustificatifTemplate`
Crée un nouveau template. Génère l'ID `tpl_<uuid8>`. Sauvegarde.

#### `update_template(template_id: str, request: TemplateCreateRequest) -> JustificatifTemplate`
Met à jour un template existant. Sauvegarde.

#### `delete_template(template_id: str) -> bool`
Supprime un template. Retourne False si non trouvé.

#### `extract_fields_from_justificatif(filename: str) -> dict`
Point clé. Charge le `.ocr.json` du justificatif existant. Utilise le pipeline OCR enrichi via Ollama/Qwen2-VL pour extraire **tous les champs structurés** du document (pas juste date/montant/fournisseur). Retourne :

```python
{
    "vendor": "TOTALENERGIES",
    "suggested_aliases": ["total", "totalenergies"],
    "detected_fields": [
        {
            "key": "auto_generated_key",
            "label": "Label suggéré",
            "value": "valeur extraite",
            "type": "type détecté",
            "confidence": 0.85,
            "suggested_source": "manual"
        }
    ]
}
```

**Implémentation** : envoyer l'image du justificatif à Qwen2-VL via Ollama avec un prompt spécialisé extraction exhaustive. Si Ollama est indisponible, fallback sur les données `.ocr.json` existantes (date, montant, fournisseur uniquement).

Prompt Qwen2-VL pour extraction template :

```
Analyse ce justificatif/facture et extrais TOUS les champs structurés visibles.
Réponds UNIQUEMENT en JSON strict, sans commentaire :
{
  "vendor": "nom du fournisseur",
  "fields": [
    {"label": "...", "value": "...", "type": "text|date|currency|number|percent"}
  ]
}
Types : date pour les dates, currency pour les montants en euros, number pour les quantités, percent pour les pourcentages, text pour le reste.
```

#### `suggest_template(libelle: str) -> list[TemplateSuggestion]`
Cherche les templates dont un `vendor_alias` apparaît dans le libellé (insensible casse, nettoyé). Retourne les matches triés par longueur du match (plus long = plus précis).

#### `generate_reconstitue(request: GenerateRequest) -> dict`
Point clé. Génère le PDF reconstitué :

1. Charger le template par ID
2. Charger l'opération depuis `operation_file[operation_index]`
3. Construire les données : champs `operation` depuis l'opération, champs `fixed` depuis les defaults, champs `computed` via formules, champs `manual` depuis `field_values`
4. Générer le PDF via ReportLab (voir section PDF ci-dessous)
5. Créer le `.ocr.json` compagnon
6. Incrémenter `usage_count` du template
7. Si `auto_associate` : appeler `rapprochement_service` pour associer le justificatif à l'opération (score 1.0, mode "reconstitue")
8. Retourner `{ "filename": "reconstitue_xxx.pdf", "associated": true/false }`

#### Génération PDF (ReportLab)

Le PDF doit ressembler à un justificatif professionnel sobre. **Pas de watermark.** Structure :

```
┌──────────────────────────────────────────────┐
│                                              │
│   [Fournisseur]            [Date]            │
│                                              │
│   ─────────────────────────────────────────  │
│                                              │
│   [Champs spécifiques du template]           │
│   ex: N° commande, litrage, etc.             │
│                                              │
│   ─────────────────────────────────────────  │
│   Désignation          │ Montant              │
│   ─────────────────────────────────────────  │
│   Montant HT           │ XX,XX €             │
│   TVA (XX%)            │ XX,XX €             │
│   ─────────────────────────────────────────  │
│   TOTAL TTC            │ XX,XX €             │
│   ─────────────────────────────────────────  │
│                                              │
└──────────────────────────────────────────────┘
```

- Format A5 (148 × 210 mm) pour ressembler à un ticket/facture
- Police Helvetica, taille 10-12pt
- **Aucune mention** "reconstitué" ou "NeuronXcompta" sur le PDF — le document doit être visuellement identique à un vrai justificatif
- Montants alignés à droite, format `1 234,56 €`
- Fournisseur en gras taille 14pt en haut

### Router (`backend/routers/templates.py`) — CRÉER

Préfixe : `/api/templates`

```python
GET    /                              → liste tous les templates
GET    /{template_id}                 → un template par ID
POST   /                              → créer un template (body: TemplateCreateRequest)
PUT    /{template_id}                 → modifier un template
DELETE /{template_id}                 → supprimer un template

POST   /extract                       → extraire les champs d'un justificatif existant
                                        Body: { "filename": "justificatif_xxx.pdf" }
                                        Retourne les champs détectés avec confiance

POST   /generate                      → générer un PDF reconstitué
                                        Body: GenerateRequest
                                        Retourne { filename, associated }

GET    /suggest/{operation_file}/{operation_index}
                                      → suggérer template(s) pour une opération
                                        Retourne list[TemplateSuggestion]
```

### Enregistrement du router

`backend/main.py` : ajouter `from backend.routers import templates` et `app.include_router(templates.router)`.

---

## 3. Frontend

### Types (`frontend/src/types/index.ts`)

Ajouter :

```typescript
// Templates justificatifs
export interface TemplateField {
  key: string
  label: string
  type: 'text' | 'date' | 'currency' | 'number' | 'percent' | 'select'
  source: 'operation' | 'ocr' | 'manual' | 'computed' | 'fixed'
  required: boolean
  default?: number
  formula?: string
  options?: string[]
  ocr_confidence?: number
}

export interface JustificatifTemplate {
  id: string
  vendor: string
  vendor_aliases: string[]
  category?: string
  sous_categorie?: string
  source_justificatif?: string
  fields: TemplateField[]
  created_at: string
  created_from: 'scan' | 'manual'
  usage_count: number
}

export interface ExtractedFields {
  vendor: string
  suggested_aliases: string[]
  detected_fields: Array<{
    key: string
    label: string
    value: string
    type: string
    confidence: number
    suggested_source: string
  }>
}

export interface TemplateSuggestion {
  template_id: string
  vendor: string
  match_score: number
  matched_alias: string
  fields_count: number
}

export interface GenerateRequest {
  template_id: string
  operation_file: string
  operation_index: int
  field_values: Record<string, string | number>
  auto_associate: boolean
}
```

### Hook (`frontend/src/hooks/useTemplates.ts`) — CRÉER

```typescript
// Queries
useTemplates()                    → GET /api/templates
useTemplate(id)                   → GET /api/templates/{id}
useTemplateSuggestion(file, idx)  → GET /api/templates/suggest/{file}/{idx}
                                     enabled: !!file && idx !== undefined

// Mutations
useExtractFields()                → POST /api/templates/extract
useCreateTemplate()               → POST /api/templates
                                     onSuccess: invalidate ['templates']
useUpdateTemplate()               → PUT /api/templates/{id}
                                     onSuccess: invalidate ['templates']
useDeleteTemplate()               → DELETE /api/templates/{id}
                                     onSuccess: invalidate ['templates']
useGenerateReconstitue()          → POST /api/templates/generate
                                     onSuccess: invalidate ['templates', 'justificatifs', 'rapprochement']
```

### Composants

#### `frontend/src/components/ocr/TemplatesTab.tsx` — CRÉER

4ème onglet de `OcrPage.tsx`. Trois sections verticales :

**Section "Créer un template"** :
- Zone drag & drop OU sélecteur de justificatif existant (dropdown avec recherche)
- Bouton "Analyser" → appelle `POST /api/templates/extract`
- Panel d'extraction (initialement caché, s'affiche après analyse) :
  - Preview du justificatif source (nom, taille, date)
  - Input "Nom du fournisseur" (pré-rempli OCR)
  - Select "Catégorie" (depuis les catégories existantes via `useCategories`)
  - Tags d'alias de matching (avec ajout/suppression)
  - Table des champs détectés : checkbox inclure, label, valeur extraite, select source, barre de confiance OCR
  - Boutons "Annuler" / "Sauvegarder le template"

**Section "Bibliothèque"** :
- Grille responsive de cartes template (`grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`)
- Chaque carte : initiales avatar coloré, nom vendor, catégorie, tags alias, badges (champs, confiance moyenne), compteur utilisations, lien source
- Clic → drawer d'édition (réutilise le même formulaire que la création)

**Section "Générer"** :
- Sélecteur d'opération (file + index) — pré-rempli si arrivée depuis query params
- Template auto-suggéré via `useTemplateSuggestion(file, index)`
- Deux colonnes : champs auto-remplis (grisés, dashed border) / champs manuels (inputs)
- Ligne TVA calculée en temps réel
- Boutons "Générer PDF" / "Générer + associer"

#### `frontend/src/components/ocr/ReconstituerButton.tsx` — CRÉER

Composant réutilisable pour les 4 points d'intégration.

Props :
```typescript
interface ReconstituerButtonProps {
  operationFile: string
  operationIndex: number
  libelle: string
  className?: string
  size?: 'sm' | 'md'       // sm pour editor/alertes, md pour rapprochement
  onGenerated?: () => void  // callback après génération réussie
}
```

Comportement :
1. Au mount : appelle `useTemplateSuggestion(file, index)`
2. Si suggestion trouvée : bouton violet "Reconstituer" + petit tag vert avec nom template
3. Si aucune suggestion : bouton grisé disabled avec tooltip "Aucun template fournisseur"
4. Au clic : ouvre un drawer `ReconstituerDrawer` (600px) avec le formulaire de génération pré-rempli

#### `frontend/src/components/ocr/ReconstituerDrawer.tsx` — CRÉER

Drawer 600px avec :
- Header : "Reconstituer — {vendor}"
- Preview de l'opération source (libellé, date, montant, fichier)
- Select template (pré-sélectionné)
- Formulaire en 2 colonnes (auto / manuel)
- Ligne TVA
- Boutons "Générer PDF" / "Générer + associer" / "Annuler"
- Toast succès après génération

### Intégrations (4 points d'entrée)

#### 1. Rapprochement manuel — `RapprochementManuelDrawer.tsx`

Dans le drawer existant, quand la liste de suggestions est vide (ou en complément en bas de liste) :

```tsx
{suggestions.length === 0 && (
  <ReconstituerButton
    operationFile={filename}
    operationIndex={index}
    libelle={operation.libelle}
    size="md"
  />
)}
```

Ajouter aussi quand il y a des suggestions mais aucune avec un bon score (toutes < 0.5).

#### 2. Alertes — `AlertesPage.tsx`

Sur chaque ligne d'alerte de type `justificatif_manquant`, ajouter le bouton à côté du bouton "Associer" existant :

```tsx
{alerte.type === 'justificatif_manquant' && (
  <ReconstituerButton
    operationFile={alerte.filename}
    operationIndex={alerte.index}
    libelle={alerte.libelle}
    size="sm"
    onGenerated={() => refetchAlertes()}
  />
)}
```

#### 3. Éditeur — `EditorPage.tsx`

Dans la colonne justificatif (trombone), pour les opérations sans justificatif, afficher le bouton au survol :

```tsx
{!operation.justificatif && (
  <ReconstituerButton
    operationFile={filename}
    operationIndex={index}
    libelle={operation.libelle}
    size="sm"
    onGenerated={() => refetchOperations()}
  />
)}
```

Le bouton apparaît au `hover` de la ligne (CSS `opacity-0 group-hover:opacity-100`).

#### 4. Clôture — `CloturePage.tsx`

Pour les mois avec `statut === 'partiel'` et `taux_justificatifs < 1.0`, ajouter un bouton "Reconstituer les manquants" qui redirige vers la page alertes filtrée sur ce mois :

```tsx
{mois.statut === 'partiel' && mois.taux_justificatifs < 1.0 && (
  <button onClick={() => navigate(`/alertes?year=${year}&month=${mois.mois}&type=justificatif_manquant`)}>
    Reconstituer les manquants
  </button>
)}
```

### Modification `OcrPage.tsx`

Ajouter le 4ème onglet :

```tsx
const TABS = [
  { id: 'upload', label: 'Upload & OCR' },
  { id: 'test', label: 'Test manuel' },
  { id: 'history', label: 'Historique' },
  { id: 'templates', label: 'Templates justificatifs' },
]
```

Support des query params pour pré-remplir la section Générer :
```tsx
const searchParams = new URLSearchParams(location.search)
const preFile = searchParams.get('file')
const preIndex = searchParams.get('index')
const preTemplate = searchParams.get('template')
```

Si ces params existent, activer l'onglet Templates et scroller vers la section Générer.

---

## 4. Routing

Aucune nouvelle route. L'onglet Templates vit dans `/ocr`. Les query params `?file=&index=&template=` permettent le deep linking depuis les autres pages.

---

## 5. CLAUDE.md

Mettre à jour les sections suivantes :

### Architecture
Ajouter sous OCR :
```
- **Templates Justificatifs**: Bibliothèque de templates par fournisseur créés depuis des justificatifs scannés. Génération de PDF reconstitués via ReportLab quand l'original est manquant. Aucune mention de reconstitution sur le PDF — traçabilité uniquement dans les métadonnées `.ocr.json`. Templates stockés dans `data/templates/justificatifs_templates.json`. Fichiers générés préfixés `reconstitue_` dans `data/justificatifs/en_attente/`.
```

### Project Structure
Ajouter :
```
├── data/
│   ├── templates/
│   │   └── justificatifs_templates.json   # Templates par fournisseur
```

### Backend API Endpoints
Ajouter ligne :
```
| templates | `/api/templates` | GET /, POST /, PUT /{id}, DELETE /{id}, POST /extract, POST /generate, GET /suggest/{file}/{idx} |
```

### Frontend Routes
Mettre à jour `/ocr` :
```
| `/ocr` | OcrPage | Point d'entrée justificatifs : batch upload PDF/JPG/PNG + OCR, test manuel, historique, **templates justificatifs** (création depuis scan, bibliothèque fournisseurs, génération reconstitués) (4 onglets) |
```

### Key Components
Ajouter :
```
- `ReconstituerButton` — bouton contextuel (rapprochement, alertes, éditeur) pour générer un justificatif reconstitué depuis un template fournisseur
- `ReconstituerDrawer` — 600px, formulaire de génération pré-rempli (champs auto/manuels, TVA, preview)
```

### Patterns to Follow
Ajouter :
```
- **Templates justificatifs**: Créés depuis des justificatifs scannés existants (OCR extraction enrichie via Qwen2-VL). Un template = un fournisseur avec aliases de matching. Les reconstitués sont des PDF sobres (ReportLab, A5) sans aucune mention de reconstitution. Traçabilité uniquement dans le `.ocr.json` (`"source": "reconstitue"`). Le bouton `ReconstituerButton` est intégré dans 4 pages (rapprochement, alertes, éditeur, clôture).
```

---

## 6. Vérification

Après implémentation, vérifier :

- [ ] `data/templates/` créé par `ensure_directories()`
- [ ] CRUD templates fonctionne (créer, lire, modifier, supprimer)
- [ ] Extraction OCR depuis un justificatif existant retourne les champs avec confiance
- [ ] Fallback si Ollama indisponible : utilise les données `.ocr.json` basiques
- [ ] Génération PDF produit `reconstitue_xxx.pdf` + `reconstitue_xxx.ocr.json` dans `en_attente/`
- [ ] PDF est sobre, format A5, aucune mention reconstitué/NeuronXcompta sur le document
- [ ] `.ocr.json` contient `"source": "reconstitue"` et `operation_ref` (seul endroit de traçabilité)
- [ ] Auto-association fonctionne quand `auto_associate: true`
- [ ] Suggestion template matche correctement les alias vs libellé bancaire
- [ ] `ReconstituerButton` visible dans rapprochement drawer (suggestions vides)
- [ ] `ReconstituerButton` visible dans alertes (type `justificatif_manquant`)
- [ ] `ReconstituerButton` visible dans éditeur (hover, colonne trombone)
- [ ] Bouton clôture redirige vers alertes filtrées
- [ ] Onglet Templates dans OcrPage fonctionne (création, bibliothèque, génération)
- [ ] Query params `?file=&index=&template=` pré-remplissent la section Générer
- [ ] `usage_count` incrémenté après chaque génération
- [ ] Invalidation TanStack Query correcte après génération (templates, justificatifs, rapprochement)
- [ ] Dark theme respecté (CSS variables)
- [ ] `from __future__ import annotations` dans tous les fichiers Python
- [ ] Tous les fichiers backend utilisent `Optional[X]` (pas `X | None`)
- [ ] Toast succès/erreur après génération
