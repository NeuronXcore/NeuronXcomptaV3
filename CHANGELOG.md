# Changelog

Toutes les modifications notables de NeuronXcompta sont documentees ici.

Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [Unreleased]

### Added (2026-04-08) — Session 6

- **Titre automatique des rapports**
  - Fonction `buildReportTitle()` dans ReportsPage : compose titre à partir catégories + période
  - Règles : 1 cat = nom exact, 2-4 = liste virgule, 5+ = 3 premières + compteur, toutes = "Toutes catégories"
  - Champ titre éditable avec flag `titleManuallyEdited` (auto-reprend si vidé)
  - Batch 12 mois utilise `buildReportTitle` par mois

- **Refonte Export Comptable V3**
  - Réécriture complète de ExportPage : 2 onglets (Générer des exports / Historique)
  - Grille calendrier 4×3 avec `ExportMonthCard` (3 états : pas de données / à générer / prêt)
  - Badges toggle PDF + CSV par mois (les deux activés par défaut)
  - Bouton unique "Exporter" → génère un ZIP contenant toujours PDF+CSV
  - Architecture ZIP : racine (operations.pdf + operations.csv), dossiers `releves/`, `rapports/`, `justificatifs/`
  - Preview contenu dans chaque carte (nb relevés, rapports, justificatifs)
  - Historique : expander contenu ZIP avec noms enrichis (relevés → "Relevé Mois Année")
  - Sélection multi-export dans l'historique + bouton "Envoyer au comptable"
  - Bouton "Envoyer au comptable" dans le PageHeader
  - Backend : `GET /status/{year}`, `POST /generate-month`, `POST /generate-batch`, `GET /contents/{filename}`, `GET /available-reports/{year}/{month}`
  - `exports_history.json` pour le logging des exports
  - Suppression du format Excel (XLSX)

- **Email Comptable — Drawer universel d'envoi**
  - Drawer 2 colonnes : sélection documents + composition email
  - Filtres par type (chips toggleables : Exports, Rapports, Relevés, Justificatifs, Documents GED)
  - Filtres par période (année + mois)
  - Recherche texte
  - Composition : destinataires chips (pré-remplis depuis settings), objet + corps auto-générés, pièces jointes listées, jauge 25 Mo
  - Envoi : tous documents zippés en un seul `Documents_Comptables_*.zip`
  - Email HTML avec logo en-tête (`logo_lockup_light_400.png` CID inline) + footer copyright (`logo_mark_64.png` + © année)
  - Fallback texte brut pour clients email non-HTML
  - Onglet Historique dans le drawer : cartes expansibles (date, destinataires, objet, statut, liste documents)
  - Store Zustand `sendDrawerStore` pour ouverture globale avec pré-sélection
  - Accessible depuis : sidebar (sous Pipeline, badge bleu), page Exports, page GED
  - Configuration SMTP dans Paramètres > Email (nouvel onglet) : Gmail + app password + nom expéditeur + destinataires chips
  - Backend : `email_service.py` (SMTP, résolution multi-type, listing documents), `email_history_service.py` (log/lecture/couverture)
  - Endpoints : `POST /test-connection`, `GET /documents`, `POST /preview`, `POST /send`, `GET /history`, `GET /coverage/{year}`
  - Composant réutilisable `EmailChipsInput` (validation email, ajout/suppression, Backspace)

- **Noms enrichis des relevés bancaires**
  - Mapping hash → "Relevé Mois Année" depuis les fichiers d'opérations
  - Appliqué dans le drawer envoi, le contenu ZIP de l'historique, et le listing documents

### Added (2026-04-08) — Session 5

- **Navigation bidirectionnelle Justificatif <-> Operation**
  - Nouveau endpoint `GET /api/justificatifs/reverse-lookup/{filename}` : trouve les operations liees a un justificatif
  - Composant `JustificatifOperationLink` : bouton "Voir l'operation" (orange) pour justificatifs associes, suggestions d'operations pour justificatifs en attente
  - Integration dans GED drawer, OCR historique, Rapprochement log
  - EditorPage : support `?file=X&highlight=Y` avec scroll + surbrillance permanente (outline orange)

- **GED V3 — Arborescence fournisseur + justificatifs en attente**
  - Fix arborescence fournisseur : clics fonctionnels sur tous les onglets (bug `parentLabel` non destructure)
  - Justificatifs en attente inclus dans la GED (237 docs au lieu de 104)
  - Badge "EN ATTENTE" ambre sur les cartes de justificatifs non attribues
  - Enrichissement automatique des metadata depuis le nom de fichier (convention `fournisseur_YYYYMMDD_montant.pdf`)
  - Suppression de rapports depuis la GED (delegation a `report_service.delete_report()`)

- **Templates justificatifs — Fac-simile PDF**
  - Modele `FieldCoordinates` (x, y, w, h, page) sur `TemplateField`
  - Extraction automatique des coordonnees via pdfplumber `extract_words()`
  - Generation fac-simile : rasterisation du PDF source + masquage images produits + remplacement date/montant
  - Fallback sur PDF sobre ReportLab si pas de coordonnees
  - Preview templates dans la bibliotheque (thumbnail + drawer detail avec champs et coordonnees)
  - Section "Generer" : dropdowns fichier/operation (filtre par annee + sans justificatif uniquement)
  - Suppression des champs TVA (non assujetti)
  - Fix page noire (bug `key={s}` sur objets sous-categories)

- **Rapprochement / Justificatifs — Fusion et ameliorations**
  - Page Rapprochement supprimee de la sidebar (redirection `/rapprochement` -> `/justificatifs`)
  - Page Justificatifs utilise le `RapprochementManuelDrawer` (filtres, scores, preview PDF)
  - EditorPage utilise le meme drawer pour l'attribution de justificatifs
  - Clic trombone vert dans Editeur/Justificatifs : preview PDF + bouton Dissocier + bouton Ouvrir Apercu
  - Clic trombone gris/ambre : drawer attribution (inchange)
  - Suggestions filtrees par mois de l'operation (tolerance +/- 1 mois)
  - Surbrillance orange sur la ligne selectionnee dans Editeur et Justificatifs

