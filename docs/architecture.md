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
│  │  (22 files)│     │  (25 files) │     │  data/       │ │
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

Alternative : Sandbox inbox (Session 29 — watchdog conditionnel)
  → Dépôt PDF/JPG/PNG dans data/justificatifs/sandbox/
  → Si image : conversion PDF INPLACE dans sandbox/ (pas de move prématuré)
  → Check rename_service.is_canonical(filename) :
     • Canonique → move sandbox→en_attente + OCR + auto-rapprochement (flow historique)
       - SandboxArrivalToast riche (emerald si auto-associé, violet sinon)
       - CTA "Voir l'opération" ou "Voir dans l'historique" selon auto_associated
     • Non-canonique → reste INPLACE dans sandbox/, apparaît dans l'onglet Sandbox /ocr
       - _register_sandbox_arrival + event SSE arrived (is_canonical: false)
       - Toast info discret frontend + invalidate ['sandbox', 'list']
       - User action : rename inline → [Lancer OCR] (POST /api/sandbox/{name}/process)
       - Mode auto optionnel : auto-processor loop (off par défaut)
  → Voir section "Sandbox = Boîte d'arrivée OCR (Session 29)" ci-dessous pour le détail

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
  → Gate date (Session 27) : skip si best_match.score.detail.date <= 0.0 (écart > 14j)
    • Protège contre cross-year hallucinés (montant + fournisseur + catégorie = 1.0 compensaient
      score_date = 0 pour atteindre pile 0.80). Les rejetés passent en suggestions_fortes.
  → Auto-lock (Session 27) : si best_score >= 0.95, pose op.locked = true + locked_at après associate()
    • Retour associations_detail[].locked: bool + score: float pour propagation SSE toast
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

Association manuelle 2-colonnes (Session 26) : ManualAssociationDrawer (1100px)
  → Outil complémentaire quand le scoring mono-op échoue (OCR défaillant ou batch multi-ops)
  → Layout : preview PDF à gauche animé (320px) | panneau ops (340px) | panneau justifs (flex-1)
  → Filtres libres date ±j + montant ±€ (useMemo sur suggestions, null OCR → keep)
  → Toggle "Élargir" : bascule sur GET /justificatifs/?status=en_attente (bypass pré-filtre ±1 mois)
  → 2 points d'entrée : JustificatifsPage (header + batch) + EditorPage (header + sélection)
  → Hook useManualAssociation : modes targeted/all, sanitize crédits, goToNextOp booléen

Association sens inverse (Session 26) : JustifToOpDrawer (1000px)
  → Ouvert depuis GedDocumentDrawer pour justifs en_attente
  → Endpoint GET /rapprochement/suggestions/justificatif/{filename} (étendu avec op_locked + op_locked_at)
  → PreviewSubDrawer grand format (700px, zIndex 65) à gauche du drawer parent
  → Édition inline OCR (date/montant/supplier) → PATCH /ocr/.../extracted-data → rescoring live
  → Badge Lock + bouton Déverrouiller par row (useToggleLock inline sans sortir du drawer)
  → Self-heal operation_ref désynchronisés (scan file sur Lien justificatif)
  → Navigation bouton "Voir" → /justificatifs?file=X&highlight=Y + onClose()

Filtre justificatifs déjà référencés (via get_all_referenced_justificatifs, cache TTL 5s) :
  → get_filtered_suggestions() : exclut les déjà-associés (exception : op courante pour ré-association)
  → list_justificatifs(status=en_attente) : exclut les fichiers déjà référencés
  → suggest_operations() (sens inverse OCR) : exclut les ops liées à un autre justificatif
  → get_batch_justificatif_scores() : skip les déjà-associés avant scoring
  → get_batch_hints() : exclut les déjà-associés des pending_ocr
  → get_unmatched_summary() : compteur justificatifs_en_attente = libres uniquement

Bouton "Associer automatiquement" sur JustificatifsPage :
  → Bandeau CTA contextuel (visible quand ops sans justificatif)
  → Toast cliquable → filtre "Sans justif." + ouvre drawer mode flux
```

### Rename service filename-first (backend)

```
rename_service.py : module pur qui porte la logique filename-first
  CANONICAL_SUFFIX = (?:_(?:[a-z]{1,3}|\d{1,2}))*   # Session 28 — durcie
  CANONICAL_RE     = ^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}{CANONICAL_SUFFIX}\.pdf$
  LEGACY_CANONICAL_RE = ancienne regex permissive (suffix _[a-z0-9]+) — retenue
                        UNIQUEMENT pour la détection des pseudo-canoniques
  FACSIMILE_RE = _fs(_\d+)?\.pdf$
  GENERIC_FILENAME_PREFIXES = {facture, justificatif, document, scan, receipt, invoice, reconstitue}

  is_canonical(name) : matche CANONICAL_RE (nouvelle, stricte)
  is_legacy_pseudo_canonical(name) : matche l'ancienne regex mais pas la nouvelle
                                      → typiquement fichiers avec suffix timestamp
                                      sandbox (`_20260417_104502`), proposés au rename
  find_legacy_pseudo_canonical(dirs) : scan lecture seule, retourne liste des basenames
                                       (appelé au boot depuis lifespan pour log audit)
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
       Inclut les sous-lignes de ventilation (vl.get("justificatif"))
    1b. get_all_referenced_justificatifs() : version publique → set[str] avec cache TTL 5s
       invalidate_referenced_cache() appelé dans associate/dissociate/rename/repair
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
       D : reconnectable_ventilation (Session 27) :
           - _detect_ventilation_reconnects(orphan_names) parse chaque orphan B2 via
             rename_service.try_parse_filename() → (supplier, YYYYMMDD, amount)
           - Scan toutes les ops : sous-ligne ventilée VIDE avec même date + montant ±0.01€
           - Match unique requis → reconnect candidate ; ambiguïtés skippées
           - Retirés de orphans_to_move_to_attente (pour ne pas déplacer ce qui sera reconnecté)

  apply_link_repair(plan=None) → dict résultat typé
    - Si plan=None, re-scanne
    - Ordre : A1 delete → A2 move → B1 delete → 3b reconnect ventilation → B2 move → C clear op.Lien
    - Hash conflicts : count uniquement, jamais modifiés (log warning)
    - Chaque action propage le .ocr.json compagnon (_move_pdf_with_ocr, _delete_pdf_with_ocr)
    - Ghost refs groupés par op_file pour 1 seul load/save par fichier
    - Reconnect ventilation : groupé par op_file + re-check idempotence avant write
    - Retourne {deleted_from_attente, moved_to_traites, deleted_from_traites,
                moved_to_attente, ventilation_reconnected, ghost_refs_cleared,
                conflicts_skipped, errors}

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

### Suppression complète justificatif (3 entry points + toast design)

