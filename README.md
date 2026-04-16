# NeuronXcompta V3

**Assistant Comptable IA** pour cabinet dentaire.

Application full-stack de gestion comptable avec catégorisation automatique par IA, OCR des justificatifs, rapports multi-formats et exports comptables.

---

## Fonctionnalités

| Module | Description |
|--------|-------------|
| **Tableau de bord** | **Cockpit exercice V2** : jauge segmentée 6 critères, KPIs avec sparkline BNC, grille 12 mois cliquables avec badges d'état, alertes pondérées, échéances fiscales, rappels rapports, bar chart recettes/dépenses |
| **Pipeline** | **Pipeline comptable interactif** : **stepper 7 étapes** (Import → Catég → Justif → **Verrouillage** → Lettrage → Vérification → Clôture), progression globale pondérée `[10, 20, 20, 10, 20, 10, 10]`, sélecteur mois/année, **widget « Scans en attente d'association »** (filtré par year+month, sections OCR récents / Fac-similés, lien « Traiter » vers Justificatifs, **collapsed par défaut** à chaque ouverture), **badge orange sidebar** sur `/ocr` (compteur pending scans), **titre d'onglet navigateur** synchronisé avec la route courante (utile en multi-tabs) |
| **Verrouillage associations** | Champ `locked` sur chaque opération, posé **automatiquement** à toute association manuelle (via `associate-manual`). Auto-rapprochement skippe les ops lockées silencieusement. Gardes HTTP 423 sur re-association / dissociation. Composant `LockCell` (cadenas orange `text-warning` si locked / gris `LockOpen` sinon) avec tooltip riche démonstratif ancré à droite. Intégration JustificatifsPage (cellule Justif) + EditorPage (colonne dédiée 44px). Modale `UnlockConfirmModal` de confirmation pour déverrouiller. Endpoint `PATCH /api/operations/{filename}/{index}/lock`. **Bulk-lock / bulk-unlock** : sélection multi-ops via header 🔒 + checkbox hover, `BulkLockBar` flottante avec toggle intelligent Verrouiller (orange) ↔ Déverrouiller (vert) selon l'état des ops sélectionnées, endpoint `PATCH /api/operations/bulk-lock` (multi-fichiers, erreurs par-item). Disponible sur JustificatifsPage + EditorPage (masquée en year-wide lecture seule) |
| **Snapshots** | Sélections nommées d'opérations réutilisables (ad-hoc folders pour suivi : "Litige Amazon", "À vérifier comptable", "Acompte Q4"). Stockage `data/snapshots.json` avec refs `(file, index)` **self-healing** via hash op-identité + archive lookup (survit aux split/merge/archive de fichiers ops). Page dédiée `/snapshots` (sidebar OUTILS, icône Camera) avec grille de cartes (pastille couleur, stats live Ops/Débits/Solde, badge ambre si refs cassées). Création depuis EditorPage via bouton « Snapshot (N) » en orange quand `rowSelection > 0` → modal avec nom pré-rempli contextuel, description, 6 couleurs. Drawer viewer 760px avec titre renommable inline + tableau ops + lien `ExternalLink` → éditeur |
| **Éditeur — Bandeau stats filtrées + ligne TOTAL sticky** | Quand un filtre est actif (recherche globale, filtre colonne, non-catégorisées), affichage en haut d'un **bandeau violet** avec `{N} op(s) filtrée(s) sur {total}` + Débits/Crédits/Solde recalculés depuis `table.getFilteredRowModel()`. Et en bas du `<tbody>` une **ligne TOTAL éphémère** encadrée orange (sticky bottom-0, bordures `border-y-2 border-warning`, gradient warning, symbole ∑, Solde dans pill colorée vert/rouge). Jamais sauvegardée (safe au PUT). Pratique pour vérifier rapidement le total d'un mois/catégorie/fournisseur. **Ligne TOTAL répliquée aussi dans JustificatifsPage** (miroir exact, visible quand au moins un filtre narrowing est actif) |
| **Note de frais** | Champ `source: Optional[str]` sur `Operation` (valeurs connues `"note_de_frais" \| "blanchissage" \| "amortissement" \| None`). Badge pill **amber** `#FAEEDA/#854F0B` affiché au-dessus du select Catégorie si `source === 'note_de_frais'` dans **EditorPage**, **JustificatifsPage** et **AlertesPage**. Split button `+ Ligne ▾` dans EditorPage : bouton principal = op bancaire, chevron = dropdown avec `Note de frais (CB perso)`. **Filtre Type d'opération** dans 4 pages (Éditeur Filtres panel, Justificatifs toolbar, Rapports 3 pills, Compta Analytique widget `Répartition par type` avec share%). Endpoint analytics étendu avec `by_source: [{source, debit, credit, count}]`. Round-trip JSON transparent (pas de migration nécessaire) |
| **Fichier mensuel vide à la demande** | Dropdown mois de l'Éditeur expose les **12 mois** même sans fichier (mois sans fichier affichés en `{Mois} — vide · créer`). Sélection → confirmation → `POST /api/operations/create-empty {year, month}` → création immédiate de `operations_manual_YYYYMM_<hex8>.json` → auto-select + toast. Débloque la saisie de notes de frais CB perso quand le relevé bancaire n'est pas encore importé. Fusion ultérieure assurée par les scripts `split/merge_*.py` existants via hash op-identité |
| **Importation** | Upload de relevés bancaires PDF, extraction automatique des opérations (dates YYYY-MM-DD, filtrage soldes/totaux) |
| **Éditeur** | Édition inline (EditableCell avec commit onBlur), catégorisation IA (vides/tout), **vue année complète** (lecture seule), **filtres catégorie + sous-catégorie**, colonnes : Justificatif (**icône `Ban` rouge barré pour ops perso — aucun justificatif requis**), Important, À revoir, Pointée, **ventilation** (bouton Scissors, sous-lignes indentées avec **trombones cliquables par sous-ligne** : vert = preview PDF / ambre = attribution drawer avec sous-ligne pré-sélectionnée via `initialVentilationIndex`), **drawer preview justificatif avec sous-drawer grand format** (toute la zone PDF cliquable → `PreviewSubDrawer` slide à gauche 700px avec bouton « Ouvrir avec Aperçu ») |
| **Catégories** | Gestion des catégories/sous-catégories avec couleurs personnalisées |
| **Rapports** | Generation PDF/CSV/Excel avec logo, colonnes Justificatif et Commentaire, 3 templates, checkboxes modernes categories, batch 12 mois, export ZIP comptable, **déduplication avec archivage** (ancien rapport archivé dans `reports/archives/`), **ventilation éclatée en N sous-lignes** avec libellé `[V1/N]` (plus de catégorie 'Ventilé' agrégée, totaux correctement répartis par sous-catégorie). Bibliotheque migree vers GED V2 |
| **Compta Analytique** | Filtres globaux (année/trimestre/mois), drill-down catégorie, **comparatif périodes avec séparation recettes/dépenses**, tendances (agrégé/catégorie/empilé), anomalies, requêtes personnalisées, **encadré déductibilité CSG/CRDS** dans le drawer URSSAF avec bouton batch « Calculer tout » |
| **Association manuelle (op → justif)** | **`ManualAssociationDrawer`** 1100px — outil 2-colonnes parallèles (ops \| justificatifs) avec panneau preview PDF à gauche animé, **filtres libres date ±j / montant ±€** (défauts 7j / 50€), toggle **« Élargir »** (bypass du pré-filtre ±1 mois backend via `/justificatifs/?status=en_attente`), badges colorés OCR sur chaque row (sky date, ambre montant, « n/a » si absent), `PdfThumbnail` 32×38px cliquable. 2 points d'entrée : JustificatifsPage (header + barre flottante batch) et EditorPage (header + bouton sélection à côté de Snapshot). Raccourcis ↓↑→Enter Esc. Complémentaire au `RapprochementWorkflowDrawer` scoré mono-op (qui reste pour le flux standard) |
| **Association sens inverse (justif → op)** | **`JustifToOpDrawer`** 1000px ouvert depuis `GedDocumentDrawer` pour justifs `en_attente`. Sous-drawer preview PDF **grand format** (700px) à gauche du drawer parent via `PreviewSubDrawer` z-65. Panneau gauche = liste justifs en attente avec recherche filename+supplier, panneau droit = ops candidates scorées avec `ScorePills`. **Édition inline OCR** sous la row sélectionnée (date/montant/supplier → `PATCH /ocr/.../extracted-data` → rescoring live). Badge `Lock` warning + bouton « Déverrouiller » par row (backend expose `op_locked` dans les suggestions). **Self-heal** des `operation_ref` désynchronisés (après merge/split) via scan du fichier sur `Lien justificatif`. Actions enrichies dans `GedDocumentDrawer` : 3 boutons conditionnels (Dissocier, Déverrouiller, Supprimer) |
| **Justificatifs** | **Vue opérations-centrée** avec **`RapprochementWorkflowDrawer` unifié** (700px, 2 modes « Toutes sans justificatif » / « Opération ciblée », progress bar, tabs, ventilation pills, raccourcis ⏎/←/→/Esc, ScorePills 4 critères, thumbnails lazy-loaded via IntersectionObserver, recherche libre exclusive). **Auto-rapprochement** avec scoring v2 (4 critères + pondération dynamique), preview justificatif avec dissociation, 4 KPIs couverture, sandbox SSE. **Catégories/sous-catégories éditables inline** (dropdowns, sauvegarde auto, mode « Toute l'année » supporté). **Filtres catégorie/sous-catégorie persistants** au changement de mois (mêmes états React conservés). **Batch reconstitution fac-similé** (multi-sélection → barre flottante → drawer choix template par groupe → génération batch). **Exemptions** CARMF/URSSAF/Honoraires (CheckCircle2 bleu ciel, tooltip) + **icône `Ban` rouge barré dédiée pour ops perso** (priorité sur la branche exempté, tooltip « aucun justificatif requis »). **Navigation bidirectionnelle** Justificatif ↔ Opération avec row surlignée persistante via `isNavTarget`. **Vue ventilée** : ligne parente + sous-lignes indentées L1/L2 avec trombone individuel par sous-ligne, `CheckCircle2` vert sur la parente si `allVlAssociated`. **Suppression complète** avec toast détaillé listant les nettoyages (PDF + thumbnail + GED metadata + liens ops parentes et ventilées + cache). |
| **Agent IA** | Modèle ML hybride : **rules-based** (`exact_matches` + `keywords` substring scoring + `perso_override_patterns`) prioritaire sur **sklearn** (`LinearSVC` wrappé dans `CalibratedClassifierCV(cv=2)` pour `predict_proba`, `class_weight='balanced'`, `perso` filtré du training). Benchmark corpus réel : **accuracy 90.1%** via règles+keywords+override (vs ~27% sklearn seul). Dashboard ML + onglet Monitoring (4 sections : Performance / Fiabilité / Progression / Diagnostic), courbe d'apprentissage, backups. **Auto-alimentation ML** depuis corrections manuelles (dédup `(libelle, categorie)`, effet immédiat sur `exact_matches`). **Bulk-import** `/ml/import-from-operations?year=...` (UI bouton bleu Database dans ActionsRapides). **Tâche auto `ml_retrain`** (6e détection `task_service`) + **Toast cerveau animé** au montage 1×/session si corrections accumulées dépassent les seuils Settings (`ml_retrain_corrections_threshold=10`, `ml_retrain_days_threshold=14`, configurables dans GeneralTab). `categorize_file()` respecte `op.locked` (plus d'écrasement silencieux par « Recatégoriser IA »). Métriques `avg_confidence` + `Ops traitées` agrégées depuis les vrais logs de prédiction (plus d'artefacts 0 ou 100%) |
| **Export Comptable V3** | Grille calendrier 4×3 avec badges toggle PDF+CSV + checkbox Compte d'attente, génération ZIP (PDF+CSV+relevés+justificatifs+compte_attente en dossiers), exports enregistrés dans la GED, historique trié par mois (jan→déc) avec expander contenu ZIP, sélection multi-export, envoi au comptable |
| **Compte d'Attente** | Export PDF/CSV des opérations en attente par mois ou année, **filtres catégorie + sous-catégorie** (liste complète du référentiel, reset auto, compteur), bouton export dropdown (4 options), enregistrement automatique dans la GED, cas 0 ops = fichier preuve |
| **Email Comptable** | Drawer universel d'envoi au comptable via SMTP Gmail : sélection documents multi-type triés par période, filtres, **expanders intelligents**, **pré-sélection intelligente**, **jauge taille temps réel**, **template HTML brandé** (logo lockup, filets violets, arborescence ZIP, signature, footer copyright), **toggle HTML/Texte** dans le drawer, ZIP unique en PJ, historique des envois |
| **OCR** | Point d'entrée justificatifs : 4 onglets (Upload / Test manuel / **Gestion OCR** renommée depuis Historique / Templates). Batch upload multi-fichiers + OCR automatique (EasyOCR), **auto-rename** post-OCR filename-first (`fournisseur_YYYYMMDD_montant.XX.pdf`, suffix `_fs` pour les fac-similés), **FilenameEditor** inline-editable, **Gestion OCR** = tableau des fichiers OCR avec tri `scan_date` (processed_at) / date (best_date) / supplier / confidence, filtre association (tous/sans/avec), **recherche multifocale** (libellé/catégorie/montant/fournisseur, accent-insensitive, debounce 250ms), **bouton crayon par ligne** → `OcrEditDrawer` 720px — édition supplier/date/montant + cat/sous-cat + **sélecteur d'opération refondu** (dropdown custom riche avec filtre par mois du justif via chip bleu « Avril 2025 » cliquable, recherche textuelle intégrée, items avec date/libellé/montant/badge catégorie violet/icône Check si sélectionné, montants en tabular-nums vert si crédit, état vide avec bouton « Voir toute l'année »), **nom canonique affiché en live** sous les champs (code mono emerald si nouveau nom, gris + badge « déjà conforme » si identique, ambre si données manquantes), sub-drawer preview PDF, accessible aussi **depuis GED** via badge « Mal nommé ? Éditer OCR » / bouton Actions dans `GedDocumentDrawer`, **bouton orange « Scanner & Renommer »** → `ScanRenameDrawer` avec `SkippedItemEditor` inline + chainage auto-rapprochement post-apply, **toast riche global** à l'arrivée d'un nouveau fichier sandbox (SandboxArrivalToast) avec CTA navigation + flash-highlight, **templates justificatifs** avec recherche + filtres, **hints comptables** (category_hint/sous_categorie_hint) auto-écrits dans `.ocr.json` sur associate et lus en priorité par score_categorie, **hover popover 300×400 en `<img>` thumbnail PNG** (plus d'iframe PDF qui se décharge en grille) |
| **Templates** | Bibliothèque de templates par fournisseur avec preview PDF, génération de justificatifs reconstitués (**fac-similé** du PDF source avec remplacement date/montant, ou PDF sobre en fallback), extraction auto des coordonnées via pdfplumber, suggestion automatique par alias ou catégorie, **batch fac-similé** (multi-ops groupées par template, endpoint `batch-suggest` + `batch-generate`), **création depuis PDF vierge** (flag `is_blank_template`, pas d'OCR, click-to-position sur l'aperçu pour placer date/montant en points PDF), **champ `taux_tva` persistable** (10% restauration / 5,5% alimentation / 20% standard / 0% exonéré) dans les 2 drawers (création + édition) utilisé pour ventiler auto TTC/HT/TVA, **substitution de placeholders dans blank templates** (détection `{KEY}`/`(KEY)` via text layer pdfplumber, substitution inline à la position exacte : `DATE_FR`, `MONTANT_TTC`, `MONTANT_HT`, `MONTANT_TVA`, `TAUX_TVA`, `FOURNISSEUR`, `REF_OPERATION`), **propagation automatique des hints catégorie** dans le `.ocr.json` généré (boost rapprochement), **administration cross-module via l'axe Templates de la GED** (bibliothèque dédiée avec filtres AFFICHAGE/CATÉGORIE, drawer détail listant les fac-similés générés) |
| **GED V2** | Hub documentaire unifie : **6 vues arbre** (periode, annee/type, categorie, fournisseur, type, **templates**), **`GedSearchBar` pleine largeur** au-dessus du split (search + montant min/max + toggle filtres avancés Type/Catégorie/Sous-cat/Fournisseur/Période, **chips actifs colorés** par type de filtre, compteur résultats, cascade catégorie → sous-catégorie, backend `montant_min`/`montant_max` avec fallback `montant \|\| montant_brut`), cartes enrichies avec **badges overlay sur thumbnails justificatifs** (statut amber/vert "En attente"/"Associé" top-right, montant bottom-left, date bottom-right — tous en `bg-black/55` ou chip coloré), justificatifs traités ET en attente, rapports intégrés (favori, re-génération, comparaison, **suppression**), enrichissement auto metadata via rapprochement/OCR/éditeur/nom de fichier, postes comptables avec % déductibilité, recherche full-text enrichie, URL params (`?axis=templates` supporté), **navigation bidirectionnelle** justificatif ↔ opération avec 2 boutons dans le drawer (« Voir dans Justificatifs » + « Ouvrir dans l'Éditeur » via prop `showEditorLink`), **édition OCR depuis GED** : badge ambre « Mal nommé ? Éditer OCR » dans le header + bouton « Éditer données OCR » dans les Actions → ouvre `OcrEditDrawer` en overlay avec fallback synthétique si pas d'OCR, **suppression propre** du justificatif avec toast détaillé (PDF + thumbnail + GED + liens ops + cache), **thumbnails invalidées** automatiquement à chaque move/rename/delete (plus d'orphelins), **sous-drawer preview grand format** (thumbnail cliquable + overlay « Agrandir » → `GedPreviewSubDrawer` slide depuis la droite, positionné à gauche du main drawer), **tooltips riches** au survol des onglets du panneau tree (fond blanc/texte noir/bordure, titre + description), **tree repliée par défaut** (zéro bruit visuel au chargement, l'utilisateur ouvre ce qu'il veut voir), **axe Templates** (bibliothèque des templates fac-similé : grille de cartes avec filtres AFFICHAGE/CATÉGORIE, drawer détail 600px avec aperçu/infos éditables/champs readonly/liste fac-similés générés cliquables, boutons Éditer/Générer en batch/Supprimer avec confirmation enrichie préservant les fac-similés) |
| **Amortissements** | Registre immobilisations, calcul dotations linéaire/dégressif, détection auto candidates (> 500€), plafonds véhicules CO2, cessions avec plus/moins-value, moteur calcul temps réel |
| **Charges forfaitaires** | 2 onglets (Blanchissage + Véhicule) avec badges pill colorés. **Blanchissage** : barème éditable, calcul OD + PDF rapport, GED. **Véhicule** : quote-part pro kilométrique (aller-retour × jours + km sup / km totaux), calcul live côté client, mise à jour poste GED, PDF rapport avec tableau dépenses par sous-catégorie, auto-regénération. Aperçu PDF via thumbnail PNG + drawer 700px. Intégré dans Simulation BNC |
| **Prévisionnel** | Calendrier de trésorerie 12 mois : timeline charges/recettes (barres Recharts), fournisseurs récurrents (facture/échéancier), parsing OCR prélèvements, scan automatique documents, régression recettes + saisonnalité, paramètres catégories |
| **Simulation BNC** | Simulateur fiscal : leviers Madelin/PER/CARMF/investissement/remplacement, dépenses détaillées par catégorie, taux marginal réel, comparatif charge/immobilisation, prévisions d'honoraires avec profil saisonnier |
| **URSSAF Déductible** | Calcul automatique part déductible vs non déductible CSG/CRDS (2,9%) sur les cotisations URSSAF. Assiette ≤2024 BNC+cotis, ≥2025 BNC×74% (réforme). Widget inline dans l'éditeur + batch année complète depuis Compta Analytique. Déduit automatiquement du BNC dans les analytics et exports |
| **Tâches** | Vue kanban 3 colonnes (To do / In progress / Done) avec drag & drop et **réordonnancement vertical** intra-colonne (persisté), tâches auto-générées (5 détections : catégorisation, justificatifs, clôture, imports, alertes) + tâches manuelles, scopé par année, badge compteur sidebar |
| **Paramètres** | Thème, export, stockage, informations système, **email comptable** (SMTP Gmail, app password, destinataires, nom expéditeur), **Intégrité des justificatifs** (scan + répare auto duplicatas/orphelins/liens fantômes, grille 6 métriques, détection conflits hash, bouton « Redémarrer backend » en dev) |

---

## Stack Technique

### Frontend
- **React 19** + TypeScript 5
- **Vite 8** (bundler)
- **TailwindCSS 4** (dark theme)
- **TanStack Query 5** (data fetching & cache)
- **TanStack Table 8** (tableaux)
- **Recharts 3** (graphiques)
- **Lucide React** (icônes)
- **Zustand** (state management global, année persistée)
- **@dnd-kit** (drag & drop kanban)

### Backend
- **FastAPI** (Python 3.9+)
- **pandas** + **numpy** (traitement de données)
- **scikit-learn** (ML catégorisation)
- **EasyOCR** + **pdf2image** (reconnaissance optique)
- **ReportLab** + **openpyxl** (génération PDF/Excel)
- **pdfplumber** (extraction PDF)

### Stockage
- Fichiers JSON dans `data/` (opérations, catégories, paramètres)
- Imports séparés : `data/imports/operations/` (JSON) et `data/imports/releves/` (PDF)
- Modèles ML en pickle (`data/ml/`)
- Cache OCR en `.ocr.json`
- Justificatifs PDF dans `data/justificatifs/`

---

## Installation

### Prérequis
- Python 3.9+
- Node.js 18+
- Poppler (pour pdf2image) : `brew install poppler`

### Lancement rapide (recommandé) — `./start.sh`

```bash
./start.sh
```

Lance en parallèle le backend (port 8000) et le frontend (port 5173) avec les flags uvicorn optimisés :
- `--timeout-graceful-shutdown 2` — force le kill du worker après 2s sur un reload (évite le blocage « Waiting for connections to close » dû aux SSE `/api/sandbox/events` + thread watchdog + tâche `_previsionnel_background_loop`)
- `--reload-exclude 'data/*' 'frontend/*' '*.pkl' '*.log' 'backups/*' '__pycache__/*'` — ignore les reloads parasites déclenchés quand le backend écrit dans `data/` (ex. `save_rules_model`, `log_prediction_batch`)

`Ctrl+C` kille les deux processus. Backend Swagger sur **http://localhost:8000/docs**, frontend sur **http://localhost:5173**.

### Lancement manuel (2 terminaux séparés)

#### Backend

```bash
# Créer un environnement virtuel (recommandé)
python3 -m venv venv
source venv/bin/activate

# Installer les dépendances
pip install -r backend/requirements.txt

# Lancer le serveur (mêmes flags que start.sh)
python3 -m uvicorn backend.main:app \
  --host 0.0.0.0 --port 8000 \
  --reload \
  --timeout-graceful-shutdown 2 \
  --reload-exclude 'data/*' --reload-exclude 'frontend/*' \
  --reload-exclude '*.pkl' --reload-exclude '*.log'
```

Le backend tourne sur **http://localhost:8000**. Documentation Swagger sur `/docs`.

#### Frontend

```bash
cd frontend

# Installer les dépendances
npm install

# Lancer le serveur de développement
npm run dev
```

Le frontend tourne sur **http://localhost:5173**. Le proxy API est configuré automatiquement vers le port 8000.

---

## Structure du Projet

```
neuronXcompta/
├── backend/
│   ├── main.py                 # Point d'entrée FastAPI
│   ├── requirements.txt        # Dépendances Python
│   ├── core/
│   │   └── config.py           # Configuration centralisée
│   ├── models/                 # Schémas Pydantic (14 fichiers)
│   │   ├── category.py
│   │   ├── justificatif.py
│   │   ├── ocr.py
│   │   ├── operation.py
│   │   ├── settings.py
│   │   ├── ged.py
│   │   ├── report.py
│   │   ├── analytics.py
│   │   ├── amortissement.py
│   │   └── ...
│   ├── routers/                # Endpoints API (20 fichiers)
│   │   ├── operations.py
│   │   ├── categories.py
│   │   ├── ml.py
│   │   ├── analytics.py
│   │   ├── settings.py
│   │   ├── reports.py
│   │   ├── queries.py
│   │   ├── justificatifs.py
│   │   ├── ocr.py
│   │   ├── exports.py
│   │   ├── ged.py
│   │   ├── amortissements.py
│   │   └── ...
│   └── services/               # Logique métier (19 fichiers)
│       ├── operation_service.py
│       ├── category_service.py
│       ├── ml_service.py
│       ├── analytics_service.py
│       ├── report_service.py
│       ├── query_service.py
│       ├── justificatif_service.py
│       ├── ocr_service.py
│       ├── export_service.py
│       ├── pdf_service.py
│       ├── rapprochement_service.py
│       ├── sandbox_service.py
│       └── cloture_service.py
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx             # Routes (16 pages)
│       ├── main.tsx            # Point d'entrée React
│       ├── index.css           # Thème Tailwind
│       ├── api/client.ts       # Client API
│       ├── components/         # 60+ composants React
│       ├── hooks/              # 18 fichiers de hooks
│       ├── types/index.ts      # Types TypeScript
│       └── lib/utils.ts        # Utilitaires
├── data/                       # Données applicatives
│   ├── imports/
│   │   ├── operations/         # Fichiers JSON d'opérations
│   │   └── releves/            # Relevés bancaires PDF
│   ├── exports/                # Archives ZIP générées
│   ├── reports/                # Rapports générés
│   ├── justificatifs/          # Justificatifs PDF
│   │   ├── en_attente/
│   │   └── traites/
│   ├── ged/                    # Bibliothèque GED
│   │   ├── ged_metadata.json
│   │   ├── ged_postes.json
│   │   └── thumbnails/
│   ├── amortissements/         # Registre immobilisations
│   │   ├── immobilisations.json
│   │   └── config.json
│   ├── previsionnel/           # Prévisionnel trésorerie
│   │   ├── providers.json
│   │   ├── echeances.json
│   │   └── settings.json
│   ├── templates/              # Templates justificatifs
│   │   └── justificatifs_templates.json
│   ├── tasks.json              # Tâches kanban (auto + manuelles)
│   ├── ml/                     # Modèles ML
│   └── logs/                   # Logs applicatifs
├── settings.json               # Configuration utilisateur
├── CLAUDE.md                   # Guide pour Claude Code
└── docs/                       # Documentation technique
```

---

## API

L'API REST est documentée automatiquement via **Swagger UI** sur `http://localhost:8000/docs`.

### Principaux endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/operations/files` | Lister les fichiers d'opérations |
| `POST` | `/api/operations/import` | Importer un relevé PDF |
| `POST` | `/api/ml/predict` | Prédire la catégorie d'un libellé |
| `POST` | `/api/ml/train` | Entraîner le modèle ML |
| `GET` | `/api/analytics/dashboard` | Données du tableau de bord |
| `POST` | `/api/reports/generate` | Générer un rapport (CSV/PDF/Excel) |
| `POST` | `/api/reports/export-zip` | Exporter rapports sélectionnés en ZIP |
| `POST` | `/api/reports/regenerate-all` | Régénérer tous les rapports |
| `POST` | `/api/reports/{filename}/open-native` | Ouvrir dans Aperçu/Numbers |
| `DELETE` | `/api/reports/all` | Supprimer tous les rapports |
| `POST` | `/api/exports/generate` | Générer un export comptable ZIP (legacy) |
| `GET` | `/api/exports/status/{year}` | Statut mensuel des exports (has_pdf, has_csv, preview contenu) |
| `POST` | `/api/exports/generate-month` | Générer un export mensuel (PDF+CSV+relevés+rapports+justificatifs) |
| `POST` | `/api/exports/generate-batch` | Générer un batch d'exports (ZIP multi-mois) |
| `GET` | `/api/exports/contents/{filename}` | Lister les fichiers dans un ZIP d'export |
| `GET` | `/api/exports/available-reports/{year}/{month}` | Rapports disponibles pour un mois |
| `POST` | `/api/email/test-connection` | Tester la connexion SMTP Gmail |
| `GET` | `/api/email/documents` | Lister les documents disponibles pour envoi (filtres type/année/mois) |
| `POST` | `/api/email/preview` | Prévisualisation email (objet + corps auto-générés) |
| `POST` | `/api/email/send` | Envoyer des documents par email (ZIP unique + HTML avec logo) |
| `GET` | `/api/email/history` | Historique des envois email |
| `GET` | `/api/email/coverage/{year}` | Couverture d'envoi par mois pour une année |
| `POST` | `/api/ocr/extract` | Extraction OCR d'un justificatif |
| `POST` | `/api/ocr/batch-upload` | Upload batch + OCR de justificatifs |
| `GET` | `/api/analytics/compare` | Comparatif entre 2 périodes |
| `GET` | `/api/analytics/category-detail` | Drill-down catégorie |
| `POST` | `/api/rapprochement/run-auto` | Rapprochement automatique |
| `POST` | `/api/rapprochement/associate-manual` | Association manuelle (supporte `ventilation_index` + `force: bool` pour bypass lock ; set `locked=true` auto après succès ; 423 si op déjà lockée sans `force`) |
| `PATCH` | `/api/operations/{filename}/{index}/lock` | Verrouiller/déverrouiller une opération — body `{locked: bool}` → `{locked, locked_at}`. Protège l'association justif contre l'auto-rapprochement |
| `POST` | `/api/justificatifs/dissociate` | Dissocier — 423 si op lockée (déverrouillage requis) |
| `DELETE` | `/api/justificatifs/{filename}` | Suppression complète : retourne dict détaillé (`ops_unlinked`, `thumbnail_deleted`, `ged_cleaned`, `ocr_cache_deleted`) |
| `PUT` | `/api/ventilation/{file}/{idx}` | Créer/modifier ventilation — lance auto-rapprochement en arrière-plan sur les sous-lignes |
| `GET` | `/api/justificatifs/scan-links` | Dry-run : liste incohérences disque ↔ ops (duplicatas, orphelins, ghosts, conflits) |
| `POST` | `/api/justificatifs/repair-links` | Apply : répare duplicatas/orphelins/ghosts, skip conflits hash |
| `GET` | `/api/settings` | Charger les paramètres |
| `POST` | `/api/settings/restart` | Redémarrer le backend (dev, touch sentinel uvicorn --reload) |
| `GET` | `/api/analytics/year-overview` | Cockpit annuel (mois, KPIs, alertes, progression) |
| `GET` | `/api/reports/tree` | Arbre triple vue (année/catégorie/format) |
| `GET` | `/api/reports/templates` | Templates de rapports prédéfinis |
| `GET` | `/api/ged/tree` | Arbre GED (par année / par type) |
| `GET` | `/api/ged/documents` | Documents indexés avec filtres |
| `GET` | `/api/amortissements` | Registre des immobilisations |
| `GET` | `/api/amortissements/kpis` | KPIs amortissements |
| `GET` | `/api/amortissements/candidates` | Opérations candidates à immobiliser |
| `GET` | `/api/previsionnel/timeline` | Timeline 12 mois charges/recettes/solde |
| `GET` | `/api/previsionnel/providers` | Fournisseurs récurrents configurés |
| `POST` | `/api/previsionnel/scan` | Scanner documents OCR/GED vs échéances |
| `POST` | `/api/previsionnel/refresh` | Régénérer les échéances de l'année |
| `GET` | `/api/previsionnel/dashboard` | KPIs prévisionnel |
| `GET` | `/api/templates` | Lister les templates justificatifs |
| `POST` | `/api/templates` | Créer un template fournisseur (depuis justificatif scanné) |
| `POST` | `/api/templates/from-blank` | Créer un template depuis un PDF vierge (pas d'OCR) |
| `POST` | `/api/templates/extract` | Extraire les champs d'un justificatif scanné |
| `POST` | `/api/templates/generate` | Générer un PDF justificatif reconstitué |
| `GET` | `/api/templates/suggest/{file}/{idx}` | Suggestions de templates pour une opération |
| `GET` | `/api/templates/ged-summary` | Liste enrichie pour la GED (compteurs fac-similés) |
| `GET` | `/api/templates/{id}/ged-detail` | Détail + fac-similés générés pour le drawer GED |
| `GET` | `/api/templates/{id}/thumbnail` | Thumbnail PNG 200px d'un blank template |
| `GET` | `/api/templates/{id}/page-size` | Dimensions de page pt PDF (click-to-position) |
| `GET` | `/api/tasks/?year=` | Lister les tâches pour une année |
| `POST` | `/api/tasks/` | Créer une tâche manuelle |
| `PATCH` | `/api/tasks/{id}` | Modifier une tâche (status, priority, dismiss) |
| `POST` | `/api/tasks/refresh?year=` | Régénérer les tâches auto pour l'année |
| `PUT` | `/api/settings` | Sauvegarder les paramètres (incl. `auto_pointage`) |
| `GET` | `/api/justificatifs/reverse-lookup/{file}` | Trouver les opérations liées à un justificatif |
| `POST` | `/api/sandbox/process` | Déclencher le traitement des fichiers en attente dans le sandbox |

---

## Développement

### Build production

```bash
cd frontend
npm run build    # Génère frontend/dist/
```

### Vérification TypeScript

```bash
cd frontend
npx tsc --noEmit
```

### Linting

```bash
cd frontend
npm run lint
```

---

## Licence

Projet privé - Usage interne uniquement.