- **Pipeline — Navigation contextuelle**
  - Toutes les etapes passent `?file=operationsXXX.json` aux pages destination
  - Page Justificatifs lit `?file=` pour pre-selectionner le bon mois
  - Etape 4 renommee "Lettrage" (pointe vers `/justificatifs`)
  - Pipeline en evidence dans la sidebar (badge orange avec %)
  - Bouton "Voir justificatifs" en badge orange dans l'etape 3
  - Etape 2 Categorisation : passe `?file=X&filter=uncategorized`

- **Auto-pointage des operations completes**
  - Setting `auto_pointage: bool = True` dans `AppSettings`
  - `auto_lettre_complete()` : pointe les ops avec categorie + sous-categorie + justificatif (ventilees : toutes sous-lignes completes)
  - Integre dans 4 points : PUT operations, POST categorize, POST associate, POST associate-manual
  - Toggle "Auto-pointage" dans le header Dashboard (vert/gris)
  - Toast informatif dans EditorPage apres save

- **Operations "Perso" auto-justifiees**
  - `_mark_perso_as_justified()` : auto-marque `Justificatif=true` pour les ops categorie "Perso"
  - Appele automatiquement a chaque save d'operations

- **Rapports — Categories Perso et Non categorise**
  - Checkboxes "Perso" et "Non categorise" dans le selecteur de categories
  - Backend `_apply_filters` gere `__non_categorise__` (ops sans categorie ou "Autres")

- **Sandbox — Traitement parallele**
  - `process_existing_files()` utilise `ThreadPoolExecutor(max_workers=3)` au lieu de sequentiel
  - Nouveau endpoint `POST /api/sandbox/process` pour declenchement manuel

- **OCR Historique — Filtres et pleine largeur**
  - Filtres par annee (store global), mois, fournisseur
  - Date extraite du nom de fichier (convention YYYYMMDD)
  - Colonnes triables (date, fournisseur, confiance)
  - Page OCR en pleine largeur

- **Toast rapprochement auto design**
  - Toast avec icone, compteurs colores (associations auto + suggestions manuelles + restants en attente)
  - Reste visible 15 secondes avec bouton fermer

- **Export Comptable — Nommage simplifie**
  - Format `Export_Comptable_ANNEE_Mois.{csv,pdf,zip}` (sans le numero de mois)

- **UI/UX**
  - Focus-within orange dans l'editeur (remplace le bleu)
  - Surbrillance orange permanente pour la ligne highlight depuis la GED
  - Selection checkbox orange dans l'editeur

### Added (2026-04-07) — Session 4

- **GED V2 — Hub documentaire unifie** : refonte complete de la bibliotheque documents
  - **Backend modele enrichi** : nouveaux champs `PeriodInfo`, `RapportMeta`, `fournisseur`, `date_document`, `date_operation`, `period`, `montant`, `ventilation_index`, `is_reconstitue`, `operation_ref`, `rapport_meta` sur `GedDocument`
  - **5 vues arbre** : `by_period` (annee/trimestre/mois), `by_year` (annee/type/mois), `by_category` (categorie/sous-categorie), `by_vendor` (fournisseur/annee), `by_type` (releves/justificatifs en attente+traites/rapports par format/docs libres)
  - **Enrichissement automatique metadata** :
    - `enrich_metadata_on_association()` : apres rapprochement auto/manuel → categorie, fournisseur, montant, period, operation_ref
    - `enrich_metadata_on_ocr()` : apres OCR → fournisseur, date_document, montant
    - `propagate_category_change()` : au save editeur → sync categorie aux justificatifs lies
    - `clear_metadata_on_dissociation()` : au dissociate → reset champs enrichis
    - `backfill_justificatifs_metadata()` : enrichissement one-shot des justificatifs traites existants au scan
  - **Rapports integres dans la GED** : `register_rapport()` appele apres generation, `migrate_reports_index()` migration one-shot depuis `reports_index.json`
  - **Nouveaux endpoints** : `GET /pending-reports`, `POST /documents/{id}/favorite`, `POST /documents/{id}/regenerate`, `POST /documents/compare-reports`
  - **Filtres documents enrichis** : quarter, categorie, sous_categorie, fournisseur, format_type, favorite — recherche full-text inclut titres/descriptions rapports + fournisseur
  - **Stats enrichies** : `par_categorie`, `par_fournisseur`, `par_type`, `non_classes`, `rapports_favoris`
  - **Mapping `POSTE_TO_CATEGORIE`** : 16 postes → categorie comptable pour classement docs libres dans l'arbre categorie
  - **Nettoyage fournisseurs** : `_clean_fournisseur()` supprime guillemets/espaces parasites des donnees OCR
  - **Frontend** :
    - `GedTreePanel` : 5 onglets icones avec derivation filtres automatique depuis node IDs
    - `GedFilterBar` : barre filtres croises (type, categorie, fournisseur, recherche) avec dropdowns compteurs et reset
    - `GedDocumentCard` : carte enrichie (thumbnail, badge categorie, fournisseur, periode, montant, badge reconstitue, etoile favori)
    - `GedReportDrawer` : drawer rapport 800px (preview PDF, favori, re-generation, telechargement, suppression)
    - `GedPage` reecrit : 5 onglets arbre, filtres croises, mode comparaison, drawer contextuel rapport/document, init filtres via URL params
    - Types enrichis : `PeriodInfo`, `RapportMeta`, `GedDocument` enrichi, `GedTreeResponse` (5 vues), `GedStats` enrichi, `GedFilters` enrichi
    - Hooks V2 : `useGedPendingReports`, `useToggleReportFavorite`, `useRegenerateReport`, `useCompareReports`
  - **ReportsPage simplifie** : onglet Bibliotheque supprime, bouton "Voir dans la bibliotheque" → `/ged?type=rapport`
  - **Integrations backend** : rapprochement_service, report_service, operations router, justificatifs router, ocr_service, reports router (delete → remove GED)

