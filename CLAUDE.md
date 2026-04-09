# CLAUDE.md - NeuronXcompta V3

## Project Overview

NeuronXcompta V3 is a full-stack accounting assistant for a dental practice. Migrated from Streamlit (V2) to React + FastAPI. All 19 pages are fully implemented with zero placeholders. Includes a sandbox watchdog that auto-processes files (PDF/JPG/PNG) dropped into `data/justificatifs/sandbox/` with OCR and real-time SSE notifications. Includes a GED (Gestion Électronique de Documents) module for document library with accounting post deductibility tracking. Includes a Dotations aux Amortissements module with registre des immobilisations, moteur de calcul linéaire/dégressif, et détection automatique des opérations candidates. Includes a Tasks Kanban module for tracking accounting actions (auto-generated + manual tasks) with drag & drop. Includes an Export Comptable V3 module with calendar grid, per-month ZIP generation (PDF+CSV+relevés+rapports+justificatifs), export history with ZIP contents expander, and multi-export selection. Includes an Email Comptable module with universal drawer for sending documents to accountant via SMTP Gmail (HTML emails with logo, single ZIP attachment, document selection by type/period, email history with coverage tracking).

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
- **Ventilation**: Une opération bancaire peut être ventilée en N sous-lignes (≥2) avec catégorie, sous-catégorie, montant et justificatif individuels. sum(montants) doit égaler le montant de l'opération. Catégorie parente = "Ventilé". Les analytics, lettrage, justificatifs et clôture itèrent sur les sous-lignes au lieu de l'op parente. Données inline dans l'opération JSON (champ `ventilation: []`).
- **Export Comptable V3**: Refonte complète de la page Export. Grille calendrier 4×3 avec badges toggle PDF/CSV par mois. Génération ZIP contenant toujours PDF+CSV + relevés bancaires + rapports auto-détectés + justificatifs (architecture dossiers : `releves/`, `rapports/`, `justificatifs/`). Historique des exports avec expander contenu ZIP (noms relevés enrichis "Relevé Mois Année"). Sélection multi-export dans l'historique avec bouton "Envoyer au comptable". Titre auto des rapports via `buildReportTitle()`. Format Excel supprimé. Données dans `data/exports/` + `data/exports/exports_history.json`.
- **Email Comptable**: Drawer universel d'envoi de documents au comptable par SMTP Gmail. Accessible depuis la sidebar (sous Pipeline), la page Exports et la GED. 2 colonnes : sélection documents (filtres type chips + année/mois + recherche) + composition email (destinataires chips, objet/corps auto-générés, pièces jointes, jauge 25 Mo). **Expanders intelligents** : groupes ≥10 docs repliés par défaut, petits groupes ouverts, badge compteur sélection quand replié. **Ordre groupes** : Exports → Rapports → Relevés → Justificatifs → Documents. **Pré-sélection intelligente** : ouverture depuis Export Comptable pré-coche le dernier export + tous les rapports. **Jauge taille temps réel** dans le footer gauche (barre progression bleue/ambre/rouge). Tous les documents sélectionnés sont zippés en un seul `Documents_Comptables_*.zip` avant envoi. Email HTML avec logo en-tête (`logo_lockup_light_400.png` CID inline), footer copyright (`logo_mark_64.png` + © année). Historique des envois dans onglet dédié du drawer (cartes expansibles). Configuration SMTP dans Paramètres > Email (Gmail + app password + destinataires + nom). Données dans `data/email_history.json`. Store Zustand `sendDrawerStore` pour ouverture globale avec pré-sélection.
- **Titre automatique des rapports**: Fonction `buildReportTitle()` compose le titre à partir des catégories sélectionnées + période. Règles : 1 cat → nom exact, 2-4 → liste virgule, 5+ → 3 premières + compteur, toutes → "Toutes catégories". Période : "Mois Année" ou "Année". Champ titre éditable manuellement avec flag `titleManuallyEdited`. Batch 12 mois utilise le titre auto par mois.
- **Tâches Kanban**: Module de suivi des actions comptables avec vue kanban 3 colonnes (To do / In progress / Done). Tâches auto-générées par scan de l'état applicatif (5 détections : opérations non catégorisées, justificatifs en attente, clôture incomplète, mois sans relevé, alertes non résolues) + tâches manuelles. Drag & drop via @dnd-kit. Scopé par année (store Zustand global). Badge compteur dans la sidebar. Données dans `data/tasks.json`.
- **Sélecteur Année Global**: Store Zustand (`useFiscalYearStore`) avec persistance localStorage. Sélecteur `◀ ANNÉE ▶` dans la sidebar, synchronisé bidirectionnellement avec les sélecteurs année de chaque page (EditorPage, AlertesPage, CloturePage, DashboardPage, ExportPage, ReportsPage, PrevisionnelPage, ComptaAnalytiquePage).
- **ML Monitoring**: Système de monitoring de l'agent IA avec logging des prédictions (source, confiance, hallucination), tracking des corrections manuelles, stats agrégées (couverture, correction rate, confusion matrix). Onglet Monitoring dans Agent IA (4 sections : Performance, Fiabilité, Progression, Diagnostic). Carte KPI "Agent IA" dans le Dashboard. Logs dans `data/ml/logs/`.
- **GED V2**: Hub documentaire unifie. 5 vues arbre (periode, annee/type, categorie, fournisseur, type). Metadata enrichi automatiquement : categorie, fournisseur, montant, period, operation_ref — via rapprochement, OCR, save editeur. Rapports integres dans la GED (migration one-shot `reports_index.json`). Backfill automatique des justificatifs traites existants au scan. Barre filtres croises (type, categorie, fournisseur, recherche). Cartes document enrichies (thumbnail, badge categorie, fournisseur, montant, badge reconstitue). Drawer rapport specifique (preview PDF, favori, re-generation, suppression). Mode comparaison rapports. Stats enrichies (par_categorie, par_fournisseur, par_type, non_classes, rapports_favoris). Pending reports via `/api/ged/pending-reports`. URL params `/ged?type=rapport&year=X`. Mapping `POSTE_TO_CATEGORIE` pour classement docs libres. Metadata stored in `data/ged/ged_metadata.json`, postes in `data/ged/ged_postes.json`. PDF thumbnails cached in `data/ged/thumbnails/` via pdf2image.
- **Export Comptable V2**: Règles comptables strictes — ops "perso" exclues du BNC (section séparée), ops sans catégorie en compte d'attente, ventilations explosées en sous-lignes. CSV : séparateur `;`, UTF-8 BOM, CRLF, montants FR (`1 234,56`), colonne Justificatif = nom fichier PDF. PDF : logo, 3 sections colorées (pro/perso/attente), récapitulatif BNC, footer paginé. Nommage `Export_Comptable_ANNEE_Mois.{csv,pdf}`. Fonctions clés : `_prepare_export_operations()`, `_format_amount_fr()`, `_export_filename()`.
- **Auto-pointage**: Setting `auto_pointage` (défaut true). `auto_lettre_complete()` pointe les ops avec catégorie + sous-catégorie + justificatif. `maybe_auto_lettre()` vérifie le setting. Intégré dans PUT operations, POST categorize, POST associate, POST associate-manual. Toggle dans le header Dashboard.
- **Navigation bidirectionnelle Justificatif ↔ Opération**: `find_operations_by_justificatif()` dans justificatif_service. Endpoint `GET /reverse-lookup/{filename}`. Composant `JustificatifOperationLink` (2 états : associé → "Voir l'opération", en attente → suggestions scorées). EditorPage supporte `?file=X&highlight=Y` avec surbrillance permanente.
- **Ops Perso auto-justifiées**: `_mark_perso_as_justified()` marque `Justificatif=true` au save pour la catégorie "Perso".
- **Templates fac-similé**: `FieldCoordinates` sur `TemplateField`. `_enrich_field_coordinates()` via pdfplumber. `_generate_pdf_facsimile()` rasterise le PDF source + masque images produits + remplace date/montant. `_blank_embedded_images()` masque les photos produits.
- **ML Auto-learning**: Les corrections manuelles de catégories dans l'éditeur alimentent automatiquement les données d'entraînement ML au save. `add_training_examples_batch()` déduplique par couple `(libelle, categorie)`. `update_rules_from_operations()` met à jour les `exact_matches` du modèle à règles pour effet immédiat. Filtre : exclut vide, "Autres", "Ventilé".
- **Rapports V2 améliorés**: Checkboxes modernes (toggle 18px) pour sélection catégories avec "Tout sélectionner" + état intermédiaire. Génération batch 12 mois. Bibliothèque : arbre par date/catégorie, sélection multi-rapports avec export ZIP pour comptable (`POST /reports/export-zip`), suppression individuelle/totale avec toast confirmation centré. Logo dans les PDF. Colonnes Justificatif (☑/☐ + nom fichier) et Commentaire dans PDF/CSV.

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
│   ├── models/                 # Pydantic schemas (16 files, incl. ged.py, report.py, analytics.py, amortissement.py, simulation.py, template.py, previsionnel.py, task.py, ml.py, email.py)
│   ├── routers/                # API endpoints (21 routers, incl. ged.py, amortissements.py, simulation.py, templates.py, previsionnel.py, tasks.py, email.py)
│   └── services/               # Business logic (22 services, incl. ged_service.py, amortissement_service.py, fiscal_service.py, template_service.py, previsionnel_service.py, task_service.py, ml_monitoring_service.py, email_service.py, email_history_service.py)
├── frontend/
│   └── src/
│       ├── App.tsx             # All 19 routes (Pipeline=/, Dashboard=/dashboard, Tasks=/tasks)
│       ├── api/client.ts       # api.get/post/put/delete/upload/uploadMultiple
│       ├── components/         # 70+ .tsx components (incl. components/ged/, components/amortissements/, components/reports/, components/tasks/, components/justificatifs/, components/email/, components/common/)
│       ├── hooks/              # 21 hook files (useApi, useOperations, useJustificatifs, useJustificatifsPage, useOcr, useExports, useRapprochement, useRapprochementManuel, useLettrage, useCloture, useSandbox, useAlertes, useGed, useReports, useAmortissements, useSimulation, usePipeline, useTemplates, usePrevisionnel, useTasks, useEmail)
│       ├── stores/useFiscalYearStore.ts  # Zustand store — année globale persistée en localStorage
│       ├── stores/sendDrawerStore.ts     # Zustand store — drawer envoi comptable (ouverture globale avec pré-sélection)
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
│   ├── tasks.json              # Tâches kanban (auto + manuelles, toutes années)
│   ├── email_history.json      # Historique des envois email au comptable
│   └── exports/
│       └── exports_history.json  # Historique des exports générés
├── settings.json               # App settings (incl. email_smtp_user, email_smtp_app_password, email_comptable_destinataires, email_default_nom)
└── docs/                       # Documentation
```

## Sidebar Navigation (Pipeline Comptable)

La sidebar est organisée avec un item Pipeline hors-groupe en tête, suivi de 6 groupes :

| Groupe | Pages |
|--------|-------|
| **—** | Pipeline (hors-groupe, en tête), Envoi comptable (bouton drawer, badge bleu) |
| **SAISIE** | Importation, Édition, Catégories, OCR |
| **TRAITEMENT** | Justificatifs, Compte d'attente |
| **ANALYSE** | Tableau de bord, Prévisionnel, Compta Analytique, Rapports, Simulation BNC |
| **CLÔTURE** | Export Comptable, Clôture, Amortissements |
| **DOCUMENTS** | Bibliothèque (GED) |
| **OUTILS** | Tâches, Agent IA, Paramètres |

## Backend API Endpoints

| Router | Prefix | Key Endpoints |
|--------|--------|---------------|
| operations | `/api/operations` | GET /files, GET/PUT/DELETE /{filename}, POST /import, POST /{filename}/categorize, GET /{filename}/has-pdf, GET /{filename}/pdf |
| categories | `/api/categories` | GET, POST, PUT /{name}, DELETE /{name}, GET /{name}/subcategories |
| ml | `/api/ml` | GET /model, POST /predict, POST /train, POST /train-and-apply, POST /rules, POST /backup, POST /restore/{name}, GET /monitoring/stats, GET /monitoring/health, GET /monitoring/confusion, GET /monitoring/correction-history |
| analytics | `/api/analytics` | GET /dashboard, GET /summary, GET /trends, GET /anomalies, GET /category-detail, GET /compare, GET /year-overview |
| reports | `/api/reports` | GET /gallery, GET /tree, GET /templates, GET /pending, POST /generate, POST /regenerate-all, POST /{filename}/regenerate, POST /{filename}/favorite, POST /{filename}/open-native, POST /compare, POST /export-zip, PUT /{filename}, GET /preview/{filename}, GET /download/{filename}, DELETE /all, DELETE /{filename} |
| queries | `/api/queries` | POST /query, GET/POST/DELETE /queries |
| justificatifs | `/api/justificatifs` | GET /, GET /stats, POST /upload, GET /reverse-lookup/{filename}, POST /associate, POST /dissociate |
| ocr | `/api/ocr` | GET /status, GET /history, POST /extract, POST /extract-upload, POST /batch-upload |
| exports | `/api/exports` | GET /periods, GET /list, GET /status/{year}, GET /available-reports/{year}/{month}, GET /contents/{filename}, POST /generate, POST /generate-month, POST /generate-batch, GET /download/{filename}, DELETE /{filename} |
| email | `/api/email` | POST /test-connection, GET /documents, POST /preview, POST /send, GET /history, GET /coverage/{year} |
| rapprochement | `/api/rapprochement` | POST /run-auto, POST /associate-manual, GET /unmatched, GET /{filename}/{index}/suggestions, GET /batch-hints/{filename} |
| lettrage | `/api/lettrage` | POST /{filename}/{index}, POST /{filename}/bulk, GET /{filename}/stats |
| cloture | `/api/cloture` | GET /years, GET /{year} |
| alertes | `/api/alertes` | GET /summary, GET /{filename}, POST /{filename}/{index}/resolve, POST /{filename}/refresh, POST /export, GET /export/download/{filename} |
| sandbox | `/api/sandbox` | GET /events (SSE), GET /list, POST /process, DELETE /{filename} |
| amortissements | `/api/amortissements` | GET /, GET /kpis, POST /, PATCH /{id}, DELETE /{id}, GET /dotations/{year}, GET /projections, GET /candidates, POST /candidates/immobiliser, POST /candidates/ignore, POST /cession/{id}, GET/PUT /config |
| ged | `/api/ged` | GET /tree, GET /documents, POST /upload, PATCH /documents/{doc_id}, DELETE /documents/{doc_id}, GET /documents/{doc_id}/preview, GET /documents/{doc_id}/thumbnail, POST /documents/{doc_id}/open-native, GET /search, GET /stats, GET/PUT/POST/DELETE /postes, POST /bulk-tag, POST /scan |
| simulation | `/api/simulation` | GET /baremes, GET /baremes/{type}, PUT /baremes/{type}, POST /calculate, GET /taux-marginal, GET /seuils, GET /historique, GET /previsions |
| previsionnel | `/api/previsionnel` | GET /timeline, GET/POST/PUT/DELETE /providers, GET /echeances, GET /dashboard, POST /scan, POST /refresh, POST /echeances/{id}/link, POST /echeances/{id}/prelevements, POST /echeances/{id}/auto-populate, GET/PUT /settings |
| templates | `/api/templates` | GET /, POST /, PUT /{id}, DELETE /{id}, POST /extract, POST /generate, GET /suggest/{file}/{idx} |
| tasks | `/api/tasks` | GET /?year=, POST /, PATCH /{task_id}, DELETE /{task_id}, POST /refresh?year= |
| ventilation | `/api/ventilation` | PUT /{file}/{idx}, DELETE /{file}/{idx}, PATCH /{file}/{idx}/{line_idx} |
| settings | `/api/settings` | GET, PUT, GET /disk-space, GET /data-stats, GET /system-info |

## Frontend Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | PipelinePage | Pipeline comptable interactif — stepper 6 étapes, progression globale, sélecteur mois/année |
| `/dashboard` | DashboardPage | **Cockpit exercice comptable V2** : sélecteur année, jauge segmentée 6 critères (relevés/catégorisation/lettrage/justificatifs/rapprochement/exports), 4 cartes KPI avec sparkline BNC et delta N-1, grille 12 mois cliquables avec 6 badges d'état + expansion (montants + actions contextuelles), alertes pondérées triées par impact, échéances fiscales (URSSAF/CARMF/ODM), bar chart recettes vs dépenses (Recharts), feed activité récente |
| `/import` | ImportPage | PDF drag-drop import |
| `/editor` | EditorPage | Inline editing, **auto-catégorisation IA au chargement** (vides), bouton "Recatégoriser IA" (tout), **sélecteur année → mois en cascade** avec option **"Toute l'année"** (lecture seule), **filtres catégorie + sous-catégorie** en cascade, **option "Non catégorisées"** (`?filter=uncategorized` depuis Pipeline), colonnes: Justificatif (trombone), Important (étoile), À revoir (triangle), Pointée (cercle vert) — **checkboxes modernes** (boutons toggle 22px avec icône/couleur), **toutes les colonnes badge triables**, PDF preview |
| `/categories` | CategoriesPage | 4-tab category management |
| `/reports` | ReportsPage | **Rapports V2** : page génération uniquement (bibliothèque migrée vers GED), checkboxes modernes catégories + "Tout sélectionner" + bouton batch 12 mois, formats PDF (logo, colonnes Justificatif ☑/☐ + Commentaire, EUR)/CSV (`;` FR, 8 colonnes)/Excel, déduplication, bouton "Voir dans la bibliothèque →" (`/ged?type=rapport`), toast post-génération avec lien GED |
| `/visualization` | ComptaAnalytiquePage | Analytics avec filtres globaux, drill-down catégorie (drawer sous-catégories), **comparatif périodes avec séparation recettes/dépenses** (2 graphiques, 2 tableaux, delta badges inversés pour revenus, clic catégorie → drawer), tendances (agrégé/catégorie/empilé), anomalies, requêtes personnalisées |
| `/justificatifs` | JustificatifsPage | **Vue opérations-centrée** : sélecteur année/mois (store Zustand), tableau triable 7 colonnes, filtre sans/avec justif (défaut: sans), 4 MetricCards, **catégorie/sous-catégorie éditables inline** (select dropdowns avec sauvegarde auto), **bandeau CTA "Associer automatiquement"** (ambre, visible quand ops sans justif, toast cliquable pour association manuelle), `JustificatifAttributionDrawer` (800px split resizable, suggestions scorées + **recherche libre** dans tous les justificatifs en attente avec debounce, hover preview PDF, bouton Attribuer orange, score affiché en %), flash highlight, sandbox SSE |
| `/agent-ai` | AgentIAPage | **2 onglets** (Dashboard ML : gauges, actions rapides avec Entraîner + Appliquer bulk, courbe apprentissage, règles, backups \| Monitoring : performance/fiabilité/progression/diagnostic avec tables + Recharts), badge sidebar violet (ops non catégorisées si entraînement > 7j) |
| `/export` | ExportPage | **Export Comptable V3** : 2 onglets (Générer/Historique), grille calendrier 4×3 avec badges toggle PDF+CSV + bouton Exporter + checkbox "Compte d'attente" (précochée), chaque ZIP contient PDF+CSV+relevés+justificatifs+compte_attente (dossiers), copie standalone PDF/CSV dans REPORTS_DIR + enregistrement GED, historique trié par année puis mois (jan→déc) avec expander contenu ZIP + checkboxes multi-sélection + bouton "Envoyer au comptable", bouton PageHeader "Envoyer au comptable" → drawer universel |
| `/rapprochement` | *(redirige vers `/justificatifs`)* | Ancienne page rapprochement, fusionnée dans Justificatifs |
| `/alertes` | AlertesPage | Compte d'attente avec badge alertes, **sélecteur année + boutons mois** |
| `/cloture` | CloturePage | Annual calendar view of monthly accounting completeness |
| `/ocr` | OcrPage | Point d'entrée justificatifs : batch upload **PDF/JPG/PNG** + OCR, test manuel, historique, **templates justificatifs** (création depuis scan, bibliothèque fournisseurs, génération reconstitués) (4 onglets) |
| `/previsionnel` | PrevisionnelPage | **Prévisionnel** : timeline 12 mois charges/recettes (barres empilées Recharts), fournisseurs récurrents (mode facture/échéancier), prélèvements OCR, scan documents, régression recettes, paramètres (3 onglets) |
| `/amortissements` | AmortissementsPage | Registre immobilisations (4 onglets : registre, tableau annuel, synthèse par poste, candidates), drawers (immobilisation avec aperçu tableau temps réel, config seuils/durées, cession avec calcul plus/moins-value), détection auto des opérations candidates (montant > seuil), moteur calcul linéaire/dégressif, plafonds véhicules CO2 |
| `/ged` | GedPage | **Bibliothèque GED V2** : split layout (arbre 260px + contenu), **5 vues arbre (période, année/type, catégorie, fournisseur, type)**, barre filtres croisés (type, catégorie, fournisseur, recherche + reset), grille cartes enrichies (thumbnail, badge catégorie, fournisseur, période, montant, badge reconstitué) ou liste tableau, drawer document redimensionnable (400-1200px) + section fiscalité, **drawer rapport** (preview PDF, favori, re-génération, téléchargement, suppression), drawer postes comptables avec **sliders % déductibilité** (0-100, step 5), mode comparaison rapports, upload documents libres (drag-drop), recherche full-text enrichie (noms + OCR + titres rapports + fournisseur), init filtres via URL params (`/ged?type=rapport&year=2026`), ouverture native macOS |
| `/simulation` | SimulationPage | Simulateur BNC 2 onglets : **Optimisation** (leviers Madelin/PER/CARMF/investissement avec sliders temps réel, impact charges URSSAF/CARMF/ODM/IR, taux marginal réel segmenté, comparatif charge/immobilisation, projection dotations 5 ans) + **Prévisions** (historique BNC, projections saisonnières, profil mensuel, tableau annuel avec évolution) |
| `/tasks` | TasksPage | **Tâches Kanban** : 3 colonnes (To do / In progress / Done), drag & drop @dnd-kit, tâches auto (5 détections) + manuelles, scopé par année globale, refresh auto au montage, badge compteur sidebar, formulaire inline création/édition |
| `/settings` | SettingsPage | 5-tab settings (general, theme, export, storage, system) |

## Key Components

### Shared
- `PageHeader` — `{ title, description?, actions?: ReactNode }`
- `MetricCard` — `{ title, value, icon?, trend?, className? }`
- `LoadingSpinner` — `{ text? }`
- `JustificatifOperationLink` — `{ justificatifFilename, isAssociated, className? }` — bouton "Voir l'opération" (associé) ou suggestions d'attribution (en attente)
- `PipelineStepCard` — card expandable avec cercle statut, barre progression, métriques, actions

### Drawers (pattern commun : translateX + backdrop)
- `RapprochementManuelDrawer` — 800px, filtres montant/date/fournisseur, liste scorée, preview PDF iframe
- `CategoryDetailDrawer` — 700px, sous-catégories avec barres, mini BarChart mensuel, liste opérations
- `RapprochementDrawer` — 600px, suggestions auto avec scores de confiance
- `JustificatifAttributionDrawer` — 800px **split resizable** (poignée drag verticale, min gauche 300px, max 550px, persistance localStorage), panneau gauche : suggestions scorées avec hover 300ms → preview PDF, panneau droit : `<object>` PDF inline. Attribution + dissociation, ReconstituerButton en bas, navigation post-attribution (saut à l'op suivante sans justif)
- `JustificatifDrawer` — preview PDF + infos justificatif (legacy, conservé)
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
- **EditableCell (EditorPage)** : utilise un état local (`useState`) pour éviter la perte de focus à chaque frappe. La valeur est committée au parent au `onBlur` ou `Enter` (pas à chaque `onChange`). Sync depuis le parent via `useRef` pour undo/categorize.
- **Justificatifs vue opérations** : `useJustificatifsPage` hook dédié. Enrichit les opérations avec `_originalIndex` + `_filename` pour transmettre les index corrects au drawer (pas les index filtrés). Mode "Toute l'année" supporte `_sourceFile`. Filtre par défaut "Sans justificatif". Sync année avec données disponibles (fallback première année si store contient une année absente).
- **PDF preview inline** : endpoint `/preview` utilise `FileResponse` avec `content_disposition_type="inline"` (pas `attachment`). Drawer utilise `<object type="application/pdf">` avec fallback lien. Basename extrait de `Lien justificatif` via `.split('/').pop()` car le champ peut contenir un chemin avec dossier (`traites/...`).
- **Image upload**: Justificatifs acceptent PDF/JPG/PNG. Images converties en PDF à l'intake via `_convert_image_to_pdf()` (Pillow). Validation magic bytes multi-format.
- **GED V2 tree**: `build_tree()` returns `{"by_period": [...], "by_category": [...], "by_vendor": [...], "by_type": [...], "by_year": [...]}`. Frontend GedTreePanel with 5 tab icons. Node IDs encode filters (`period-{y}-T{q}`, `cat-{name}`, `vendor-{slug}-{y}`, `releve-{y}-{m}`, `year-{y}-{type}-{m}`). `deriveFiltersFromNode()` in GedTreePanel.tsx converts nodeId → GedFilters. GedFilterBar syncs cross-filters (type, category, vendor, search) bidirectionally with tree selection. URL params read on mount via `useSearchParams`. Enrichment: `enrich_metadata_on_association()`, `enrich_metadata_on_ocr()`, `propagate_category_change()` called from rapprochement, OCR, editor save. `backfill_justificatifs_metadata()` enriches existing traités at scan. `POSTE_TO_CATEGORIE` mapping for category tree classification of docs libres.
- **GED postes comptables**: 16 postes par défaut (loyer-cabinet, véhicule, téléphone, etc.). Slider 0-100 step 5 avec couleur dynamique (vert/orange/rouge). Postes system non supprimables, custom ajoutables. Stats par poste (nb docs, total brut, total déduit).
- **GED thumbnails**: pdf2image + poppler → PNG 200px de large, cache `data/ged/thumbnails/{md5}.png`. Régénéré si PDF source plus récent. Fallback icône générique si non-PDF ou échec.
- **Reports V2**: Index JSON (`reports_index.json`), réconciliation au boot, 3 templates prédéfinis (BNC annuel, Ventilation charges, Récapitulatif social), format EUR (`1 234,56 €`), déduplication, arbre par date/catégorie, favoris, comparaison, rappels dans le dashboard. PDF avec logo (`backend/assets/`), colonnes Justificatif (☑/☐ + nom fichier) et Commentaire (italique). CSV 8 colonnes avec justificatif et commentaire. Checkboxes modernes toggle 18px pour sélection catégories (avec "Tout sélectionner" en 1er item + état intermédiaire Minus). Batch génération 12 mois. Export ZIP multi-rapports pour comptable. Suppression avec toast confirmation centré. Ouverture native via `POST /{filename}/open-native`.
- **Export Comptable V2**: `_prepare_export_operations()` classe en 3 groupes (pro/perso/attente). Ventilations explosées. CSV : `;`, BOM, CRLF, montants FR. PDF : logo, sections colorées `#D5E8F0`, totaux `#E8E8E8`, récapitulatif, footer paginé. Nommage `Export_Comptable_YYYY-MM_Mois`. Helpers : `_format_amount_fr()`, `_export_filename()`.
- **Export Compte d'Attente**: Export PDF/CSV des opérations en compte d'attente par mois ou année. Nommage `compte_attente_{mois}.{ext}` / `compte_attente_{année}.{ext}`. Enregistrement automatique dans la GED comme rapport (`report_type: "compte_attente"`). Déduplication à la régénération. Intégré dans l'Export Comptable via `include_compte_attente` (défaut True, génère PDF + CSV dans le ZIP sous `compte_attente/`). Cas 0 opérations : fichier généré quand même (preuve mois clean). Logo `logo_lockup_light_400.png`. Service dédié `alerte_export_service.py`.
- **ML Auto-learning au save**: Le PUT `/api/operations/{filename}` extrait les opérations catégorisées (exclut vide/Autres/Ventilé), nettoie les libellés via `clean_libelle()`, et appelle `add_training_examples_batch()` + `update_rules_from_operations()`. Déduplication par `(libelle, categorie)`. Effet immédiat sur les `exact_matches`, effet différé sur sklearn via "Entraîner + Appliquer".
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
- **Ventilation opérations** : bouton Scissors dans EditorPage ouvre VentilationDrawer (600px). Sous-lignes indentées sous l'op parente. sum(montants) == montant op (tolérance 0.01€). Catégorie parente = "Ventilé". Rapprochement par sous-ligne via `ventilation_index`. Analytics/clôture itèrent les sous-lignes.
- **Checkboxes modernes (EditorPage)** : composant `CheckboxCell` générique — boutons toggle 22px arrondis avec `border-2`, icône blanche quand coché (Star/AlertTriangle/Check/CheckCircle2), bordure colorée subtile au repos. Props : `colorClass`, `uncheckedColor`, `icon`. Les 4 colonnes badge (Justificatif, Important, A_revoir, Pointée) sont **triables** via `sortingFn` custom.
- **Filtre uncategorized (EditorPage)** : param URL `?filter=uncategorized` active un filtre custom `__uncategorized__` sur la colonne Catégorie (matche vide + "Autres"). Bandeau warning avec compteur + bouton "Retirer le filtre". Pipeline navigue vers `/editor?filter=uncategorized` depuis l'étape Catégorisation.
- **Auto-rapprochement** : `run_auto_rapprochement()` chaîné automatiquement après OCR dans les 3 points d'entrée (upload justificatifs, batch OCR, sandbox watchdog). Seuil 0.80 (ex 0.95). `score_fournisseur()` utilise le matching par sous-chaîne en plus du Jaccard (ex: "amazon" dans "PRLVSEPAAMAZONPAYMENT" → 1.0). Bouton "Associer automatiquement" sur JustificatifsPage avec bandeau CTA contextuel + toast cliquable pour association manuelle.
- **Recherche libre drawer attribution** : `JustificatifAttributionDrawer` supporte la recherche dans tous les justificatifs en attente via `GET /justificatifs/?status=en_attente&search=...` (debounce 300ms). Résultats affichés sous les suggestions scorées. Bouton Attribuer orange (`bg-warning`).

## Dependencies

**Frontend**: react, react-router-dom, @tanstack/react-query, @tanstack/react-table, recharts, react-dropzone, lucide-react, tailwind-merge, clsx, date-fns, zustand, react-hot-toast, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities

**Backend**: fastapi, uvicorn, pandas, numpy, scikit-learn, pdfplumber, reportlab, openpyxl, easyocr, pdf2image, pillow, pytesseract, watchdog
