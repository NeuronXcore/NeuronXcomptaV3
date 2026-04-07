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

Importation      Justificatifs      Tableau de bord     Export Comptable    Bibliothèque    Agent IA
Édition          Rapprochement      Compta Analytique   Clôture             (GED)           Paramètres
Catégories       Compte d'attente   Rapports            Amortissements
OCR              Prévisionnel       Simulation BNC
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
  → Retour : résultats avec données OCR (montant, date, fournisseur)
  → Page Justificatifs = vue opérations-centrée (tableau triable, drawer attribution split resizable, pas d'upload)

Alternative : Sandbox watchdog
  → Dépôt PDF/JPG/PNG dans data/justificatifs/sandbox/
  → Si image : conversion PDF + écriture en_attente/ + suppression image
  → Si PDF : shutil.move vers en_attente/
  → OCR + SSE notification

Formats acceptés : PDF, JPG, JPEG, PNG (config.ALLOWED_JUSTIFICATIF_EXTENSIONS)
Validation : magic bytes (config.MAGIC_BYTES), limite 10 Mo
Images converties en PDF à l'intake, original non conservé
```

### Rapprochement bancaire

```
Rapprochement automatique : POST /rapprochement/run-auto
  → Parcourt justificatifs en_attente avec OCR
  → Score = 45% montant + 35% date + 20% fournisseur (Jaccard + sous-chaîne)
  → score_fournisseur : max(Jaccard, substring matching)
    ex: "amazon" dans "PRLVSEPAAMAZONPAYMENT" → 1.0
  → Auto-associe si score >= 0.80 et écart >= 0.02 avec 2ème match
  → Chaîné automatiquement après OCR (3 points d'entrée) :
    - _run_ocr_background() dans justificatifs.py
    - batch_upload() dans ocr.py
    - _process_file() dans sandbox_service.py

Rapprochement manuel : drawer avec filtres + recherche libre
  → Suggestions scorées : GET /suggestions/operation/{file}/{index}
  → Recherche libre : GET /justificatifs/?status=en_attente&search=...
  → Bouton Attribuer orange (bg-warning) + preview PDF
  → Score affiché en % (score.total × 100)

Bouton "Associer automatiquement" sur JustificatifsPage :
  → Bandeau CTA contextuel (visible quand ops sans justificatif)
  → Toast cliquable → filtre "Sans justif." + ouvre drawer
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

### Export Comptable V2

```
_prepare_export_operations(operations, filename) :
  → Itère les opérations, explose les ventilations en sous-lignes [V1/N]
  → Classe en 3 groupes :
    - pro : catégorie valide (BNC)
    - perso : categorie.lower() == "perso" (exclues du BNC)
    - attente : vide, None, "Autres", "Ventilé" sans sous-lignes
  → Trie chaque groupe par date ASC
  → Calcule totaux : recettes_pro, charges_pro, solde_bnc, total_perso, total_attente

CSV : séparateur ;, UTF-8 BOM, CRLF, montants FR via _format_amount_fr()
  → 8 colonnes : Date, Libellé, Débit, Crédit, Catégorie, Sous-catégorie, Justificatif, Commentaire
  → Sections : ops pro → TOTAL PROFESSIONNEL → ops perso → TOTAL PERSO → ops attente → TOTAL ATTENTE

PDF : paysage A4, logo backend/assets/, footer Page X/Y + NeuronXcompta
  → 8 colonnes avec montants alignés droite
  → Sections headers fond #D5E8F0, totaux fond #E8E8E8 bold
  → Justificatif : ☑ vert + nom fichier ou ☐ gris
  → Commentaire : italique 6pt tronqué 40 chars
  → Récapitulatif BNC en bas de page

Nommage : Export_Comptable_{YYYY}-{MM}_{MoisFR}.{ext}
  → _export_filename(year, month, ext)
  → ZIP : Export_Comptable_{YYYY}-{MM}_{MoisFR}_{timestamp}.zip
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
  → Frontend : OcrDataEditor (chips montants/dates + input manuel + fournisseur)
  → Badge "OCR incomplet" dans la galerie si ocr_amount ou ocr_date null
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
  → Event SSE poussé via asyncio.Queue (thread-safe via loop.call_soon_threadsafe)
  → Frontend : useSandbox hook (EventSource) → invalidation TanStack Query + toast
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