### Added (2026-04-06) — Session 3

- **Refonte Export Comptable (CSV + PDF)** : regles comptables strictes, format professionnel
  - Nouvelle fonction `_prepare_export_operations()` : classe les operations en 3 groupes (pro/perso/attente)
  - Ventilations explosees en sous-lignes avec suffixe `[V1/N]`
  - Ops "perso" exclues des totaux BNC (section separee "Mouvements personnels")
  - Ops sans categorie / "Autres" en compte d'attente (section separee)
  - CSV : separateur `;`, UTF-8 BOM, CRLF, montants FR (`1 234,56`), colonne Justificatif = nom fichier PDF, pas de lignes `#`
  - PDF : logo en haut a gauche, 7 colonnes, montants alignes droite, 3 sections colorees, recapitulatif BNC, footer pagine (`Page X/Y`)
  - Nommage : `Export_Comptable_YYYY-MM_Mois.{csv,pdf}` (retrocompatibilite ancien format)
  - Helpers : `_format_amount_fr()`, `_export_filename()`, `_safe_float()`

- **Auto-alimentation ML depuis corrections manuelles** : apprentissage automatique au save
  - `ml_service.add_training_examples_batch()` : ajout batch deduplique dans `training_examples.json`
  - `ml_service.update_rules_from_operations()` : mise a jour `exact_matches` + `subcategories` dans le modele a regles
  - Handler PUT `/api/operations/{filename}` : extrait les operations categorisees au save et alimente le ML
  - Effet immediat : nouvelles regles exactes actives des le prochain auto-categorize
  - Effet differe : "Entrainer + Appliquer" utilise les nouvelles donnees d'entrainement
  - Filtre : exclut vide, "Autres", "Ventile" — deduplication par couple `(libelle, categorie)`

- **Fix ajout ligne EditorPage** : la nouvelle ligne apparait toujours en haut du tableau
  - Reset des filtres colonnes, recherche globale, et filtre "Non categorisees" a l'ajout
  - Tri bascule en date decroissante + pagination remise a page 0

- **Bouton "Ouvrir dans Apercu/Numbers" (Rapports)** : ouverture native des fichiers
  - Backend : endpoint `POST /reports/{filename}/open-native` avec `subprocess.Popen(["open", ...])`
  - Frontend : hook `useOpenReportNative()`, bouton dans `ReportPreviewDrawer` et `ReportGallery`
  - Label adapte au format : "Ouvrir dans Apercu" (PDF), "Ouvrir dans Numbers" (CSV), "Ouvrir dans Excel" (XLSX)

- **Refonte Rapports — Generation** : checkboxes modernes + batch
  - Remplacement `<select multiple>` par checkboxes toggle (18px, Check/Minus icons, pastilles couleur)
  - Checkbox "Tout selectionner" en premiere ligne avec etat intermediaire (tiret) et compteur `N/17`
  - Meme systeme pour les sous-categories
  - Bouton "Batch (12 mois)" : genere un rapport par mois pour l'annee selectionnee avec toast progression
  - Titres ameliores : 2-4 categories listees, 5+ tronquees avec `(+N)` (ex: "URSSAF, CARMF, Honoraires… (+3) — Mars 2025")

- **Refonte Rapports — Bibliotheque** : checkboxes modernes + export comptable + suppression
  - Checkboxes toggle modernes sur chaque carte (18px, remplacement `<input type="checkbox">`)
  - Toolbar : checkbox "Tout selectionner" avec etat intermediaire + compteur selection
  - Arborescence simplifiee : 2 onglets (Par date / Par categorie) au lieu de 3
  - Bouton "Exporter pour le comptable (N)" : cree un ZIP des rapports coches via `POST /reports/export-zip`
  - Bouton "Tout supprimer" avec toast de confirmation centre (`top-center`, 10s)
  - Suppression individuelle : toast de confirmation centre (remplace le double-clic)
  - Backend : endpoints `POST /reports/export-zip`, `DELETE /reports/all`, `POST /reports/regenerate-all`

- **Logo dans les rapports PDF** : logo `logo_lockup_light_400.png` en haut a gauche
  - Charge depuis `backend/assets/`, fallback graceful si absent
  - Ajoute dans `_generate_pdf_v2()` (rapports) et `_generate_pdf_content()` (exports)

- **Colonne Justificatif dans les rapports** : traçabilite des pieces justificatives
  - CSV : 8eme colonne `Justificatif` avec nom du fichier PDF ou vide, ratio dans les totaux (`12/89`)
  - PDF : colonne `Just.` avec checkbox ☑ vert + nom fichier ou ☐ gris, ratio dans les totaux

- **Colonne Commentaire dans les rapports** : notes utilisateur exportees
  - CSV : 9eme colonne `Commentaire` avec texte libre
  - PDF : colonne `Commentaire` en italique 6pt, tronquee a 40 chars

### Added (2026-04-06) — Session 2

- **Checkboxes modernes (EditorPage)** : remplacement des `<input type="checkbox">` natifs par des boutons toggle stylises
  - Carres arrondis 22px avec `border-2`, icone blanche quand coches, bordure coloree subtile quand decoches
  - Selection : fond `primary` + icone `Check`
  - Important : fond `warning` + icone `Star`, bordure ambre au repos
  - A revoir : fond `danger` + icone `AlertTriangle`, bordure rouge au repos
  - Pointee : fond `emerald-500` + icone `CheckCircle2`
  - Composant `CheckboxCell` generique avec props `colorClass`, `uncheckedColor`, `icon`

- **Tri sur les colonnes badge (EditorPage)** : les 4 colonnes badge sont desormais triables
  - Justificatif (trombone), Important (etoile), A revoir (triangle), Pointee (cercle)
  - `sortingFn` custom : tri boolean `Number(value || 0)`
  - Fleches de tri visibles dans le header au clic

