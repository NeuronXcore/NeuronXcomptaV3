# Architecture Technique

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│              http://localhost:5173                        │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Components│  │  Hooks   │  │  Types   │              │
│  │  (30+.tsx)│  │(TanStack)│  │(index.ts)│              │
│  └─────┬─────┘  └─────┬────┘  └──────────┘              │
│        │              │                                  │
│        └──────┬───────┘                                  │
│               │                                          │
│         ┌─────▼─────┐                                    │
│         │ api/client │ ──── fetch('/api/...')            │
│         └─────┬──────┘                                   │
└───────────────┼──────────────────────────────────────────┘
                │  Vite proxy /api → :8000
                ▼
┌───────────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                       │
│              http://localhost:8000                         │
│                                                           │
│  ┌────────────┐     ┌─────────────┐     ┌──────────────┐ │
│  │  Routers   │ ──▶ │  Services   │ ──▶ │  Data (JSON) │ │
│  │  (20 files)│     │  (19 files) │     │  data/       │ │
│  └────────────┘     └─────────────┘     └──────────────┘ │
│        │                   │                              │
│  ┌─────▼──────┐     ┌─────▼──────┐                       │
│  │   Models   │     │  ML Models │                       │
│  │  (Pydantic)│     │  (sklearn) │                       │
│  └────────────┘     └────────────┘                       │
└───────────────────────────────────────────────────────────┘
```

## Flux de données

### Pipeline comptable (sidebar)

```
PIPELINE (hors-groupe, page d'accueil /)
  └─ Badge % global du mois courant

SAISIE → TRAITEMENT → ANALYSE → CLÔTURE → DOCUMENTS → OUTILS

Importation      Justificatifs      Tableau de bord     Export Comptable    Bibliothèque    Tâches
Édition          Compte d'attente   Prévisionnel        Clôture             (GED)           Agent IA
Catégories                          Compta Analytique   Amortissements                      Paramètres
OCR                                 Rapports
                                    Simulation BNC
```

### Importation d'un relevé

```
PDF Upload → operations router → pdf_service.extract_operations_from_pdf()
  → Détection doublons (hash MD5)
  → Parsing tables pdfplumber
  → Sauvegarde JSON dans data/imports/operations/, PDF dans data/imports/releves/
  → Réponse : opérations extraites
```

### Upload justificatifs (OCR = point d'entrée)

```
Batch PDF/JPG/PNG → POST /api/ocr/batch-upload
  → Si image (JPG/PNG) : _convert_image_to_pdf() via Pillow → bytes PDF
  → justificatif_service.upload_justificatifs() (validation magic bytes, sauvegarde en_attente/)
  → ocr_service.extract_or_cached() pour chaque fichier (synchrone)
  → auto_rename_from_ocr() → délègue à rename_service.compute_canonical_name() (filename-first puis OCR fallback)
  → renomme en fournisseur_YYYYMMDD_montant.XX.pdf (ou suffix _fs pour les fac-similés reconstitués)
  → Retour : résultats avec données OCR + auto_renamed flag

Alternative : Sandbox watchdog
  → Dépôt PDF/JPG/PNG dans data/justificatifs/sandbox/
  → Si image : conversion PDF + écriture en_attente/ + suppression image
  → Si PDF : shutil.move vers en_attente/
  → OCR + auto-rename + SSE notification enrichie (auto_renamed + original_filename + supplier + best_date + best_amount)
  → Frontend : SandboxArrivalToast (toast riche global via useSandbox() lifté dans AppLayout)
     - Gradient violet→indigo, pulse ring, affichage supplier/date/amount, badge AUTO
     - CTA "Voir dans l'historique" → /ocr?tab=historique&sort=scan_date&highlight={filename}
     - Flash-highlight + scroll-into-view sur la row OCR cible (CSS animate-ping-slow 2s)

Renommage manuel : POST /api/justificatifs/{filename}/rename
  → rename_justificatif() : PDF + .ocr.json + associations ops + GED metadata
  → _invalidate_thumbnail_for_path() appelé avant move (purge du cache GED thumbnails)
  → Frontend : FilenameEditor inline-editable avec suggestion convention OCR

Onglet "Gestion OCR" (ex-Historique) dans /ocr :
  → Tableau trié par scan_date (processed_at) / date (best_date) / supplier / confidence
  → Bouton crayon par ligne → OcrEditDrawer (720px)
     - Édition supplier/date/montant (pills candidats OCR + inputs manuels)
     - Dropdowns catégorie / sous-catégorie (persistés en hints dans .ocr.json)
     - Dropdown op selector (50 candidats filtrés par cat)
     - Preview PDF iframe 220×300 cliquable → PreviewSubDrawer grand format
     - handleValidate : chain PATCH OCR → rename si canonique → associate si op → close
  → Bouton orange "Scanner & Renommer" → ScanRenameDrawer
     - Enrichit les buckets skipped via SkippedItemEditor inline (édition + op selector + rename & associate)
     - Chain run_auto_rapprochement() post-apply (retour auto_associated + strong_suggestions)

Formats acceptés : PDF, JPG, JPEG, PNG (config.ALLOWED_JUSTIFICATIF_EXTENSIONS)
Validation : magic bytes (config.MAGIC_BYTES), limite 10 Mo
Images converties en PDF à l'intake, original non conservé
```

### Thumbnail cache lifecycle (GED)

```
Les thumbnails PDF sont cachés dans data/ged/thumbnails/{md5}.png (clé = doc_id relatif à BASE_DIR).
Bug historique : 236 orphelins dus à des moves/renames sans invalidation du cache.

Fix : _invalidate_thumbnail_for_path(abs_path) appelé avant chaque opération destructive
  - justificatif_service.associate() : avant move en_attente → traites
  - justificatif_service.dissociate() : avant move traites → en_attente
  - justificatif_service.rename_justificatif() : avant le rename
  - justificatif_service.delete_justificatif() : avant delete
  → calcule le doc_id, appelle ged_service.delete_thumbnail_for_doc_id(doc_id)

En parallèle, _update_ged_metadata_location(filename, new_location) met à jour :
  - La clé dict dans ged_metadata.json
  - Le champ doc_id
  - Le champ ocr_file
Appelé lors des moves associate/dissociate.

Endpoint cross-location : GET /api/justificatifs/{filename}/thumbnail
  → Résout automatiquement en_attente/ puis traites/ via get_justificatif_path()
  → Délègue à ged_service.get_thumbnail_path() (génère à la volée si absent)
  → Utilisé par Thumbnail, SuggestionCard, SkippedItemEditor, OcrEditDrawer
```

### Rapprochement bancaire (scoring v2)

```
Scoring v2 : 4 critères orthogonaux + pondération dynamique
  compute_score(ocr_data, operation, override_montant?, override_categorie?, override_sous_categorie?)
    → score_montant(ocr, op) :
       paliers graduels 0/1%/2%/5% → 1.0/0.95/0.85/0.60/0.0
       + test HT/TTC (plancher 0.95 si ocr / TVA ≈ op pour TVA 20/10/5,5%)
    → score_date(ocr, op) :
       paliers symétriques ±0/±1/±3/±7/±14 → 1.0/0.95/0.80/0.50/0.20/0.0
    → score_fournisseur(ocr, op) :
       max(substring, Jaccard, Levenshtein)
       - substring : "amazon" dans "PRLVSEPAAMAZONPAYMENT" → 1.0
       - Jaccard : tokens normalisés hors stopwords
       - Levenshtein : difflib.SequenceMatcher, seuil 0.5
    → score_categorie(ocr_fournisseur, op_categorie, op_sous_categorie?) :
       - ml_service.predict_category(fournisseur) → rules-based prioritaire
         fallback sklearn via evaluate_hallucination_risk (confiance ≥ 0.5)
       - Compare avec op_categorie : 1.0 match / 0.6 cat match sub ≠ / 0.0 mismatch
       - Retourne None si non-inférable → critère neutre
  compute_total_score(M, D, F, C) :
    - Si C non-None : 0.35*M + 0.25*F + 0.20*D + 0.20*C
    - Si C None : redistribution 0.4375*M + 0.3125*F + 0.25*D
  Retourne {total, detail: {montant, date, fournisseur, categorie}, confidence_level}

Rapprochement automatique : POST /rapprochement/run-auto
  → Parcourt justificatifs en_attente avec OCR
  → compute_score pour chaque (op, justif), best_match si score ≥ 0.80 ET écart ≥ 0.02 avec 2ème
  → Chaîné automatiquement après OCR (3 points d'entrée) :
    - _run_ocr_background() dans justificatifs.py (upload)
    - batch_upload() dans ocr.py
    - _process_file() dans sandbox_service.py

Rapprochement manuel : RapprochementWorkflowDrawer unifié (700px)
  → 2 modes : "Toutes sans justificatif" (flux) / "Opération ciblée" (mono-op)
  → Suggestions scorées : GET /rapprochement/{file}/{index}/suggestions
  → Recherche libre exclusive : GET /justificatifs/?status=en_attente&search=...
  → ScorePills (frontend) : 3-4 pills colorées M/D/F/C + total, delta jours inline, couleurs dynamiques
  → Thumbnails PDF lazy-loaded via IntersectionObserver (rootMargin 200px)
  → Attribuer via POST /rapprochement/associate-manual (rapprochement_score + ventilation_index)
  → Auto-skip post-attribution en mode flux, raccourcis ⏎/←/→/Esc

Bouton "Associer automatiquement" sur JustificatifsPage :
  → Bandeau CTA contextuel (visible quand ops sans justificatif)
  → Toast cliquable → filtre "Sans justif." + ouvre drawer mode flux
```

### Rename service filename-first (backend)

```
rename_service.py : module pur qui porte la logique filename-first
  CANONICAL_RE = ^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}(_[a-z0-9]+)*\.pdf$
  FACSIMILE_RE = _fs(_\d+)?\.pdf$
  GENERIC_FILENAME_PREFIXES = {facture, justificatif, document, scan, receipt, invoice, reconstitue}

  is_canonical(name) : matche CANONICAL_RE
  is_facsimile(name) : FACSIMILE_RE OR startsWith("reconstitue_") (legacy)
  normalize_filename_quirks(name) : .pdf.pdf, NNpdf.pdf, name (1).pdf
  try_parse_filename(name) → (supplier, YYYYMMDD, amount, suffix) | None
    - 3 regex tolérantes (underscore, dash, pas de séparateur)
    - Garde-fous : supplier non-générique, date plausible 2000-2100, montant ≤ 100 000 €
  build_from_parsed(supplier, date, amount, suffix) : reconstruit canonique avec point décimal
  is_suspicious_supplier(raw) : vide, len < 3, dans SUSPICIOUS_SUPPLIERS set
  _load_ocr_cache(pdf_path) → (extracted_data, is_reconstitue) | None
    - Reconstitue : champs à la racine (best_date, best_amount, supplier, source)
    - OCR normal : nested dans extracted_data, status doit être success
  _inject_fs_suffix(canonical_name) : insère _fs avant .pdf pour les fac-similés
  deduplicate_against(target_dir, desired_name, source_path) : self-collision-aware

  compute_canonical_name(filename, ocr_data?, source_dir?, is_reconstitue?) → (new_name, source) | None
    Stratégie 1 : filename-first via try_parse_filename + build_from_parsed
    Stratégie 2 : OCR fallback (si ocr_data fourni + supplier non-suspect)
    Injecte _fs si is_reconstitue = True

  scan_and_plan_renames(directory, force_generic?) → ScanPlan
    Walk *.pdf, classifie en 6 buckets :
      already_canonical, to_rename_from_name (SAFE), to_rename_from_ocr (review),
      skipped_no_ocr, skipped_bad_supplier, skipped_no_date_amount

Appelé depuis :
  - justificatif_service.auto_rename_from_ocr() (post-OCR via 3 entry points)
  - routers/justificatifs.scan_rename() (POST /api/justificatifs/scan-rename)
  - scripts/rename_justificatifs_convention.py (CLI thin wrapper)

Convention canonique : fournisseur_YYYYMMDD_montant.XX.pdf (point décimal)
Suffix _fs : supplier_YYYYMMDD_montant.XX_fs.pdf pour les fac-similés reconstitués
Suffix _a/_b/_2 : autorisé pour ventilation multi-justificatifs + déduplication

Endpoint scan-rename :
  POST /api/justificatifs/scan-rename?apply=&apply_ocr=&scope=both
  Dry-run par défaut, apply=true pour exécuter
  scope=both fusionne en_attente/ + traites/ (398 fichiers scannés)
  Frontend : ScanRenameDrawer (OCR Historique tab) avec preview + confirm
```

### Intégrité des liens justificatifs (scan + répare auto)

```
justificatif_service.py : service de réparation des incohérences disque ↔ ops

  scan_link_issues() → dict typé (6 catégories, jamais None)
    1. _collect_referenced_justificatifs() : walk IMPORTS_OPERATIONS_DIR/operations_*.json
       → {filename: [(op_file, op_idx)]}
    2. Enum traites_pdfs = {p.name for p in TRAITES.glob("*.pdf")}
    3. Enum attente_pdfs = {p.name for p in EN_ATTENTE.glob("*.pdf")}
    4. Intersections :
       A : attente_pdfs ∩ referenced → check dst.exists()
           - Both : _md5_file(src) == _md5_file(dst) ?
             - identique → duplicates_to_delete_attente (A1)
             - différent → hash_conflicts (SKIP, log warning)
           - Attente only → misplaced_to_move_to_traites (A2)
       B : traites_pdfs - referenced → orphan
           - Dup existe en attente : hashes identiques ?
             - identique → orphans_to_delete_traites (B1)
             - différent → hash_conflicts (SKIP)
           - Traites only → orphans_to_move_to_attente (B2)
       C : referenced - (traites ∪ attente) → ghost_refs (Justificatif=true mais fichier absent)

  apply_link_repair(plan=None) → dict résultat typé
    - Si plan=None, re-scanne
    - Ordre : A1 delete → A2 move → B1 delete → B2 move → C clear op.Lien
    - Hash conflicts : count uniquement, jamais modifiés (log warning)
    - Chaque action propage le .ocr.json compagnon (_move_pdf_with_ocr, _delete_pdf_with_ocr)
    - Ghost refs groupés par op_file pour 1 seul load/save par fichier
    - Retourne {deleted_from_attente, moved_to_traites, deleted_from_traites,
                moved_to_attente, ghost_refs_cleared, conflicts_skipped, errors}

  Helpers :
    _md5_file(path, block=65536) : MD5 streamé par blocs
    _move_pdf_with_ocr(src, dst) : shutil.move PDF + .ocr.json compagnon
    _delete_pdf_with_ocr(path) : unlink PDF + .ocr.json

Points d'appel :
  1. Backend lifespan (backend/main.py) : appel silencieux au démarrage
     - Log INFO si actions appliquées, WARNING si conflits restants
     - Intégré après reconcile_index() pour report_service
  2. GET /api/justificatifs/scan-links : dry-run typé pour l'UI
  3. POST /api/justificatifs/repair-links : apply pour l'UI
  4. Script CLI scripts/repair_justificatif_links.py (thin wrapper)

Frontend :
  - Hooks useScanLinks (enabled: false, refetch manuel) / useRepairLinks
  - Types ScanLinksResult + RepairLinksResult
  - Section JustificatifsIntegritySection dans SettingsPage > Stockage
  - 6 IntegrityMetric colorés (grid-cols-2 md:grid-cols-3)
  - Bouton Réparer avec compteur totalFixable + conflicts en <details>

Invariant garanti :
  Les conflits de hash (duplicatas aux versions divergentes) ne sont JAMAIS
  modifiés automatiquement. L'utilisateur doit les résoudre manuellement après
  comparaison du contenu des 2 versions.
```

### Redémarrage backend depuis l'UI (dev only)

```
POST /api/settings/restart
  → écrit un timestamp dans backend/_reload_trigger.py (sentinel vide)
  → uvicorn --reload détecte la modification et redémarre automatiquement
  → retourne {"restarting": true, "sentinel": "_reload_trigger.py"}

backend/_reload_trigger.py : fichier sentinel
  - Contient juste RELOAD_TIMESTAMP = N
  - Jamais importé par le code applicatif (volontaire)
  - Réécrit à chaque POST /restart avec un nouveau timestamp

Hook useRestartBackend (useApi.ts) :
  1. POST /settings/restart
  2. sleep 1500ms (laisser uvicorn kill l'ancien process)
  3. Poll GET /api/settings toutes les 500ms (timeout 20s)
  4. window.location.reload() hard pour re-fetch le bundle frontend

Bouton Restart dans JustificatifsIntegritySection :
  - window.confirm() avant déclenchement
  - Icône Power, tint warning amber
  - Désactivé pendant restart.isPending
  - Usage principal : rejouer la réparation des liens au boot après fix manuel

Contrainte : fonctionne UNIQUEMENT en dev (uvicorn --reload). En production,
un supervisor externe (systemd, launchd, PM2) serait nécessaire pour relancer
le process après un SIGTERM.
```

### Catégorisation IA

```
Libellé → ml router → ml_service.predict_category()
  1. Correspondance exacte (model.json → exact_matches)
  2. Mots-clés (model.json → keywords) — exact word match + substring match
     Ex: "motifremplacementdr" matche keyword "rempla" via substring (score 0.8)
  3. Scikit-learn (sklearn_model.pkl + vectorizer.pkl)
  → Score de confiance + risque d'hallucination

Sous-catégorie → ml_service.predict_subcategory()
  1. Correspondance exacte (model.json → subcategories)
  2. Pattern matching (model.json → subcategory_patterns) — substring dans le libellé
     Ex: libellé contenant "rempla" → sous-catégorie "Honoraires"

Import PDF → _categorize_simple() : keywords par priorité (Remplaçant avant Revenus)

Auto-catégorisation (EditorPage) :
  → Au chargement d'un fichier, useEffect déclenche POST /{filename}/categorize (mode: empty_only)
  → Seules les opérations sans catégorie ou "Autres" sont traitées
  → useRef anti-boucle empêche le re-déclenchement (lastAutoCategorizedFile)
  → Bouton "Recatégoriser IA" : force mode "all" (recatégorise toutes les lignes)

Entraîner + Appliquer (AgentIAPage) :
  → POST /api/ml/train-and-apply?year=YYYY
  → Entraîne sklearn puis categorize_file() sur tous les fichiers de l'année (mode empty_only)
  → Logique de catégorisation extraite dans operation_service.categorize_file() (source unique)

ML Monitoring :
  → Chaque catégorisation logge un PredictionBatchLog dans data/ml/logs/predictions/
  → Chaque save éditeur (PUT /{filename}) détecte les corrections par comparaison
  → Corrections loggées dans data/ml/logs/corrections/corrections_YYYY_MM.json
  → Entraînements loggés dans data/ml/logs/trainings.json
  → GET /monitoring/stats agrège : couverture, confiance, corrections, hallucinations, confusion
  → GET /monitoring/health : KPI résumé pour Dashboard (coverage, correction_trend, alert)

ML Auto-learning (au save éditeur) :
  → PUT /api/operations/{filename} (après monitoring)
  → Filtre ops avec catégorie valide (exclut vide, "Autres", "Ventilé")
  → clean_libelle() sur chaque libellé
  → add_training_examples_batch() : déduplique par (libelle, categorie), append dans training_examples.json
  → update_rules_from_operations() : met à jour exact_matches + subcategories dans model.json
  → Effet immédiat : prochaine auto-catégorisation utilise les nouvelles règles exactes
  → Effet différé : "Entraîner + Appliquer" utilise les nouvelles données sklearn
  → Tout en try/except : ne bloque jamais le save
```

### Export Comptable V3

```
Architecture ZIP (generate_single_export) :
  Export_Comptable_{YYYY}_{Mois}_{PDF|CSV}_{timestamp}.zip
  ├── Export_Comptable_{YYYY}_{Mois}.pdf    (toujours inclus)
  ├── Export_Comptable_{YYYY}_{Mois}.csv    (toujours inclus)
  ├── releves/
  │   └── pdf_{hash}.pdf                     (relevé bancaire si trouvé)
  ├── justificatifs/
  │   └── *.pdf                              (justificatifs associés aux opérations)
  └── compte_attente/                        (si include_compte_attente=true, défaut)
      ├── compte_attente_{mois}.pdf
      └── compte_attente_{mois}.csv

Post-génération :
  → Copie standalone PDF+CSV dans data/reports/ (scanné par la GED)
  → Enregistrement GED via register_rapport() (report_type: "export_comptable")
  → Déduplication : régénérer écrase le fichier et met à jour l'entrée GED

_prepare_export_operations(operations, filename) :
  → Itère les opérations, explose les ventilations en sous-lignes [V1/N]
  → Classe en 3 groupes :
    - pro : catégorie valide (BNC)
    - perso : categorie.lower() == "perso" (exclues du BNC)
    - attente : vide, None, "Autres", "Ventilé" sans sous-lignes
  → Trie chaque groupe par date ASC
  → Calcule totaux : recettes_pro, charges_pro, solde_bnc, total_perso, total_attente

CSV : séparateur ;, UTF-8 BOM, CRLF, montants FR via _format_amount_fr()
PDF : paysage A4, logo backend/assets/, footer Page X/Y + NeuronXcompta

Statut mensuel (get_month_export_status) :
  → 12 mois × { nb_operations, has_data, has_pdf, has_csv, nb_releves, nb_rapports, nb_justificatifs }
  → Croisement fichiers opérations + exports_history.json

Historique (exports_history.json) :
  → Log automatique à chaque génération (_log_export)
  → Entrées : id, year, month, format, filename, title, nb_operations, generated_at

Batch (generate_batch_export) :
  → ZIP multi-mois avec sous-dossiers {Mois}_{Année}/
  → Chaque sous-dossier contient la même architecture que l'export unitaire
```

### Export Compte d'Attente

```
Service dédié : alerte_export_service.py

Nommage :
  Par mois : compte_attente_{mois_minuscule}.{ext}  (ex: compte_attente_janvier.pdf)
  Par année : compte_attente_{année}.{ext}           (ex: compte_attente_2025.csv)

Collecte (_collect_attente_operations) :
  → Itère les fichiers d'opérations pour l'année/mois
  → Filtre : compte_attente == True OU catégorie vide/None/"Autres"/"Non catégorisé"/"?"
  → Tri par date croissante

CSV : BOM UTF-8, séparateur ;, CRLF, montants FR
  Colonnes : Date, Libellé, Catégorie, Sous-catégorie, Débit, Crédit, Type alerte, Commentaire
  Totaux en bas (débit, crédit, solde, nb opérations)

PDF : paysage A4, logo backend/assets/logo_lockup_light_400.png
  Tableau 7 colonnes, alternance couleurs, header violet
  Récapitulatif : total débits/crédits/solde + comptage par type d'alerte
  Footer paginé : Page X + NeuronXcompta + période + date génération

Cas 0 opérations : fichier généré avec mention "Aucune opération en compte d'attente"

GED : enregistrement via register_rapport() (report_type: "compte_attente")
  Stockage dans data/reports/ (scanné par la GED) + copie dans data/exports/ (download)
  Déduplication : même year/month/format → écrasement + mise à jour entrée GED

Intégration Export Comptable :
  → include_compte_attente (défaut true) dans GenerateExportRequest et GenerateMonthRequest
  → Génère PDF + CSV dans le dossier compte_attente/ du ZIP
```

### Email Comptable

```
Envoi email au comptable (send_email) :
  1. Résoudre les chemins (_resolve_document_path) par type :
     - export → EXPORTS_DIR
     - rapport → REPORTS_DIR, RAPPORTS_DIR
     - releve → IMPORTS_RELEVES_DIR
     - justificatif → JUSTIFICATIFS_TRAITES_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR
     - ged → GED_DIR (récursif)
  2. Créer un ZIP temporaire (_create_zip) :
     Documents_Comptables_{timestamp}.zip
     ├── exports/
     ├── rapports/
     ├── releves/
     ├── justificatifs/
     └── documents/
  3. Générer le HTML brandé (generate_email_html) :
     - Template externe backend/templates/email_template.html (tables, compatible Gmail/Outlook)
     - En-tête : logo lockup 200px entre filets violets #534AB7, titre contextuel
     - Mention "Email généré par NeuronXcompta"
     - Introduction contextuelle + arborescence ZIP (_build_zip_tree ou _build_doc_tree)
     - Signature + footer copyright
     - Logos : CID pour envoi réel, base64 data-URI pour preview (paramètre for_preview)
  4. Construire le mail MIME :
     MIMEMultipart('mixed')
     ├── MIMEMultipart('related')
     │   ├── MIMEMultipart('alternative')
     │   │   ├── MIMEText(corps, 'plain')      ← fallback texte (generate_email_body_plain)
     │   │   └── MIMEText(html, 'html')         ← template HTML brandé
     │   ├── MIMEImage(logo_lockup_light_400.png, CID: logo_main)
     │   └── MIMEImage(logo_mark_64.png, CID: logo_mark)
     └── MIMEBase(ZIP)                           ← pièce jointe unique
  5. Envoyer via SMTP Gmail (STARTTLS port 587)
  6. Logger dans email_history.json

Preview (POST /preview) :
  → EmailPreviewRequest (documents seuls, sans destinataires)
  → Retourne objet + corps (plain text) + corps_html (template brandé, logos base64)
  → Frontend : toggle HTML/Texte dans le drawer (iframe srcDoc / textarea)

Listing documents (list_available_documents) :
  → Scan répertoires par type, exclure .json/.png/.DS_Store
  → Enrichir noms relevés : hash → "Relevé Mois Année" via _build_releve_display_map()
  → Filtres optionnels : type, année, mois

Historique (email_history_service) :
  → data/email_history.json (append-only, écriture atomique)
  → Couverture par mois (get_send_coverage) : quels mois ont été envoyés

Store Zustand (sendDrawerStore) :
  → open({ preselected?: DocumentRef[], defaultFilter?: string })
  → close()
  → Monté globalement dans App.tsx
  → Points d'entrée : sidebar (sous Pipeline), ExportPage, GedPage
```

### Checkboxes modernes et tri (EditorPage)

```
Composant CheckboxCell : bouton toggle 22px arrondi
  → Props : colorClass, uncheckedColor, icon (React.ElementType)
  → Coché : fond coloré + icône blanche + shadow + ring
  → Décoché : bg-surface + bordure colorée subtile + hover

Colonnes badge triables (sortingFn custom) :
  → Justificatif : tri par Boolean(Justificatif)
  → Important : tri par Boolean(Important), colorClass="bg-warning", icon=Star
  → À revoir : tri par Boolean(A_revoir), colorClass="bg-danger", icon=AlertTriangle
  → Pointée : tri par Boolean(lettre), bouton dédié bg-emerald-500
```

### Filtre "Non catégorisées" (EditorPage)

```
Pipeline étape Catégorisation → navigate('/editor?filter=uncategorized')
  → EditorPage lit searchParams.get('filter')
  → Active filterUncategorized state + columnFilter '__uncategorized__'
  → filterFn custom sur colonne Catégorie : matche vide || "Autres"
  → Panneau filtres ouvert auto avec dropdown sur "⚠ Non catégorisées"
  → Bandeau warning "Filtre actif : N résultats" + bouton "Retirer le filtre"
```

### Vue année complète (EditorPage)

```
Sélection "Toute l'année" → useYearOperations(filesForYear, true)
  → useQueries : N requêtes parallèles GET /operations/{filename}
  → Fusion des résultats avec champ _sourceFile par opération
  → Mode lecture seule (pas de save/edit/add/delete)
  → Badge ambre "Lecture seule — Année complète"
  → Filtres catégorie + sous-catégorie + tri fonctionnels
  → Export CSV disponible
```

### Comparatif recettes / dépenses (Compta Analytique)

```
Onglet Comparatif → sélection Période A + Période B
  → GET /api/analytics/compare → KPIs + categories avec a_debit/a_credit/b_debit/b_credit
  → Frontend : séparation catégories en 2 groupes
    → Recettes : catégories où (a_credit + b_credit) > (a_debit + b_debit)
    → Dépenses : les autres
  → 2 graphiques côte à côte (recettes vert, dépenses rouge)
  → 2 tableaux distincts avec colonnes adaptées (Crédit A/B ou Débit A/B)
  → Delta badges inversés pour revenus (hausse = vert)
  → Clic catégorie → CategoryDetailDrawer (sous-catégories, évolution, opérations)
  → Légendes dynamiques avec périodes (ex: "2024" / "2025")
```

### Ventilation d'opérations

```
EditorPage → bouton Scissors → VentilationDrawer (600px)
  → Sous-lignes éditables : montant, catégorie, sous-catégorie, libellé
  → Barre solde temps réel (vert si 0, rouge sinon)
  → Validation : ≥ 2 lignes, sum == montant op (0.01€)
  → PUT /api/ventilation/{file}/{idx} → ventilation_service.set_ventilation()
    → Catégorie parente = "Ventilé"
    → Sous-lignes stockées inline dans le JSON opération (champ ventilation: [])

Impacts downstream :
  → Clôture : taux lettrage/justificatifs comptent les sous-lignes individuellement
  → Analytics : _expand_ventilation() explose en lignes virtuelles, "Ventilé" exclu
  → Alertes : une alerte justificatif_manquant par sous-ligne sans justificatif
  → Rapprochement auto : itère sous-lignes, score avec sous_ligne.montant
  → Rapprochement manuel : sélecteur sous-ligne dans le drawer
  → Batch hints : clés "idx:vl_idx" pour les sous-lignes
  → Unmatched : compte les sous-lignes (pas l'op parente)
```

### OCR automatique

```
Upload justificatif → justificatifs router → upload_justificatifs()
  → Background: ocr_service.extract_or_cached(filepath, original_filename)
    → _parse_filename_convention(original_filename) : parse fournisseur_YYYYMMDD_montant.pdf
    → pdf2image → convert_from_path() (PDF → images)
    → EasyOCR Reader.readtext() (images → texte)
    → Parsing : dates, montants, fournisseur (regex robuste)
    → best_amount : priorité total facture > ttc > total > € > max(candidates)
    → best_date : priorité ligne "date"+facture_kw, exclusion échéance/circulation
    → Override : filename_parsed > OCR pour chaque champ individuellement
    → Cache : .ocr.json à côté du PDF (avec filename_parsed + original_filename)
  → Suggestions améliorées (date OCR + montant OCR + fournisseur)

Édition manuelle :
  → PATCH /api/ocr/{filename}/extracted-data → update_extracted_data()
  → Cherche .ocr.json dans en_attente/ ET traites/
  → Ajoute manual_edit: true + manual_edit_at
  → Body accepte : best_amount, best_date, supplier, category_hint, sous_categorie_hint (OcrManualEdit étendu)
  → Les hints sont stockés au **top-level** du .ocr.json (pas dans extracted_data)
  → Frontend : OcrDataEditor + OcrEditDrawer + SkippedItemEditor (tous écrivent via ce PATCH)
  → Badge "OCR incomplet" dans la galerie si ocr_amount ou ocr_date null

Hints comptables (category_hint + sous_categorie_hint) :
  → Écrits automatiquement par justificatif_service.associate() après chaque association :
    op.Catégorie → category_hint | op.Sous-catégorie → sous_categorie_hint
    Skip "", "Autres", "Ventilé"
  → Appel : ocr_service.update_extracted_data(filename, {"category_hint": cat, "sous_categorie_hint": subcat})
  → Lus par rapprochement_service.score_categorie() en **override prioritaire** de la prédiction ML :
    - Stratégie 1 : hint direct match op.categorie → 1.0 / 0.6 / 0.0
    - Stratégie 2 : ML fallback si hint absent
  → _load_ocr_data() injecte les hints dans le dict ocr_data transmis à compute_score()
  → compute_score() extrait j_cat_hint / j_subcat_hint de justificatif_ocr et forwards à score_categorie
  → Effet cascade : chaque association enrichit le .ocr.json → prochain auto-rapprochement plus précis
  → Test e2e : amazon_20250109 score 0.547 → 0.748 (+20 points) avec hint matching
```

### Sandbox Watchdog (OCR automatique par dépôt)

```
Fichier (PDF/JPG/PNG) déposé dans data/justificatifs/sandbox/
  → watchdog (FileSystemEventHandler) détecte on_created
  → Filtre : extension dans ALLOWED_JUSTIFICATIF_EXTENSIONS
  → Attente écriture complète (polling getsize, 500ms)
  → Si image : _convert_image_to_pdf() → écriture PDF en_attente/ → suppression image
  → Si PDF : shutil.move → data/justificatifs/en_attente/ (gestion doublons avec suffix timestamp)
  → ocr_service.extract_or_cached() → .ocr.json
  → _process_file() lit le cache OCR après processing et extrait supplier / best_date / best_amount
  → _push_event() pousse un event SSE enrichi avec ces 3 champs
  → Event SSE poussé via asyncio.Queue (thread-safe via loop.call_soon_threadsafe)
  → Frontend : useSandbox hook (EventSource) **lifté dans AppLayout** → écoute globalement quelle que soit la page
     - showArrivalToast(data) affiche un SandboxArrivalToast riche (toast.custom + createElement)
     - Gradient violet→indigo, pulse ring, supplier/date/amount, badge AUTO, CTA "Voir dans l'historique"
     - Navigation via window.history.pushState + PopStateEvent (pas useNavigate — évite un bug d'ordre des hooks)
     - URL cible : /ocr?tab=historique&sort=scan_date&highlight={filename}
     - Invalidation TanStack Query (ocr-history, justificatifs, ged, operations)
```

Au démarrage du backend, les fichiers (PDF/JPG/PNG) déjà présents dans sandbox/ sont traités automatiquement.
Le watchdog est géré par le lifespan FastAPI (start/stop).

### Rapprochement bancaire

```
Fichier opérations → rapprochement router → rapprochement_service
  → Auto : score(date, montant, fournisseur OCR) pour chaque opération × justificatif
  → Manuel : association directe opération ↔ justificatif
  → Mise à jour champs : rapprochement_score, rapprochement_mode, rapprochement_date
  → Dissociation : supprime lien justificatif + champs rapprochement
```

### Lettrage comptable

```
Fichier opérations → lettrage router → operation_service
  → Toggle : inverse op["lettre"] (bool) pour une opération
  → Bulk : applique lettre=true/false sur N indices
  → Stats : total, lettrées, non_lettrées, taux
```

### Clôture comptable

```
Année → cloture router → cloture_service.get_annual_status(year)
  → Pour chaque mois 1-12 :
    → Identifie le fichier d'opérations (metadata month/year)
    → Compte nb_operations, nb_lettrees, taux_lettrage
    → Compte nb_justificatifs_total, nb_justificatifs_ok, taux_justificatifs
    → Statut : complet (100% L + 100% J) | partiel (relevé chargé) | manquant
  → Retourne tableau 12 mois avec statut et stats
```

### Export comptable

```
Sélection mois → exports router → export_service.generate_export()
  → Charge opérations du mois
  → Génère CSV/PDF/Excel en mémoire
  → Inclut relevé bancaire PDF original
  → Inclut justificatifs associés
  → Package ZIP → data/exports/
```

### GED V2 (Hub Documentaire Unifié)

```
Page Bibliothèque (/ged) → GedPage (split layout)
  ├─ Arbre gauche (260px) : 5 onglets
  │   → GET /api/ged/tree → { by_period, by_category, by_vendor, by_type, by_year }
  │   → GedTreePanel : 5 icônes (Calendar, Layers, Tag, Building2, FolderTree)
  │   → deriveFiltersFromNode() convertit nodeId → GedFilters
  │   → scan_all_sources() indexe : relevés, justificatifs, rapports, docs libres
  │   → backfill_justificatifs_metadata() enrichit les traités existants
  │   → migrate_reports_index() migre reports_index.json (one-shot)
  │
  ├─ Barre filtres croisés (GedFilterBar)
  │   → Dropdowns : type, catégorie (avec compteurs), fournisseur (avec compteurs)
  │   → Recherche full-text enrichie (noms + OCR + titres rapports + fournisseur)
  │   → Bouton reset quand filtre actif
  │   → Init filtres via URL params (/ged?type=rapport&year=2026)
  │
  ├─ Contenu : grille cartes enrichies (GedDocumentCard) ou tableau liste
  │   → Thumbnail PDF + badge catégorie + fournisseur + période + montant
  │   → Badge "RECONSTITUÉ" si is_reconstitue
  │   → Étoile favori pour rapports
  │   → Mode comparaison (checkbox sélection 2 rapports)
  │
  ├─ Drawer contextuel selon type :
  │   → Document (GedDocumentDrawer) : preview PDF + fiscalité + postes
  │   → Rapport (GedReportDrawer) : preview PDF + favori + re-génération + suppression
  │
  ├─ Enrichissement automatique metadata :
  │   → Rapprochement auto/manuel → enrich_metadata_on_association()
  │   → OCR extraction → enrich_metadata_on_ocr()
  │   → Save éditeur → propagate_category_change()
  │   → Dissociation → clear_metadata_on_dissociation()
  │   → Génération rapport → register_rapport()
  │   → Suppression rapport → remove_document()
  │
  └─ Mapping POSTE_TO_CATEGORIE (16 postes → catégorie comptable)
      → Classement docs libres dans l'arbre catégorie
```

### Rapports V2

```
Page Rapports (/reports) → ReportsPage (génération uniquement)
  ├─ 3 templates rapides (BNC annuel, Ventilation charges, Récapitulatif social)
  │   → Filtres avancés (période, catégories multi-select, type, montant, format)
  │   → Formats : PDF (EUR, ligne totaux), CSV (;/virgule/BOM), Excel (formules SUM)
  │   → Déduplication : même clé (filtres+format) = remplacement ancien rapport
  │
  ├─ Bouton "Voir dans la bibliothèque →" → /ged?type=rapport
  │   → Toast post-génération avec lien vers GED
  │
  ├─ Génération → register_rapport() → GED metadata enrichi
  │   → rapport_meta : title, description, filters, format, favorite, generated_at
  │   → period déduit depuis filters (year, month, quarter)
  │   → categorie déduit si filtre mono-catégorie
  │
  └─ Bibliothèque migrée vers GED V2 (/ged?type=rapport)
      → Favoris, comparaison, re-génération via endpoints GED
      → Migration one-shot : reports_index.json → ged_metadata.json (.migrated)
```

### Dotations aux Amortissements

```
Page Amortissements (/amortissements) → AmortissementsPage (4 onglets)
  ├─ Registre : tableau immobilisations avec avancement %, VNC, statut
  ├─ Tableau annuel : dotations par exercice avec totaux
  ├─ Synthèse par poste : VNC et dotations par poste comptable
  └─ Candidates : opérations détectées (montant > seuil + catégorie éligible)

Moteur de calcul (dupliqué Python + TypeScript) :
  ├─ Linéaire : annuité = base / durée, pro rata année 1 (jours/360), complément dernière année
  ├─ Dégressif : taux = (1/durée) × coeff, bascule linéaire quand linéaire > dégressif
  ├─ Plafonds véhicules : base plafonnée selon classe CO2 (30000/20300/18300/9900€)
  └─ Quote-part pro : dotation_déductible = dotation_brute × quote_part_pro / 100

Données : data/amortissements/immobilisations.json + config.json
```

### Prévisionnel (calendrier de trésorerie)

```
Page Prévisionnel (/previsionnel) → PrevisionnelPage (3 onglets)
  ├─ Timeline : ComposedChart Recharts (barres charges/recettes + courbe cumul)
  │   ├─ Charges = providers récurrents + moyennes catégories N-1 (> seuil)
  │   ├─ Recettes = régression linéaire (numpy) + coefficients saisonniers
  │   ├─ Mois clos = données réelles depuis opérations importées
  │   └─ Expansion inline au clic : détail postes charges/recettes avec source/statut
  ├─ Fournisseurs : CRUD providers (2 modes)
  │   ├─ Mode facture : 1 document attendu par période (mensuel/trimestriel/etc.)
  │   └─ Mode échéancier : 1 document annuel → parsing OCR (3 formats) → 12 prélèvements
  │       → Grille 12 mois (montant, statut, confiance OCR)
  │       → Scan vs opérations bancaires (keywords + montant ± tolérance)
  └─ Paramètres : seuil, catégories à inclure (checkboxes), recettes (chips), overrides

Données : data/previsionnel/ (providers.json, echeances.json, settings.json)
Background : asyncio task (1h) → refresh + statuts retard + scan documents + scan prélèvements
Intégrations : post-OCR, post-sandbox, post-GED upload → check_single_document()
```

### Templates Justificatifs (reconstitution)

```
Page OCR (/ocr) → OcrPage → 4ème onglet "Templates justificatifs"
  ├─ Créer : sélection justificatif existant → POST /api/templates/extract
  │   → Extraction OCR enrichie (Qwen2-VL via Ollama, fallback .ocr.json basique)
  │   → Formulaire : vendor, aliases, catégorie, table champs (checkbox, label, source, confiance)
  │   → POST /api/templates → sauvegarde dans data/templates/justificatifs_templates.json
  ├─ Bibliothèque : grille cards templates (vendor, aliases, champs, usage_count)
  │   → DELETE /api/templates/{id} pour suppression
  └─ Générer : sélection opération (file + index) → GET /api/templates/suggest/{file}/{idx}
      → Template auto-suggéré par matching alias dans le libellé bancaire
      → Formulaire 2 colonnes : champs auto (grisés) + champs manuels
      → Calcul TVA temps réel (formules computed)
      → POST /api/templates/generate
          → ReportLab : PDF A5 sobre (Helvetica, pas de watermark)
          → .ocr.json compagnon ("source": "reconstitue", operation_ref)
          → Fichiers dans data/justificatifs/en_attente/reconstitue_*
          → Si auto_associate : justificatif_service.associate() + rapprochement metadata

Intégrations (bouton ReconstituerButton) :
  ├─ RapprochementManuelDrawer : quand aucun justificatif trouvé
  ├─ AlertesPage : à côté de "Marquer résolue" pour alertes justificatif_manquant
  ├─ EditorPage : colonne Paperclip, visible au hover pour opérations sans justificatif
  └─ CloturePage : bouton "Reconstituer les manquants" → redirige vers alertes filtrées

Batch reconstitution (JustificatifsPage) :
  ├─ Multi-sélection checkboxes (ops sans justificatif uniquement)
  │   → Header checkbox select-all/deselect-all + état indéterminé
  │   → Barre flottante en bas : "N sélectionnées" + bouton "Reconstituer (N)"
  ├─ BatchReconstituerDrawer (550px, composant dédié)
  │   → POST /api/templates/batch-suggest (groupe ops par template)
  │   → Matching : 1) catégorie/sous-catégorie, 2) alias fournisseur, 3) unmatched
  │   → Dropdown template modifiable par groupe
  │   → Ops sans template en warning ambre
  │   → Bouton "Générer (N)" → POST /api/templates/batch-generate par groupe
  └─ Fac-similé PDF : rectangle blanc élargi dynamiquement
      → max(largeur_coordonnées, largeur_texte_formaté + padding)
      → Évite que l'ancien montant du ticket source déborde
```

### Pipeline Comptable Interactif (page d'accueil)

```
Page Pipeline (/) → PipelinePage
  → Grille 12 badges mois (icône + nom + %) cliquables
  → Sélecteur exercice fiscal (boutons années)
  → Barre progression globale pondérée (10/20/25/25/10/10)
  → Stepper 6 étapes accordion (cards expandables) :
    1. Import (GET /api/operations/files)
    2. Catégorisation (GET /api/operations/{filename})
    3. Justificatifs (GET /api/cloture/{year} → taux_justificatifs)
    4. Rapprochement (GET /api/cloture/{year} → taux_lettrage)
    5. Vérification (GET /api/alertes/summary)
    6. Clôture (GET /api/cloture/{year} → statut)
  → Persistance année/mois dans localStorage
  → Badge sidebar : % global mois courant, clic → navigate('/')
```

### Dashboard V2 (Cockpit exercice)

```
Page Dashboard (/dashboard) → DashboardPage
  → GET /api/analytics/year-overview?year=2025 (un seul appel agrégé)
  ├─ Jauge segmentée 6 critères (relevés/catégorisation/lettrage/justificatifs/rapprochement/exports)
  ├─ 4 KPI cards (Recettes, Charges, BNC + sparkline, Charges sociales prov.)
  ├─ Grille 12 mois avec 6 badges d'état, expansion au clic (montants + actions)
  ├─ Alertes pondérées par impact (100/80/55+/40/25)
  ├─ Rappels rapports à générer (rapports mensuels/trimestriels manquants)
  ├─ Échéances fiscales (URSSAF T1-T4, CARMF, ODM) avec countdown J-XX
  └─ Bar chart recettes vs dépenses + feed activité récente
```

## Couches applicatives

### Frontend

| Couche | Responsabilité | Fichiers |
|--------|----------------|----------|
| **Components** | UI et interactions | `src/components/` (67+ fichiers, incl. `pipeline/`, `ged/`, `amortissements/`, `reports/`, `dashboard/`, `editor/VentilationDrawer`, `justificatifs/JustificatifAttributionDrawer`, `justificatifs/OcrDataEditor`) |
| **Hooks** | Data fetching, cache, mutations, SSE | `src/hooks/` (19 fichiers, incl. usePipeline, useGed, useReports, useAmortissements, useTemplates, usePrevisionnel, useVentilation) |
| **API Client** | Abstraction fetch, gestion erreurs | `src/api/client.ts` |
| **Types** | Interfaces TypeScript | `src/types/index.ts` |
| **Utils** | Formatage, classes CSS | `src/lib/utils.ts` |

### Backend

| Couche | Responsabilité | Fichiers |
|--------|----------------|----------|
| **Routers** | Endpoints HTTP, validation, SSE | `backend/routers/` (20 fichiers, incl. ged.py, amortissements.py, templates.py, previsionnel.py, ventilation.py) |
| **Services** | Logique métier, I/O, watchdog, GED, prévisionnel | `backend/services/` (20 fichiers, incl. ged_service.py, amortissement_service.py, template_service.py, previsionnel_service.py, ventilation_service.py) |
| **Models** | Schémas Pydantic | `backend/models/` (15 fichiers, incl. ged.py, amortissement.py, template.py, previsionnel.py) |
| **Config** | Chemins, constantes | `backend/core/config.py` |

## Stockage des données

```
data/
├── imports/
│   ├── operations/             # Fichiers JSON d'opérations
│   │   └── operations_YYYYMMDD_HHMMSS_HASH.json
│   └── releves/                # Relevés bancaires originaux (PDF)
│       └── pdf_HASH.pdf
├── exports/                    # Archives ZIP mensuelles
├── reports/                    # Rapports générés (CSV/PDF/XLSX)
├── rapports/                   # Rapports legacy
├── justificatifs/
│   ├── en_attente/             # Justificatifs non associés
│   │   ├── justificatif_YYYYMMDD_HHMMSS_nom.pdf
│   │   └── justificatif_YYYYMMDD_HHMMSS_nom.ocr.json
│   ├── sandbox/                # Dépôt auto → watchdog → OCR → en_attente
│   └── traites/                # Justificatifs associés à une opération
├── ml/
│   ├── model.json              # Règles (exact_matches, keywords)
│   ├── sklearn_model.pkl       # Modèle ML entraîné
│   ├── vectorizer.pkl          # TF-IDF vectorizer
│   ├── training_examples.json  # Exemples d'entraînement
│   ├── backups/                # Sauvegardes horodatées
│   └── logs/                   # Monitoring ML
│       ├── predictions/        # PredictionBatchLog par catégorisation
│       ├── corrections/        # CorrectionLog[] mensuels
│       └── trainings.json      # TrainingLog[] (append)
├── ged/
│   ├── ged_metadata.json       # Index des documents GED (chemins, types, postes, tags)
│   ├── ged_postes.json         # Postes comptables avec % déductibilité
│   ├── thumbnails/             # Cache thumbnails PNG (pdf2image, 200px)
│   │   └── {md5_doc_id}.png
│   └── {year}/{month}/         # Documents libres uploadés
├── amortissements/
│   ├── immobilisations.json    # Registre des immobilisations
│   └── config.json             # Seuil (500€), durées, catégories éligibles, plafonds
├── templates/
│   └── justificatifs_templates.json  # Templates fournisseurs (vendor, aliases, fields)
├── previsionnel/
│   ├── providers.json          # Fournisseurs récurrents (URSSAF, CARMF, assurance...)
│   ├── echeances.json          # Échéances générées (statut, document lié, prélèvements)
│   └── settings.json           # Paramètres (seuil, catégories, overrides)
├── compta_analytique/          # Presets de requêtes
├── logs/                       # Logs applicatifs (rotation 10 Mo)
└── ocr/                        # Cache OCR global
```

### Tâches Kanban

```
task_service.generate_auto_tasks(year)
    ├── 1. Opérations non catégorisées (par fichier de l'année)
    ├── 2. Justificatifs en attente de rapprochement
    ├── 3. Clôture incomplète (mois partiels via cloture_service)
    ├── 4. Mois sans relevé importé
    └── 5. Alertes non résolues (compte d'attente)
            │
            ▼
    POST /api/tasks/refresh?year=YYYY
    ┌─ Déduplication par auto_key ──────────────────┐
    │  - Nouveau auto_key → ajouter                  │
    │  - auto_key existant (done/dismissed) → skip   │
    │  - auto_key existant (actif) → update          │
    │  - auto_key disparu → supprimer                │
    └────────────────────────────────────────────────┘
            │
            ▼
    data/tasks.json (toutes années, un seul fichier)
            │
            ▼
    GET /api/tasks/?year=YYYY → filtré par année
```

Frontend : `DndContext` (@dnd-kit) → 3 colonnes `useDroppable` → cartes `useSortable`. Refresh auto au montage et au changement d'année (store Zustand).

### Sélecteur année global

```
useFiscalYearStore (Zustand + persist localStorage)
    │
    ├── Sidebar : sélecteur ◀ ANNÉE ▶
    ├── EditorPage : dropdown année → mois en cascade
    ├── DashboardPage : YearSelector
    ├── CloturePage : boutons ◀▶
    ├── AlertesPage : dropdown année → mois
    ├── ComptaAnalytiquePage : filtre année global
    ├── ExportPage : boutons année
    ├── ReportsPage : filtre année dans filters
    ├── PrevisionnelPage : dropdown année
    └── TasksPage : query + refresh scopés par année
```

Tous lisent/écrivent le même store → sync bidirectionnelle automatique (Zustand natif).

## Gestion de l'état frontend

**TanStack Query** gère tout l'état serveur, **Zustand** gère l'état client partagé (année globale) :

```typescript
// Lecture avec cache automatique
const { data, isLoading } = useQuery({
  queryKey: ['operations', filename],
  queryFn: () => api.get(`/operations/${filename}`),
})

// Mutation avec invalidation
const mutation = useMutation({
  mutationFn: (data) => api.post('/ml/train', data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['ml-model'] })
  },
})
```

Paramètres globaux du QueryClient :
- `staleTime: 30s` — données considérées fraîches pendant 30s
- `retry: 1` — 1 seul retry en cas d'erreur

## Sécurité & Validation

- **CORS** : Autorisé uniquement depuis `localhost:5173` et `localhost:3000`
- **Validation** : Pydantic côté backend, TypeScript côté frontend
- **Upload** : Vérification magic bytes multi-format (PDF `%PDF-`, JPEG `\xff\xd8\xff`, PNG `\x89PNG`), limite 10 Mo, conversion image→PDF via Pillow
- **Sanitization** : NaN/Inf remplacés par 0 dans les opérations
