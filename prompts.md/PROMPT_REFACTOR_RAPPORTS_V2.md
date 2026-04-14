# PROMPT — Refactoring Rapports V2 (optimisé)

## Pré-requis

Lire `CLAUDE.md` en premier. Le projet neuronXcompta V3 est une application comptable full-stack (React 19 + FastAPI) pour un médecin anesthésiste-réanimateur en SCP.

---

## Objectif

Transformer la page Rapports (`/reports`) en un module professionnel avec :
- Filtres élaborés (période, catégorie, sous-catégorie, type d'opération)
- Galerie organisée par année avec badges, titres évocateurs, preview/édition/suppression
- Templates de rapports prédéfinis (BNC annuel, ventilation charges, récapitulatif social)
- Formats financiers EUR conformes avec ligne totaux
- Déduplication intelligente à la génération

---

## Fichiers impactés

### Backend (créer/modifier)

| Fichier | Action |
|---------|--------|
| `backend/models/report.py` | **Créer** — schémas Pydantic |
| `backend/services/report_service.py` | **Refactorer** — index JSON, templates, format EUR, dédup |
| `backend/routers/reports.py` | **Refactorer** — 8 endpoints |
| `backend/assets/` | **Créer** — dossier avec logos PNG (lockup 400px, mark 64px) |

### Frontend (créer/modifier)

| Fichier | Action |
|---------|--------|
| `frontend/src/types/index.ts` | **Étendre** — types Report enrichis |
| `frontend/src/hooks/useReports.ts` | **Créer** — hooks TanStack Query dédiés |
| `frontend/src/components/reports/ReportsPage.tsx` | **Refactorer** — layout 2 onglets |
| `frontend/src/components/reports/ReportFilters.tsx` | **Créer** — panneau filtres avancés + template selector |
| `frontend/src/components/reports/ReportGallery.tsx` | **Créer** — galerie groupée par année |
| `frontend/src/components/reports/ReportPreviewDrawer.tsx` | **Créer** — drawer 800px preview + actions |

---

## 1. Modèles Backend — `backend/models/report.py`

```python
from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ReportFilters(BaseModel):
    categories: Optional[list[str]] = None
    subcategories: Optional[list[str]] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    year: Optional[int] = None
    quarter: Optional[int] = None
    month: Optional[int] = None
    type: Optional[str] = None          # "debit" | "credit" | "all"
    important_only: bool = False
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None


class ReportGenerateRequest(BaseModel):
    format: str = "pdf"                  # "pdf" | "csv" | "excel"
    title: Optional[str] = None          # auto-généré si absent
    description: Optional[str] = None
    filters: ReportFilters = ReportFilters()
    template_id: Optional[str] = None    # si basé sur un template


class ReportUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class ReportMetadata(BaseModel):
    filename: str
    title: str
    description: Optional[str] = None
    format: str                          # "pdf" | "csv" | "excel"
    generated_at: str                    # ISO datetime
    filters: ReportFilters
    template_id: Optional[str] = None
    nb_operations: int = 0
    total_debit: float = 0.0
    total_credit: float = 0.0
    file_size: int = 0
    file_size_human: str = ""
    year: Optional[int] = None           # déduit des filtres pour groupement
    quarter: Optional[int] = None
    month: Optional[int] = None


class ReportTemplate(BaseModel):
    id: str
    label: str
    description: str
    icon: str                            # nom icône Lucide
    format: str
    filters: ReportFilters


class GalleryResponse(BaseModel):
    reports: list[ReportMetadata]
    available_years: list[int]
    total_count: int
```

---

## 2. Service Backend — `backend/services/report_service.py`

### 2.1 Index JSON — `data/reports/reports_index.json`

Structure :

```json
{
  "version": 1,
  "reports": [
    {
      "filename": "rapport_sante_nov2024_20250520_143022.pdf",
      "title": "Santé — Novembre 2024",
      "description": null,
      "format": "pdf",
      "generated_at": "2025-05-20T14:30:22",
      "filters": { "categories": ["Santé"], "year": 2024, "month": 11 },
      "template_id": null,
      "nb_operations": 23,
      "total_debit": 4520.50,
      "total_credit": 0,
      "file_size": 45200,
      "file_size_human": "44.1 Ko",
      "year": 2024,
      "quarter": 4,
      "month": 11
    }
  ]
}
```

### 2.2 Réconciliation au boot

Au démarrage du service (appeler dans la fonction lifespan de `main.py` ou au premier appel `get_gallery`) :
1. Charger `reports_index.json` (créer vide si absent)
2. Lister les fichiers dans `data/reports/` (PDF, CSV, XLSX)
3. Supprimer les entrées d'index dont le fichier n'existe plus sur disque
4. Indexer les fichiers non référencés avec métadonnées basiques (titre = nom fichier nettoyé, format déduit de l'extension, taille fichier, date = mtime)
5. Sauvegarder l'index réconcilié
6. Logger le résultat (`"Reports index reconciled: {n} removed, {m} added"`)

### 2.3 Templates prédéfinis

Définir dans le service (constante, pas de fichier JSON séparé) :

```python
REPORT_TEMPLATES: list[dict] = [
    {
        "id": "bnc_annuel",
        "label": "Récapitulatif annuel BNC",
        "description": "Toutes les opérations de l'année — recettes et dépenses",
        "icon": "FileText",
        "format": "pdf",
        "filters": {
            "type": "all",
        }
        # year sera injecté au runtime (année en cours ou sélectionnée)
    },
    {
        "id": "ventilation_charges",
        "label": "Ventilation des charges",
        "description": "Dépenses par catégorie et sous-catégorie",
        "icon": "PieChart",
        "format": "excel",
        "filters": {
            "type": "debit",
        }
    },
    {
        "id": "recapitulatif_social",
        "label": "Récapitulatif social",
        "description": "Charges URSSAF, CARMF, ODM sur l'année",
        "icon": "Shield",
        "format": "pdf",
        "filters": {
            "categories": ["Charges sociales"],
            "type": "debit",
        }
    },
]
```

### 2.4 Titre auto-généré

Fonction `_generate_title(filters, template_id)` :

```
Logique :
- Si template_id → utiliser le label du template + année/période
  ex: "Récapitulatif annuel BNC — 2024"
- Si categories (une seule) → "{catégorie} — {période}"
  ex: "Santé — Novembre 2024"
- Si categories (plusieurs) → "{n} catégories — {période}"
  ex: "3 catégories — T3 2025"
- Sinon → "Toutes catégories — {période}"
  ex: "Toutes catégories — 2024"

Formatage période :
- year + month → "{MOIS_FR[month]} {year}" (ex: "Novembre 2024")
- year + quarter → "T{quarter} {year}" (ex: "T3 2025")
- year seul → "{year}" (ex: "2024")
- date_from + date_to → "{date_from} au {date_to}"
- rien → "Toutes périodes"
```

### 2.5 Déduplication à la génération

Avant de créer un nouveau rapport, calculer une **clé de déduplication** :

```python
dedup_key = (
    filters.year,
    filters.quarter,
    filters.month,
    filters.date_from,
    filters.date_to,
    tuple(sorted(filters.categories or [])),
    format
)
```

Si un rapport existant a la même clé :
- Supprimer l'ancien fichier disque + son entrée index
- Créer le nouveau normalement
- Ajouter `"replaced": "ancien_filename"` dans la réponse

### 2.6 Format financier EUR

#### PDF (ReportLab)

```python
def _format_eur(amount: float) -> str:
    """Format montant en EUR : 1 234,56 €"""
    if amount == 0:
        return "—"
    formatted = f"{abs(amount):,.2f}".replace(",", " ").replace(".", ",")
    sign = "-" if amount < 0 else ""
    return f"{sign}{formatted} €"
```

Structure du PDF :
- **En-tête avec logo** :
  - Logo PNG `logo_lockup_400.png` (40px de haut) aligné à gauche
  - Titre du rapport à droite du logo, 14pt bold, couleur `#811971`
  - Sous le titre : date de génération + filtres appliqués (texte gris 8pt compact)
  - Filet horizontal `#811971` (0.5pt) séparant l'en-tête du contenu
- **Tableau** : colonnes Date | Libellé | Catégorie | Sous-catégorie | Débit | Crédit
  - Montants alignés à droite, format `_format_eur()`
  - Alternance de couleur de fond (gris clair `#f5f5f5` / blanc) pour lisibilité
  - En-tête tableau : fond `#811971`, texte blanc, 9pt bold
  - Corps : Helvetica 8pt pour le tableau
- **Ligne totaux** : filet horizontal épais au-dessus, "TOTAUX" en gras, sommes débit/crédit en gras, fond `#f0e8ef`
- **Pied de page** : logo mark (16px) + "neuronXcompta — Page {n}/{total}" centré, 7pt gris

Code ReportLab pour l'en-tête :

```python
from reportlab.lib.utils import ImageReader
from reportlab.lib.units import mm
from pathlib import Path

LOGO_PATH = Path(__file__).parent.parent / "assets" / "logo_lockup_400.png"
LOGO_MARK_PATH = Path(__file__).parent.parent / "assets" / "logo_mark_64.png"
PRIMARY_COLOR = HexColor("#811971")

def _draw_header(canvas, doc, title: str, subtitle: str):
    """En-tête avec logo sur chaque page."""
    canvas.saveState()
    # Logo lockup (gauche)
    if LOGO_PATH.exists():
        logo = ImageReader(str(LOGO_PATH))
        # 400px wide original → 50mm wide at 40px height
        canvas.drawImage(logo, doc.leftMargin, doc.height + doc.topMargin - 8*mm,
                         width=50*mm, height=13*mm, preserveAspectRatio=True, mask='auto')
    # Titre (droite du logo)
    canvas.setFont("Helvetica-Bold", 14)
    canvas.setFillColor(PRIMARY_COLOR)
    canvas.drawString(doc.leftMargin + 55*mm, doc.height + doc.topMargin - 4*mm, title)
    # Sous-titre (filtres)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(HexColor("#888888"))
    canvas.drawString(doc.leftMargin + 55*mm, doc.height + doc.topMargin - 9*mm, subtitle)
    # Filet
    canvas.setStrokeColor(PRIMARY_COLOR)
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, doc.height + doc.topMargin - 12*mm,
                doc.width + doc.leftMargin, doc.height + doc.topMargin - 12*mm)
    canvas.restoreState()

def _draw_footer(canvas, doc):
    """Pied de page avec logo mark."""
    canvas.saveState()
    if LOGO_MARK_PATH.exists():
        mark = ImageReader(str(LOGO_MARK_PATH))
        canvas.drawImage(mark, doc.width/2 + doc.leftMargin - 20*mm, 8*mm,
                         width=4*mm, height=4*mm, preserveAspectRatio=True, mask='auto')
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(HexColor("#999999"))
    canvas.drawCentredString(doc.width/2 + doc.leftMargin,
                              8*mm, f"neuronXcompta — Page {canvas.getPageNumber()}")
    canvas.restoreState()
```

#### CSV

- Séparateur `;` (standard français)
- Décimal `,`
- En-tête : `Date;Libellé;Catégorie;Sous-catégorie;Débit;Crédit`
- Montants : nombre brut avec virgule décimale (ex: `1234,56`)
- Dernière ligne : `;TOTAUX;;;{total_debit};{total_credit}`
- Encodage : UTF-8 avec BOM (`\ufeff` en début de fichier pour Excel)

#### Excel (openpyxl)

- Onglet "Opérations" :
  - En-tête figé (freeze_panes = "A2")
  - Colonnes : Date | Libellé | Catégorie | Sous-catégorie | Débit | Crédit
  - Format nombre : `#,##0.00 €` (NumberFormat sur toutes les cellules montant)
  - Autofit largeur colonnes (`ws.column_dimensions[col].width = max_len + 2`)
  - Ligne totaux : formules `=SUM(E2:E{n})` et `=SUM(F2:F{n})`, fond gris, gras
- Onglet "Résumé" (si plus de 10 opérations) :
  - Tableau croisé par catégorie : Catégorie | Nb ops | Total Débit | Total Crédit | Solde
  - Même format nombre EUR

### 2.7 Nommage des fichiers

```python
# Pattern : rapport_{slug_title}_{timestamp}.{ext}
# slug_title : titre en minuscules, accents retirés, espaces → underscore, max 40 chars
import unicodedata, re

def _slugify(text: str, max_len: int = 40) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text.lower())
    text = re.sub(r"[\s-]+", "_", text).strip("_")
    return text[:max_len]

# Ex: "rapport_sante_novembre_2024_20250520_143022.pdf"
```

---

## 3. Router Backend — `backend/routers/reports.py`

8 endpoints :

### `GET /gallery`

Retourne la liste complète des rapports avec années disponibles.

```python
@router.get("/gallery")
async def get_gallery():
    reports = report_service.get_all_reports()  # depuis l'index, trié par generated_at desc
    years = sorted(set(r.year for r in reports if r.year), reverse=True)
    return {
        "reports": [r.dict() for r in reports],
        "available_years": years,
        "total_count": len(reports)
    }
```

### `GET /templates`

```python
@router.get("/templates")
async def get_templates():
    return report_service.get_templates()
```

### `POST /generate`

```python
@router.post("/generate")
async def generate_report(request: ReportGenerateRequest):
    result = report_service.generate_report(request)
    return result
    # Retourne : { "filename": "...", "title": "...", "replaced": null | "ancien.pdf" }
```

### `POST /{filename}/regenerate`

Régénère le rapport en gardant titre et description. Écrase le fichier en place.

```python
@router.post("/{filename}/regenerate")
async def regenerate_report(filename: str):
    result = report_service.regenerate_report(filename)
    return result
    # Retourne : { "filename": "...", "title": "...", "nb_operations": 42 }
```

### `PUT /{filename}`

Édite titre et/ou description dans l'index.

```python
@router.put("/{filename}")
async def update_report(filename: str, request: ReportUpdateRequest):
    updated = report_service.update_report_metadata(filename, request)
    return updated
```

### `GET /preview/{filename}`

Sert le fichier avec `Content-Disposition: inline` pour affichage iframe.

```python
@router.get("/preview/{filename}")
async def preview_report(filename: str):
    path = report_service.get_report_path(filename)
    if not path or not path.exists():
        raise HTTPException(404, "Rapport introuvable")
    media_type = {
        ".pdf": "application/pdf",
        ".csv": "text/csv",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }.get(path.suffix, "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={
        "Content-Disposition": f"inline; filename=\"{filename}\""
    })
```

### `GET /download/{filename}`

Sert le fichier avec `Content-Disposition: attachment`.

### `DELETE /{filename}`

Supprime le fichier disque + l'entrée dans l'index.

---

## 4. Types Frontend — `frontend/src/types/index.ts`

Ajouter :

```typescript
// --- Reports V2 ---

export interface ReportFilters {
  categories?: string[];
  subcategories?: string[];
  date_from?: string;
  date_to?: string;
  year?: number;
  quarter?: number;
  month?: number;
  type?: 'debit' | 'credit' | 'all';
  important_only?: boolean;
  min_amount?: number;
  max_amount?: number;
}

export interface ReportGenerateRequest {
  format: 'pdf' | 'csv' | 'excel';
  title?: string;
  description?: string;
  filters: ReportFilters;
  template_id?: string;
}

export interface ReportUpdateRequest {
  title?: string;
  description?: string;
}

export interface ReportMetadata {
  filename: string;
  title: string;
  description?: string;
  format: 'pdf' | 'csv' | 'excel';
  generated_at: string;
  filters: ReportFilters;
  template_id?: string;
  nb_operations: number;
  total_debit: number;
  total_credit: number;
  file_size: number;
  file_size_human: string;
  year?: number;
  quarter?: number;
  month?: number;
}

export interface ReportTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
  format: 'pdf' | 'csv' | 'excel';
  filters: ReportFilters;
}

export interface GalleryResponse {
  reports: ReportMetadata[];
  available_years: number[];
  total_count: number;
}
```

---

## 5. Hooks Frontend — `frontend/src/hooks/useReports.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  GalleryResponse,
  ReportTemplate,
  ReportGenerateRequest,
  ReportUpdateRequest,
} from '../types';

// Galerie complète (metadata + années dispo)
export function useReportsGallery() {
  return useQuery<GalleryResponse>({
    queryKey: ['reports-gallery'],
    queryFn: () => api.get('/reports/gallery'),
  });
}

// Templates prédéfinis
export function useReportTemplates() {
  return useQuery<ReportTemplate[]>({
    queryKey: ['reports-templates'],
    queryFn: () => api.get('/reports/templates'),
  });
}

// Générer un rapport
export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ReportGenerateRequest) =>
      api.post('/reports/generate', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] });
    },
  });
}