- **Navigation Pipeline → Editeur filtree** : clic "Ouvrir l'editeur" sur l'etape Categorisation navigue vers `/editor?filter=uncategorized`
  - EditorPage lit le param `?filter=uncategorized` et active un filtre custom sur la colonne Categorie
  - `filterFn` custom : `__uncategorized__` matche les operations vides ou "Autres"
  - Panneau filtres ouvert automatiquement avec dropdown positionne sur "Non categorisees"
  - Bandeau warning "Filtre actif : operations non categorisees (N resultats)" avec bouton "Retirer le filtre"
  - Option "Non categorisees" ajoutee au dropdown categorie du panneau filtres

- **Auto-rapprochement justificatifs** : association automatique justificatif ↔ operation apres upload
  - `_run_ocr_background()` (justificatifs.py) chaine `run_auto_rapprochement()` apres OCR
  - `batch_upload()` (ocr.py) lance le rapprochement auto apres la boucle OCR
  - `_process_file()` (sandbox_service.py) lance le rapprochement auto apres OCR watchdog
  - Les 3 points d'entree (upload justificatifs, upload OCR, sandbox) declenchent automatiquement l'association

- **Bouton "Associer automatiquement" (JustificatifsPage)** : bandeau CTA contextuel
  - Bandeau ambre gradient visible quand `stats.sans > 0` avec compteur dynamique
  - Bouton `bg-warning` avec shadow, hover scale et icone Zap
  - Toast custom cliquable quand suggestions fortes : clic → filtre "Sans justif." + ouvre drawer sur la 1ere operation sans justificatif
  - Disparait automatiquement quand toutes les operations sont couvertes
  - Utilise le hook existant `useRunAutoRapprochement()` avec invalidation de cache complete

- **Amelioration scoring rapprochement** : meilleure detection des correspondances
  - `score_fournisseur()` : ajout matching par sous-chaine (ex: "amazon" dans "PRLVSEPAAMAZONPAYMENT" → score 1.0)
  - Seuil auto-association abaisse de 0.95 → 0.80 (avec toujours ecart >= 0.02 entre 1er et 2eme match)
  - Niveaux de confiance ajustes : fort >= 0.80, probable >= 0.65, possible >= 0.50
  - Scores reels passes de 0.80 max a 0.93-1.0 grace au substring matching

- **Recherche libre dans le drawer attribution** : recherche dans tous les justificatifs en attente
  - Requete `GET /justificatifs/?status=en_attente&search=...` avec debounce 300ms
  - Resultats affiches sous les suggestions scorees avec separateur "Autres justificatifs correspondants"
  - Chaque resultat a un bouton "Attribuer" orange identique
  - Message d'aide quand aucune suggestion : "Tapez un nom pour rechercher dans tous les justificatifs"

- **Fix affichage score** : `score.total` (0-1 backend) multiplie par 100 pour affichage en pourcentage
  - Corrige le badge qui affichait "1%" au lieu de "80%"
  - `scoreColor()` recoit maintenant correctement la valeur 0-100

- **Bouton Attribuer modernise** : style orange identique au bouton "Associer automatiquement"
  - `bg-warning text-background` avec `shadow-sm`, `hover:scale-105`, `font-semibold`

