# CLAUDE.md - NeuronXcompta V3

## Project Overview

NeuronXcompta V3 is a full-stack accounting assistant for a dental practice. Migrated from Streamlit (V2) to React + FastAPI. All 14 pages are fully implemented with zero placeholders. Includes a sandbox watchdog that auto-processes PDFs dropped into `data/justificatifs/sandbox/` with OCR and real-time SSE notifications.

## Architecture

- **Backend**: FastAPI (Python 3.9+), runs on port 8000
- **Frontend**: React 19 + Vite + TypeScript + TailwindCSS 4, runs on port 5173
- **Data**: JSON file storage in `data/` directory
- **ML**: Rules-based + scikit-learn categorization, pickle models in `data/ml/`
- **OCR**: EasyOCR with pdf2image, cache `.ocr.json` alongside PDFs. OCR page is the primary entry point for justificatif uploads (batch upload + immediate OCR).
- **Sandbox Watchdog**: `watchdog` library monitors `data/justificatifs/sandbox/`, auto-OCR + SSE notifications

## Critical Constraints

- **Python 3.9**: MUST use `from __future__ import annotations` in all backend files. Use `Optional[X]` not `X | None`, use `list[X]` only with future annotations.
- **NaN values**: Operation JSON files may contain NaN floats. The `_sanitize_value()` function in `operation_service.py` handles this.
- **PageHeader**: Uses `actions` prop (not children) for header buttons.
- **Dark theme**: All colors via CSS variables in `index.css` (`bg-background`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`).

## How to Run

```bash
# Backend
cd /path/to/neuronXcompta
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd frontend
npm run dev
```

## Project Structure

```
neuronXcompta/
├── backend/
│   ├── main.py                 # FastAPI entry point
│   ├── core/config.py          # All paths, constants, MOIS_FR
│   ├── models/                 # Pydantic schemas (6 files)
│   ├── routers/                # API endpoints (14 routers)
│   └── services/               # Business logic (13 services)
├── frontend/
│   └── src/
│       ├── App.tsx             # All 14 routes (Accueil fusionné avec Dashboard)
│       ├── api/client.ts       # api.get/post/put/delete/upload/uploadMultiple
│       ├── components/         # 30+ .tsx components
│       ├── hooks/              # 11 hook files (useApi, useOperations, useJustificatifs, useOcr, useExports, useRapprochement, useRapprochementManuel, useLettrage, useCloture, useSandbox, useAlertes)
│       ├── types/index.ts      # All TypeScript interfaces
│       ├── lib/utils.ts        # cn, formatCurrency, formatDate, MOIS_FR, formatFileTitle
│       └── index.css           # Tailwind @theme with custom colors
├── data/                       # JSON storage (imports, exports, ml, justificatifs, logs)
├── settings.json               # App settings
└── docs/                       # Documentation
```

## Sidebar Navigation (Pipeline Comptable)

La sidebar est organisée en 5 groupes suivant la chronologie du pipeline comptable :

| Groupe | Pages |
|--------|-------|
| **SAISIE** | Importation, Édition, Catégories, OCR |
| **TRAITEMENT** | Justificatifs, Rapprochement, Compte d'attente, Échéancier |
| **ANALYSE** | Tableau de bord, Compta Analytique, Rapports |
| **CLÔTURE** | Export Comptable, Clôture |
| **OUTILS** | Agent IA, Paramètres |

## Backend API Endpoints

| Router | Prefix | Key Endpoints |
|--------|--------|---------------|
| operations | `/api/operations` | GET /files, GET/PUT/DELETE /{filename}, POST /import, POST /{filename}/categorize, GET /{filename}/has-pdf, GET /{filename}/pdf |
| categories | `/api/categories` | GET, POST, PUT /{name}, DELETE /{name}, GET /{name}/subcategories |
| ml | `/api/ml` | GET /model, POST /predict, POST /train, POST /rules, POST /backup, POST /restore/{name} |
| analytics | `/api/analytics` | GET /dashboard, GET /summary, GET /trends, GET /anomalies, GET /category-detail, GET /compare |
| reports | `/api/reports` | GET /gallery, POST /generate, GET /download/{filename}, DELETE /{filename} |
| queries | `/api/queries` | POST /query, GET/POST/DELETE /queries |
| justificatifs | `/api/justificatifs` | GET /, GET /stats, POST /upload, POST /associate, POST /dissociate |
| ocr | `/api/ocr` | GET /status, GET /history, POST /extract, POST /extract-upload, POST /batch-upload |
| exports | `/api/exports` | GET /periods, GET /list, POST /generate, GET /download/{filename} |
| rapprochement | `/api/rapprochement` | POST /run-auto, POST /associate-manual, GET /unmatched, GET /{filename}/{index}/suggestions, GET /batch-hints/{filename} |
| lettrage | `/api/lettrage` | POST /{filename}/{index}, POST /{filename}/bulk, GET /{filename}/stats |
| cloture | `/api/cloture` | GET /years, GET /{year} |
| sandbox | `/api/sandbox` | GET /events (SSE), GET /list, DELETE /{filename} |
| settings | `/api/settings` | GET, PUT, GET /disk-space, GET /data-stats, GET /system-info |

## Frontend Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | DashboardPage | KPIs, charts, recent operations (anciennement Accueil + Dashboard fusionnés) |
| `/import` | ImportPage | PDF drag-drop import |
| `/editor` | EditorPage | Inline operation editing with AI categorization, lettrage toggle, PDF preview |
| `/categories` | CategoriesPage | 4-tab category management |
| `/reports` | ReportsPage | Report generation (CSV/PDF/Excel) + gallery |
| `/visualization` | ComptaAnalytiquePage | Analytics avec filtres globaux, drill-down catégorie, comparatif périodes, tendances (agrégé/catégorie/empilé), anomalies, requêtes personnalisées |
| `/justificatifs` | JustificatifsPage | Galerie, association, PDF preview drawer, sandbox SSE badge (upload retiré — passe par OCR) |
| `/agent-ai` | AgentIAPage | ML model dashboard, rules, training, backups |
| `/export` | ExportPage | Monthly ZIP export with calendar grid |
| `/rapprochement` | RapprochementPage | Auto/manual bank-justificatif reconciliation avec drawer rapprochement manuel (filtres, scores, preview PDF) |
| `/alertes` | AlertesPage | Compte d'attente avec badge alertes |
| `/cloture` | CloturePage | Annual calendar view of monthly accounting completeness |
| `/ocr` | OcrPage | Point d'entrée justificatifs : batch upload + OCR, test manuel, historique (3 onglets) |
| `/echeancier` | EcheancierPage | Échéancier des opérations récurrentes |
| `/settings` | SettingsPage | 5-tab settings (general, theme, export, storage, system) |

## Key Components

### Shared
- `PageHeader` — `{ title, description?, actions?: ReactNode }`
- `MetricCard` — `{ title, value, icon?, trend?, className? }`
- `LoadingSpinner` — `{ text? }`

### Drawers (pattern commun : translateX + backdrop)
- `RapprochementManuelDrawer` — 800px, filtres montant/date/fournisseur, liste scorée, preview PDF iframe
- `CategoryDetailDrawer` — 700px, sous-catégories avec barres, mini BarChart mensuel, liste opérations
- `RapprochementDrawer` — 600px, suggestions auto avec scores de confiance
- `JustificatifDrawer` — preview PDF + infos justificatif
- `QueryDrawer` — constructeur de requêtes personnalisées avec résultats

## Patterns to Follow

- **Hooks**: Use TanStack Query (`useQuery`, `useMutation`, `useQueryClient`) for all API calls
- **Styling**: Tailwind classes only, use `cn()` for conditional classes
- **Icons**: Lucide React (already installed)
- **Drawers**: Fixed panel with `translateX` transition + backdrop, 600-800px wide
- **Forms**: Controlled components with `useState`, mutations with `onSuccess` invalidation
- **Backend services**: Always call `ensure_directories()` at start, use `from __future__ import annotations`
- **SSE**: Use `StreamingResponse` with `text/event-stream`, send initial `data: {"status":"connected"}` to flush the connection
- **Toasts**: Use `react-hot-toast` (`toast.success()`, `toast.error()`) — `<Toaster />` is in `App.tsx`
- **Sidebar sections**: Utilise `NAV_SECTIONS` avec labels de section discrets (uppercase, text-[10px])

## Dependencies

**Frontend**: react, react-router-dom, @tanstack/react-query, @tanstack/react-table, recharts, react-dropzone, lucide-react, tailwind-merge, clsx, date-fns, zustand, react-hot-toast

**Backend**: fastapi, uvicorn, pandas, numpy, scikit-learn, pdfplumber, reportlab, openpyxl, easyocr, pdf2image, pillow, pytesseract, watchdog
