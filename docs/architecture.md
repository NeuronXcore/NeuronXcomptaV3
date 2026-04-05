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
│  │  (18 files)│     │  (17 files) │     │  data/       │ │
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
OCR              Échéancier         Simulation BNC
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
  → Page Justificatifs = galerie seule (pas d'upload)

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
  → Score = 45% montant + 35% date + 20% fournisseur (Jaccard)
  → Auto-associe si score >= 0.95 et match unique

Rapprochement manuel : drawer avec filtres
  → GET /{filename}/{index}/suggestions?search=&montant_min=...
  → Score simplifié : 50% montant + 30% date + 20% fournisseur
  → Sélection + preview PDF + association
```

### Catégorisation IA

```
Libellé → ml router → ml_service.predict_category()
  1. Correspondance exacte (model.json → exact_matches)
  2. Mots-clés (model.json → keywords)
  3. Scikit-learn (sklearn_model.pkl + vectorizer.pkl)
  → Score de confiance + risque d'hallucination

Auto-catégorisation (EditorPage) :
  → Au chargement d'un fichier, useEffect déclenche POST /{filename}/categorize (mode: empty_only)
  → Seules les opérations sans catégorie ou "Autres" sont traitées
  → useRef anti-boucle empêche le re-déclenchement (lastAutoCategorizedFile)
  → Bouton "Recatégoriser IA" : force mode "all" (recatégorise toutes les lignes)
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

### OCR automatique

```
Upload justificatif → justificatifs router → upload_justificatifs()
  → Background: ocr_service.extract_or_cached()
    → pdf2image → convert_from_path() (PDF → images)
    → EasyOCR Reader.readtext() (images → texte)
    → Parsing : dates, montants, fournisseur
    → Cache : .ocr.json à côté du PDF
  → Suggestions améliorées (date OCR + montant OCR + fournisseur)
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

### GED (Gestion Électronique de Documents)

```
Page Bibliothèque (/ged) → GedPage (split layout)
  ├─ Arbre gauche (260px) : double vue (onglets "Par année" / "Par type")
  │   → GET /api/ged/tree → { by_type: [...], by_year: [...] }
  │   → scan_all_sources() indexe : relevés, justificatifs, rapports, docs libres
  │   → Aucune duplication : métadonnées dans ged_metadata.json, fichiers restent en place
  │
  ├─ Contenu droit : grille thumbnails (5-6 cols) ou tableau liste
  │   → Thumbnails : GET /api/ged/documents/{id}/thumbnail → pdf2image (1ère page, 200px)
  │   → Cache : data/ged/thumbnails/{md5}.png (régénéré si PDF plus récent)
  │
  ├─ Drawer document (redimensionnable 400-1200px, poignée drag bord gauche)
  │   → Preview PDF (iframe) + section Fiscalité
  │   → Poste comptable (select) → % déductible hérité ou surchargé
  │   → Montant déductible = montant_brut × effective_pct / 100
  │   → Bouton "Ouvrir dans Aperçu" → POST /open-native → subprocess.Popen(["open", path])
  │
  ├─ Drawer postes comptables (600px)
  │   → 16 postes par défaut (loyer, véhicule, téléphone, etc.)
  │   → Slider input[type=range] 0-100 step 5, couleur dynamique (vert/orange/rouge)
  │   → Stats par poste : nb docs, total brut, total déduit
  │
  └─ Upload documents libres → data/ged/{year}/{month}/
      → Images (JPG/PNG) converties en PDF à l'intake
      → Recherche full-text : noms fichiers + tags + notes + contenu .ocr.json
```

### Rapports V2

```
Page Rapports (/reports) → ReportsPage (2 onglets)
  ├─ Onglet "Générer"
  │   → 3 templates rapides (BNC annuel, Ventilation charges, Récapitulatif social)
  │   → Filtres avancés (période, catégories multi-select, type, montant, format)
  │   → Formats : PDF (EUR, ligne totaux), CSV (;/virgule/BOM), Excel (formules SUM)
  │   → Déduplication : même clé (filtres+format) = remplacement ancien rapport
  │
  ├─ Onglet "Bibliothèque" (layout split comme GED)
  │   → Arbre triple vue (par année / par catégorie / par format)
  │   → Grille cartes avec favoris (étoile dorée, tri en premier)
  │   → Sélection multiple pour comparaison (checkbox)
  │   → Drawer preview 800px (PDF iframe, metadata, édition titre, re-génération)
  │   → Drawer comparaison 700px (side-by-side, deltas montants/ops/%)
  │
  └─ Index JSON (data/reports/reports_index.json)
      → Réconciliation au boot (sync filesystem ↔ index)
      → Titre auto-généré (catégorie + période)
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
| **Components** | UI et interactions | `src/components/` (60+ fichiers, incl. `pipeline/`, `ged/`, `amortissements/`, `reports/`, `dashboard/`) |
| **Hooks** | Data fetching, cache, mutations, SSE | `src/hooks/` (16 fichiers, incl. usePipeline, useGed, useReports, useAmortissements) |
| **API Client** | Abstraction fetch, gestion erreurs | `src/api/client.ts` |
| **Types** | Interfaces TypeScript | `src/types/index.ts` |
| **Utils** | Formatage, classes CSS | `src/lib/utils.ts` |

### Backend

| Couche | Responsabilité | Fichiers |
|--------|----------------|----------|
| **Routers** | Endpoints HTTP, validation, SSE | `backend/routers/` (17 fichiers, incl. ged.py, amortissements.py) |
| **Services** | Logique métier, I/O, watchdog, GED, amortissements | `backend/services/` (16 fichiers, incl. ged_service.py, amortissement_service.py) |
| **Models** | Schémas Pydantic | `backend/models/` (10 fichiers, incl. ged.py, report.py, analytics.py, amortissement.py) |
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
│   └── backups/                # Sauvegardes horodatées
├── ged/
│   ├── ged_metadata.json       # Index des documents GED (chemins, types, postes, tags)
│   ├── ged_postes.json         # Postes comptables avec % déductibilité
│   ├── thumbnails/             # Cache thumbnails PNG (pdf2image, 200px)
│   │   └── {md5_doc_id}.png
│   └── {year}/{month}/         # Documents libres uploadés
├── amortissements/
│   ├── immobilisations.json    # Registre des immobilisations
│   └── config.json             # Seuil (500€), durées, catégories éligibles, plafonds
├── compta_analytique/          # Presets de requêtes
├── logs/                       # Logs applicatifs (rotation 10 Mo)
└── ocr/                        # Cache OCR global
```

## Gestion de l'état frontend

**TanStack Query** gère tout l'état serveur :

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
