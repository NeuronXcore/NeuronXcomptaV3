# CLAUDE.md - NeuronXcompta V3

## Project Overview

NeuronXcompta V3 is a full-stack accounting assistant for a dental practice. Migrated from Streamlit (V2) to React + FastAPI. All 18 pages are fully implemented with zero placeholders. Includes a sandbox watchdog that auto-processes files (PDF/JPG/PNG) dropped into `data/justificatifs/sandbox/` with OCR and real-time SSE notifications. Includes a GED (Gestion Électronique de Documents) module for document library with accounting post deductibility tracking. Includes a Dotations aux Amortissements module with registre des immobilisations, moteur de calcul linéaire/dégressif, et détection automatique des opérations candidates. Includes a Tasks Kanban module for tracking accounting actions (auto-generated + manual tasks) with drag & drop.

## Architecture

- **Backend**: FastAPI (Python 3.9+), runs on port 8000
- **Frontend**: React 19 + Vite + TypeScript + TailwindCSS 4, runs on port 5173
- **Data**: JSON file storage in `data/` directory. Imports split: `data/imports/operations/` (JSON) and `data/imports/releves/` (PDF). Auto-migration at startup.
- **ML**: Rules-based + scikit-learn categorization, pickle models in `data/ml/`
- **OCR**: EasyOCR with pdf2image, cache `.ocr.json` alongside PDFs. OCR page is the primary entry point for justificatif uploads (batch upload PDF/JPG/PNG + immediate OCR).
- **Sandbox Watchdog**: `watchdog` library monitors `data/justificatifs/sandbox/` for PDF/JPG/PNG, auto-converts images to PDF, auto-OCR + SSE notifications
- **Image Support**: JPG/JPEG/PNG justificatifs are converted to PDF at intake via Pillow (`_convert_image_to_pdf()`). Only PDF is stored. Constants in `config.py`: `ALLOWED_JUSTIFICATIF_EXTENSIONS`, `IMAGE_EXTENSIONS`, `MAGIC_BYTES`.
- **Amortissements**: Registre des immobilisations avec calcul automatique des dotations (linéaire/dégressif), détection des opérations candidates (montant > seuil + catégorie éligible), plafonds véhicules CO2, gestion cessions/sorties. Données dans `data/amortissements/`. Moteur de calcul dupliqué Python/TypeScript.
- **Simulation BNC**: Moteur fiscal complet (URSSAF, CARMF, ODM, IR) avec barèmes JSON versionnés dans `data/baremes/`. Calcul temps réel côté client via `fiscal-engine.ts` (duplique la logique Python). Distinction critique PER (IR seul) vs Madelin (BNC + social). Prévisions d'honoraires par analyse saisonnière.
- **Prévisionnel**: Calendrier de trésorerie annuel combinant charges attendues (providers récurrents + moyennes N-1), recettes projetées (régression linéaire + saisonnalité), et réalisé. Deux modes fournisseurs : facture récurrente (un document par période) et échéancier de prélèvements (parsing OCR, matching opérations bancaires). Timeline 12 mois Recharts avec barres empilées. Données dans `data/previsionnel/`. Background scan toutes les heures.
- **Templates Justificatifs**: Bibliothèque de templates par fournisseur créés depuis des justificatifs scannés. Génération de PDF reconstitués via ReportLab quand l'original est manquant. Aucune mention de reconstitution sur le PDF — traçabilité uniquement dans les métadonnées `.ocr.json`. Templates stockés dans `data/templates/justificatifs_templates.json`. Fichiers générés préfixés `reconstitue_` dans `data/justificatifs/en_attente/`.
- **Tâches Kanban**: Module de suivi des actions comptables avec vue kanban 3 colonnes (To do / In progress / Done). Tâches auto-générées par scan de l'état applicatif (5 détections : opérations non catégorisées, justificatifs en attente, clôture incomplète, mois sans relevé, alertes non résolues) + tâches manuelles. Drag & drop via @dnd-kit. Scopé par année (store Zustand global). Badge compteur dans la sidebar. Données dans `data/tasks.json`.
- **Sélecteur Année Global**: Store Zustand (`useFiscalYearStore`) avec persistance localStorage. Sélecteur `◀ ANNÉE ▶` dans la sidebar, synchronisé bidirectionnellement avec les sélecteurs année de chaque page (EditorPage, AlertesPage, CloturePage, DashboardPage, ExportPage, ReportsPage, PrevisionnelPage, ComptaAnalytiquePage).
- **GED**: Document library indexing existing files (relevés, justificatifs, rapports) without duplication. Supports free document uploads in `data/ged/{year}/{month}/`. Each document linked to a *poste comptable* with configurable deductibility % (slider 0-100, step 5). Metadata stored in `data/ged/ged_metadata.json`, postes in `data/ged/ged_postes.json`. PDF thumbnails cached in `data/ged/thumbnails/` via pdf2image. Dual tree view (by year / by type).

