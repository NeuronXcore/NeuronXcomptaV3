# Architecture Technique

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│              http://localhost:5173                        │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Components│  │  Hooks   │  │  Types   │              │
│  │  (28 .tsx)│  │(TanStack)│  │(index.ts)│              │
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
│  │  (13 files)│     │  (12 files) │     │  data/       │ │
│  └────────────┘     └─────────────┘     └──────────────┘ │
│        │                   │                              │
│  ┌─────▼──────┐     ┌─────▼──────┐                       │
│  │   Models   │     │  ML Models │                       │
│  │  (Pydantic)│     │  (sklearn) │                       │
│  └────────────┘     └────────────┘                       │
└───────────────────────────────────────────────────────────┘
```

## Flux de données

### Importation d'un relevé

```
PDF Upload → operations router → pdf_service.extract_operations_from_pdf()
  → Détection doublons (hash MD5)
  → Parsing tables pdfplumber
  → Sauvegarde JSON dans data/imports/
  → Réponse : opérations extraites
```

### Catégorisation IA

```
Libellé → ml router → ml_service.predict_category()
  1. Correspondance exacte (model.json → exact_matches)
  2. Mots-clés (model.json → keywords)
  3. Scikit-learn (sklearn_model.pkl + vectorizer.pkl)
  → Score de confiance + risque d'hallucination
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
| **Hooks** | Data fetching, cache, mutations | `src/hooks/` (8 fichiers) |
| **API Client** | Abstraction fetch, gestion erreurs | `src/api/client.ts` |
| **Types** | Interfaces TypeScript | `src/types/index.ts` |
| **Utils** | Formatage, classes CSS | `src/lib/utils.ts` |

### Backend

| Couche | Responsabilité | Fichiers |
|--------|----------------|----------|
| **Routers** | Endpoints HTTP, validation | `backend/routers/` (13 fichiers) |
| **Services** | Logique métier, I/O | `backend/services/` (12 fichiers) |
| **Models** | Schémas Pydantic | `backend/models/` (6 fichiers) |
| **Config** | Chemins, constantes | `backend/core/config.py` |

## Stockage des données

```
data/
├── imports/                    # Fichiers JSON d'opérations
│   ├── operations_YYYYMMDD_HHMMSS_HASH.json
│   └── pdf_HASH.pdf           # Relevé bancaire original
├── exports/                    # Archives ZIP mensuelles
├── reports/                    # Rapports générés (CSV/PDF/XLSX)
├── rapports/                   # Rapports legacy
├── justificatifs/
│   ├── en_attente/             # Justificatifs non associés
│   │   ├── justificatif_YYYYMMDD_HHMMSS_nom.pdf
│   │   └── justificatif_YYYYMMDD_HHMMSS_nom.ocr.json
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
- **Upload** : Vérification magic bytes PDF (`%PDF-`), limite 10 Mo
- **Sanitization** : NaN/Inf remplacés par 0 dans les opérations
