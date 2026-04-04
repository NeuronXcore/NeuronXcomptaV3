# NeuronXcompta V3

**Assistant Comptable IA** pour cabinet dentaire.

Application full-stack de gestion comptable avec catégorisation automatique par IA, OCR des justificatifs, rapports multi-formats et exports comptables.

---

## Fonctionnalités

| Module | Description |
|--------|-------------|
| **Tableau de bord** | **Cockpit exercice V2** : jauge segmentée 6 critères, KPIs avec sparkline BNC, grille 12 mois cliquables avec badges d'état, alertes pondérées, échéances fiscales, rappels rapports, bar chart recettes/dépenses |
| **Importation** | Upload de relevés bancaires PDF, extraction automatique des opérations (dates YYYY-MM-DD, filtrage soldes/totaux) |
| **Éditeur** | Édition inline, catégorisation IA (vides/tout), **vue année complète** (lecture seule), **filtres catégorie + sous-catégorie**, colonnes : Justificatif, Important, À revoir, Pointée |
| **Catégories** | Gestion des catégories/sous-catégories avec couleurs personnalisées |
| **Rapports** | Génération PDF/CSV/Excel, 3 templates, bibliothèque triple vue (année/catégorie/format), favoris, comparaison, format EUR, déduplication |
| **Compta Analytique** | Filtres globaux (année/trimestre/mois), drill-down catégorie, **comparatif périodes avec séparation recettes/dépenses**, tendances (agrégé/catégorie/empilé), anomalies, requêtes personnalisées |
| **Rapprochement** | Rapprochement auto + drawer manuel avec filtres, scores, preview PDF |
| **Justificatifs** | Galerie, association aux opérations, suggestions automatiques (upload via page OCR) |
| **Agent IA** | Modèle ML (rules + sklearn), courbe d'apprentissage, backups |
| **Export Comptable** | Archive ZIP mensuelle (opérations + relevé + justificatifs) |
| **OCR** | Point d'entrée justificatifs : batch upload multi-fichiers + OCR automatique (EasyOCR), test manuel, historique |
| **GED** | Bibliothèque documentaire : double vue arbre (année/type), thumbnails PDF, postes comptables avec % déductibilité, upload documents libres, recherche full-text, OCR auto |
| **Amortissements** | Registre immobilisations, calcul dotations linéaire/dégressif, détection auto candidates (> 500€), plafonds véhicules CO2, cessions avec plus/moins-value, moteur calcul temps réel |
| **Paramètres** | Thème, export, stockage, informations système |

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
│   ├── models/                 # Schémas Pydantic (10 fichiers)
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
│   ├── routers/                # Endpoints API (17 fichiers)
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
│   └── services/               # Logique métier (16 fichiers)
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
│       ├── hooks/              # 14 fichiers de hooks
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
| `POST` | `/api/exports/generate` | Générer un export comptable ZIP |
| `POST` | `/api/ocr/extract` | Extraction OCR d'un justificatif |
| `POST` | `/api/ocr/batch-upload` | Upload batch + OCR de justificatifs |
| `GET` | `/api/analytics/compare` | Comparatif entre 2 périodes |
| `GET` | `/api/analytics/category-detail` | Drill-down catégorie |
| `POST` | `/api/rapprochement/run-auto` | Rapprochement automatique |
| `POST` | `/api/rapprochement/associate-manual` | Association manuelle |
| `GET` | `/api/settings` | Charger les paramètres |
| `GET` | `/api/analytics/year-overview` | Cockpit annuel (mois, KPIs, alertes, progression) |
| `GET` | `/api/reports/tree` | Arbre triple vue (année/catégorie/format) |
| `GET` | `/api/reports/templates` | Templates de rapports prédéfinis |
| `GET` | `/api/ged/tree` | Arbre GED (par année / par type) |
| `GET` | `/api/ged/documents` | Documents indexés avec filtres |
| `GET` | `/api/amortissements` | Registre des immobilisations |
| `GET` | `/api/amortissements/kpis` | KPIs amortissements |
| `GET` | `/api/amortissements/candidates` | Opérations candidates à immobiliser |
| `PUT` | `/api/settings` | Sauvegarder les paramètres |

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
