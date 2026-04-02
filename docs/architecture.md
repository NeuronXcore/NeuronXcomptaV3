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
│  │  (14 files)│     │  (13 files) │     │  data/       │ │
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
SAISIE → TRAITEMENT → ANALYSE → CLÔTURE → OUTILS

Importation      Justificatifs      Tableau de bord     Export Comptable    Agent IA
Édition          Rapprochement      Compta Analytique   Clôture             Paramètres
Catégories       Compte d'attente   Rapports
OCR              Échéancier
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

## Couches applicatives

### Frontend

| Couche | Responsabilité | Fichiers |
|--------|----------------|----------|
| **Components** | UI et interactions | `src/components/` (28 fichiers) |
| **Hooks** | Data fetching, cache, mutations, SSE | `src/hooks/` (11 fichiers) |
| **API Client** | Abstraction fetch, gestion erreurs | `src/api/client.ts` |
| **Types** | Interfaces TypeScript | `src/types/index.ts` |
| **Utils** | Formatage, classes CSS | `src/lib/utils.ts` |

### Backend

| Couche | Responsabilité | Fichiers |
|--------|----------------|----------|
| **Routers** | Endpoints HTTP, validation, SSE | `backend/routers/` (14 fichiers) |
| **Services** | Logique métier, I/O, watchdog | `backend/services/` (13 fichiers) |
| **Models** | Schémas Pydantic | `backend/models/` (6 fichiers) |
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