### Added (2026-04-06) — Session 1
- **Refonte page Justificatifs** : remplacement de la galerie par une vue operations-centree
  - Tableau triable 7 colonnes (date, libelle, debit, credit, categorie, sous-categorie, justif)
  - Hook dedie `useJustificatifsPage` avec enrichissement `_originalIndex` + `_filename`
  - Filtre sans/avec justificatif (defaut: sans), 4 MetricCards (total, avec, sans, taux %)
  - `JustificatifAttributionDrawer` (800px, split resizable avec poignee drag, persistance localStorage)
  - Suggestions scorees avec hover 300ms → preview PDF inline (`<object type="application/pdf">`)
  - Attribution + dissociation + navigation post-attribution (saut a l'op suivante sans justif)
  - Flash highlight CSS sur la ligne active apres navigation
  - Selecteur annee/mois en cascade (pattern EditorPage), sync annee avec donnees disponibles
  - ReconstituerButton en bas du panneau gauche, sandbox SSE badge dans le header

- **Fix preview PDF inline** : `Content-Disposition: inline` dans l'endpoint `/api/justificatifs/{filename}/preview` pour afficher les PDF dans les iframes au lieu de les telecharger

- **Fix EditableCell (EditorPage)** : etat local (`useState`) pour eviter la perte de focus a chaque frappe dans les champs texte (commentaire, libelle). Valeur committee au parent au `onBlur` ou `Enter`

- **Ventilation d'operations** : une operation bancaire peut etre ventilee en N sous-lignes (>=2) avec categorie, sous-categorie, montant et justificatif individuels
  - Backend : modele `VentilationLine`, service `ventilation_service.py`, router `/api/ventilation` (PUT/DELETE/PATCH)
  - `sum(montants)` doit egaler le montant de l'operation (tolerance 0.01)
  - Categorie parente automatiquement mise a "Ventile"
  - Cloture/analytics/alertes iterent sur les sous-lignes individuellement
  - Rapprochement auto et manuel supportent les sous-lignes (`ventilation_index`)
  - Frontend : bouton Scissors dans EditorPage, `VentilationDrawer` (600px) avec barre solde temps reel, `VentilationLines` indentees sous l'op parente
  - Selecteur sous-ligne dans `RapprochementManuelDrawer` et `RapprochementPage`
  - Mode annee complete : sous-lignes visibles, Scissors masque

- **Fix extraction OCR** : refonte complete du parsing des justificatifs
  - Regex montants robuste : capture `1163.08`, `1439.87` (4+ chiffres sans espace)
  - `best_amount` = montant TTC : priorite total facture > ttc > total > euro > max, avec collecte multi-sources et max(candidates)
  - `best_date` = date facture : priorite ligne "date" + mot-cle facture, exclusion echeance/circulation, detection mois en lettres ("18 juillet 2025")
  - `supplier` : fallback formes juridiques (Bank, plc, GmbH, Ltd, SCP, SELARL) + premiere ligne non-vide
  - Recherche multi-ligne (3 lignes apres le mot-cle) pour les PDF ou les valeurs sont sur des lignes separees

- **Convention de nommage justificatifs** : parsing `fournisseur_YYYYMMDD_montant.pdf`
  - `_parse_filename_convention()` : pure function, 3 segments exactement
  - Priorite filename > OCR pour chaque champ individuellement
  - Tracabilite `filename_parsed` et `original_filename` dans le `.ocr.json`
  - Propage dans batch upload et sandbox watchdog
  - Fichiers existants (`justificatif_YYYYMMDD_HHMMSS_*.pdf`) non impactes (4+ segments → null)

- **Edition manuelle des donnees OCR** : correction des valeurs extraites depuis le frontend
  - Endpoint `PATCH /api/ocr/{filename}/extracted-data` avec modele `OcrManualEdit`
  - Composant `OcrDataEditor` : chips cliquables montants (EUR) + dates (DD/MM/YYYY), input manuel, badge Manuel/OCR
  - Badge "OCR incomplet" (ambre) dans la galerie justificatifs quand `ocr_amount` ou `ocr_date` sont null
  - Integration dans le drawer justificatif (sous le PDF preview)
  - Invalidation TanStack Query sur ocr, justificatifs, rapprochement

- **ML Monitoring** : systeme complet de monitoring de l'agent IA
  - Logging automatique des predictions a chaque categorisation (source, confiance, risque hallucination)
  - Tracking des corrections manuelles au save dans l'editeur (detection par comparaison avec derniere prediction)
  - Logging des entrainements (accuracy, nb exemples, nb regles)
  - Nouvel onglet "Monitoring" dans la page Agent IA avec 4 sections :
    - Performance : taux de couverture, confiance moyenne, distribution confiance
    - Fiabilite : taux de correction, taux d'hallucination, libelles inconnus, table top erreurs
    - Progression : courbe accuracy (LineChart Recharts), courbe taux correction/mois, base de connaissances
    - Diagnostic : paires confuses (matrice confusion simplifiee), categories orphelines
  - Carte KPI "Agent IA" dans le Dashboard : couverture, corrections, trend, alerte, clic → Agent IA
  - `backend/models/ml.py` : PredictionSource enum, PredictionLog, PredictionBatchLog, CorrectionLog, TrainingLog, MLMonitoringStats, MLHealthKPI
  - `backend/services/ml_monitoring_service.py` : logging, detection corrections, stats agregees, health KPI
  - 4 endpoints monitoring : `GET /api/ml/monitoring/stats`, `/health`, `/confusion`, `/correction-history`
  - Stockage logs dans `data/ml/logs/predictions/` et `data/ml/logs/corrections/`
  - Systeme d'onglets dans AgentIAPage (Dashboard ML | Monitoring)

- **Entrainer + Appliquer** : bouton bulk recategorisation dans Agent IA
  - Bouton vert "Entrainer + Appliquer" dans la page Agent IA (section Actions rapides)
  - En un clic : entraine le modele sklearn puis recategorise (mode empty_only) toutes les operations de l'annee
  - Checkbox "Toutes les annees" pour traiter tous les fichiers
  - `POST /api/ml/train-and-apply?year=` : endpoint combine entrainement + categorisation bulk
  - Toast avec stats concretes (nb fichiers traites, nb operations modifiees)
  - Utilise `useFiscalYearStore` pour l'annee par defaut
  - Extraction de `categorize_file()` dans `operation_service.py` (logique deplacee du router vers le service)

- **Badge Agent IA sidebar** : badge violet dans la sidebar quand l'agent IA necessite attention
  - Affiche le nombre d'operations non categorisees
  - Visible uniquement si operations non categorisees > 0 ET dernier entrainement > 7 jours

### Added (2026-04-05)
- **Module Tâches Kanban** : suivi des actions comptables avec vue kanban 3 colonnes
  - 3 colonnes : To do / In progress / Done avec drag & drop via @dnd-kit
  - Tâches auto-générées par scan de l'état applicatif (5 détections) : opérations non catégorisées, justificatifs en attente, clôture incomplète, mois sans relevé, alertes non résolues
  - Tâches manuelles créées par l'utilisateur avec titre, description, priorité, date d'échéance
  - Scopé par année (synchronisé avec le sélecteur année global de la sidebar)
  - Déduplication des tâches auto par `auto_key` : ne recrée pas les tâches done/dismissed, met à jour les tâches actives
  - Badge "Auto" sur les tâches générées, bouton Dismiss (EyeOff) pour ignorer
  - Formulaire inline pour création/édition, validation Enter/Escape
  - Refresh automatique au montage de la page et au changement d'année
  - Badge compteur de tâches actives dans la sidebar (amber)
  - `backend/models/task.py` : 3 enums (TaskStatus, TaskPriority, TaskSource) + 3 modèles Pydantic
  - `backend/services/task_service.py` : `generate_auto_tasks(year)` avec 5 détections scopées par année
  - `backend/routers/tasks.py` : 5 endpoints CRUD + refresh sous `/api/tasks`
  - `frontend/src/hooks/useTasks.ts` : 5 hooks TanStack Query
  - 4 composants dans `frontend/src/components/tasks/` (TaskCard, KanbanColumn, TaskInlineForm, TasksPage)
  - Données dans `data/tasks.json`
  - Sidebar : entrée "Tâches" avec icône CheckSquare dans le groupe OUTILS

- **Sélecteur Année Global** : store Zustand partagé entre toutes les pages
  - `frontend/src/stores/useFiscalYearStore.ts` : store Zustand avec middleware `persist` (localStorage `neuronx-fiscal-year`)
  - Sélecteur `◀ ANNÉE ▶` compact dans la sidebar, au-dessus des groupes de navigation
  - Synchronisation bidirectionnelle : changer l'année dans la sidebar ou sur une page met à jour partout
  - Pages migrées : EditorPage, AlertesPage, CloturePage, ComptaAnalytiquePage, DashboardPage, ExportPage, ReportsPage, PrevisionnelPage
  - L'année persiste au refresh navigateur
  - Le mois/trimestre restent en `useState` local par page (non concernés)

### Fixed (2026-04-05)
- **Catégorisation REMPLA** : les opérations bancaires contenant "REMPLA" dans le libellé (virements SEPA remplaçants) sont désormais catégorisées automatiquement en "Remplaçant / Honoraires"
  - `_categorize_simple()` : ajout "Remplaçant" avec keywords ["REMPLA", "REMPLACANT", "REMPLACEMENT"] **avant** "Revenus" (qui matchait "VIREMENT" en premier)
  - `predict_category()` : ajout substring matching dans le scoring keywords (ex: "motifremplacementdr" matche "rempla")
  - `predict_subcategory()` : ajout fallback `subcategory_patterns` pour mapper REMPLA → Honoraires
  - `model.json` : ajout keywords Remplaçant + subcategory_patterns
  - 19 opérations existantes (2024-2026) recatégorisées en "Remplaçant / Honoraires"

### Added (2026-04-05)
- **Module Prévisionnel** : calendrier de trésorerie annuel remplaçant l'ancien Échéancier
  - Timeline 12 mois avec barres empilées Recharts (charges rouge / recettes vert), courbe trésorerie cumulée togglable
  - 3 sources de données : providers récurrents, moyennes N-1 par catégorie, régression linéaire + saisonnalité
  - 2 modes fournisseurs : facture récurrente (1 document par période) et échéancier de prélèvements (parsing OCR 3 formats)
  - CRUD providers avec drawer 600px, keywords OCR/opérations, périodicité configurable
  - Grille 12 mois prélèvements avec statuts colorés (vérifié/écart/attendu), confiance OCR
  - Scan automatique documents (OCR+GED → échéances, score ≥0.75), chaînage mode échéancier (association → parse OCR → populate → scan opérations)
  - Scan prélèvements vs opérations bancaires par keywords + montant ± tolérance
  - Expansion inline au clic sur barre : détail charges/recettes avec source et statut
  - Paramètres : seuil montant, grille checkboxes catégories à inclure, catégories recettes (chips), overrides mensuels
  - Background scan asyncio toutes les heures (refresh + statuts retard + scan documents + scan prélèvements)
  - Intégrations post-OCR/sandbox/GED (`check_single_document` en try/except)
  - `backend/services/previsionnel_service.py` : CRUD, timeline, parsing OCR, scan matching, régression numpy
  - `backend/routers/previsionnel.py` : 18 endpoints sous `/api/previsionnel`
  - `frontend/src/hooks/usePrevisionnel.ts` : 20 hooks TanStack Query
  - 11 composants dans `frontend/src/components/previsionnel/`
  - Données dans `data/previsionnel/` (providers.json, echeances.json, settings.json)
  - Sidebar : entrée "Prévisionnel" dans le groupe ANALYSE (remplace Échéancier du groupe TRAITEMENT)
- **Templates Justificatifs** : système de templates par fournisseur pour reconstituer des justificatifs manquants
  - Création de templates depuis des justificatifs scannés (extraction OCR enrichie via Qwen2-VL, fallback données OCR basiques)
  - Bibliothèque fournisseurs avec aliases de matching (détection automatique dans les libellés bancaires)
  - Génération de PDF reconstitués via ReportLab (format A5, professionnel, sans watermark)
  - Traçabilité exclusivement dans les métadonnées : préfixe `reconstitue_` + champ `"source": "reconstitue"` dans `.ocr.json`
  - Champs auto-remplis (opération, OCR), manuels, fixes et calculés (TVA temps réel via formules)
  - Auto-association optionnelle du justificatif généré à l'opération source
  - 4ème onglet "Templates justificatifs" dans la page OCR (création, bibliothèque, génération)
  - Bouton `ReconstituerButton` intégré dans 4 pages : Rapprochement (drawer vide), Alertes (justificatif_manquant), Éditeur (colonne trombone), Clôture (mois incomplets)
  - `ReconstituerDrawer` : drawer 600px avec formulaire pré-rempli, sélection template, champs auto/manuels
  - `backend/services/template_service.py` : CRUD, extraction OCR, suggestion, génération PDF, auto-association
  - `backend/routers/templates.py` : 8 endpoints sous `/api/templates`
  - `frontend/src/hooks/useTemplates.ts` : 7 hooks (3 queries + 4 mutations)
  - Templates stockés dans `data/templates/justificatifs_templates.json`
  - Fichiers générés dans `data/justificatifs/en_attente/` (reconstitue_YYYYMMDD_HHMMSS_vendor.pdf + .ocr.json)
- **Pipeline Comptable Interactif** : nouvelle page d'accueil (`/`) remplace le Dashboard
  - Stepper vertical 6 étapes avec statuts temps réel (Import, Catégorisation, Justificatifs, Rapprochement, Vérification, Clôture)
  - Grille 12 badges mois cliquables avec icône statut, nom court et % progression (couleur vert/ambre/gris)
  - Sélecteur d'exercice fiscal avec boutons années (style primary pour l'année active)
  - Barre de progression globale pondérée (10/20/25/25/10/10)
  - Cards expandables accordion avec métriques, description et boutons d'action vers les pages concernées
  - Persistance année/mois dans localStorage
  - Badge % global dans la sidebar sous l'item Pipeline
  - Dashboard déplacé vers `/dashboard` dans le groupe ANALYSE
  - Suppression du drawer Pipeline flottant (PipelineWrapper, PipelineTrigger, PipelineDrawer, PipelineStep, PipelineDetail)
  - `frontend/src/hooks/usePipeline.ts` : réécrit avec 6 étapes, monthBadges, localStorage
  - `frontend/src/components/pipeline/PipelinePage.tsx` + `PipelineStepCard.tsx` : nouveaux composants
  - Types : `PipelineStepStatus`, `PipelineStep`, `PipelineMetric`, `PipelineState`