```
justificatif_service.delete_justificatif(filename) → Optional[dict]
  Nettoie toute trace résiduelle et retourne un dict détaillé :
  {
    deleted: filename,
    ops_unlinked: [{file, libelle, index}],       (liste des ops délinkées)
    thumbnail_deleted: bool,                       (thumbnail PNG GED supprimé)
    ged_cleaned: bool,                             (metadata GED purgée)
    ocr_cache_deleted: bool,                       (.ocr.json supprimé)
  }
  Ordre de nettoyage :
    1. _clean_operation_link(filename) → descend dans parentes + ventilations
    2. _invalidate_thumbnail_for_path(filepath)
    3. ged_service.remove_document(doc_id)
    4. ocr_service.delete_ocr_cache_for(filepath)
    5. filepath.unlink() (le PDF)
    6. invalidate_referenced_cache()

Endpoint DELETE /api/justificatifs/{filename} :
  Retourne le dict tel quel (200) ou 404 si filename introuvable.

Frontend — helper partagé frontend/src/lib/deleteJustificatifToast.ts :
  - showDeleteConfirmToast(filename, operationLibelle, onConfirm)
    → toast.custom() : Trash2 rouge + "Supprimer {filename} ?" + "Lié à : {libellé}"
      + boutons Supprimer (rouge) / Annuler (gris), duration 8s
  - showDeleteSuccessToast(result: DeleteJustificatifResult)
    → toast.success() listant les nettoyages : "lien opération nettoyé,
      thumbnail purgée, GED nettoyée, cache OCR purgé"

Points d'appel UI :
  1. OCR Gestion OCR (OcrPage HistoriqueTab) : bouton Trash2 par ligne
     opacity-0 group-hover:opacity-100, lookupByFilename pour récupérer libellé op
  2. EditorPage : preview panel footer, bouton à droite des Dissocier/Ouvrir
     operations[previewJustifOpIndex]?.Libellé pour le toast
  3. JustificatifsPage : preview panel footer, à gauche de Dissocier
     (layout justify-between), operations.find(op => _originalIndex/_filename match)
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
  ├── Export_Comptable_{YYYY}_{Mois}.pdf             (chronologique, toujours inclus)
  ├── Export_Comptable_{YYYY}_{Mois}.csv             (chronologique, toujours inclus)
  ├── Ventilation_par_categorie_{YYYY}-{MM}_{Mois}.pdf   (Session 31, toujours inclus)
  ├── Ventilation_par_categorie_{YYYY}-{MM}_{Mois}.csv   (Session 31, toujours inclus)
  ├── releves/
  │   └── pdf_{hash}.pdf                             (relevé bancaire si trouvé)
  ├── rapports/
  │   └── *.pdf                                      (rapports auto-détectés pour le mois)
  ├── justificatifs/
  │   └── *.pdf                                      (justificatifs associés aux opérations)
  └── compte_attente/                                (si include_compte_attente=true, défaut)
      ├── compte_attente_{mois}.pdf
      └── compte_attente_{mois}.csv

Post-génération :
  → Copie standalone PDF+CSV chronologique dans data/reports/ (scanné par la GED)
  → Enregistrement GED via register_rapport() (report_type: "export_comptable")
  → Déduplication GED : régénérer écrase le fichier et met à jour l'entrée GED
  → Déduplication historique (Session 31) : voir `_log_export` ci-dessous

_prepare_export_operations(operations, filename) :
  → Itère les opérations, explose les ventilations en sous-lignes [V1/N]
  → Classe en 3 groupes :
    - pro : catégorie valide (BNC)
    - perso : categorie.lower() == "perso" (exclues du BNC)
    - attente : vide, None, "Autres", "Ventilé" sans sous-lignes
  → Trie chaque groupe par date ASC
  → Calcule totaux : recettes_pro, charges_pro, solde_bnc, total_perso, total_attente

CSV chronologique : séparateur ;, UTF-8 BOM, CRLF, montants FR via _format_amount_fr()
PDF chronologique : paysage A4, logo backend/assets/, footer Page X/Y + NeuronXcompta

Ventilation par catégorie (Session 31) :
  _group_by_category(prepared) :
    → Fusionne pro + perso + attente, re-groupe par (Catégorie, Sous-catégorie)
    → Tri alpha catégorie puis alpha sous-catégorie
    → Retourne { groups: [{ categorie, subcats: [{ sous_categorie, lines, debit, credit }],
                            debit, credit, count, net }], grand_debit, grand_credit, grand_net }

  _generate_pdf_by_category(prepared, month_name, year, month) :
    → A4 portrait, logo centré, titre "Ventilation par catégorie — {Mois} {Year}"
    → Pour chaque catégorie : header bleu foncé + sous-sections (1 tableau par sous-cat
      avec ops + ligne sous-total gris) + bandeau bleu "TOTAL {cat} (N op.)" avec Net
    → Bandeau noir final "TOTAL GÉNÉRAL (N op.)" avec Net
    → Pagination footer "Page X — Ventilation par catégorie — {Mois} {Year}"

  _generate_csv_by_category(prepared, month_name, year) :
    → Titre + nb ops en header (2 lignes texte avant le header CSV)
    → Même 8 colonnes que le chronologique
    → Lignes de sous-total par sous-catégorie : "Sous-total {sous_cat} (N op.)"
    → Lignes de TOTAL par catégorie : "TOTAL {cat} (N op.)" + ligne blanche
    → Ligne finale "TOTAL GÉNÉRAL (N op.)"

_find_bank_statement(operation_filename) (Session 31) :
  → Cas 1 : regex originale "operations_\d{8}_\d{6}_<hex>.json" → pdf_<hex>.pdf direct
  → Cas 2 : fichier "operations_(merged|split)_YYYYMM_*.json" (hex d'origine perdu
    après split/merge) → scan data/imports/operations/_archive/*.bak_* :
      - Extraire hex de chaque archive (regex sur .bak_ name)
      - Résoudre pdf_<hex>.pdf dans IMPORTS_RELEVES_DIR (skip si absent)
      - Charger l'archive, compter ops où (year, month) == target
      - Skip si nb_in_month < 3 (évite les débordements de quelques ops)
      - Scorer par (is_monthly, nb_in_month, concentration) — is_monthly=True
        si nb_in_month/total ≥ 0.8 (vrai fichier mensuel gagne)
      - Retourner le pdf du meilleur score

Statut mensuel (get_month_export_status) :
  → 12 mois × { nb_operations, has_data, has_pdf, has_csv, nb_releves, nb_rapports, nb_justificatifs }
  → Croisement fichiers opérations + exports_history.json

Historique (exports_history.json) :
  → Log automatique à chaque génération (_log_export)
  → Entrées : id, year, month, format, filename, title, nb_operations, generated_at
  → Déduplication Session 31 : avant d'appender, toute entrée antérieure avec le
    même triplet (year, month, format) est retirée de l'historique ET le ZIP
    correspondant est supprimé du disque (unlink best-effort, try/except OSError).
    → le dernier export wins, historique et disque restent propres.

Batch (generate_batch_export) :
  → ZIP multi-mois avec sous-dossiers {Mois}_{Année}/
  → Chaque sous-dossier contient PDF+CSV chronologique + ventilation par catégorie
    PDF+CSV (Session 31) + relevé + rapports + justificatifs
  → _log_export appelé par mois avec le même ZIP filename (dédup s'applique)
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
  → Rapports (report_service) : _explode_ventilations() transforme chaque op ventilée
    en N sous-lignes avec libellé [V{i+1}/{N}], catégorie/montant/justificatif de la
    sous-ligne, appelé AVANT _apply_filters() pour que les sous-catégories soient
    filtrables par l'utilisateur. Les totaux rapports (PDF/CSV) sont ainsi
    répartis correctement par sous-catégorie (pas d'agrégat "Ventilé").
  → Auto-rapprochement post-ventilation : PUT /api/ventilation/{file}/{idx} lance
    run_auto_rapprochement() en arrière-plan via BackgroundTasks après création/
    modification d'une ventilation. Les sous-lignes créées sont immédiatement
    scorées contre les justificatifs en attente (seuil 0.80).

Ventilation UI :
  → JustificatifsPage : ligne parente + N sous-lignes indentées (L1, L2...)
    avec trombone individuel par sous-ligne + CheckCircle2 vert sur la parente
    si toutes les sous-lignes sont associées (allVlAssociated).
  → EditorPage VentilationLines : trombones cliquables sur les sous-lignes
    → onJustifClick (emerald) ouvre le preview PDF
    → onAttributeClick (amber, sous-ligne vide) ouvre le RapprochementWorkflowDrawer
      avec la sous-ligne pré-sélectionnée via nouveau prop initialVentilationIndex
    → stopPropagation() pour ne pas ouvrir le VentilationDrawer du <tr> parent
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
  → Effacés par justificatif_service.dissociate() : appel update_extracted_data avec None
    → suppression des clés du .ocr.json (pas null) → score_categorie retourne None (neutre)
  → Appel : ocr_service.update_extracted_data(filename, {"category_hint": cat, "sous_categorie_hint": subcat})
  → update_extracted_data supporte None/"" = suppression de la clé (data.pop)
  → Lus par rapprochement_service.score_categorie() en **override prioritaire** de la prédiction ML :
    - Stratégie 1 : hint direct match op.categorie → 1.0 / 0.6 / 0.0
    - Stratégie 2 : ML fallback si hint absent
  → _load_ocr_data() injecte les hints dans le dict ocr_data transmis à compute_score()
  → compute_score() extrait j_cat_hint / j_subcat_hint de justificatif_ocr et forwards à score_categorie
  → Effet cascade : chaque association enrichit le .ocr.json → prochain auto-rapprochement plus précis
  → Test e2e : amazon_20250109 score 0.547 → 0.748 (+20 points) avec hint matching
```

