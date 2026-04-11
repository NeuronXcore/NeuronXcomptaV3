# NeuronXcompta V3

**Assistant Comptable IA** pour cabinet dentaire.

Application full-stack de gestion comptable avec catégorisation automatique par IA, OCR des justificatifs, rapports multi-formats et exports comptables.

---

## Fonctionnalités

| Module | Description |
|--------|-------------|
| **Tableau de bord** | **Cockpit exercice V2** : jauge segmentée 6 critères, KPIs avec sparkline BNC, grille 12 mois cliquables avec badges d'état, alertes pondérées, échéances fiscales, rappels rapports, bar chart recettes/dépenses |
| **Importation** | Upload de relevés bancaires PDF, extraction automatique des opérations (dates YYYY-MM-DD, filtrage soldes/totaux) |
| **Éditeur** | Édition inline (EditableCell avec commit onBlur), catégorisation IA (vides/tout), **vue année complète** (lecture seule), **filtres catégorie + sous-catégorie**, colonnes : Justificatif, Important, À revoir, Pointée, **ventilation** (bouton Scissors, sous-lignes indentées) |
| **Catégories** | Gestion des catégories/sous-catégories avec couleurs personnalisées |
| **Rapports** | Generation PDF/CSV/Excel avec logo, colonnes Justificatif et Commentaire, 3 templates, checkboxes modernes categories, batch 12 mois, export ZIP comptable, **déduplication avec archivage** (ancien rapport archivé dans `reports/archives/`). Bibliotheque migree vers GED V2 |
| **Compta Analytique** | Filtres globaux (année/trimestre/mois), drill-down catégorie, **comparatif périodes avec séparation recettes/dépenses**, tendances (agrégé/catégorie/empilé), anomalies, requêtes personnalisées |
| **Justificatifs** | **Vue opérations-centrée** avec **`RapprochementWorkflowDrawer` unifié** (700px, 2 modes « Toutes sans justificatif » / « Opération ciblée », progress bar, tabs, ventilation pills, raccourcis ⏎/←/→/Esc, ScorePills 4 critères, thumbnails lazy-loaded via IntersectionObserver, recherche libre exclusive). **Auto-rapprochement** avec scoring v2 (4 critères + pondération dynamique), preview justificatif avec dissociation, 4 KPIs couverture, sandbox SSE. **Catégories/sous-catégories éditables inline** (dropdowns, sauvegarde auto, mode « Toute l'année » supporté). **Batch reconstitution fac-similé** (multi-sélection → barre flottante → drawer choix template par groupe → génération batch). **Exemptions** CARMF/URSSAF/Honoraires/Perso (CheckCircle2 bleu ciel, tooltip). **Navigation bidirectionnelle** Justificatif ↔ Opération avec row surlignée persistante via `isNavTarget`. |
| **Agent IA** | Modèle ML (rules + sklearn), courbe d'apprentissage, backups, **auto-alimentation ML** depuis corrections manuelles (dédupliqué, effet immédiat sur les règles exactes) |
| **Export Comptable V3** | Grille calendrier 4×3 avec badges toggle PDF+CSV + checkbox Compte d'attente, génération ZIP (PDF+CSV+relevés+justificatifs+compte_attente en dossiers), exports enregistrés dans la GED, historique trié par mois (jan→déc) avec expander contenu ZIP, sélection multi-export, envoi au comptable |
| **Compte d'Attente** | Export PDF/CSV des opérations en attente par mois ou année, bouton export dropdown (4 options), enregistrement automatique dans la GED, cas 0 ops = fichier preuve |
| **Email Comptable** | Drawer universel d'envoi au comptable via SMTP Gmail : sélection documents multi-type triés par période, filtres, **expanders intelligents**, **pré-sélection intelligente**, **jauge taille temps réel**, **template HTML brandé** (logo lockup, filets violets, arborescence ZIP, signature, footer copyright), **toggle HTML/Texte** dans le drawer, ZIP unique en PJ, historique des envois |
| **OCR** | Point d'entrée justificatifs : batch upload multi-fichiers + OCR automatique (EasyOCR), test manuel, historique trié par date traitement avec **recherche multifocale** (libellé/catégorie/montant/fournisseur, accent-insensitive, multi-termes AND, debounce 250ms), **auto-rename** post-OCR filename-first (`fournisseur_YYYYMMDD_montant.XX.pdf`, suffix `_fs` pour les fac-similés reconstitués), **FilenameEditor** inline-editable avec suggestion convention, **aperçu PDF hover**, **templates justificatifs** avec recherche + filtres, **édition manuelle** (chips montants/dates cliquables, badge OCR incomplet), **bouton orange « Scanner & Renommer »** dans l'onglet Historique ouvrant un drawer de scan filename-first (dry-run + apply, scope en_attente/traites/both) |
| **Templates** | Bibliothèque de templates par fournisseur avec preview PDF, génération de justificatifs reconstitués (**fac-similé** du PDF source avec remplacement date/montant, ou PDF sobre en fallback), extraction auto des coordonnées via pdfplumber, suggestion automatique par alias ou catégorie, **batch fac-similé** (multi-ops groupées par template, endpoint `batch-suggest` + `batch-generate`) |
| **GED V2** | Hub documentaire unifie : **5 vues arbre** (periode, annee/type, categorie, fournisseur, type), cartes enrichies (thumbnail, badge categorie, fournisseur, montant, badge reconstitue, **badge EN ATTENTE**), justificatifs traites ET en attente, barre filtres croises, rapports integres (favori, re-generation, comparaison, **suppression**), enrichissement auto metadata via rapprochement/OCR/editeur/nom de fichier, postes comptables avec % deductibilite, recherche full-text enrichie, URL params, navigation bidirectionnelle justificatif ↔ operation |
| **Amortissements** | Registre immobilisations, calcul dotations linéaire/dégressif, détection auto candidates (> 500€), plafonds véhicules CO2, cessions avec plus/moins-value, moteur calcul temps réel |
| **Prévisionnel** | Calendrier de trésorerie 12 mois : timeline charges/recettes (barres Recharts), fournisseurs récurrents (facture/échéancier), parsing OCR prélèvements, scan automatique documents, régression recettes + saisonnalité, paramètres catégories |
| **Simulation BNC** | Simulateur fiscal : leviers Madelin/PER/CARMF/investissement/remplacement, dépenses détaillées par catégorie, taux marginal réel, comparatif charge/immobilisation, prévisions d'honoraires avec profil saisonnier |
| **Tâches** | Vue kanban 3 colonnes (To do / In progress / Done) avec drag & drop, tâches auto-générées (5 détections : catégorisation, justificatifs, clôture, imports, alertes) + tâches manuelles, scopé par année, badge compteur sidebar |
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

### Backend

```bash
# Créer un environnement virtuel (recommandé)
python3 -m venv venv
source venv/bin/activate

# Installer les dépendances
pip install -r backend/requirements.txt

# Lancer le serveur
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Le backend tourne sur **http://localhost:8000**. Documentation Swagger sur `/docs`.

### Frontend

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
| `POST` | `/api/rapprochement/associate-manual` | Association manuelle |
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
| `POST` | `/api/templates` | Créer un template fournisseur |
| `POST` | `/api/templates/extract` | Extraire les champs d'un justificatif scanné |
| `POST` | `/api/templates/generate` | Générer un PDF justificatif reconstitué |
| `GET` | `/api/templates/suggest/{file}/{idx}` | Suggestions de templates pour une opération |
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
