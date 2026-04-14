# Prompt — Refonte Export Comptable : grille calendrier + génération auto

## Contexte

Refonte de la page ExportPage (`/export`) pour offrir un workflow en un clic : grille 12 mois, clic sur PDF ou CSV → génération automatique du rapport si inexistant → téléchargement. Suppression du format Excel (XLSX). Historique des exports dans un fichier JSON dédié (pas dans la GED).

## Architecture existante à connaître

- `POST /api/reports/generate` — génère un rapport (body : `{ format, title, filters }`)
- `POST /api/exports/generate` — génère un export comptable ZIP
- `GET /api/ged/pending-reports?year=YYYY` — mois sans rapport pour l'année
- `GET /api/cloture/{year}` — statut annuel (12 mois avec nb_operations, taux_lettrage, taux_justificatifs)
- `GET /api/operations/files` — liste des fichiers d'opérations
- Nommage existant : `Export_Comptable_{YYYY}-{MM}_{MoisFR}.{ext}`
- `_export_filename(year, month, ext)` dans `export_service.py`
- Formats actuels : CSV (`;`, BOM, CRLF, montants FR) + PDF (logo, 3 sections pro/perso/attente, récapitulatif BNC)

## 1. Backend

### 1.1 Historique des exports — `data/exports/exports_history.json`

Fichier : `backend/services/export_service.py`

Ajouter un log automatique à chaque export généré :

```python
# Structure exports_history.json
{
  "exports": [
    {
      "id": "exp_20260408_143000",
      "year": 2026,
      "month": 3,
      "format": "pdf",
      "filename": "Export_Comptable_2026-03_Mars.pdf",
      "title": "Toutes catégories — Mars 2026",
      "nb_operations": 92,
      "generated_at": "2026-04-08T14:30:00"
    }
  ]
}
```

Ajouter dans `export_service.py` :
- `_log_export(year, month, format, filename, title, nb_operations)` — append dans le fichier JSON
- `get_exports_history(year: Optional[int] = None) -> list` — lecture avec filtre optionnel par année
- `get_month_export_status(year: int) -> dict` — pour chaque mois 1-12, retourne `{ has_pdf: bool, has_csv: bool, last_pdf: str|None, last_csv: str|None, nb_operations: int }`

### 1.2 Endpoint statut mensuel

Fichier : `backend/routers/exports_router.py`

```
GET /api/exports/status/{year}
```

Réponse :
```json
{
  "year": 2026,
  "months": [
    {
      "month": 1,
      "label": "Janvier",
      "nb_operations": 89,
      "has_data": true,
      "has_pdf": true,
      "has_csv": false,
      "last_pdf_filename": "Export_Comptable_2026-01_Janvier.pdf",
      "last_pdf_date": "2026-02-05T10:00:00"
    },
    {
      "month": 7,
      "label": "Juillet",
      "nb_operations": 0,
      "has_data": false,
      "has_pdf": false,
      "has_csv": false,
      "last_pdf_filename": null,
      "last_pdf_date": null
    }
  ]
}
```

Logique : itérer les fichiers d'opérations, compter les ops par mois, croiser avec `exports_history.json`.

### 1.3 Endpoint génération unitaire avec auto-titre

Fichier : `backend/routers/exports_router.py`

```
POST /api/exports/generate-month
```

Body :
```json
{
  "year": 2026,
  "month": 3,
  "format": "pdf"
}
```

Réponse :
```json
{
  "filename": "Export_Comptable_2026-03_Mars.pdf",
  "title": "Toutes catégories — Mars 2026",
  "nb_operations": 92,
  "generated": true,
  "download_url": "/api/exports/download/Export_Comptable_2026-03_Mars.pdf"
}
```

Logique :
1. Titre auto : `buildReportTitle(toutes_categories, year, month)` → `"Toutes catégories — Mars 2026"`
2. Appeler `export_service.generate_export()` existant avec les bons paramètres
3. Logger dans `exports_history.json`
4. Retourner le filename pour téléchargement

### 1.4 Endpoint téléchargement

```
GET /api/exports/download/{filename}
```

Sert le fichier depuis `data/exports/` avec `Content-Disposition: attachment`.

### 1.5 Endpoint batch ZIP

```
POST /api/exports/generate-batch
```

Body :
```json
{
  "year": 2026,
  "months": [1, 2, 3, 4, 5, 6],
  "format": "pdf"
}
```

Réponse :
```json
{
  "zip_filename": "Exports_Comptable_2026_20260408_143000.zip",
  "generated_count": 4,
  "already_existed": 2,
  "total": 6,
  "download_url": "/api/exports/download/Exports_Comptable_2026_20260408_143000.zip"
}
```

Logique : pour chaque mois, vérifier si l'export existe déjà (même format) → si non, générer → ZIP le tout.

### 1.6 Supprimer le format Excel

Dans `export_service.py` : supprimer toute logique Excel/XLSX. Ne garder que PDF et CSV.

### 1.7 Titre auto — helper Python

```python
MONTH_NAMES_FR = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
]

def build_export_title(year: int, month: int) -> str:
    return f"Toutes catégories — {MONTH_NAMES_FR[month - 1]} {year}"
```

## 2. Frontend

### 2.1 Types

Fichier : `frontend/src/types/index.ts`

