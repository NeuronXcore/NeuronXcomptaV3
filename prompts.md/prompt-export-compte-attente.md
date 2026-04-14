# Export Compte d'Attente — PDF & CSV par mois/année

## Contexte

La page Compte d'attente (`/alertes`, `AlertesPage`) affiche les opérations en attente. On veut exporter ces opérations filtrées par mois ou année entière, en PDF et CSV. Les exports doivent apparaître dans la GED (rapports). L'Export Comptable existant doit aussi inclure le compte d'attente par défaut.

Logo : `backend/assets/logo_lockup_light.png` (même que l'export comptable).

### Convention de nommage

- **Par mois** : `compte_attente_janvier.pdf`, `compte_attente_janvier.csv`
- **Par année** : `compte_attente_2025.pdf`, `compte_attente_2025.csv`

---

## 1. Backend — Model (`backend/models/alerte.py`)

Ajouter (ou créer le fichier si inexistant) :

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional

class AlerteExportRequest(BaseModel):
    year: int
    month: Optional[int] = None  # None = année entière
    format: str  # "csv" | "pdf"

class AlerteExportResponse(BaseModel):
    filename: str
    nb_operations: int
    total_debit: float
    total_credit: float
```

---

## 2. Backend — Service (`backend/services/alerte_export_service.py`)

Nouveau service dédié.

### Nommage

```python
from backend.core.config import MOIS_FR

def _export_filename(year: int, month: Optional[int], ext: str) -> str:
    if month:
        mois_label = MOIS_FR[month - 1].lower()  # "janvier", "février"...
        return f"compte_attente_{mois_label}.{ext}"
    else:
        return f"compte_attente_{year}.{ext}"
```

### `export_compte_attente(year, month, format) -> dict`

- Collecter les opérations en attente : itérer sur les fichiers d'opérations de l'année (et mois si spécifié), filtrer `compte_attente == True` OU catégorie vide/None/"Autres"
- Trier par date croissante
- Générer CSV ou PDF selon `format`
- **Enregistrer dans la GED** via `ged_service` (voir section 4)
- Stocker le fichier dans `data/exports/`
- Retourner `AlerteExportResponse`

### Cas 0 opérations

Si aucune opération en attente pour la période demandée, **générer quand même** le fichier :
- CSV : header + ligne unique "Aucune opération en compte d'attente" + totaux à 0
- PDF : tableau vide avec mention "Aucune opération en compte d'attente pour cette période" centré, récapitulatif à 0

Cela sert de preuve pour le comptable que le mois est clean. Le `nb_operations` dans la réponse sera 0.

### `_generate_csv(operations, year, month) -> str`

Conventions Export V2 :
- Séparateur `;`, UTF-8 BOM (`\ufeff`), CRLF
- Montants format FR (`1 234,56`) — copier `_format_amount_fr()` depuis `export_service.py`
- Colonnes : `Date;Libellé;Catégorie;Sous-catégorie;Débit;Crédit;Type alerte;Commentaire`
- Ligne totaux en bas (total débit, total crédit, solde)
- Nommage via `_export_filename()`

### `_generate_pdf(operations, year, month) -> str`

ReportLab, même style que l'export comptable :
- **Logo** en haut à gauche : `backend/assets/logo_lockup_light.png`, hauteur ~30px
- **Titre** : "Compte d'Attente — Janvier 2025" ou "Compte d'Attente — Année 2025"
- **Sous-titre** : "Généré le {date}", nombre d'opérations
- **Tableau** 7 colonnes : Date | Libellé | Catégorie | Sous-cat | Débit | Crédit | Type alerte
  - Montants alignés droite, format FR
  - Alternance couleurs de fond
  - Header fond sombre
- **Récapitulatif** en bas : Total Débits, Total Crédits, Solde, Nombre d'opérations par type d'alerte
- **Footer** paginé : `Page X/Y` + date de génération
- Nommage via `_export_filename()`

---

## 3. Backend — Router (`backend/routers/alertes.py`)

Ajouter 2 endpoints dans le router existant :

### `POST /api/alertes/export`

Body : `AlerteExportRequest`. Appelle `alerte_export_service.export_compte_attente()`. Retourne `AlerteExportResponse`.

### `GET /api/alertes/export/download/{filename}`

`FileResponse` pour télécharger le fichier depuis `data/exports/`.

---

## 4. Intégration GED — Enregistrement automatique comme rapport

Chaque export généré doit être indexé dans la GED pour apparaître dans la bibliothèque de rapports.

Dans `alerte_export_service.py`, après génération du fichier :

```python
from backend.services.ged_service import ged_service

ged_service.register_document(
    file_path=output_path,
    doc_type="rapport",
    metadata={
        "report_type": "compte_attente",
        "year": year,
        "month": month,
        "format": ext,
        "generated_at": datetime.now().isoformat(),
        "nb_operations": len(operations),
    }
)
```

Vérifier le contrat exact de `ged_service` — reproduire le même pattern que `report_service` lors de la génération de rapports mensuels pour que le document apparaisse dans la vue GED `type=rapport`.

Si la GED utilise un `reports_index.json` séparé, y ajouter aussi l'entrée avec `report_type: "compte_attente"`.

### Déduplication à la régénération

Avant d'enregistrer dans la GED, vérifier si un document avec le même `report_type: "compte_attente"` + même `year` + même `month` + même `format` existe déjà. Si oui :
- **Écraser le fichier** sur disque (même nom de fichier = naturel)
- **Mettre à jour l'entrée GED existante** (updated_at, nb_operations, generated_at) plutôt que créer un doublon

Reproduire le pattern `find_duplicate_report` utilisé par le report_service si disponible. Sinon, filtrer `ged_metadata.json` par `report_type + year + month + format`.

---

## 5. Intégration Export Comptable — Checkbox précochée (PDF + CSV par défaut)

### Backend — Model d'export

Ajouter un champ au body de `POST /api/exports/generate` :

```python
include_compte_attente: bool = True   # ← NOUVEAU, défaut True
```

### Backend — `backend/services/export_service.py`

Dans la fonction de génération d'export, si `include_compte_attente` est True :
- Appeler `alerte_export_service.export_compte_attente(year, month, "pdf")`
- Appeler `alerte_export_service.export_compte_attente(year, month, "csv")`
- Ajouter les 2 fichiers (`compte_attente_{mois}.pdf` + `compte_attente_{mois}.csv`) dans l'archive ZIP

**Export annuel** : si l'export comptable est déclenché pour l'année entière (pas un mois unique), inclure un seul fichier `compte_attente_{année}.pdf` + `compte_attente_{année}.csv` (pas 12 fichiers mensuels). L'export annuel agrège toutes les opérations en attente de l'année.

### Frontend — `ExportPage`

Dans la zone d'options/checkboxes (à côté de justificatifs, relevé bancaire, rapports…), ajouter :

```tsx
<label className="flex items-center gap-2 cursor-pointer">
  <input
    type="checkbox"
    checked={includeCompteAttente}
    onChange={(e) => setIncludeCompteAttente(e.target.checked)}
    className="..."  // même style que les autres checkboxes
  />
  <span className="text-sm text-text">Compte d'attente</span>
</label>
```

- **Précochée par défaut** (state initial `true`)
- Positionnée au même niveau que les autres checkboxes existantes
- Passée dans le body `POST /api/exports/generate` comme `include_compte_attente`

---

## 6. Frontend — Type (`frontend/src/types/index.ts`)

```typescript
export interface AlerteExportResponse {
  filename: string;
  nb_operations: number;
  total_debit: number;
  total_credit: number;
}
```

Mettre à jour l'interface `ExportRequest` existante : ajouter `include_compte_attente?: boolean`.

---

## 7. Frontend — Hook (`frontend/src/hooks/useAlertes.ts`)

Ajouter :

```typescript
export function useExportCompteAttente() {
  return useMutation({
    mutationFn: async (params: { year: number; month?: number; format: 'csv' | 'pdf' }) => {
      const res = await api.post<AlerteExportResponse>('/api/alertes/export', params);
      return res;
    },
  });
}

export async function downloadCompteAttenteExport(filename: string) {
  const response = await fetch('/api/alertes/export/download/' + encodeURIComponent(filename));
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
```

---

## 8. Frontend — AlertesPage — Bouton export dropdown

Dans le `PageHeader` actions :

- Bouton "Exporter" avec icône `Download` (Lucide)
- Dropdown 4 options au clic :

```
  PDF — {Mois sélectionné}
  CSV — {Mois sélectionné}
  ─────────────────────────
  PDF — Année {YYYY}
  CSV — Année {YYYY}
```

- Icônes : `FileText` pour PDF, `FileSpreadsheet` pour CSV
- Pendant génération : spinner `Loader2` + bouton disabled
- Au succès : toast + téléchargement auto
- Fermeture dropdown : clic extérieur (useEffect + ref) ou après sélection

---

## 9. Mise à jour CLAUDE.md

Ajouter/mettre à jour les sections suivantes :

### Section Architecture — après "Export Comptable V2"

```
- **Export Compte d'Attente**: Export PDF/CSV des opérations en compte d'attente par mois ou année. Nommage `compte_attente_{mois}.{ext}` / `compte_attente_{année}.{ext}`. Enregistrement automatique dans la GED comme rapport (`report_type: "compte_attente"`). Déduplication à la régénération. Intégré dans l'Export Comptable via `include_compte_attente` (défaut True, génère PDF + CSV dans le ZIP). Cas 0 opérations : fichier généré quand même (preuve mois clean). Logo `logo_lockup_light.png`.
```

### Section API Reference — Alertes

Documenter les 2 nouveaux endpoints : `POST /api/alertes/export`, `GET /api/alertes/export/download/{filename}`.

### Section API Reference — Exports

Documenter le nouveau champ `include_compte_attente: bool = True` dans le body de `POST /api/exports/generate`.

---

## Ordre d'implémentation

1. Model (`backend/models/alerte.py`)
2. Service (`backend/services/alerte_export_service.py`)
3. Router (ajouts `backend/routers/alertes.py`)
4. Intégration GED (enregistrement + déduplication)
5. Intégration Export Comptable — backend (`include_compte_attente` + ajout ZIP)
6. Type frontend (`types/index.ts`)
7. Hook (`useAlertes.ts`)
8. AlertesPage — bouton export dropdown
9. ExportPage — checkbox précochée
10. CLAUDE.md — mise à jour documentation

## Checklist

- [ ] Nommage : `compte_attente_{mois_minuscule}.{ext}` et `compte_attente_{année}.{ext}`
- [ ] Logo `logo_lockup_light.png` chargé dans le PDF
- [ ] CSV : BOM UTF-8, séparateur `;`, CRLF, montants FR
- [ ] PDF : footer paginé `Page X/Y`, récapitulatif, alternance couleurs
- [ ] Export mois unique ET année entière fonctionnels
- [ ] Cas 0 opérations : fichier généré avec mention explicite
- [ ] Fichier enregistré dans la GED comme rapport (`report_type: "compte_attente"`)
- [ ] Déduplication GED : régénération écrase le fichier + met à jour l'entrée (pas de doublon)
- [ ] Export Comptable : `include_compte_attente` défaut `True`, génère **les 2 formats** (PDF + CSV) dans le ZIP
- [ ] Export Comptable annuel : un seul fichier `compte_attente_{année}` (pas 12 mensuels)
- [ ] ExportPage : checkbox "Compte d'attente" précochée, alignée avec les autres options
- [ ] Téléchargement auto après génération depuis AlertesPage
- [ ] Toast succès/erreur
- [ ] Dropdown ferme au clic extérieur ou après sélection
- [ ] Spinner pendant la génération
- [ ] CLAUDE.md mis à jour (architecture + API reference)