### Added (2026-04-05 — previous)
- **Simulation BNC** : simulateur fiscal complet pour optimisation des charges
  - Page `/simulation` avec 2 onglets (Optimisation, Prévisions)
  - Moteur fiscal dual Python (`fiscal_service.py`) + TypeScript (`fiscal-engine.ts`) avec résultats identiques
  - Barèmes versionnés JSON dans `data/baremes/` (URSSAF, CARMF, IR, ODM) avec fallback année la plus récente
  - Onglet Optimisation : leviers interactifs (Madelin, PER, CARMF classe, investissement, remplacement, formation DPC), expander dépenses détaillées par catégorie (véhicule, fournitures, abonnements, télécom, logiciel, comptable, frais bancaires, repas, poste, autres)
  - Distinction critique PER (réduit IR seul) vs Madelin (réduit BNC social + IR)
  - Impact charges temps réel (URSSAF, CARMF, ODM, IR) avec delta et badges économie
  - Taux marginal réel combiné avec barre segmentée colorée (IR/URSSAF/CARMF)
  - Comparatif charge immédiate vs immobilisation pour les investissements
  - Projection des dotations sur 5 ans (graphique Recharts)
  - Onglet Prévisions : historique BNC depuis les opérations, projections saisonnières, profil saisonnier 12 mois, tableau annuel avec évolution
  - Parts fiscales : défaut 1.75 (parent isolé + garde alternée), options 1/1.25/1.5/1.75/2/2.5/3/3.5/4
  - 8 endpoints sous `/api/simulation` (barèmes, calculate, taux-marginal, seuils, historique, prévisions)
  - `frontend/src/hooks/useSimulation.ts` : 7 hooks (5 queries + 2 mutations)
  - Sidebar : entrée "Simulation BNC" avec icône Calculator dans le groupe ANALYSE