```typescript
interface ExportMonthStatus {
  month: number;
  label: string;
  nb_operations: number;
  has_data: boolean;
  has_pdf: boolean;
  has_csv: boolean;
  last_pdf_filename: string | null;
  last_pdf_date: string | null;
  last_csv_filename: string | null;
  last_csv_date: string | null;
}

interface ExportYearStatus {
  year: number;
  months: ExportMonthStatus[];
}

interface GenerateMonthResponse {
  filename: string;
  title: string;
  nb_operations: number;
  generated: boolean;
  download_url: string;
}

interface GenerateBatchResponse {
  zip_filename: string;
  generated_count: number;
  already_existed: number;
  total: number;
  download_url: string;
}
```

### 2.2 Hooks

Fichier : `frontend/src/hooks/useExports.ts`

```typescript
// GET /api/exports/status/{year}
export function useExportStatus(year: number) {
  return useQuery<ExportYearStatus>({
    queryKey: ['export-status', year],
    queryFn: () => api.get(`/api/exports/status/${year}`).then(r => r.data),
  });
}

// POST /api/exports/generate-month
export function useGenerateMonthExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { year: number; month: number; format: 'pdf' | 'csv' }) =>
      api.post('/api/exports/generate-month', params).then(r => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['export-status', vars.year] });
    },
  });
}

// POST /api/exports/generate-batch
export function useGenerateBatchExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { year: number; months: number[]; format: 'pdf' | 'csv' }) =>
      api.post('/api/exports/generate-batch', params).then(r => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['export-status', vars.year] });
    },
  });
}
```

### 2.3 Composant ExportPage

Fichier : `frontend/src/pages/ExportPage.tsx`

**Réécriture complète** de la page.

#### Structure :

```
PageHeader — "Export comptable" + description
├── Sélecteur année (boutons 2024 / 2025 / 2026)
├── Barre actions :
│   ├── "Tout exporter PDF (ZIP)" — bouton vert
│   ├── "Tout exporter CSV (ZIP)" — bouton outline
│   └── Compteur : "N prêts · M à générer"
├── Grille 4×3 — ExportMonthCard ×12
└── Bandeau info bleu
```

#### Composant ExportMonthCard

Props : `month: ExportMonthStatus, year: number, onGenerate: (month, format) => void, isGenerating: boolean`

**3 états visuels :**

1. **Pas de données** (`has_data === false`) :
   - Opacité 0.35
   - Nom du mois + "Pas de données"
   - Non cliquable

2. **Données, export existe** (`has_data && has_pdf`) :
   - Badge vert "PDF" (et/ou "CSV")
   - `{nb_operations} opérations`
   - "Rapport prêt" en vert
   - Deux boutons PDF / CSV en bas

3. **Données, pas d'export** (`has_data && !has_pdf`) :
   - Badge ambre "à générer"
   - `{nb_operations} opérations`
   - "Clic = génère + télécharge" en ambre
   - Deux boutons PDF / CSV en bas (style info pour le format principal)

#### Comportement au clic sur PDF ou CSV :

```typescript
async function handleExport(month: number, format: 'pdf' | 'csv') {
  const result = await generateMonth.mutateAsync({ year, month, format });
  // Déclencher le téléchargement
  window.open(`/api/exports/download/${result.filename}`, '_blank');
  toast.success(result.generated
    ? `Export ${format.toUpperCase()} généré et téléchargé`
    : `Export ${format.toUpperCase()} téléchargé`
  );
}
```

#### Comportement "Tout exporter" :

```typescript
async function handleBatchExport(format: 'pdf' | 'csv') {
  const monthsWithData = months.filter(m => m.has_data).map(m => m.month);
  const result = await generateBatch.mutateAsync({ year, months: monthsWithData, format });
  window.open(`/api/exports/download/${result.zip_filename}`, '_blank');
  toast.success(`ZIP exporté : ${result.generated_count} générés, ${result.already_existed} existants`);
}
```

## 3. Ordre d'implémentation

1. `backend/services/export_service.py` — `_log_export()`, `get_exports_history()`, `get_month_export_status()`, `build_export_title()`, suppression XLSX
2. `backend/routers/exports_router.py` — `GET /status/{year}`, `POST /generate-month`, `GET /download/{filename}`, `POST /generate-batch`
3. `frontend/src/types/index.ts` — interfaces Export
4. `frontend/src/hooks/useExports.ts` — hooks TanStack Query
5. `frontend/src/pages/ExportPage.tsx` — réécriture complète

## 4. Vérification

- [ ] Clic PDF sur un mois sans export → génère + télécharge + badge passe à vert
- [ ] Clic PDF sur un mois avec export → télécharge directement (pas de re-génération)
- [ ] Clic CSV fonctionne indépendamment du PDF
- [ ] "Tout exporter PDF" → génère les manquants + ZIP
- [ ] Mois sans données grisés et non cliquables
- [ ] Sélecteur année change la grille
- [ ] `exports_history.json` se remplit correctement
- [ ] Format Excel supprimé partout (backend + frontend)
- [ ] Titre auto : `Toutes catégories — Mois Année`
- [ ] `npx tsc --noEmit` passe sans erreur
- [ ] Pas de régression sur `POST /api/exports/generate` (endpoint existant)