## PDF Import Pipeline

- **Extraction**: `operation_service.extract_operations_from_pdf()` uses pdfplumber + regex
- **Dates**: Extracted as `DD/MM/YY` or `DD/MM/YYYY`, converted to `YYYY-MM-DD` (required by HTML `input type="date"`)
- **Amounts**: Simple pattern `\d+[,.]\d{2}` tried first (avoids false thousands grouping), last match used (amount is rightmost on line)
- **Exclusion filter**: Lines containing SOLDE, TOTAL, etc. are skipped (balance lines, not operations)
- **Categorization at import**: Basic keyword matching (`_categorize_simple()`) at PDF import — priority order matters (e.g. "Remplaçant" with REMPLA keywords checked before "Revenus" with VIREMENT). Full ML categorization (rules + sklearn) runs **automatically** when a file is loaded in EditorPage (empty categories only). ML model supports substring matching in keywords (e.g. "motifremplacementdr" matches keyword "rempla") and `subcategory_patterns` for pattern-based sous-catégorie prediction. Manual "Recatégoriser IA" button available to force re-categorize all lines.
- **Deduplication**: SHA-256 hash of PDF content, first 8 chars in filenames

## Critical Constraints

- **Python 3.9**: MUST use `from __future__ import annotations` in all backend files. Use `Optional[X]` not `X | None`, use `list[X]` only with future annotations.
- **NaN values**: Operation JSON files may contain NaN floats. The `_sanitize_value()` function in `operation_service.py` handles this.
- **PageHeader**: Uses `actions` prop (not children) for header buttons.
- **Dark theme**: All colors via CSS variables in `index.css` (`bg-background`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`).

## How to Run

```bash
# Backend
cd /path/to/neuronXcompta
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd frontend
npm run dev
```

## Project Structure

```
neuronXcompta/
├── backend/
│   ├── main.py                 # FastAPI entry point
│   ├── core/config.py          # All paths, constants, MOIS_FR, ALLOWED_JUSTIFICATIF_EXTENSIONS, MAGIC_BYTES, GED_DIR, AMORTISSEMENTS_DIR, BAREMES_DIR, TASKS_FILE
│   ├── models/                 # Pydantic schemas (14 files, incl. ged.py, report.py, analytics.py, amortissement.py, simulation.py, template.py, previsionnel.py, task.py)
│   ├── routers/                # API endpoints (20 routers, incl. ged.py, amortissements.py, simulation.py, templates.py, previsionnel.py, tasks.py)
│   └── services/               # Business logic (19 services, incl. ged_service.py, amortissement_service.py, fiscal_service.py, template_service.py, previsionnel_service.py, task_service.py)
├── frontend/
│   └── src/
│       ├── App.tsx             # All 19 routes (Pipeline=/, Dashboard=/dashboard, Tasks=/tasks)
│       ├── api/client.ts       # api.get/post/put/delete/upload/uploadMultiple
│       ├── components/         # 65+ .tsx components (incl. components/ged/, components/amortissements/, components/reports/, components/tasks/)
│       ├── hooks/              # 19 hook files (useApi, useOperations, useJustificatifs, useOcr, useExports, useRapprochement, useRapprochementManuel, useLettrage, useCloture, useSandbox, useAlertes, useGed, useReports, useAmortissements, useSimulation, usePipeline, useTemplates, usePrevisionnel, useTasks)
│       ├── stores/useFiscalYearStore.ts  # Zustand store — année globale persistée en localStorage
│       ├── lib/amortissement-engine.ts  # Moteur de calcul amortissement TypeScript (linéaire + dégressif)
│       ├── lib/fiscal-engine.ts         # Moteur fiscal TypeScript (URSSAF, CARMF, IR, simulation multi-leviers)
│       ├── types/index.ts      # All TypeScript interfaces
│       ├── lib/utils.ts        # cn, formatCurrency, formatDate, MOIS_FR, formatFileTitle
│       └── index.css           # Tailwind @theme with custom colors
├── data/
│   ├── imports/
│   │   ├── operations/         # JSON operation files
│   │   └── releves/            # PDF bank statements
│   ├── amortissements/
│   │   ├── immobilisations.json  # Registre des immobilisations
│   │   └── config.json           # Seuil, durées par défaut, catégories éligibles
│   ├── ged/
│   │   ├── ged_metadata.json   # GED document index
│   │   ├── ged_postes.json     # Postes comptables config
│   │   ├── thumbnails/         # PDF thumbnail cache (PNG)
│   │   └── {year}/{month}/     # Free document uploads
│   ├── previsionnel/
│   │   ├── providers.json          # Fournisseurs récurrents configurés
│   │   ├── echeances.json          # Échéances générées
│   │   └── settings.json           # Paramètres du module
│   ├── templates/
│   │   └── justificatifs_templates.json   # Templates par fournisseur
│   ├── baremes/
│   │   ├── urssaf_2024.json      # Barème URSSAF (PASS, maladie, CSG/CRDS, IJ, CURPS)
│   │   ├── carmf_2024.json       # Barème CARMF (régime base, complémentaire, ASV)
│   │   ├── ir_2024.json          # Barème IR (tranches, décote, PER, Madelin)
│   │   └── odm_2024.json         # Cotisation Ordre des Médecins
│   └── tasks.json              # Tâches kanban (auto + manuelles, toutes années)
├── settings.json               # App settings
└── docs/                       # Documentation
```

## Sidebar Navigation (Pipeline Comptable)

La sidebar est organisée avec un item Pipeline hors-groupe en tête, suivi de 6 groupes :

| Groupe | Pages |
|--------|-------|
| **—** | Pipeline (hors-groupe, en tête) |
| **SAISIE** | Importation, Édition, Catégories, OCR |
| **TRAITEMENT** | Justificatifs, Rapprochement, Compte d'attente |
| **ANALYSE** | Tableau de bord, Prévisionnel, Compta Analytique, Rapports, Simulation BNC |
| **CLÔTURE** | Export Comptable, Clôture, Amortissements |
| **DOCUMENTS** | Bibliothèque (GED) |
| **OUTILS** | Tâches, Agent IA, Paramètres |

## Backend API Endpoints

| Router | Prefix | Key Endpoints |
|--------|--------|---------------|
| operations | `/api/operations` | GET /files, GET/PUT/DELETE /{filename}, POST /import, POST /{filename}/categorize, GET /{filename}/has-pdf, GET /{filename}/pdf |
| categories | `/api/categories` | GET, POST, PUT /{name}, DELETE /{name}, GET /{name}/subcategories |
| ml | `/api/ml` | GET /model, POST /predict, POST /train, POST /rules, POST /backup, POST /restore/{name} |
| analytics | `/api/analytics` | GET /dashboard, GET /summary, GET /trends, GET /anomalies, GET /category-detail, GET /compare, GET /year-overview |
| reports | `/api/reports` | GET /gallery, GET /tree, GET /templates, GET /pending, POST /generate, POST /{filename}/regenerate, POST /{filename}/favorite, POST /compare, PUT /{filename}, GET /preview/{filename}, GET /download/{filename}, DELETE /{filename} |
| queries | `/api/queries` | POST /query, GET/POST/DELETE /queries |
| justificatifs | `/api/justificatifs` | GET /, GET /stats, POST /upload, POST /associate, POST /dissociate |
| ocr | `/api/ocr` | GET /status, GET /history, POST /extract, POST /extract-upload, POST /batch-upload |
| exports | `/api/exports` | GET /periods, GET /list, POST /generate, GET /download/{filename} |
| rapprochement | `/api/rapprochement` | POST /run-auto, POST /associate-manual, GET /unmatched, GET /{filename}/{index}/suggestions, GET /batch-hints/{filename} |
| lettrage | `/api/lettrage` | POST /{filename}/{index}, POST /{filename}/bulk, GET /{filename}/stats |
| cloture | `/api/cloture` | GET /years, GET /{year} |
| alertes | `/api/alertes` | GET /summary, GET /{filename}, POST /{filename}/{index}/resolve, POST /{filename}/refresh |
| sandbox | `/api/sandbox` | GET /events (SSE), GET /list, DELETE /{filename} |
| amortissements | `/api/amortissements` | GET /, GET /kpis, POST /, PATCH /{id}, DELETE /{id}, GET /dotations/{year}, GET /projections, GET /candidates, POST /candidates/immobiliser, POST /candidates/ignore, POST /cession/{id}, GET/PUT /config |
| ged | `/api/ged` | GET /tree, GET /documents, POST /upload, PATCH /documents/{doc_id}, DELETE /documents/{doc_id}, GET /documents/{doc_id}/preview, GET /documents/{doc_id}/thumbnail, POST /documents/{doc_id}/open-native, GET /search, GET /stats, GET/PUT/POST/DELETE /postes, POST /bulk-tag, POST /scan |
| simulation | `/api/simulation` | GET /baremes, GET /baremes/{type}, PUT /baremes/{type}, POST /calculate, GET /taux-marginal, GET /seuils, GET /historique, GET /previsions |
| previsionnel | `/api/previsionnel` | GET /timeline, GET/POST/PUT/DELETE /providers, GET /echeances, GET /dashboard, POST /scan, POST /refresh, POST /echeances/{id}/link, POST /echeances/{id}/prelevements, POST /echeances/{id}/auto-populate, GET/PUT /settings |
| templates | `/api/templates` | GET /, POST /, PUT /{id}, DELETE /{id}, POST /extract, POST /generate, GET /suggest/{file}/{idx} |
| tasks | `/api/tasks` | GET /?year=, POST /, PATCH /{task_id}, DELETE /{task_id}, POST /refresh?year= |
| settings | `/api/settings` | GET, PUT, GET /disk-space, GET /data-stats, GET /system-info |

## Frontend Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | PipelinePage | Pipeline comptable interactif — stepper 6 étapes, progression globale, sélecteur mois/année |
| `/dashboard` | DashboardPage | **Cockpit exercice comptable V2** : sélecteur année, jauge segmentée 6 critères (relevés/catégorisation/lettrage/justificatifs/rapprochement/exports), 4 cartes KPI avec sparkline BNC et delta N-1, grille 12 mois cliquables avec 6 badges d'état + expansion (montants + actions contextuelles), alertes pondérées triées par impact, échéances fiscales (URSSAF/CARMF/ODM), bar chart recettes vs dépenses (Recharts), feed activité récente |
| `/import` | ImportPage | PDF drag-drop import |
| `/editor` | EditorPage | Inline editing, **auto-catégorisation IA au chargement** (vides), bouton "Recatégoriser IA" (tout), **sélecteur année → mois en cascade** avec option **"Toute l'année"** (lecture seule, charge N fichiers en parallèle via `useYearOperations`), **filtres catégorie + sous-catégorie** en cascade, colonnes: Justificatif (trombone), Important (étoile), À revoir (triangle), Pointée (cercle vert), PDF preview |
| `/categories` | CategoriesPage | 4-tab category management |
| `/reports` | ReportsPage | **Rapports V2** : 2 onglets (Générer avec templates rapides + filtres avancés, Bibliothèque avec triple vue arbre par année/catégorie/format), favoris épinglés, comparaison side-by-side de 2 rapports (drawer delta), rappels dans le dashboard, formats PDF (EUR, ligne totaux)/CSV (`;` FR)/Excel (formules SUM), déduplication, index JSON, preview drawer 800px avec édition titre/description |
| `/visualization` | ComptaAnalytiquePage | Analytics avec filtres globaux, drill-down catégorie (drawer sous-catégories), **comparatif périodes avec séparation recettes/dépenses** (2 graphiques, 2 tableaux, delta badges inversés pour revenus, clic catégorie → drawer), tendances (agrégé/catégorie/empilé), anomalies, requêtes personnalisées |
| `/justificatifs` | JustificatifsPage | Galerie, association, PDF preview drawer, sandbox SSE badge (upload retiré — passe par OCR) |
| `/agent-ai` | AgentIAPage | ML model dashboard, rules, training, backups |
| `/export` | ExportPage | Monthly ZIP export with calendar grid |
| `/rapprochement` | RapprochementPage | Auto/manual bank-justificatif reconciliation avec drawer rapprochement manuel (filtres, scores, preview PDF) |
| `/alertes` | AlertesPage | Compte d'attente avec badge alertes, **sélecteur année + boutons mois** |
| `/cloture` | CloturePage | Annual calendar view of monthly accounting completeness |
| `/ocr` | OcrPage | Point d'entrée justificatifs : batch upload **PDF/JPG/PNG** + OCR, test manuel, historique, **templates justificatifs** (création depuis scan, bibliothèque fournisseurs, génération reconstitués) (4 onglets) |
| `/previsionnel` | PrevisionnelPage | **Prévisionnel** : timeline 12 mois charges/recettes (barres empilées Recharts), fournisseurs récurrents (mode facture/échéancier), prélèvements OCR, scan documents, régression recettes, paramètres (3 onglets) |
| `/amortissements` | AmortissementsPage | Registre immobilisations (4 onglets : registre, tableau annuel, synthèse par poste, candidates), drawers (immobilisation avec aperçu tableau temps réel, config seuils/durées, cession avec calcul plus/moins-value), détection auto des opérations candidates (montant > seuil), moteur calcul linéaire/dégressif, plafonds véhicules CO2 |
| `/ged` | GedPage | **Bibliothèque GED** : split layout (arbre 260px + contenu), **double vue arbre (par année / par type)**, grille thumbnails PDF ou liste tableau, drawer preview PDF redimensionnable (400-1200px) + section fiscalité (poste comptable, montant brut, % déductible, montant déductible calculé), drawer postes comptables avec **sliders % déductibilité** (0-100, step 5, couleur dynamique vert/orange/rouge), upload documents libres (drag-drop), recherche full-text (noms + OCR), ouverture native macOS (Aperçu) |
| `/simulation` | SimulationPage | Simulateur BNC 2 onglets : **Optimisation** (leviers Madelin/PER/CARMF/investissement avec sliders temps réel, impact charges URSSAF/CARMF/ODM/IR, taux marginal réel segmenté, comparatif charge/immobilisation, projection dotations 5 ans) + **Prévisions** (historique BNC, projections saisonnières, profil mensuel, tableau annuel avec évolution) |
| `/tasks` | TasksPage | **Tâches Kanban** : 3 colonnes (To do / In progress / Done), drag & drop @dnd-kit, tâches auto (5 détections) + manuelles, scopé par année globale, refresh auto au montage, badge compteur sidebar, formulaire inline création/édition |
| `/settings` | SettingsPage | 5-tab settings (general, theme, export, storage, system) |

## Key Components

### Shared
- `PageHeader` — `{ title, description?, actions?: ReactNode }`
- `MetricCard` — `{ title, value, icon?, trend?, className? }`
- `LoadingSpinner` — `{ text? }`
- `PipelineStepCard` — card expandable avec cercle statut, barre progression, métriques, actions

### Drawers (pattern commun : translateX + backdrop)
- `RapprochementManuelDrawer` — 800px, filtres montant/date/fournisseur, liste scorée, preview PDF iframe
- `CategoryDetailDrawer` — 700px, sous-catégories avec barres, mini BarChart mensuel, liste opérations
- `RapprochementDrawer` — 600px, suggestions auto avec scores de confiance
- `JustificatifDrawer` — preview PDF + infos justificatif
- `QueryDrawer` — constructeur de requêtes personnalisées avec résultats
- `GedDocumentDrawer` — 400-1200px **redimensionnable** (poignée drag bord gauche), preview PDF + fiscalité + tags/notes
- `GedPostesDrawer` — 600px, liste postes avec sliders déductibilité, stats par poste
- `ReportPreviewDrawer` — 800px, preview PDF iframe + metadata + édition titre/description + re-génération + suppression
- `ReportCompareDrawer` — 700px, comparaison side-by-side de 2 rapports avec deltas montants/ops/%
- `ImmobilisationDrawer` — 650px, création/édition immobilisation, aperçu tableau temps réel (moteur TS), section véhicule conditionnelle
- `ConfigAmortissementsDrawer` — 500px, seuil, durées par défaut, catégories éligibles, plafonds véhicules
- `CessionDrawer` — 500px, sortie d'actif avec calcul plus/moins-value et régime fiscal
- `SimulationOptimisationSection` — leviers interactifs (sliders), calcul temps réel, impact charges, taux marginal, comparatif charge/immobilisation
- `SimulationPrevisionsSection` — historique BNC, projections saisonnières, profil mensuel, tableau annuel
- `ReconstituerButton` — bouton contextuel (rapprochement, alertes, éditeur) pour générer un justificatif reconstitué depuis un template fournisseur
- `ReconstituerDrawer` — 600px, formulaire de génération pré-rempli (champs auto/manuels, TVA, preview)

## Patterns to Follow

- **Hooks**: Use TanStack Query (`useQuery`, `useMutation`, `useQueryClient`) for all API calls
- **Styling**: Tailwind classes only, use `cn()` for conditional classes
- **Icons**: Lucide React (already installed)
- **Drawers**: Fixed panel with `translateX` transition + backdrop, 600-800px wide. GedDocumentDrawer is **resizable** (mousedown drag on left edge, min 400px, max 1200px)
- **Forms**: Controlled components with `useState`, mutations with `onSuccess` invalidation
- **Backend services**: Always call `ensure_directories()` at start, use `from __future__ import annotations`
- **SSE**: Use `StreamingResponse` with `text/event-stream`, send initial `data: {"status":"connected"}` to flush the connection
- **Toasts**: Use `react-hot-toast` (`toast.success()`, `toast.error()`) — `<Toaster />` is in `App.tsx`
- **Sidebar sections**: Utilise `NAV_SECTIONS` avec labels de section discrets (uppercase, text-[10px])
- **File selectors**: EditorPage et AlertesPage utilisent un sélecteur en cascade **année → mois** (pas de dropdown unique surchargé). Fichiers triés chronologiquement. `availableYears` et `monthsForYear` via `useMemo`.
- **Year-wide view**: EditorPage propose "Toute l'année" qui charge tous les fichiers en parallèle via `useYearOperations` (hook `useQueries`). Mode **lecture seule** (pas de save/edit). Badge ambre "Lecture seule — Année complète". Filtres et tri fonctionnels.
- **Category/subcategory filters**: Panel Filtres de EditorPage propose un dropdown catégorie + un dropdown sous-catégorie dépendant (peuplé via `subcategoriesMap`). Reset auto de la sous-catégorie au changement de catégorie. Grille 5 colonnes.
- **Comparatif recettes/dépenses**: ComparatifSection sépare les catégories en 2 groupes (recettes si credit > debit, dépenses sinon). 2 graphiques côte à côte avec légendes dynamiques (périodes sélectionnées). 2 tableaux avec colonnes adaptées (Crédit A/B pour recettes, Débit A/B pour dépenses). Delta badges inversés pour les revenus (hausse = vert). Clic catégorie → CategoryDetailDrawer.
- **Auto-categorization**: EditorPage déclenche automatiquement `categorizeMutation` (mode `empty_only`) au chargement d'un fichier via `useEffect` + `useRef` anti-boucle.
- **Image upload**: Justificatifs acceptent PDF/JPG/PNG. Images converties en PDF à l'intake via `_convert_image_to_pdf()` (Pillow). Validation magic bytes multi-format.
- **GED dual tree**: `build_tree()` returns `{"by_type": [...], "by_year": [...]}`. Frontend tabs switch between views. Node IDs encode type/year/month for filter derivation (`year-{y}-{type}-{m}` for by_year, `releve-{y}-{m}` for by_type).
- **GED postes comptables**: 16 postes par défaut (loyer-cabinet, véhicule, téléphone, etc.). Slider 0-100 step 5 avec couleur dynamique (vert/orange/rouge). Postes system non supprimables, custom ajoutables. Stats par poste (nb docs, total brut, total déduit).
- **GED thumbnails**: pdf2image + poppler → PNG 200px de large, cache `data/ged/thumbnails/{md5}.png`. Régénéré si PDF source plus récent. Fallback icône générique si non-PDF ou échec.
- **Reports V2**: Index JSON (`reports_index.json`), réconciliation au boot, 3 templates prédéfinis (BNC annuel, Ventilation charges, Récapitulatif social), format EUR (`1 234,56 €`), déduplication, triple vue arbre (année/catégorie/format), favoris, comparaison, rappels dans le dashboard.
- **Amortissement engine**: Moteur de calcul dupliqué backend Python (`amortissement_service.py`) et frontend TypeScript (`lib/amortissement-engine.ts`). Résultats identiques. Linéaire (pro rata temporis année 1, complément dernière année) et dégressif (bascule en linéaire quand linéaire > dégressif).
- **Candidate detection**: Détection automatique des opérations > seuil (500€ par défaut) dans les catégories immobilisables. Champs `immobilisation_id`, `immobilisation_ignored` sur l'opération.
- **Plafonds véhicules**: Base amortissable plafonnée selon classe CO2 (30000/20300/18300/9900€). Quote-part pro appliquée ensuite.
- **Fiscal engine dual**: Moteur fiscal dupliqué Python (`fiscal_service.py`) et TypeScript (`fiscal-engine.ts`). Résultats identiques à l'arrondi près. Barèmes chargés une seule fois via `useBaremes()`, calcul côté client pour la réactivité des sliders.
- **PER vs Madelin**: PER déduit du revenu imposable (IR) UNIQUEMENT. Madelin déduit du BNC social ET imposable. Cette distinction est critique dans `simulateAll()`.
- **Barèmes versionnés**: Fichiers JSON dans `data/baremes/{type}_{year}.json`. Fallback sur l'année la plus récente. Modifiables via `PUT /api/simulation/baremes/{type}`.
- **Templates justificatifs**: Créés depuis des justificatifs scannés existants (OCR extraction enrichie via Qwen2-VL). Un template = un fournisseur avec aliases de matching. Les reconstitués sont des PDF sobres (ReportLab, A5) sans aucune mention de reconstitution. Traçabilité uniquement dans le `.ocr.json` (`"source": "reconstitue"`). Le bouton `ReconstituerButton` est intégré dans 4 pages (rapprochement, alertes, éditeur, clôture).
- **Pipeline badge** : badge % global dans la sidebar sous l'item Pipeline, clic → navigate('/'), couleur dynamique (vert/ambre/gris). Utilise `usePipeline` pour le mois courant auto-détecté.
- **Global year store** : `useFiscalYearStore` (Zustand + persist localStorage `neuronx-fiscal-year`). Sélecteur `◀ ANNÉE ▶` dans la sidebar, synchronisé avec toutes les pages. Le mois/trimestre restent en `useState` local par page. La sidebar ne sync pas tant que `useOperationFiles` n'a pas chargé (évite d'écraser la valeur persistée avec le fallback année courante).
- **Tasks kanban** : 3 colonnes avec `DndContext` + `useDroppable` + `useSortable` (@dnd-kit). Tâches auto générées par `task_service.generate_auto_tasks(year)` (5 détections scopées par année). Déduplication par `auto_key` dans le router (pas le service). Tâches manuelles supprimables, auto uniquement dismissables. Refresh auto au montage + quand l'année change. Badge compteur (tâches non-done) dans la sidebar sur l'item `/tasks`.

## Dependencies

**Frontend**: react, react-router-dom, @tanstack/react-query, @tanstack/react-table, recharts, react-dropzone, lucide-react, tailwind-merge, clsx, date-fns, zustand, react-hot-toast, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities

**Backend**: fastapi, uvicorn, pandas, numpy, scikit-learn, pdfplumber, reportlab, openpyxl, easyocr, pdf2image, pillow, pytesseract, watchdog