- **Module Amortissements** : registre des immobilisations, calcul dotations linéaire/dégressif avec pro rata temporis, détection auto candidates (montant > 500€ + catégorie éligible), plafonds véhicules CO2 (4 classes), gestion cessions avec calcul plus/moins-value et régime fiscal (court/long terme), moteur de calcul dupliqué Python/TypeScript
  - Page `/amortissements` avec 4 onglets (Registre, Tableau annuel, Synthèse par poste, Candidates)
  - 3 drawers : ImmobilisationDrawer (650px, aperçu tableau temps réel), ConfigAmortissementsDrawer (500px), CessionDrawer (500px)
  - `backend/services/amortissement_service.py` : CRUD, moteur calcul, détection, cession, KPIs
  - `backend/routers/amortissements.py` : 15 endpoints sous `/api/amortissements`
  - `frontend/src/lib/amortissement-engine.ts` : moteur TS identique au Python
  - `frontend/src/hooks/useAmortissements.ts` : 14 hooks (7 queries + 7 mutations)
- **Rapports V2** : refonte complète du module rapports
  - Index JSON (`reports_index.json`) avec réconciliation au boot
  - 3 templates prédéfinis (BNC annuel, Ventilation charges, Récapitulatif social)
  - Format EUR (`1 234,56 €`) dans les PDF, CSV séparateur `;` + virgule décimale, Excel formules SUM
  - Déduplication à la génération (même filtres+format = remplacement)
  - Bibliothèque avec triple vue arbre (par année / par catégorie / par format)
  - Rapports favoris (étoile, tri en premier)
  - Comparaison de 2 rapports (drawer delta montants/ops/%)
  - Rappels dans le dashboard (rapports mensuels/trimestriels non générés)
  - Preview drawer 800px avec édition titre/description inline
  - 12 endpoints sous `/api/reports`
- **Dashboard V2 — Cockpit exercice comptable** : refonte complète de la page d'accueil
  - Sélecteur année + actions rapides (Importer, OCR, Rapprocher)
  - Jauge segmentée 6 critères (relevés/catégorisation/lettrage/justificatifs/rapprochement/exports)
  - 4 cartes KPI avec sparkline BNC mensuel et delta N-1
  - Grille 12 mois cliquables avec 6 badges d'état + expansion (montants + actions contextuelles)
  - Alertes pondérées triées par impact (100=relevé manquant, 80=export, 55+=justificatifs, 40=catégorisation, 25=lettrage)
  - Échéances fiscales (URSSAF/CARMF/ODM) avec countdown J-XX
  - Bar chart recettes vs dépenses (Recharts)
  - Feed activité récente avec timestamps relatifs
  - `GET /api/analytics/year-overview` : endpoint agrégé unique
- **GED — Type libre + OCR auto** : champ type remplacé par autocomplétion libre (datalist HTML), OCR automatique à l'upload via `extract_or_cached()`, preview conditionnel image/PDF
- **GED — Catégorie/sous-catégorie** : ajout sélecteurs catégorie → sous-catégorie en cascade dans l'upload et le drawer metadata (en plus du poste comptable existant)
- **Module GED (Bibliothèque Documents)** : indexation documents existants sans duplication, upload documents libres, postes comptables avec % déductibilité (slider 0-100), thumbnails PDF, double vue arbre (par année / par type), drawer redimensionnable (400-1200px), recherche full-text, ouverture native macOS

### Added (2026-04-04)
- **Compta Analytique — Comparatif recettes/depenses** : separation automatique des categories en 2 groupes (recettes si credit > debit, depenses sinon), 2 graphiques cote a cote, 2 tableaux avec colonnes adaptees (Credit A/B ou Debit A/B), delta badges inverses pour revenus, legendes dynamiques avec periodes selectionnees
- **Compta Analytique — Clic categorie en mode Comparatif** : clic sur une categorie ouvre le CategoryDetailDrawer (sous-categories, evolution mensuelle, operations) — desormais connecte au comparatif en plus du mode Analyse
- **EditorPage — Vue annee complete** : option "Toute l'annee (N ops)" dans le selecteur mois, charge tous les fichiers en parallele via `useYearOperations` (hook `useQueries`), mode lecture seule avec badge ambre, filtres et tri fonctionnels, export CSV disponible
- **EditorPage — Filtre sous-categorie** : dropdown sous-categorie dependant de la categorie selectionnee dans le panel Filtres, reset auto au changement de categorie, grille 5 colonnes
- **useYearOperations hook** : nouveau hook dans `useOperations.ts` utilisant `useQueries` pour charger N fichiers en parallele avec fusion et champ `_sourceFile`
- **Type Operation** : ajout champ optionnel `_sourceFile` pour identifier le fichier source en mode annee complete