### Polish UX Sandbox + perf OCR (Session 30)

**Checkboxes batch OCR** — `frontend/src/components/ocr/SandboxRow.tsx` + `SandboxTab.tsx` :
- Checkbox 22×22 `role="checkbox"` avant la thumbnail, opacity 40%→100% au hover. Primary plein quand sélectionné, row highlight `bg-primary/10 ring-1 ring-primary/40`.
- Select All tri-état dans la toolbar (Check / Minus / empty) basé sur `filtered.every`/`some`/`none(selected.has)`.
- Barre flottante `fixed bottom-6 left-1/2 -translate-x-1/2 z-40` avec compteur badge, pill warning amber si non-canoniques présents, bouton « Lancer OCR (N) » primary, X pour dismiss.
- `handleProcessBatch` lance N `POST /api/sandbox/{filename}/process` en parallèle via `Promise.allSettled`. Chaque POST retourne immédiatement `{status:"started"}` (background task), les events SSE `scanning` → `processed` pilotent la UI.
- Auto-purge (`useEffect` sur `items`) nettoie les sélections quand les fichiers quittent la sandbox.

**3 toasts SSE distincts** (`frontend/src/hooks/useSandbox.ts` + composants `frontend/src/components/shared/`) :
- `SandboxScanningToast` (cyan/sky, animations CSS déclarées dans `index.css` : `scan-sweep` ligne horizontale qui balaie verticalement l'icône document + `scan-ring` anneau pulsant + `scan-dot` 3 dots séquentiels) — status `scanning`
- `SandboxPendingToast` (amber/orange, icône `Inbox`, CTA persistent « Ouvrir la boîte d'arrivée » → `/ocr?tab=sandbox`) — status `arrived` non-canonique
- `SandboxArrivalToast` (violet ou emerald selon `auto_associated`) — status `processed` (existant)

**Preview PDF inline** — drawer slide-from-right 720px dans `SandboxTab.tsx` (state `previewFilename`, backdrop `bg-black/50 backdrop-blur-sm`, handler Esc global, `<object type="application/pdf">` toolbar native, bouton fallback « Ouvrir dans un onglet »). Remplace l'ancienne ouverture dans nouvel onglet.

**Preload EasyOCR au lifespan backend** — `backend/services/ocr_service.preload_reader_async()` lance un thread daemon qui appelle `_get_reader()` en arrière-plan dès le boot. Le backend sert les requêtes immédiatement (pas de blocage lifespan). `reader_loaded=True` en ~3s post-boot car le modèle est en cache disque `~/.EasyOCR/model/`. Élimine le cold start ~20-30s sur le 1er OCR post-reboot.

**`POST /api/sandbox/{filename}/process` en background task** — `backend/routers/sandbox.py` lance un `threading.Thread(target=_run_background, daemon=True)` qui appelle `process_sandbox_file()`. L'endpoint retourne immédiatement `{status:"started",filename}` au lieu d'attendre la fin du pipeline OCR + rapprochement (10-30s). Résout le « Failed to fetch » côté frontend quand EasyOCR bloquait > timeout fetch browser. Les SSE events `scanning` → `processed` (via `_push_event` depuis le thread) pilotent la UI.

**Countdown bar dynamique** — `SandboxRow.tsx` :
- `nowTs: number` state (fix du bug `const [, setNow]` qui ne partageait pas `now` avec le `useMemo`)
- `useEffect` interval 250 ms réglé avec cleanup, conditionnel sur `item.auto_deadline`
- `useMemo` avec `[auto_deadline, arrived_at, nowTs]` en deps → re-calcul à chaque tick
- Rendu : `transition-[width] duration-300 ease-linear` pour lisser entre ticks, gradient `amber-400 → orange-500`, label timer `min-w-[90px] text-right`

**Config preview Claude ports alternatifs** — `.claude/launch.json` : backend sur `8100`, frontend sur `5273` avec env `VITE_API_URL=http://127.0.0.1:8000`. `frontend/vite.config.ts` proxy target configurable via `process.env.VITE_API_URL` (défaut `http://127.0.0.1:8000`). Permet de faire tourner `preview_start` sans conflit avec le `./start.sh` local sur `5173/8000`. Cohabitation transparente.

**Filet de sécurité ports (`kill-ports.sh` + trap `start.sh`)** — workaround pour les workers uvicorn zombies qui survivent à `--timeout-graceful-shutdown 2` (handlers SSE/watchdog/asyncio non-coopératifs → le worker garde le LISTEN sur `:8000` sans répondre, relance ultérieure échoue sur `EADDRINUSE`).

- `kill-ports.sh` (racine repo, exécutable) : `lsof -ti tcp:8000 | xargs kill -9` + idem 5173 + filet `pkill -9 -f "uvicorn backend.main"` et `pkill -9 -f "vite"` pour tuer les résidus qui n'écoutent plus. À lancer manuellement quand on détecte un zombie (`lsof -i :8000` qui montre un LISTEN sans réponse).
- `start.sh` ajoute : (a) un **pre-kill** des deux ports juste après le shebang (silencieux si rien à tuer — garantit qu'une relance à froid ne plante jamais sur `EADDRINUSE`), (b) une fonction `cleanup()` avec `trap cleanup EXIT INT TERM` qui libère les ports à toute sortie (Ctrl+C, `kill`, exit normal). Le nouveau trap remplace l'ancien `trap "kill $BACKEND_PID $FRONTEND_PID" INT TERM` — strictement plus robuste puisqu'il attrape aussi les workers enfants spawnés par uvicorn `--reload` (qui sont précisément les zombies visés).

Ne règle pas la cause racine (handlers non-coopératifs côté backend). Le fix profond — cleanup coopératif des générateurs SSE + arrêt gracieux du `watchdog.Observer` + annulation de `_previsionnel_background_loop` dans le `lifespan` shutdown — viendra dans une session dédiée.

### Réorganisation des onglets `/ocr` (Session 30)

Le composant `HistoriqueTab` (legacy « Gestion OCR ») est splitté en 2 onglets distincts via le composant générique `OcrListTab` paramétré par prop `statusFilter: 'en_attente' | 'traites'`. Le filtrage se fait côté interne via `lookupByFilename.get(filename)` (reverse-lookup des opérations liées) — `length === 0` = `en_attente`, `> 0` = `traites`.

Nouvelle structure des 6 onglets dans l'ordre métier :
1. **Upload & OCR** — batch upload multi-fichiers PDF/JPG/PNG
2. **Test Manuel** — extraction OCR ponctuelle
3. **Sandbox** — boîte d'arrivée (badge amber sur `sandbox_count`)
4. **En attente** — scans canoniques sans opération liée (badge orange sur `en_attente_count`)
5. **Traités** — scans associés à une opération (badge emerald sur `traites_count`)
6. **Templates justificatifs** — bibliothèque templates

L'ancien filtre segmenté Association (tous/sans/avec) est supprimé (l'onglet fige le statut). Remplacé par un compteur live `{N} sans assoc.` / `{N} associé(s)` qui reflète les items après filtres mois + fournisseur + statusFilter.

`LEGACY_TAB_ALIASES = { historique: 'en-attente' }` + `VALID_TABS` (validation stricte) garantissent la rétrocompatibilité des URL `?tab=historique` (events SSE rejoués au reload, fenêtre 180s ring buffer) et la résilience aux params inattendus.

Le `SandboxArrivalToast` pointe désormais vers `/ocr?tab=en-attente&sort=scan_date&highlight=X` (au lieu de `historique`), CTA mis à jour « Voir en attente ».

### Sandbox = Boîte d'arrivée OCR (Session 29)

Depuis Session 29, `data/justificatifs/sandbox/` n'est plus un simple point d'entrée transitoire mais une **boîte d'arrivée visible** dans l'UI (onglet `Sandbox` dans `/ocr`, 1er onglet). Le watchdog est **conditionnel** selon la canonicité du nom.

```
Fichier (PDF/JPG/PNG) déposé dans data/justificatifs/sandbox/
  → watchdog (FileSystemEventHandler) détecte on_created
  → Filtre : extension dans ALLOWED_JUSTIFICATIF_EXTENSIONS
  → Attente écriture complète (polling getsize, 500ms)
  → Si image : _convert_image_to_pdf() → écriture PDF INPLACE dans sandbox/ → suppression image
    • (Pas de move vers en_attente/ — la canonicité est vérifiée APRÈS conversion)
  → Check : rename_service.is_canonical(filename) ?

  ┌─ Canonique (fournisseur_YYYYMMDD_montant.XX.pdf strict) ──────────────────┐
  │  _unregister_sandbox_arrival(filename)                                      │
  │  _process_from_sandbox(filename) [extrait, réutilisable] :                 │
  │    → shutil.move(sandbox/ → en_attente/)                                    │
  │    → _push_event(status="scanning") : toast.loading() frontend              │
  │    → ocr_service.extract_or_cached() → .ocr.json                            │
  │    → auto_rename_from_ocr() (filename-first avec fallback OCR)              │
  │    → rapprochement_service.run_auto_rapprochement()                         │
  │      • Seuil 0.80 = auto-associé, ≥0.95 = auto-lock                         │
  │    → _push_event(status="processed") enrichi (supplier/date/montant,        │
  │       auto_associated, operation_ref)                                       │
  │  → Frontend : SandboxArrivalToast riche (variante emerald si auto-associé) │
  └─────────────────────────────────────────────────────────────────────────────┘

  ┌─ Non-canonique (ex: Scan_0417_103422.pdf) ─────────────────────────────────┐
  │  Reste INPLACE dans sandbox/                                                │
  │  _register_sandbox_arrival(filename, now)                                   │
  │    • _sandbox_arrivals: dict[str, datetime] (thread-safe via lock)          │
  │  _push_event(status="arrived", is_canonical=false, original_filename=...)   │
  │  → Frontend : toast info discret + invalide ['sandbox', 'list']             │
  │  → Apparaît dans l'onglet /ocr → Sandbox pour correction manuelle           │
  └─────────────────────────────────────────────────────────────────────────────┘
```

**Actions utilisateur depuis l'onglet Sandbox** (`SandboxTab.tsx` + `SandboxRow.tsx`) :
- Rename inline (↵ save / ⇧↵ save+process / Esc cancel) → `POST /api/sandbox/{filename}/rename` (inplace, préserve arrival timestamp)
- Lancer OCR → `POST /api/sandbox/{filename}/process` (délègue à `_process_from_sandbox`)
- Supprimer (⌘⌫) → `DELETE /api/sandbox/{filename}` (purge PDF + thumbnail cache + arrival)
- Preview → `GET /api/sandbox/{filename}/preview` (PDF inline, ouvert en nouvel onglet)

**Mode auto (optionnel, off par défaut)** : `backend/services/sandbox_auto_processor.py` — loop asyncio 10s qui traite les arrivals `(now - arrived_at) >= sandbox_auto_delay_seconds`. Réglage via `AppSettings.sandbox_auto_mode` + `sandbox_auto_delay_seconds` (clamp 5-3600s, 30s par défaut). UI : toggle + slider dans header SandboxTab + section dédiée Settings > Général.

**Seed boot** (lifespan) :
1. `scan_existing_sandbox_arrivals()` — seed `_sandbox_arrivals` avec `mtime` (préserve l'ancienneté) AVANT le watchdog
2. `start_sandbox_watchdog()` — démarre Observer + thread `process_existing_files` (from_watchdog=False, pas d'events `arrived` rejoués pour éviter le flood)
3. `seed_recent_events_from_disk()` — rejeu SSE fenêtre 180s : events `processed` depuis en_attente/ + traites/ ET events `arrived` depuis sandbox/

**SSE events** (enrichis Session 29 avec `is_canonical: bool`) :
- `scanning` — move sandbox→en_attente, avant OCR (canoniques uniquement)
- `processed` — fin pipeline (OCR + rename + rapprochement)
- `arrived` — fichier non-canonique déposé (nouveauté Session 29)
- `error` — erreur pipeline
- Dédup frontend via `event_id = {filename}@{timestamp}@{status}` + `SEEN_EVENT_IDS` FIFO 200
- Rejeu au (re)connect avec `replayed: true` (arrived skip toast sur rejeu)

### Exclusions GED (Session 29)

**Principe** : sandbox/ est une **file d'attente de travail** (fichiers transitoires sans metadata OCR validés), PAS un dossier de référence GED. L'inclure dans la GED polluerait filtres, stats, vues par fournisseur/catégorie avec des items vides. Règles strictement implémentées + commentaires explicites dans chaque service pour prévenir les régressions.

| Scope | Inclut sandbox/ ? | Où |
|-------|-------------------|-----|
| `justificatif_service.get_justificatif_path()` | **NON** — scope `en_attente/` + `traites/` uniquement. Résolveur dédié sandbox : `sandbox_service.get_sandbox_path()` |
| `justificatif_service.get_all_referenced_justificatifs()` | **NON** — par construction, l'association op↔justif n'est possible qu'après OCR → déplacement hors sandbox |
| `justificatif_service.scan_link_issues()` | **NON** — les 6 catégories (duplicates, misplaced, orphans, ghost_refs, hash_conflicts, reconnectable_ventilation) restent scopées `en_attente/` + `traites/` |
| `ged_service.build_tree()` | **NON** — 5 axes (période, catégorie, fournisseur, type, année) ignorent sandbox |
| `ged_service.get_stats()` | **NON** — compteurs par-catégorie/fournisseur/type ignorent sandbox |
| `ged_service.get_documents()` | **NON** — scans depuis `en_attente/`, `traites/`, `releves/`, `operations/`, `reports/`, `rapports/` uniquement |
| Thumbnails (`data/ged/thumbnails/`) | **NON** — cache GED séparé. Sandbox a son propre cache `data/sandbox_thumbs/{md5}.png` via `sandbox_service.get_sandbox_thumbnail_path()` |
| Endpoints `/api/justificatifs/*` | **NON** — ne retournent jamais un fichier sandbox |
| Endpoints `/api/sandbox/*` | **NON cross-location** — ne retournent jamais un fichier en_attente ou traites |

**Visibilité côté stats** : `GET /api/justificatifs/stats` renvoie `{en_attente, traites, sandbox, total}` — le front badge la sidebar OCR (amber) sur `sandbox` uniquement ; le badge onglet interne `Gestion OCR` garde `en_attente` (scans canoniques sans association).

**Safety net reporté (non-V1)** : pas d'alerte « fichier sandbox > 7 jours » dans AlertesPage. Évolution possible si l'usage montre un besoin (voir CLAUDE.md "On the horizon").

### Rapprochement bancaire

```
Fichier opérations → rapprochement router → rapprochement_service
  → Auto : score(date, montant, fournisseur OCR) pour chaque opération × justificatif
  → Manuel : association directe opération ↔ justificatif
  → Mise à jour champs : rapprochement_score, rapprochement_mode, rapprochement_date
  → Dissociation : supprime lien justificatif + champs rapprochement
```

### Verrouillage des opérations (protection anti-écrasement)

```
Modèle Operation enrichi :
  → locked: Optional[bool] = False
  → locked_at: Optional[str] = None  (ISO datetime timespec=seconds)

Set automatique (association manuelle) :
  → backend/routers/rapprochement.py:associate_manual
  → Après succès justificatif_service.associate() → charge ops, set locked=true + locked_at, save
  → PAS dans le service pour éviter que l'auto-rapprochement locker aussi

Skip silencieux (auto-rapprochement) :
  → backend/services/rapprochement_service.py:run_auto_rapprochement (boucle ligne 767)
  → if op.get("locked"): continue (avant les branches ventilée/non-ventilée)
  → Protection globale sur l'op entière (pas au niveau sous-ligne)

Gardes HTTP 423 (ré-association / dissociation) :
  → backend/routers/rapprochement.py:associate_manual (en tête)
    - Charge ops, check op["locked"] → raise 423 sauf si req.force=True
    - Champ force: bool = False ajouté sur ManualAssociateRequest
  → backend/routers/justificatifs.py:dissociate_justificatif (en tête)
    - Même pattern, pas de bypass force disponible

Endpoint PATCH (toggle explicite) :
  → PATCH /api/operations/{filename}/{index}/lock
  → Body Pydantic : { locked: bool }
  → Response : { locked, locked_at }
  → Idempotent par valeur (pas un toggle aveugle)

Frontend :
  → useToggleLock : api.patch + invalidation ['operations', filename] + ['justificatifs']
  → LockCell (components/LockCell.tsx) :
    - Null si !hasJustificatif
    - Click unlocked → lock immédiat + toast
    - Click locked → UnlockConfirmModal → confirm → unlock + toast
    - Icônes : Lock orange #f59e0b (text-warning) si locked, LockOpen gris sinon
    - Tooltip custom ancré right-0 (pas centré) pour éviter débordement
  → UnlockConfirmModal : backdrop + card 380px warning avec message démonstratif

Intégration :
  → JustificatifsPage : inline-flex gap-1.5 wrap autour du bouton Justif
  → EditorPage : nouvelle colonne dédiée 28px après Justificatif, supporte year-wide
    via op._sourceFile ?? selectedFile + op._index ?? row.index

Double verrou (2 couches de protection) :
  → Couche 1 (native, préexistante) : run_auto skippe Justificatif=true (op/sous-ligne)
  → Couche 2 (nouvelle) : skip supplémentaire sur locked=true
  → Résultat : même après dissociation, l'auto ne peut pas ré-associer sans unlock explicite

Agent IA : ne touche JAMAIS aux champs Justificatif / Lien justificatif (vérifié —
  ml_service, ml_monitoring_service, routers/ml.py, categorize_file mutent uniquement
  Catégorie + Sous-catégorie)

Bulk-lock / Bulk-unlock (multi-fichiers) :
  → Endpoint PATCH /api/operations/bulk-lock (avant la route /{filename}/{index}/lock
    pour éviter collision FastAPI — sinon filename="bulk-lock" matcherait)
  → Modèles : BulkLockItem(filename, index, locked), BulkLockRequest(items),
    BulkLockResultItem(filename, index, locked, locked_at?, error?), BulkLockResponse
  → Algorithme :
    - sorted_items groupés par filename via itertools.groupby
    - Pour chaque groupe : 1 seul load_operations + 1 seul save_operations
    - Erreurs par-item (fichier introuvable, index hors bornes) remontées dans
      results[i].error sans stopper le batch
    - locked_at = datetime.now().isoformat(timespec="seconds") si locked=true

  Frontend :
  → useBulkLock (hooks/useBulkLock.ts) : mutation + invalidation par filename unique
  → BulkLockBar (components/BulkLockBar.tsx) : barre flottante toggle
    - Prop allLocked → switch icône Lock/LockOpen + couleur warning/emerald + label
    - Prop shifted → bottom-24 si coexistence avec autre barre, sinon bottom-6
  → Toggle intelligent : targetLocked = !lockSelectedAllLocked
    - Toutes verrouillées → mode déverrouillage
    - Mix ou toutes déverrouillées → mode verrouillage (homogénéise)

  UX JustificatifsPage :
  → 2ᵉ sélection indépendante lockSelectedOps dans useJustificatifsPage.ts
    (parallèle à selectedOps utilisé pour batch fac-similé)
  → lockableOps = ops avec Lien justificatif + !isOpExempt + ventilationIndex == null
  → Colonne Verrou dédiée, header = bouton 🔒 cliquable (3 états visuels)
  → Cellule : 3 modes
    - Non lockable → null
    - Sélection active → checkbox 22px warning seule
    - Repos → LockCell cliquable + checkbox 18px au hover à côté (<tr> avec classe group)

  UX EditorPage :
  → État lockSelectedOps inline (pas de hook partagé, duplication minime)
  → Colonne id: 'locked' refactorée (size 44px), header 🔒 masqué en allYearMode
  → <tr> parent reçoit classe group + highlight bg-warning/10 si sélectionnée
  → BulkLockBar masquée complètement en year-wide (lecture seule)
  → selectedOpsRefs construit via Object.keys(rowSelection).map(rowId =>
    ({file, index: op._index ?? Number(rowId)}))
    CRITIQUE : Number(rowId) = index dans la data array d'origine (TanStack default),
    PAS row.index qui est la position visible post-filtre/tri
```

### Snapshots (sélections nommées d'opérations réutilisables)

```
Objectif : permettre de sauvegarder des sélections ad-hoc d'opérations ("Litige Amazon",
"À vérifier comptable", "Acompte Q4") pour y revenir plus tard, exporter, partager.

Modèles (backend/models/snapshot.py) :
  → SnapshotOpRef(file, index)
  → Snapshot(id, name, description?, color?, ops_refs, context_year?, context_month?,
    context_filters?, created_at, updated_at?)
  → SnapshotCreate / SnapshotUpdate (payloads API)

Service (backend/services/snapshot_service.py) :
  → CRUD sur data/snapshots.json (structure {snapshots: [...]})
  → _op_hash(op) = (Date, Libellé.strip(), Débit, Crédit) — miroir des scripts split/merge
  → _build_active_hash_index() → {hash: (filename, index)} sur tous les fichiers ops actifs
  → _try_repair_ref_via_archive(old_file, old_index, hash_idx) :
    1. Cherche data/imports/operations/_archive/{old_file}.bak_* (plus récent)
    2. Charge archived_ops[old_index]
    3. Hash l'op, lookup dans hash_idx
    4. Retourne (new_file, new_index) ou None
  → resolve_snapshot_ops(snapshot_id) :
    - Pour chaque ref : load fichier, extract op à l'index
    - Si cassée → _try_repair_ref_via_archive → met à jour ops_refs + persiste
    - Retourne liste enrichie avec _sourceFile + _index

Router (backend/routers/snapshots.py) :
  → GET /, GET /{id}, GET /{id}/operations, POST /, PATCH /{id}, DELETE /{id}
  → POST validé : name non vide, ops_refs non vide

Frontend :
  → useSnapshots (hooks/useSnapshots.ts) : 5 hooks (list/get/operations/create/update/delete)
  → SnapshotCreateModal : modale 440px, nom pré-rempli contextuel intelligent
    (combine mois/année + filtre catégorie + recherche globale + count), description,
    picker 6 couleurs, raccourci Cmd+Enter
  → SnapshotsListDrawer : drawer 520px, cartes avec pastille couleur, hover actions
    (Voir, Supprimer avec confirmation inline)
  → SnapshotViewerDrawer : drawer 760px, titre éditable inline (crayon hover → input),
    4 stats (Ops/Débits/Crédits/Solde), badge ambre si refs cassées, tableau ops avec
    lien ExternalLink → /editor?file=X&highlight=Y
  → SnapshotsPage (/snapshots) : PageHeader, grille responsive 1/2/3 cols de
    SnapshotCard. Chaque carte utilise useSnapshotOperations pour stats live
  → Sidebar : item "Snapshots" dans groupe OUTILS (icône Camera)

Intégration EditorPage :
  → 2 boutons dans le header actions :
    1. 📷 "Mes snapshots" toujours visible → ouvre SnapshotsListDrawer
    2. 📷 "Snapshot (N)" visible si selectedCount > 0 && !allYearMode (bg warning)
       → ouvre SnapshotCreateModal
  → selectedOpsRefs construit depuis rowSelection TanStack (cf. règle Number(rowId))
  → Après création : setRowSelection({}) pour clear la sélection

Self-healing (critique) :
  → Les refs (file, index) sont fragiles face aux migrations données (split/merge/archivage)
  → resolve_snapshot_ops tente le repair transparent via hash au moment de la lecture
  → Les refs réparées sont persistées immédiatement → pas de recalcul au prochain accès
  → Limitation connue : si le bug initial Number(rowId) vs row.index a produit des refs
    erronées historiques, l'auto-repair trouve les ops aux mauvais index (pas l'intention
    user). Recommandation : supprimer + recréer les snapshots avec ops surprenantes
```

### Performance — Cache multi-couches (backend + frontend)

```
Contexte : avec l'augmentation du nombre de fichiers d'opérations (splits + merges +
mensuels historiques = 25-30 fichiers), le chargement de l'éditeur et le changement de
mois étaient devenus lents (1-3s).

Backend — operation_service.list_operation_files() :
  → Remplace pd.read_json par json.load natif + Counter pour le mois/année dominant
    (au lieu de pd.to_datetime + mode). 5× plus rapide par file.
  → Cache mémoire _LIST_FILES_CACHE: {path: (mtime, meta)}
  → Recalcule uniquement pour les fichiers modifiés depuis le dernier appel
  → Cleanup auto des entrées pour fichiers supprimés
  → Gain : 125 ms → 25 ms (cache hit)

Backend — rapprochement_service.get_batch_hints() :
  → Cache mémoire _BATCH_HINTS_CACHE: {filename: (signature, hints)}
  → signature = (ops_mtime, frozenset((ocr_name, ocr_mtime) for ocr in pending))
  → Invalidation automatique : dès qu'un fichier ops OU un justificatif en attente
    est modifié / ajouté / supprimé, la signature change → cache miss
  → Gain : 1 055-2 415 ms → 35-56 ms (cache hit)

Frontend — staleTime + placeholderData :
  → useOperationFiles : staleTime 60s (dropdown ne refetch pas à chaque navigation)
  → useOperations(filename) : staleTime 30s (revenir à un mois déjà visité = instantané)
  → useBatchHints(filename) : staleTime 2min + placeholderData: keepPreviousData
    - Évite refetch excessif
    - Évite re-render complet du TanStack Table pendant fetch : les colonnes ont
      batchHints dans leurs deps → avec keepPreviousData on garde les anciens hints
      le temps que les nouveaux arrivent, pas de flash visuel

Scripts de maintenance données :
  → scripts/split_multi_month_operations.py : éclate un fichier multi-mois en N
    fichiers mensuels, rebinde refs GED/OCR, archive source
  → scripts/merge_overlapping_monthly_files.py : fusionne fichiers qui se chevauchent
    via hash op-identité + heuristique enrichment_score, rebinde GED/OCR, archive
    sources, passe recover_orphan_refs_to_archived pour les refs cassées antérieures
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
      (lettrage : éclatement des sous-lignes ventilées, 1 vl = 1 unité)
    → Compte nb_justificatifs_total, nb_justificatifs_ok, taux_justificatifs
      (justifs : 1 op = 1 unité, ventilées « avec » ssi every sous-ligne justifiée,
       op simple via `Lien justificatif` non vide — aligné avec
       useJustificatifsPage.stats côté frontend, voir CHANGELOG 2026-04-26)
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
  ├─ Arbre gauche (260px) : 6 onglets (période, année/type, catégorie, fournisseur, type, templates)
  │   → GET /api/ged/tree → { by_period, by_category, by_vendor, by_type, by_year }
  │   → GedTreePanel : 6 icônes (Calendar, Layers, Tag, Building2, FolderTree, Wand2)
  │   → Onglet Templates masqué si templatesCount === 0
  │   → Onglets avec tooltips stylés au survol (fond blanc, texte noir, bordure)
  │   → deriveFiltersFromNode() convertit nodeId → GedFilters
  │   → Arborescence REPLIÉE PAR DÉFAUT (useState(false)) — user ouvre à la demande
  │   → scan_all_sources() indexe : relevés, justificatifs, rapports, docs libres
  │   → backfill_justificatifs_metadata() enrichit les traités existants
  │   → migrate_reports_index() migre reports_index.json (one-shot)
  │
  ├─ Barre filtres croisés (GedSearchBar) — pleine largeur au-dessus du split
  │   → Input search + montant min/max + toggle filtres avancés
  │   → Chips actifs colorés, compteur résultats
  │   → Init filtres via URL params (/ged?type=rapport&year=2026, /ged?axis=templates)
  │
  ├─ Contenu :
  │   ├─ Mode documents : grille cartes enrichies (GedDocumentCard) ou tableau liste
  │   │   → Thumbnail PDF + badges overlay (statut/montant/date pour justificatifs)
  │   │   → Étoile favori pour rapports
  │   │   → Mode comparaison (checkbox sélection 2 rapports)
  │   │
  │   └─ Mode templates (activeTab === 'templates') : GedTemplatesView
  │       → Grille de cards template (thumbnail, badge VIERGE, chips cat, méta)
  │       → GET /api/templates/ged-summary (scan .ocr.json pour compter fac-similés)
  │       → 2 boutons par card : Éditer (ouvre TemplateEditDrawer) + Générer (BatchGenerateDrawer)
  │       → Filtres panneau gauche : AFFICHAGE (Tous/Vierge/Scanné) + CATÉGORIE
  │
  ├─ Drawer contextuel selon type :
  │   → Document (GedDocumentDrawer) : thumbnail cliquable + fiscalité + postes
  │     → Remplacement de l'iframe inline par vignette + sub-drawer grand format
  │     → GedPreviewSubDrawer slide depuis la droite à gauche du main drawer
  │     → <object type="application/pdf"> avec toolbar native (PDF) ou <img> (image)
  │     → Esc en mode capture ne ferme QUE le sub-drawer
  │   → Rapport (GedReportDrawer) : preview PDF + favori + re-génération + suppression
  │   → Template (GedTemplateDetailDrawer) : aperçu + infos éditables + champs readonly
  │     → Liste fac-similés générés cliquables → /justificatifs?file=...
  │     → Footer : Supprimer (confirm enrichi "N fac-similés conservés") / Éditer / Générer batch
  │     → GET /api/templates/{id}/ged-detail pour le compteur + liste
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
Page Amortissements (/amortissements) → AmortissementsPage (5 onglets, badges Lucide)
  ├─ Registre (List) : tableau immobilisations avec avancement %, VNC, statut, badge Reprise ambre
  ├─ Tableau annuel (Calendar) : dotations par exercice avec totaux
  ├─ Synthèse par poste (BarChart3) : VNC et dotations par poste comptable
  ├─ Candidates (Sparkles) : opérations détectées (montant > seuil + Catégorie == "Matériel" strict)
  └─ Dotation (Calculator) : génération OD 31/12 + PDF + GED (B1)
       ├─ État saisie : 3 MetricCards (Brute / Déductible accent / Immos) + bandeau ref légale
       │  + bandeau verrouillage + tableau récap immos contributives readonly
       │  + bouton "Générer la dotation {year}" (toast brandé violet Sparkles)
       └─ État généré : checklist 3✓ + 5 boutons (GED / Éditeur / Regénérer / Envoyer / Supprimer)
          + PdfThumbnail 200×280 → PdfPreviewDrawer 700px

Moteur de calcul (dupliqué Python + TypeScript) :
  ├─ Linéaire strict BNC : annuité = base / durée, pro rata année 1 (jours/360), complément dernière année
  ├─ Dégressif : conservé en LECTURE SEULE pour immos legacy (interdit en BNC régime recettes)
  ├─ Plafonds véhicules : base plafonnée selon classe CO2 (30000/20300/18300/9900€)
  ├─ Quote-part pro : dotation_déductible = dotation_brute × quote_part_pro / 100
  └─ Reprise d'exercice antérieur : 3 champs (exercice_entree_neuronx + amortissements_anterieurs + vnc_ouverture)
       avec auto-suggestion via POST /amortissements/compute-backfill (linéaire pur, pro rata année 1)
       — la ligne récap is_backfill=True est exclue du BNC

Flow OD dotation (Prompt B1 + B3) :
  generer_dotation_ecriture(year)
    ├─ get_virtual_detail(year) → liste immos contributives
    ├─ find_dotation_operation(year) → suppression OD si existante (idempotent)
    ├─ _find_or_create_december_file(year) → fichier ops décembre
    ├─ report_service.get_or_generate(template_id="amortissements_dotations", filters={year, poste:"all"}, format="pdf")
    │     → renderer = amortissement_report_service.render_dotations
    │     → cache hit si dedup_key == "amort_dotations_{year}_all" déjà en index
    ├─ append OD locked=True, source="amortissement", Lien justificatif=reports/{filename}
    └─ _register_dotation_ged_entry(...) → enrichit metadata GED (operation_ref, source_module)

Templates Rapports V2 amortissements (Prompt B3) :
  report_service.REPORT_TEMPLATES :
    ├─ amortissements_registre (icône Package, dedup_key=amort_registre_{year}_{statut}_{poste})
    └─ amortissements_dotations (icône TrendingDown, dedup_key=amort_dotations_{year}_{poste})
  Renderer multi-format : render_registre / render_dotations → PDF (paysage A4 + colonne Origine + badge ambre Reprise)
                                                              + CSV (BOM UTF-8 + ; + virgule + CRLF Excel FR)
                                                              + XLSX (header violet + format €+ formules SUM + freeze A2)
  Convergence : OD + ZIP comptable + UI /reports consomment tous get_or_generate → 1 PDF/CSV/XLSX par couple (filters, format)

Données : data/amortissements/{immobilisations.json, config.json}
         + data/reports/rapport_*_{timestamp}.{pdf,csv,xlsx} (avec dedup_key dans reports_index.json)
```

### Charges Forfaitaires (blanchissage + repas + véhicule)

```
Page Charges forfaitaires (/charges-forfaitaires) → ChargesForfaitairesPage
  ├─ Tabs badges pill colorés : Shirt violet (Blanchissage) / UtensilsCrossed orange (Repas) / Car bleu (Véhicule)
  │
  ├─ Onglet Blanchissage :
  │   ├─ État 1 — Saisie :
  │   │   ├─ Inputs : jours travaillés (décimales, step 0.5), honoraires liasse SCP (optionnel)
  │   │   ├─ Barème éditable : tarifs pressing (€, step 0.01), qté/jour, décote domicile 30%
  │   │   ├─ 3 MetricCards : honoraires bruts ou liasse, coût/jour, total déductible
  │   │   ├─ Tableau détail articles (calcul live debounce 300ms)
  │   │   └─ Bouton "Générer l'écriture" → toast custom brandé (logo + gradient violet)
  │   └─ État 2 — Déjà généré :
  │       ├─ Checklist 3✓ (OD, PDF, GED)
  │       ├─ Thumbnail PdfThumbnail (PNG) → clic → PdfPreviewDrawer (700px)
  │       └─ Boutons : Ouvrir GED / Regénérer / Envoyer au comptable (objet pré-rempli)
  │
  ├─ Onglet Repas (forfait déductible BOI-BNC-BASE-40-60) :
  │   ├─ Barème URSSAF : seuil repas maison (5,35 €) + plafond restaurant (20,20 €)
  │   ├─ Forfait/jour = plafond − seuil (calculé, jamais stocké)
  │   ├─ État 1 — Saisie :
  │   │   ├─ Input jours travaillés (partagé avec blanchissage)
  │   │   ├─ 3 MetricCards : seuil maison, plafond restaurant, forfait/jour (violet)
  │   │   ├─ Tableau barème (Paramètre / Valeur / Source) + total déductible
  │   │   ├─ Calcul live côté client (useMemo, pas d'appel API)
  │   │   └─ Bouton "Générer l'écriture" → toast brandé
  │   └─ État 2 — Déjà généré :
  │       ├─ Checklist 3✓ (OD, PDF, GED)
  │       ├─ Thumbnail PdfThumbnail → clic → PdfPreviewDrawer
  │       └─ Boutons : Ouvrir GED / Regénérer / Envoyer au comptable
  │
  ├─ Onglet Véhicule (quote-part professionnelle) :
  │   ├─ État 1 — Saisie :
  │   │   ├─ 4 Inputs : distance aller (km), jours travaillés (partagé), km sup, km totaux compteur
  │   │   ├─ Honoraires liasse SCP (optionnel, même pattern que blanchissage)
  │   │   ├─ Calcul live côté client (useMemo, pas d'appel API) : jours × distance × 2 + km_sup
  │   │   ├─ 3 MetricCards : km trajet habituel, km professionnels, % déductible
  │   │   ├─ Barre visuelle pro/perso + encadré poste actuel + delta pts
  │   │   ├─ Tableau dépenses véhicule (sous-catégories Véhicule+Transport, brut → déductible)
  │   │   └─ Bouton "Appliquer X% au poste Véhicule" → toast brandé
  │   └─ État 2 — Déjà appliqué :
  │       ├─ Checklist 3✓ (Poste, PDF, GED)
  │       ├─ Thumbnail PdfThumbnail (PNG) → clic → PdfPreviewDrawer (700px)
  │       ├─ Tableau dépenses véhicule (live, pas figé)
  │       ├─ Auto-regénération PDF silencieuse à la visite (useEffect + useRef)
  │       └─ Boutons : Ouvrir GED / Regénérer / Envoyer au comptable
  │
  ├─ Backend : ChargesForfaitairesService
  │   ├─ Blanchissage : calcul, OD décembre, PDF ReportLab, GED
  │   ├─ Repas : calcul forfait (plafond − seuil × jours), OD décembre, PDF, GED
  │   ├─ Véhicule : calcul ratio, update poste GED, PDF avec dépenses, GED, historique barème
  │   ├─ Barèmes : blanchissage_{year}.json + repas_{year}.json + vehicule_{year}.json (fallback année récente)
  │   ├─ PDF : data/reports/ (blanchissage_*.pdf, repas_*.pdf, quote_part_vehicule_*.pdf)
  │   ├─ GED : type "rapport" + source_module "charges-forfaitaires"
  │   └─ Config : data/charges_forfaitaires_config.json (par année, champs partagés + véhicule)
  │
  ├─ Composants partagés :
  │   ├─ PdfPreviewDrawer.tsx : drawer 700px avec object PDF + boutons ouvrir/télécharger/fermer
  │   └─ PdfThumbnail : image PNG cliquable (pas iframe/object — évite capture clics par plugin PDF)
  │
  └─ Intégrations :
      ├─ Simulation BNC : blanchissage = checkbox toggle, véhicule = ligne informative (ratio %)
      ├─ GED : drawer bidirectionnel (bouton "Voir dans Charges forfaitaires")
      └─ Email : sendDrawerStore.defaultSubject pour objet pré-rempli
```

### URSSAF Déductible (CSG/CRDS)

```
Calcul automatique de la part déductible vs non déductible des cotisations URSSAF.

Règle fiscale :
  Non déductible = CSG 2,4% + CRDS 0,5% = 2,9% × assiette CSG/CRDS
  Assiette ≤2024 : BNC + cotisations sociales obligatoires (mode "bnc_plus_cotisations")
  Assiette ≥2025 : BNC × 0,74 (réforme décret 2024-688, mode "bnc_abattu")

Backend :
  ├─ Barèmes : data/baremes/urssaf_{year}.json → section csg_crds enrichie
  │   (taux_non_deductible, assiette_mode, assiette_abattement)
  ├─ fiscal_service.compute_urssaf_deductible() → calcul pur, aucun effet de bord
  ├─ POST /api/simulation/urssaf-deductible → calcul unitaire
  ├─ POST /api/simulation/batch-csg-split?year=X&force=bool → batch toutes ops URSSAF d'une année
  ├─ PATCH /api/operations/{filename}/{index}/csg-split → stocke csg_non_deductible sur une op
  └─ Analytics : charges_pro et total_debit diminués de csg_non_deductible
     (export_service.py ligne 138, analytics_service.py ligne 380)

Détection URSSAF : libellé contient "urssaf"/"dspamc"/"cotis"
  ou catégorie "Cotisations" + sous-catégorie "URSSAF"

Frontend :
  ├─ UrssafSplitWidget.tsx (EditorPage) : badge rouge "X € nd" si déjà calculé,
  │   bouton "CSG ⚡" sinon → popover décomposition → [Appliquer]
  ├─ CategoryDetailDrawer.tsx (Compta Analytique) : encadré "Déductibilité CSG/CRDS"
  │   avec bouton batch "Calculer tout / Recalculer" pour toute l'année
  │   + badges "X € nd" sur chaque opération dans la liste
  └─ Hooks : useUrssafDeductible, usePatchCsgSplit, useBatchCsgSplit
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
  ├─ Créer depuis justificatif : sélection justificatif existant → POST /api/templates/extract
  │   → Extraction OCR enrichie (Qwen2-VL via Ollama, fallback .ocr.json basique)
  │   → Formulaire : vendor, aliases, catégorie, table champs (checkbox, label, source, confiance)
  │   → POST /api/templates → sauvegarde dans data/templates/justificatifs_templates.json
  ├─ Créer depuis PDF vierge : bouton "Depuis un PDF vierge" (icône FilePlus2)
  │   → BlankTemplateUploadDrawer (420px, dropzone + vendor + aliases + cat/sous-cat)
  │   → POST /api/templates/from-blank (multipart, pas d'OCR lancé)
  │     → Sauvegarde PDF dans data/templates/{id}/background.pdf
  │     → Rasterise thumbnail.png 200px (pdf2image + Pillow)
  │     → Lit dimensions page (pdfplumber) : page_width_pt, page_height_pt
  │     → Crée template avec is_blank_template=True, fields=[]
  │   → Sur succès, ouvre auto TemplateEditDrawer en mode édition
  │     → Click-to-position sur l'aperçu : ratio pageWidthPt / img.clientWidth
  │     → Overlays rectangles amber sur les champs positionnés
  │     → canSave relaxé : pas besoin de champs date/montant_ttc obligatoires
  ├─ Bibliothèque : grille cards templates (vendor, aliases, champs, usage_count)
  │   → Badge overlay VIERGE amber si is_blank_template=True
  │   → Chip catégorie · sous-catégorie si renseignées
  │   → DELETE /api/templates/{id} pour suppression (préserve les fac-similés générés)
  └─ Générer : sélection opération (file + index) → GET /api/templates/suggest/{file}/{idx}
      → Template auto-suggéré par matching alias dans le libellé bancaire
      → Formulaire 2 colonnes : champs auto (grisés) + champs manuels
      → Calcul TVA temps réel (formules computed)
      → POST /api/templates/generate
          → ReportLab : PDF A5 sobre (Helvetica, pas de watermark) OU fac-similé overlay si coords
          → .ocr.json compagnon ("source": "reconstitue", template_id, operation_ref)
          → Propagation hints catégorie : si template.category existe,
             écrit category_hint + sous_categorie_hint au top-level du .ocr.json
             → rapprochement_service.score_categorie() lit ces hints en priorité ML
          → Fichiers dans data/justificatifs/en_attente/vendor_YYYYMMDD_amount.XX_fs.pdf
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
  → Widget « Scans en attente d'association » (collapsed par défaut, badge compteur visible dans le header)
  → Barre progression globale pondérée (10/20/20/10/20/10/10 — 7 étapes)
  → Stepper 7 étapes accordion (cards expandables) :
    1. Import (GET /api/operations/files)
    2. Catégorisation (GET /api/operations/{filename})
    3. Justificatifs (GET /api/cloture/{year} → taux_justificatifs)
    4. Verrouillage (calcul client depuis operationsQuery.data : locked / associées)
       → Numérateur : ops avec locked=true parmi celles associées
       → Dénominateur : ops avec 'Lien justificatif' non vide OU ventilation justifiée
       → CTA : « Voir les associations » → /justificatifs?file=X&filter=avec
    5. Lettrage (GET /api/cloture/{year} → taux_lettrage)
    6. Vérification (GET /api/alertes/summary)
    7. Clôture (GET /api/cloture/{year} → statut)
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

Frontend : `DndContext` (@dnd-kit, `closestCorners`) → 3 colonnes `useDroppable` + `SortableContext` → cartes `useSortable`. Refresh auto au montage et au changement d'année (store Zustand).

```
Réordonnancement drag & drop :
    DndContext (closestCorners)
    ├── KanbanColumn (useDroppable + SortableContext)
    │   └── TaskCard (useSortable, champ order: int)
    │
    handleDragEnd :
    ├── Intra-colonne → arrayMove(tasks, old, new) → POST /reorder {ordered_ids}
    └── Inter-colonnes → PATCH /{id} {status} → POST /reorder {ordered_ids}
```

### Sélecteur année global

```
useFiscalYearStore (Zustand + persist localStorage)
    │
    ├── Sidebar : sélecteur ◀ ANNÉE ▶
    ├── EditorPage : dropdown année → mois en cascade
    ├── DashboardPage : YearSelector
    ├── CloturePage : boutons ◀▶
    ├── AlertesPage : dropdown année → mois + filtres catégorie/sous-catégorie
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