// Re-générer un rapport existant
export function useRegenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) =>
      api.post(`/reports/${filename}/regenerate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] });
    },
  });
}

// Modifier titre/description
export function useUpdateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, data }: { filename: string; data: ReportUpdateRequest }) =>
      api.put(`/reports/${filename}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] });
    },
  });
}

// Supprimer
export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) =>
      api.delete(`/reports/${filename}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] });
    },
  });
}
```

---

## 6. Composants Frontend

### 6.1 `ReportsPage.tsx` — Layout principal

```
┌── PageHeader ─────────────────────────────────────────────┐
│  Rapports                              [? aide contextuelle]│
└───────────────────────────────────────────────────────────┘

┌── Onglets ────────────────────────────────────────────────┐
│  [Générer]  [Bibliothèque (42)]                           │
└───────────────────────────────────────────────────────────┘

Onglet "Générer" :
  ┌── Templates rapides ──────────────────────────────────┐
  │  [📄 BNC Annuel]  [📊 Ventilation]  [🛡 Social]      │
  │  Un clic = filtres pré-remplis                         │
  └────────────────────────────────────────────────────────┘

  ┌── Filtres avancés (ReportFilters) ────────────────────┐
  │  Période: [Année ▾] [Trimestre ▾] [Mois ▾]           │
  │  OU : [Date début] → [Date fin]                       │
  │  Catégories: [Multi-select ▾]                          │
  │  Sous-catégories: [Multi-select ▾] (dépendant)        │
  │  Type: ○ Tout  ○ Dépenses  ○ Recettes                │
  │  Montant: [Min] → [Max]   ☐ Important uniquement      │
  │  Format: ○ PDF  ○ CSV  ○ Excel                        │
  │                                                        │
  │  [Générer le rapport]                                  │
  └────────────────────────────────────────────────────────┘

Onglet "Bibliothèque" :
  → ReportGallery (voir 6.3)
```

Comportement des onglets :
- State local `activeTab: 'generate' | 'library'`
- Badge sur "Bibliothèque" : nombre total de rapports
- Au succès d'une génération → basculer automatiquement sur l'onglet Bibliothèque + toast success
- Si la réponse contient `replaced` → toast info "Rapport précédent remplacé"

### 6.2 `ReportFilters.tsx` — Panneau de filtres

Props :
```typescript
interface ReportFiltersProps {
  filters: ReportFilters;
  onFiltersChange: (filters: ReportFilters) => void;
  format: 'pdf' | 'csv' | 'excel';
  onFormatChange: (format: 'pdf' | 'csv' | 'excel') => void;
  onGenerate: () => void;
  isGenerating: boolean;
}
```

Logique clé :
- Les catégories viennent de `useCategories()` (hook existant dans `useApi.ts`)
- Les sous-catégories se filtrent selon les catégories sélectionnées (même pattern que EditorPage)
- Le sélecteur de période propose année → trimestre → mois en cascade (même pattern que AlertesPage)
- Les sélecteurs "Période" et "Dates personnalisées" sont mutuellement exclusifs : remplir date_from/date_to vide année/trimestre/mois et vice-versa
- Bouton "Réinitialiser filtres" en petit texte en bas

Templates rapides (section au-dessus des filtres) :
```typescript
// Au clic sur un template :
const handleTemplateClick = (template: ReportTemplate) => {
  onFiltersChange({
    ...template.filters,
    year: template.filters.year || new Date().getFullYear(),
  });
  onFormatChange(template.format);
  // Optionnel : générer immédiatement
};
```

Chaque template = une carte compacte :
```tsx
<button
  className={cn(
    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
    "bg-surface border-border hover:border-primary/50"
  )}
  onClick={() => handleTemplateClick(template)}
>
  <Icon className="w-5 h-5 text-primary" />
  <div className="text-left">
    <div className="text-sm font-medium text-text">{template.label}</div>
    <div className="text-xs text-text-muted">{template.description}</div>
  </div>
</button>
```

### 6.3 `ReportGallery.tsx` — Bibliothèque par année

Props :
```typescript
interface ReportGalleryProps {
  onPreview: (report: ReportMetadata) => void;
}
```

Layout :
```
┌── Badges années ──────────────────────────────────────────┐
│  [2025 (18)]  [2024 (24)]  [Tous]                        │
└──────────────────────────────────────────────────────────┘

┌── Barre recherche + tri ─────────────────────────────────┐
│  🔍 [Rechercher...]           Tri: [Plus récent ▾]       │
└──────────────────────────────────────────────────────────┘

┌── Grille rapports ───────────────────────────────────────┐
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ 📄 PDF      │  │ 📊 Excel    │  │ 📄 PDF      │      │
│  │ Santé       │  │ Ventilation │  │ BNC Annuel  │      │
│  │ Nov 2024    │  │ T3 2025     │  │ 2024        │      │
│  │ 23 ops      │  │ 156 ops     │  │ 1024 ops    │      │
│  │ 4 520,50 €  │  │ 42 180 €    │  │ 320 000 €   │      │
│  │ 44 Ko       │  │ 128 Ko      │  │ 2,1 Mo      │      │
│  │             │  │             │  │             │      │
│  │ 20/05/2025  │  │ 15/06/2025  │  │ 02/01/2025  │      │
│  │ [👁][✏️][🗑]│  │ [👁][✏️][🗑]│  │ [👁][✏️][🗑]│      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
└──────────────────────────────────────────────────────────┘
```

Chaque carte :
- Icône format (PDF rouge, CSV vert, Excel bleu-vert) — en haut à gauche
- Badge template si `template_id` présent (ex: "BNC") — en haut à droite
- Titre (tronqué à 2 lignes)
- Métriques : nb_operations, total principal (débit ou crédit selon filtre type), taille fichier
- Date de génération en bas
- 3 boutons d'action : Aperçu (Eye), Éditer (Pencil), Supprimer (Trash2)

Filtre par année :
```typescript
const [selectedYear, setSelectedYear] = useState<number | null>(null);
const filteredReports = useMemo(() => {
  let result = gallery?.reports || [];
  if (selectedYear) result = result.filter(r => r.year === selectedYear);
  if (searchTerm) result = result.filter(r =>
    r.title.toLowerCase().includes(searchTerm.toLowerCase())
  );
  return result;
}, [gallery, selectedYear, searchTerm]);
```

Tri : par date (défaut, desc), par titre (alpha), par taille.

État vide : illustration simple + texte "Aucun rapport généré" + bouton "Générer un rapport" qui bascule sur l'onglet Générer.

### 6.4 `ReportPreviewDrawer.tsx` — Preview + actions

```
┌── Drawer 800px ────────────────────────────────────────────┐
│  ← Fermer        "Santé — Novembre 2024"       [···] menu │
│                                                             │
│  ┌─ Métadonnées ──────────────────────────────────────────┐│
│  │ Format: PDF  ·  Généré le: 20/05/2025 14:30           ││
│  │ 23 opérations  ·  Débit: 4 520,50 €  ·  Crédit: 0 €  ││
│  │ Filtres: Santé, Novembre 2024                          ││
│  │ Template: Récapitulatif social (si applicable)         ││
│  └────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─ Aperçu ──────────────────────────────────────────────┐│
│  │  [PDF] → iframe src="/api/reports/preview/{fn}"        ││
│  │  [CSV/Excel] → tableau HTML des 20 premières lignes    ││
│  │               + message "... et {n} lignes de plus"    ││
│  └────────────────────────────────────────────────────────┘│
│                                                             │
│  [📥 Télécharger]  [🔄 Re-générer]  [🗑 Supprimer]        │
└─────────────────────────────────────────────────────────────┘
```

Props :
```typescript
interface ReportPreviewDrawerProps {
  report: ReportMetadata | null;
  isOpen: boolean;
  onClose: () => void;
}
```

Actions :
- **Télécharger** : `window.open('/api/reports/download/{fn}')` (ouvre dans un nouvel onglet)
- **Re-générer** : appelle `useRegenerateReport` → toast success → rafraîchit les métadonnées
- **Supprimer** : confirmation modale → `useDeleteReport` → toast → ferme le drawer
- **Éditer** (dans le menu `···`) : modal simple avec titre + description → `useUpdateReport`

Modal d'édition (inline dans le drawer) :
```
┌── Modal ───────────────────────────┐
│  Modifier le rapport               │
│                                    │
│  Titre:                            │
│  [Santé — Novembre 2024         ]  │
│                                    │
│  Description:                      │
│  [                              ]  │
│  [                              ]  │
│                                    │
│  [Annuler]  [Enregistrer]          │
└────────────────────────────────────┘
```

---

## 7. Intégration avec l'existant

### 7.1 Registre dans `main.py`

Le router est déjà enregistré. S'assurer que la réconciliation de l'index est appelée au démarrage dans le lifespan :

```python
# Dans la fonction lifespan existante, ajouter :
from backend.services.report_service import reconcile_index
reconcile_index()
```

### 7.2 Config — `backend/core/config.py`

Ajouter si absent :
```python
REPORTS_DIR = DATA_DIR / "reports"
REPORTS_INDEX = REPORTS_DIR / "reports_index.json"
ASSETS_DIR = Path(__file__).parent.parent / "assets"
LOGO_LOCKUP = ASSETS_DIR / "logo_lockup_400.png"
LOGO_MARK = ASSETS_DIR / "logo_mark_64.png"
```

Et ajouter `REPORTS_DIR` dans `ensure_directories()`.

### 7.3 Fichiers logo — `backend/assets/`

Copier les fichiers suivants dans `backend/assets/` (créer le dossier) :

| Fichier | Usage | Dimensions |
|---------|-------|------------|
| `logo_lockup_400.png` | En-tête PDF (mark + wordmark) | 400×103px |
| `logo_mark_64.png` | Pied de page PDF, favicon | 64×64px |
| `logo_mark.svg` | Frontend sidebar, app icon | Vectoriel |
| `logo_mark_solid.svg` | Variante remplie (fond sombre) | Vectoriel |
| `logo_lockup.svg` | Version vectorielle complète | Vectoriel |

Les fichiers PNG sont utilisés par ReportLab (qui ne gère pas le SVG nativement).
Les fichiers SVG sont pour le frontend (sidebar, page login, etc.).

Le logo utilise la couleur primaire `#811971` et représente un cerveau-ampoule avec :
- Hémisphère gauche : nœuds neuronaux connectés (IA)
- Hémisphère droit : barres de graphique (comptabilité)
- Base : socle ampoule (intelligence appliquée)

### 7.4 Logo frontend — Sidebar

Optionnel mais recommandé : remplacer le titre texte de la sidebar par le logo SVG mark + texte :

```tsx
// Dans Sidebar.tsx, en haut
<div className="flex items-center gap-3 px-4 py-5">
  <img src="/logo_mark.svg" alt="" className="w-8 h-8" />
  <div>
    <div className="text-sm font-semibold text-text">neuronXcompta</div>
    <div className="text-[10px] text-text-muted tracking-wider">COMPTABILITÉ IA</div>
  </div>
</div>
```

Placer `logo_mark.svg` dans `frontend/public/`.

### 7.5 Route frontend — `App.tsx`

La route `/reports` existe déjà avec `ReportsPage`. Pas de changement de routing.

### 7.6 Sidebar

La page Rapports est déjà dans le groupe ANALYSE de la sidebar. Pas de changement.

---

## 8. Conventions à respecter

### Backend
- `from __future__ import annotations` dans tout fichier Python
- `Optional[X]` et non `X | None`
- Pydantic pour tous les schémas de requête/réponse
- `_sanitize_value()` sur les montants (gestion NaN)
- Utiliser `MOIS_FR` de `config.py` pour les noms de mois français

### Frontend
- TanStack Query : `useQuery` / `useMutation` / `useQueryClient`
- Tailwind classes uniquement, `cn()` pour conditionnels
- Lucide React pour les icônes
- `react-hot-toast` pour les notifications (`toast.success()`, `toast.error()`, `toast.info()` via `toast()`)
- `PageHeader` avec prop `actions` (pas children)
- Dark theme : `bg-background`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`
- Drawers : `fixed` + `translateX` + backdrop, pattern existant dans les autres drawers

### Icônes format

```tsx
import { FileText, Sheet, Table2 } from 'lucide-react';

const FORMAT_CONFIG = {
  pdf:   { icon: FileText, color: 'text-red-400',     label: 'PDF' },
  csv:   { icon: Sheet,    color: 'text-green-400',   label: 'CSV' },
  excel: { icon: Table2,   color: 'text-emerald-400', label: 'Excel' },
};
```

### Badge année

```tsx
<button
  className={cn(
    "px-3 py-1 rounded-full text-sm font-medium transition-colors",
    selectedYear === year
      ? "bg-primary text-white"
      : "bg-surface text-text-muted hover:bg-surface/80"
  )}
>
  {year}
  <span className="ml-1.5 text-xs opacity-70">({count})</span>
</button>
```

---

## 9. Ordre d'implémentation

1. `backend/models/report.py` — schémas Pydantic
2. `backend/core/config.py` — constantes REPORTS_DIR, REPORTS_INDEX
3. `backend/services/report_service.py` — index, réconciliation, templates, génération (PDF/CSV/Excel avec format EUR), déduplication, slugify, titre auto
4. `backend/routers/reports.py` — 8 endpoints
5. `backend/main.py` — appel réconciliation dans lifespan
6. `frontend/src/types/index.ts` — types Report V2
7. `frontend/src/hooks/useReports.ts` — hooks dédiés
8. `frontend/src/components/reports/ReportFilters.tsx`
9. `frontend/src/components/reports/ReportGallery.tsx`
10. `frontend/src/components/reports/ReportPreviewDrawer.tsx`
11. `frontend/src/components/reports/ReportsPage.tsx` — assemblage final

---

## 10. Checklist de vérification

Après implémentation, vérifier :

- [ ] `GET /reports/gallery` retourne la liste avec `available_years` déduits
- [ ] `GET /reports/templates` retourne les 3 templates prédéfinis
- [ ] Générer un rapport PDF → vérifier format EUR (`1 234,56 €`) et ligne totaux
- [ ] Générer un rapport CSV → ouvrir dans Excel → vérifier séparateur `;` et virgule décimale
- [ ] Générer un rapport Excel → vérifier format nombre `#,##0.00 €` et formules SUM
- [ ] Re-générer un rapport : même nom de fichier, titre conservé, contenu mis à jour
- [ ] Déduplication : générer 2x le même (même filtres/format) → vérifie qu'il n'y a pas de doublon
- [ ] Éditer titre + description → vérifier persistance après reload
- [ ] Supprimer un rapport → vérifier suppression fichier + index
- [ ] Preview PDF dans le drawer → iframe fonctionnel
- [ ] Preview CSV/Excel → tableau HTML des premières lignes
- [ ] Clic template → filtres pré-remplis
- [ ] Réconciliation au boot : ajouter manuellement un PDF dans `data/reports/` → vérifier qu'il apparaît dans la galerie après restart
- [ ] Dark mode : tous les composants respectent le thème
- [ ] Onglet Bibliothèque → filtre par année fonctionne
- [ ] Toast success après génération + bascule auto vers onglet Bibliothèque
- [ ] Toast info si rapport remplacé (déduplication)
- [ ] État vide de la galerie : message + bouton vers onglet Générer
- [ ] `from __future__ import annotations` dans tout fichier Python créé
- [ ] Pas de `any` dans le TypeScript
- [ ] Logo lockup visible en en-tête de chaque page PDF (400px, couleur `#811971`)
- [ ] Logo mark visible en pied de page PDF (16px à côté de "neuronXcompta")
- [ ] Fallback gracieux si fichiers logo absents (texte seul, pas de crash)
- [ ] Fichiers `backend/assets/logo_lockup_400.png` et `logo_mark_64.png` présents