### Added (previous)
- **Rapprochement Manuel Drawer** : drawer 800px avec filtres (montant, date, fournisseur), liste scoree, preview PDF iframe
  - `GET /api/rapprochement/{filename}/{index}/suggestions` : suggestions filtrees avec scoring simplifie
  - `frontend/src/hooks/useRapprochementManuel.ts` : hook dedie avec filtres reactifs
  - `frontend/src/components/rapprochement/RapprochementManuelDrawer.tsx` : composant drawer complet
- **Sidebar reorganisee par pipeline comptable** : 5 groupes (Saisie, Traitement, Analyse, Cloture, Outils) avec labels de section discrets
  - Fusion Accueil + Tableau de bord : route `/` affiche DashboardPage directement
  - Suppression de la page Accueil separee
- **OCR = point d'entree unique justificatifs** :
  - `POST /api/ocr/batch-upload` : upload multi-fichiers + OCR synchrone + sauvegarde en_attente
  - Nouveau tab "Upload & OCR" (defaut) dans OcrPage avec drag & drop batch jusqu'a 50 fichiers
  - Page Justificatifs : upload retire, remplace par bouton "Ajouter via OCR"
- **Compta Analytique — Filtres globaux** : filtre annee/trimestre/mois en haut de page, applique a toutes les sections (KPIs, ventilation, tendances, anomalies)
  - Tous les endpoints analytics acceptent `quarter` et `month` en plus de `year`
- **Compta Analytique — Drill-down categorie** :
  - `GET /api/analytics/category-detail` : sous-categories, evolution mensuelle, 50 dernieres operations
  - `CategoryDetailDrawer.tsx` : drawer 700px avec barres sous-categories, mini BarChart, liste operations
  - Categories cliquables dans le tableau de ventilation
- **Compta Analytique — Comparatif periodes** :
  - `GET /api/analytics/compare` : compare 2 periodes avec KPIs + deltas % + ventilation par categorie
  - Onglet "Comparatif" dans la page avec 2 selecteurs periode, KPIs cote a cote, graphe barres groupees, tableau detaille
- **Compta Analytique — Barres empilees** : 3eme mode "Empile" dans la section Evolution temporelle (barres empilees par categorie par mois/trimestre)
- **Sandbox Watchdog OCR** : depot automatique de PDF dans `data/justificatifs/sandbox/` avec traitement OCR et deplacement vers `en_attente/`
  - `backend/services/sandbox_service.py` : watchdog (lib `watchdog`), gestion doublons, scan initial au demarrage
  - `backend/routers/sandbox.py` : SSE `/api/sandbox/events`, `GET /list`, `DELETE /{filename}`
  - `frontend/src/hooks/useSandbox.ts` : hook EventSource avec reconnexion auto
  - Badge inline "Sandbox actif" sur la page Justificatifs
  - Notifications toast via `react-hot-toast` (global `<Toaster />` dans App.tsx)
- Lifespan FastAPI pour gestion du cycle de vie du watchdog (start/stop)

### Changed
- `frontend/src/App.tsx` : route `/` = PipelinePage, route `/dashboard` = DashboardPage (18 routes)
- `frontend/src/components/layout/Sidebar.tsx` : item Pipeline hors-groupe en tête avec badge % global, Dashboard déplacé vers `/dashboard` dans ANALYSE
- `frontend/src/components/layout/AppLayout.tsx` : suppression PipelineWrapper (drawer flottant)
- `backend/core/config.py` : ajout `JUSTIFICATIFS_SANDBOX_DIR` + `ensure_directories()`
- `backend/main.py` : ajout lifespan context manager, import router sandbox
- `frontend/src/hooks/useApi.ts` : tous les hooks analytics acceptent year/quarter/month
- `frontend/src/components/ocr/OcrPage.tsx` : 4 onglets (Upload & OCR, Test Manuel, Historique, Templates justificatifs)
- `frontend/src/components/justificatifs/JustificatifsPage.tsx` : zone upload retiree
- `frontend/src/components/compta-analytique/ComptaAnalytiquePage.tsx` : filtres globaux, drill-down, toggle Analyse/Comparatif, mode empile

### Dependencies
- Backend : `watchdog>=4.0.0`
- Frontend : `react-hot-toast`

---

## [3.0.2] - 2025-05-20

### Added
- Module **Rapprochement bancaire** : auto/manuel, scoring (date + montant + fournisseur OCR)
- Module **Lettrage comptable** : toggle/bulk, statistiques par fichier
- Module **Cloture** : calendrier annuel, statut par mois (complet/partiel/manquant)

---

## [3.0.1] - 2025-05-20

### Added
- Donnees de configuration initiales
- Categories et sous-categories par defaut
- Fichiers d'entrainement ML

---

## [3.0.0] - 2025-05-20

### Added
- Migration complete de Streamlit (V2) vers React 19 + FastAPI
- 15 pages fonctionnelles sans placeholders
- Pipeline OCR EasyOCR avec cache `.ocr.json`
- Categorisation IA (regles + scikit-learn)
- Import PDF avec detection doublons
- Export comptable mensuel (ZIP)
- Systeme de rapports (CSV/PDF/Excel)
- Requetes analytiques personnalisees
- Gestion des justificatifs (upload, association, preview)
- Dark theme avec CSS variables
- TanStack Query pour la gestion d'etat serveur
