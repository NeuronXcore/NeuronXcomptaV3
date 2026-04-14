# GED V2 — Hub documentaire unifié

> **Lire `CLAUDE.md` en premier** avant toute implémentation.

## Contexte

La GED actuelle (`/ged`) a 2 vues arbre (par année / par type). La bibliothèque rapports (`/reports` onglet Bibliothèque) est séparée avec sa propre navigation (triple vue année/catégorie/format, favoris, comparaison). L'objectif est d'unifier tout dans la GED avec 4 axes de navigation homogènes, et d'enrichir les metadata automatiquement aux points d'entrée existants.

## Vue d'ensemble des modifications

| Fichier | Action | Description |
|---------|--------|-------------|
| `backend/services/ged_service.py` | **Modifier** | Arbre 4 vues, enrichissement metadata, migration rapports, stats enrichies |
| `backend/routers/ged.py` | **Modifier** | Nouveaux filtres documents, endpoint pending-reports, stats enrichies |
| `backend/models/ged.py` | **Modifier** | Nouveaux champs metadata (categorie, fournisseur, period, rapport_meta, etc.) |
| `backend/services/rapprochement_service.py` | **Modifier** | Appel `enrich_metadata()` après association/dissociation |
| `backend/services/report_service.py` | **Modifier** | Appel `register_rapport()` après génération |
| `backend/services/operation_service.py` | **Modifier** | Propagation catégorie aux justificatifs liés au save |
| `backend/routers/reports.py` | **Modifier** | Supprimer endpoints gallery/tree, garder generate/preview/download/compare/favorite/pending |
| `frontend/src/components/ged/GedPage.tsx` | **Réécrire** | 4 onglets arbre, barre filtres croisés, cartes enrichies, drawer contextuel |
| `frontend/src/components/ged/GedTreePanel.tsx` | **Nouveau** | Panneau arbre 4 onglets avec compteurs |
| `frontend/src/components/ged/GedFilterBar.tsx` | **Nouveau** | Barre filtres croisés (période, catégorie, fournisseur, type, recherche) |
| `frontend/src/components/ged/GedDocumentCard.tsx` | **Nouveau** | Carte enrichie (thumbnail, catégorie badge, fournisseur, favori) |
| `frontend/src/components/ged/GedReportActions.tsx` | **Nouveau** | Actions contextuelles rapports (re-générer, comparer, favori, éditer titre) |
| `frontend/src/hooks/useGed.ts` | **Modifier** | Nouveaux hooks pour arbre 4 vues, filtres combinés, stats enrichies |
| `frontend/src/hooks/useReports.ts` | **Modifier** | Supprimer hooks gallery/tree, garder generate/compare/favorite/pending |
| `frontend/src/components/reports/ReportsPage.tsx` | **Modifier** | Supprimer onglet Bibliothèque, garder onglet Générer + bouton "Voir dans la GED" |
| `frontend/src/components/dashboard/DashboardPage.tsx` | **Modifier** | Liens rappels rapports → `/ged?type=rapport` |
| `frontend/src/components/cloture/CloturePage.tsx` | **Modifier** | Liens → `/ged?...` |
| `frontend/src/types/index.ts` | **Modifier** | Types GedDocument enrichis, GedTree 4 vues |

---

## Phase 1 — Backend : modèle et service GED enrichi

### 1.1 — Modèle `backend/models/ged.py`

Ajouter les champs au modèle `GedDocumentMeta` (ou équivalent) :

```python
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel

class PeriodInfo(BaseModel):
    year: int
    month: Optional[int] = None
    quarter: Optional[int] = None

class RapportMeta(BaseModel):
    template_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    filters: Optional[dict] = None
    format: Optional[str] = None  # pdf, csv, xlsx
    favorite: bool = False
    generated_at: Optional[str] = None
    can_regenerate: bool = True
    can_compare: bool = True

class GedDocumentMeta(BaseModel):
    doc_id: str
    type: str  # releve, justificatif, rapport, document_libre
    filename: str
    path: str
    size: Optional[int] = None
    added_at: Optional[str] = None
    # Champs enrichis (nouveaux)
    categorie: Optional[str] = None
    sous_categorie: Optional[str] = None
    fournisseur: Optional[str] = None
    date_document: Optional[str] = None
    date_operation: Optional[str] = None
    period: Optional[PeriodInfo] = None
    montant: Optional[float] = None
    ventilation_index: Optional[int] = None
    is_reconstitue: bool = False
    # Rapport (nouveau)
    rapport_meta: Optional[RapportMeta] = None
    # Existants
    poste_comptable: Optional[str] = None
    deductible_pct: Optional[int] = None
    montant_brut: Optional[float] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None
```

### 1.2 — Service `backend/services/ged_service.py`

#### Fonction `enrich_metadata_on_association()`

Appelée après chaque rapprochement (auto ou manuel). Reçoit le filename justificatif + les infos de l'opération associée.

```python
def enrich_metadata_on_association(
    justificatif_filename: str,
    operation_file: str,
    operation_index: int,
    categorie: str,
    sous_categorie: Optional[str],
    fournisseur: Optional[str],
    date_operation: str,
    montant: float,
    ventilation_index: Optional[int] = None
) -> None:
    """Enrichit le metadata GED du justificatif avec les infos de l'opération."""
    metadata = _load_metadata()
    doc_id = _find_doc_id_for_justificatif(metadata, justificatif_filename)
    if not doc_id:
        return
    
    doc = metadata[doc_id]
    doc["categorie"] = categorie
    doc["sous_categorie"] = sous_categorie
    doc["fournisseur"] = fournisseur
    doc["date_operation"] = date_operation
    doc["montant"] = montant
    doc["ventilation_index"] = ventilation_index
    
    # Calculer period depuis date_operation
    from datetime import datetime
    dt = datetime.strptime(date_operation, "%Y-%m-%d")
    doc["period"] = {
        "year": dt.year,
        "month": dt.month,
        "quarter": (dt.month - 1) // 3 + 1
    }
    
    _save_metadata(metadata)
```

#### Fonction `clear_metadata_on_dissociation()`

Appelée après dissociation. Reset les champs enrichis (mais garde `poste_comptable`, `tags`, `notes`).

```python
def clear_metadata_on_dissociation(justificatif_filename: str) -> None:
    metadata = _load_metadata()
    doc_id = _find_doc_id_for_justificatif(metadata, justificatif_filename)
    if not doc_id:
        return
    doc = metadata[doc_id]
    for field in ["categorie", "sous_categorie", "fournisseur", "date_operation", "montant", "ventilation_index"]:
        doc[field] = None
    # Garder period si date_document existe (sinon reset aussi)
    if not doc.get("date_document"):
        doc["period"] = None
    _save_metadata(metadata)
```

#### Fonction `register_rapport()`

Appelée après génération d'un rapport. Crée ou met à jour l'entrée GED.

```python
def register_rapport(
    filename: str,
    path: str,
    title: str,
    description: Optional[str],
    filters: dict,
    format_type: str,
    template_id: Optional[str] = None,
    replaced_filename: Optional[str] = None
) -> None:
    metadata = _load_metadata()
    
    # Supprimer ancien si remplacement (déduplication)
    if replaced_filename:
        old_id = f"rapports/{replaced_filename}"
        metadata.pop(old_id, None)
    
    doc_id = f"rapports/{filename}"
    
    # Déduire period depuis filters
    period = None
    if filters.get("year"):
        period = {
            "year": filters["year"],
            "month": filters.get("month"),
            "quarter": filters.get("quarter")
        }
    
    # Déduire categorie depuis filters
    categorie = None
    if filters.get("categories") and len(filters["categories"]) == 1:
        categorie = filters["categories"][0]
    
    metadata[doc_id] = {
        "doc_id": doc_id,
        "type": "rapport",
        "filename": filename,
        "path": path,
        "added_at": datetime.now().isoformat(),
        "categorie": categorie,
        "period": period,
        "rapport_meta": {
            "template_id": template_id,
            "title": title,
            "description": description,
            "filters": filters,
            "format": format_type,
            "favorite": False,
            "generated_at": datetime.now().isoformat(),
            "can_regenerate": True,
            "can_compare": True
        }
    }
    _save_metadata(metadata)
```

#### Fonction `propagate_category_change()`

Appelée au save éditeur quand une opération change de catégorie.

```python
def propagate_category_change(
    operation_file: str,
    operation_index: int,
    new_categorie: str,
    new_sous_categorie: Optional[str]
) -> None:
    """Propage le changement de catégorie aux justificatifs liés."""
    metadata = _load_metadata()
    for doc_id, doc in metadata.items():
        if doc.get("type") != "justificatif":
            continue
        # Matcher via le filename de l'opération et l'index
        # Il faut chercher dans les opérations pour trouver le lien
        # Alternative : stocker operation_ref dans le metadata
        # → Voir enrichissement ci-dessous
    _save_metadata(metadata)
```

**Important** : pour que `propagate_category_change` fonctionne, il faut aussi stocker `operation_ref` (file + index) dans le metadata au moment de l'association. Ajouter le champ :

```python
class GedDocumentMeta(BaseModel):
    # ... champs existants ...
    operation_ref: Optional[dict] = None  # {"file": "operations_xxx.json", "index": 5, "ventilation_index": null}
```

Et dans `enrich_metadata_on_association()`, ajouter :
```python
doc["operation_ref"] = {
    "file": operation_file,
    "index": operation_index,
    "ventilation_index": ventilation_index
}
```

Ainsi `propagate_category_change()` peut itérer sur les metadata et trouver les justificatifs liés par `operation_ref.file == operation_file and operation_ref.index == operation_index`.

#### Fonction `build_tree()` — refonte

Retourne 4 arbres au lieu de 2 :

```python
def build_tree() -> dict:
    metadata = _load_metadata()
    return {
        "by_period": _build_period_tree(metadata),
        "by_category": _build_category_tree(metadata),
        "by_vendor": _build_vendor_tree(metadata),
        "by_type": _build_type_tree(metadata)
    }
```

##### `_build_period_tree(metadata)`

```
année → trimestre → mois → documents (tous types mélangés)
```

- Grouper par `period.year` → `period.quarter` → `period.month`
- Les documents sans `period` vont dans un nœud "Non daté" en fin d'arbre
- Compteurs à chaque niveau (nb docs enfants récursif)
- ID nœuds : `period-{year}`, `period-{year}-T{q}`, `period-{year}-{month}`

##### `_build_category_tree(metadata)`

```
catégorie → sous-catégorie → documents
```

- Grouper par `categorie` → `sous_categorie`
- Nœud `"⚠ Non classés"` en tête pour docs sans catégorie (justificatifs en_attente non associés, docs libres sans poste mappé)
- Pour les documents libres avec `poste_comptable` mais sans `categorie` : mapper poste → catégorie via une table de correspondance (cf. section "Mapping poste → catégorie" ci-dessous)
- Les rapports multi-catégories (pas de filtre catégorie unique) vont dans un nœud "Rapports généraux"
- ID nœuds : `cat-{categorie}`, `cat-{categorie}-{sous_categorie}`

##### `_build_vendor_tree(metadata)`

```
fournisseur → année → documents
```

- Grouper par `fournisseur` → `period.year`
- Nœud `"Fournisseur inconnu"` pour docs sans fournisseur (hors relevés et rapports)
- Relevés et rapports **exclus** de cet arbre (pas de fournisseur pertinent)
- ID nœuds : `vendor-{fournisseur_slug}`, `vendor-{fournisseur_slug}-{year}`

##### `_build_type_tree(metadata)`

L'arbre actuel enrichi :

```
Relevés bancaires → année → mois
Justificatifs
├── En attente
└── Traités → année → mois
Rapports
├── PDF
├── CSV
└── Excel
Documents libres → année → mois
```

- Les rapports sont sous-groupés par format (`rapport_meta.format`)
- Les rapports favoris ont un flag `favorite: true` dans le nœud (le frontend les trie en premier)
- ID nœuds : conservent le pattern actuel pour rétrocompatibilité

#### Fonction `get_documents()` — filtres enrichis

Accepte les nouveaux paramètres de filtre :

```python
def get_documents(
    type: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    quarter: Optional[int] = None,
    categorie: Optional[str] = None,
    sous_categorie: Optional[str] = None,
    fournisseur: Optional[str] = None,
    format_type: Optional[str] = None,  # pdf, csv, xlsx (rapports)
    favorite: Optional[bool] = None,     # rapports favoris
    search: Optional[str] = None,
    tags: Optional[str] = None,
    poste_comptable: Optional[str] = None,
    sort_by: str = "added_at",
    sort_order: str = "desc"
) -> list[dict]:
```

**Recherche full-text enrichie** : en plus des champs existants (noms, tags, notes, OCR), chercher aussi dans `rapport_meta.title` et `rapport_meta.description`.

#### Fonction `get_stats()` — stats enrichies

Retourne les stats actuelles (par poste) **plus** :

```python
{
    # Existant
    "total_documents": 94,
    "total_brut": 5000.0,
    "total_deductible": 3500.0,
    "disk_size_human": "12.4 Mo",
    "par_poste": [...],
    # Nouveau
    "par_categorie": [
        {"categorie": "Charges sociales", "count": 23, "total_montant": 42000},
        {"categorie": "Véhicule", "count": 18, "total_montant": 15000},
        ...
    ],
    "par_fournisseur": [
        {"fournisseur": "URSSAF", "count": 12, "total_montant": 42000},
        {"fournisseur": "TotalEnergies", "count": 9, "total_montant": 3600},
        ...
    ],
    "par_type": {
        "releve": 26,
        "justificatif": 48,
        "rapport": 12,
        "document_libre": 8
    },
    "non_classes": 5,
    "rapports_favoris": 3
}
```

#### Fonction `migrate_reports_index()` — migration one-shot

Appelée au boot (dans `scan_all_sources()` ou séparément). Lit `data/reports/reports_index.json`, crée les entrées correspondantes dans `ged_metadata.json` avec `type: "rapport"` et `rapport_meta` rempli, puis renomme le fichier en `reports_index.json.migrated` pour ne pas le retraiter.

```python
def migrate_reports_index() -> int:
    """Migre les rapports de reports_index.json vers ged_metadata.json. Retourne le nb migrés."""
    index_path = REPORTS_DIR / "reports_index.json"
    if not index_path.exists():
        return 0
    
    migrated_path = index_path.with_suffix(".json.migrated")
    if migrated_path.exists():
        return 0  # Déjà migré
    
    with open(index_path) as f:
        reports_index = json.load(f)
    
    metadata = _load_metadata()
    count = 0
    
    for report in reports_index:
        doc_id = f"rapports/{report['filename']}"
        if doc_id in metadata:
            continue  # Déjà présent
        
        # Construire period
        period = None
        filters = report.get("filters", {})
        if filters.get("year"):
            period = {
                "year": filters["year"],
                "month": filters.get("month"),
                "quarter": filters.get("quarter")
            }
        
        categorie = None
        cats = filters.get("categories", [])
        if len(cats) == 1:
            categorie = cats[0]
        
        metadata[doc_id] = {
            "doc_id": doc_id,
            "type": "rapport",
            "filename": report["filename"],
            "path": str(REPORTS_DIR / report["filename"]),
            "added_at": report.get("created_at", report.get("generated_at")),
            "categorie": categorie,
            "period": period,
            "rapport_meta": {
                "template_id": report.get("template_id"),
                "title": report.get("title", report["filename"]),
                "description": report.get("description"),
                "filters": filters,
                "format": report.get("format", "pdf"),
                "favorite": report.get("favorite", False),
                "generated_at": report.get("generated_at"),
                "can_regenerate": True,
                "can_compare": True
            }
        }
        count += 1
    
    _save_metadata(metadata)
    
    # Renommer pour ne pas re-migrer
    index_path.rename(migrated_path)
    
    return count
```

Appeler `migrate_reports_index()` au début de `scan_all_sources()`.

#### Mapping poste_comptable → catégorie

Pour les documents libres qui ont un `poste_comptable` mais pas de `categorie`, ajouter une table de correspondance en constante :

```python
POSTE_TO_CATEGORIE = {
    "loyer-cabinet": ("Locaux", None),
    "vehicule": ("Véhicule", None),
    "telephone": ("Télécom", "Téléphone"),
    "internet": ("Télécom", "Internet"),
    "assurance-pro": ("Assurances", "RC Pro"),
    "assurance-vehicule": ("Véhicule", "Assurance"),
    "comptable": ("Honoraires", "Comptable"),
    "fournitures": ("Fournitures", None),
    "formation": ("Formation", "DPC"),
    "cotisation-ordre": ("Charges sociales", "ODM"),
    "charges-sociales": ("Charges sociales", None),
    "frais-bancaires": ("Frais bancaires", None),
    "repas": ("Frais de repas", None),
    "poste-courrier": ("Poste", None),
    "logiciel": ("Logiciel", None),
    "materiel": ("Matériel", None),
}
```

Utiliser ce mapping dans `_build_category_tree()` pour classer les documents libres qui ont un poste mais pas de catégorie.

### 1.3 — Endpoint `GET /api/ged/pending-reports`

Nouveau endpoint pour les rappels dashboard (remplace l'ancien `GET /api/reports/pending`).

Dans `backend/routers/ged.py` :

```python
@router.get("/pending-reports")
async def get_pending_reports(year: int = Query(...)):
    """Rapports mensuels/trimestriels non générés pour les mois passés."""
    return ged_service.get_pending_reports(year)
```

Dans `backend/services/ged_service.py` :

```python
def get_pending_reports(year: int) -> list[dict]:
    """Identifie les rapports mensuels/trimestriels manquants."""
    metadata = _load_metadata()
    
    # Rapports existants pour l'année
    existing = set()
    for doc_id, doc in metadata.items():
        if doc.get("type") != "rapport":
            continue
        rm = doc.get("rapport_meta")
        if not rm:
            continue
        period = doc.get("period", {})
        if period and period.get("year") == year:
            key = f"{rm.get('template_id', 'custom')}_{period.get('month', 'annual')}_{rm.get('format', 'pdf')}"
            existing.add(key)
    
    # Identifier les mois passés sans rapport mensuel
    from datetime import date
    today = date.today()
    pending = []
    for month in range(1, 13):
        if year > today.year or (year == today.year and month >= today.month):
            break
        key = f"bnc_annuel_{month}_pdf"
        if key not in existing:
            pending.append({
                "type": "mensuel",
                "year": year,
                "month": month,
                "label": f"Rapport mensuel — {MOIS_FR.get(month, '')} {year}"
            })
    
    return pending
```

### 1.4 — Router `backend/routers/ged.py` — modifications

Modifier `GET /api/ged/tree` pour retourner 4 arbres :

```python
@router.get("/tree")
async def get_tree():
    return ged_service.build_tree()  # { by_period, by_category, by_vendor, by_type }
```

Modifier `GET /api/ged/documents` pour accepter les nouveaux filtres :

```python
@router.get("/documents")
async def get_documents(
    type: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    quarter: Optional[int] = None,
    categorie: Optional[str] = None,
    sous_categorie: Optional[str] = None,
    fournisseur: Optional[str] = None,
    format_type: Optional[str] = None,
    favorite: Optional[bool] = None,
    search: Optional[str] = None,
    tags: Optional[str] = None,
    poste_comptable: Optional[str] = None,
    sort_by: str = "added_at",
    sort_order: str = "desc"
):
    return ged_service.get_documents(
        type=type, year=year, month=month, quarter=quarter,
        categorie=categorie, sous_categorie=sous_categorie,
        fournisseur=fournisseur, format_type=format_type,
        favorite=favorite, search=search, tags=tags,
        poste_comptable=poste_comptable,
        sort_by=sort_by, sort_order=sort_order
    )
```

Modifier `GET /api/ged/stats` pour retourner les stats enrichies (par_categorie, par_fournisseur, par_type).

Ajouter les endpoints rapports dans le router GED pour les actions spécifiques :

```python
@router.post("/documents/{doc_id:path}/favorite")
async def toggle_favorite(doc_id: str):
    """Toggle favori sur un rapport."""
    return ged_service.toggle_rapport_favorite(doc_id)

@router.post("/documents/{doc_id:path}/regenerate")
async def regenerate_rapport(doc_id: str):
    """Re-générer un rapport avec données actualisées."""
    return ged_service.regenerate_rapport(doc_id)

@router.post("/documents/compare-reports")
async def compare_reports(body: dict = Body(...)):
    """Compare 2 rapports. Body: { doc_id_a, doc_id_b }"""
    return ged_service.compare_reports(body["doc_id_a"], body["doc_id_b"])
```

Les fonctions `toggle_rapport_favorite`, `regenerate_rapport`, `compare_reports` dans `ged_service.py` délèguent à `report_service` pour la logique métier (génération, comparaison) et mettent à jour le metadata GED.

### 1.5 — Router `backend/routers/reports.py` — nettoyage

**Supprimer** les endpoints absorbés par la GED :
- `GET /gallery` → remplacé par `GET /api/ged/documents?type=rapport`
- `GET /tree` → remplacé par `GET /api/ged/tree` (nœud by_type > rapports)
- `POST /{filename}/favorite` → remplacé par `POST /api/ged/documents/{doc_id}/favorite`
- `POST /compare` → remplacé par `POST /api/ged/documents/compare-reports`
- `GET /pending` → remplacé par `GET /api/ged/pending-reports`
- `PUT /{filename}` (édition titre) → remplacé par `PATCH /api/ged/documents/{doc_id}`

**Conserver** :
- `GET /templates` — templates de génération
- `POST /generate` — génération (appelle `register_rapport()` en fin)
- `POST /{filename}/regenerate` — re-génération (met à jour metadata GED)
- `GET /preview/{filename}` — preview PDF inline
- `GET /download/{filename}` — téléchargement
- `DELETE /{filename}` — suppression (supprime aussi l'entrée GED)

### 1.6 — Intégrations rapprochement

Dans `backend/services/rapprochement_service.py`, après chaque association réussie (auto et manuel) :

```python
from backend.services import ged_service

# Après association dans associate_manual() et dans la boucle de run_auto()
# Charger l'opération pour récupérer les infos
operation = operations[operation_index]
ged_service.enrich_metadata_on_association(
    justificatif_filename=justificatif_filename,
    operation_file=operation_file,
    operation_index=operation_index,
    categorie=operation.get("Catégorie", ""),
    sous_categorie=operation.get("Sous-catégorie", ""),
    fournisseur=ocr_data.get("supplier", ""),
    date_operation=operation.get("Date", ""),
    montant=float(operation.get("Débit", 0) or operation.get("Crédit", 0)),
    ventilation_index=ventilation_index
)
```

Après dissociation :

```python
# Dans la logique de dissociation (justificatifs router ou rapprochement)
ged_service.clear_metadata_on_dissociation(justificatif_filename)
```

### 1.7 — Intégration report_service

Dans `backend/services/report_service.py`, à la fin de `generate_report()` :

```python
from backend.services import ged_service

# Après génération réussie du rapport
ged_service.register_rapport(
    filename=report_filename,
    path=str(report_path),
    title=title,
    description=description,
    filters=filters,
    format_type=format_type,
    template_id=template_id,
    replaced_filename=replaced_filename  # None si pas de déduplication
)
```

### 1.8 — Intégration save éditeur

Dans `backend/routers/operations.py`, dans le `PUT /{filename}` (save) :

```python
from backend.services import ged_service

# Après sauvegarde des opérations, propager les changements de catégorie
# Comparer old_operations vs new_operations
for idx, (old_op, new_op) in enumerate(zip(old_operations, operations)):
    old_cat = old_op.get("Catégorie", "")
    new_cat = new_op.get("Catégorie", "")
    if old_cat != new_cat and new_op.get("Lien justificatif"):
        ged_service.propagate_category_change(
            operation_file=filename,
            operation_index=idx,
            new_categorie=new_cat,
            new_sous_categorie=new_op.get("Sous-catégorie", "")
        )
```

### 1.9 — Intégration OCR upload

Dans les 3 points d'entrée OCR, après l'extraction, écrire `fournisseur`, `date_document`, `montant` dans le metadata GED si le document est déjà indexé :

```python
# Dans ocr_service ou justificatif_service, après OCR réussi
ged_service.enrich_metadata_on_ocr(
    justificatif_filename=filename,
    fournisseur=ocr_data.get("supplier"),
    date_document=ocr_data.get("best_date"),
    montant=ocr_data.get("best_amount"),
    is_reconstitue=filename.startswith("reconstitue_")
)
```

Ajouter `enrich_metadata_on_ocr()` dans `ged_service.py` :

```python
def enrich_metadata_on_ocr(
    justificatif_filename: str,
    fournisseur: Optional[str] = None,
    date_document: Optional[str] = None,
    montant: Optional[float] = None,
    is_reconstitue: bool = False
) -> None:
    metadata = _load_metadata()
    doc_id = _find_doc_id_for_justificatif(metadata, justificatif_filename)
    if not doc_id:
        return
    doc = metadata[doc_id]
    if fournisseur:
        doc["fournisseur"] = fournisseur
    if date_document:
        doc["date_document"] = date_document
        dt = datetime.strptime(date_document, "%Y-%m-%d")
        if not doc.get("period"):
            doc["period"] = {"year": dt.year, "month": dt.month, "quarter": (dt.month - 1) // 3 + 1}
    if montant:
        doc["montant"] = montant
    doc["is_reconstitue"] = is_reconstitue
    _save_metadata(metadata)
```

### 1.10 — Suppression rapport → nettoyage GED

Dans `backend/routers/reports.py`, `DELETE /{filename}` :

```python
# Après suppression du fichier rapport
ged_service.remove_document(f"rapports/{filename}")
```

---

## Phase 2 — Frontend : GED V2

### 2.1 — Types `frontend/src/types/index.ts`

Ajouter/modifier :

```typescript
export interface PeriodInfo {
  year: number;
  month?: number;
  quarter?: number;
}

export interface RapportMeta {
  template_id?: string;
  title?: string;
  description?: string;
  filters?: Record<string, any>;
  format?: string;
  favorite: boolean;
  generated_at?: string;
  can_regenerate: boolean;
  can_compare: boolean;
}

export interface GedDocument {
  doc_id: string;
  type: 'releve' | 'justificatif' | 'rapport' | 'document_libre';
  filename: string;
  path: string;
  size?: number;
  added_at?: string;
  // Enrichis
  categorie?: string;
  sous_categorie?: string;
  fournisseur?: string;
  date_document?: string;
  date_operation?: string;
  period?: PeriodInfo;
  montant?: number;
  ventilation_index?: number;
  is_reconstitue?: boolean;
  operation_ref?: { file: string; index: number; ventilation_index?: number };
  // Rapport
  rapport_meta?: RapportMeta;
  // Existants
  poste_comptable?: string;
  deductible_pct?: number;
  montant_brut?: number;
  tags?: string[];
  notes?: string;
}

export interface GedTreeNode {
  id: string;
  label: string;
  count: number;
  icon?: string;
  children?: GedTreeNode[];
  // Nouveau pour rapports favoris
  favorite?: boolean;
}

export interface GedTree {
  by_period: GedTreeNode[];
  by_category: GedTreeNode[];
  by_vendor: GedTreeNode[];
  by_type: GedTreeNode[];
}

export interface GedStats {
  total_documents: number;
  total_brut: number;
  total_deductible: number;
  disk_size_human: string;
  par_poste: Array<{ poste_id: string; poste_label: string; deductible_pct: number; nb_docs: number; total_brut: number; total_deductible: number }>;
  par_categorie: Array<{ categorie: string; count: number; total_montant: number }>;
  par_fournisseur: Array<{ fournisseur: string; count: number; total_montant: number }>;
  par_type: Record<string, number>;
  non_classes: number;
  rapports_favoris: number;
}

export interface GedFilters {
  type?: string;
  year?: number;
  month?: number;
  quarter?: number;
  categorie?: string;
  sous_categorie?: string;
  fournisseur?: string;
  format_type?: string;
  favorite?: boolean;
  search?: string;
  tags?: string;
  poste_comptable?: string;
  sort_by?: string;
  sort_order?: string;
}
```

### 2.2 — Hook `frontend/src/hooks/useGed.ts`

Ajouter les hooks manquants et modifier les existants :

```typescript
// Arbre 4 vues (remplace l'ancien useGedTree)
export function useGedTree() {
  return useQuery<GedTree>({
    queryKey: ['ged', 'tree'],
    queryFn: () => api.get('/ged/tree'),
  });
}

// Documents avec filtres enrichis
export function useGedDocuments(filters: GedFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v));
    }
  });
  return useQuery<GedDocument[]>({
    queryKey: ['ged', 'documents', filters],
    queryFn: () => api.get(`/ged/documents?${params.toString()}`),
  });
}

// Stats enrichies
export function useGedStats() {
  return useQuery<GedStats>({
    queryKey: ['ged', 'stats'],
    queryFn: () => api.get('/ged/stats'),
  });
}

// Pending reports (pour dashboard)
export function useGedPendingReports(year: number) {
  return useQuery({
    queryKey: ['ged', 'pending-reports', year],
    queryFn: () => api.get(`/ged/pending-reports?year=${year}`),
  });
}

// Toggle favori rapport
export function useToggleReportFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.post(`/ged/documents/${encodeURIComponent(docId)}/favorite`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged'] });
    },
  });
}

// Re-générer rapport
export function useRegenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.post(`/ged/documents/${encodeURIComponent(docId)}/regenerate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged'] });
    },
  });
}

// Comparer 2 rapports
export function useCompareReports() {
  return useMutation({
    mutationFn: (body: { doc_id_a: string; doc_id_b: string }) =>
      api.post('/ged/documents/compare-reports', body),
  });
}
```

### 2.3 — Composant `frontend/src/components/ged/GedTreePanel.tsx`

**Nouveau composant** — panneau arbre gauche avec 4 onglets.

```
Props: {
  tree: GedTree;
  activeTab: 'period' | 'category' | 'vendor' | 'type';
  onTabChange: (tab) => void;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string, filters: Partial<GedFilters>) => void;
}
```

Comportement :
- 4 onglets en haut : icônes Calendar / Tag / Building2 / FolderTree (Lucide)
- Arbre récursif expandable/collapsable (icônes ChevronRight/ChevronDown)
- Compteur badge à droite de chaque nœud
- Nœud sélectionné : `bg-primary/10 text-primary font-medium`
- Au clic sur un nœud, appeler `onNodeSelect` avec le `nodeId` et les filtres déduits :
  - Nœud `period-2026-T1` → `{ year: 2026, quarter: 1 }`
  - Nœud `cat-Véhicule-Carburant` → `{ categorie: "Véhicule", sous_categorie: "Carburant" }`
  - Nœud `vendor-urssaf-2026` → `{ fournisseur: "URSSAF", year: 2026 }`
  - Nœud `rapport-pdf` → `{ type: "rapport", format_type: "pdf" }`

### 2.4 — Composant `frontend/src/components/ged/GedFilterBar.tsx`

**Nouveau composant** — barre de filtres croisés.

```
Props: {
  filters: GedFilters;
  onFiltersChange: (filters: GedFilters) => void;
  stats: GedStats;  // pour les compteurs dans les dropdowns
}
```

Layout horizontal :
```
[Période ▼] [Catégorie ▼] [Fournisseur ▼] [Type ▼] [🔍 Recherche...] [✕ Réinitialiser]
```

- Chaque dropdown affiche les options avec compteur (`Véhicule (18)`)
- Le dropdown Période propose : Toutes, puis par année, puis par trimestre si année sélectionnée
- Badge sur chaque dropdown quand un filtre est actif
- Bouton reset visible quand au moins 1 filtre actif
- Les filtres sont synchronisés avec la sélection dans l'arbre (bidirectionnel) : un clic dans l'arbre met à jour les filtres, un changement dans la barre peut changer le nœud sélectionné

### 2.5 — Composant `frontend/src/components/ged/GedDocumentCard.tsx`

**Nouveau composant** — carte document enrichie (mode grille).

```
Props: {
  document: GedDocument;
  isSelected: boolean;  // pour sélection multiple (comparaison)
  onSelect: () => void;
  onClick: () => void;
}
```

Layout carte :
```
┌─────────────────────────┐
│ □ [checkbox sélection]  │  ← visible en mode comparaison rapports
│  [thumbnail PDF 160px]  │
│  ou icône type si pas    │
│  de thumbnail            │
├─────────────────────────┤
│ ⭐ Titre / Filename      │  ← étoile si rapport favori
│ 📊 PDF · 245 Ko          │  ← icône type + format + taille
│ 🏷 Charges sociales      │  ← badge catégorie couleur (via catégorie → couleur existante)
│ 🏢 URSSAF                │  ← fournisseur (texte muted)
│ 📅 Janvier 2026          │  ← période
│ 💰 3 500,00 €            │  ← montant si disponible
│ [RECONSTITUÉ]            │  ← badge ambre si is_reconstitue
└─────────────────────────┘
```

- Titre = `rapport_meta.title` pour les rapports, `filename` pour les autres
- Hover : ombre `shadow-lg`, bord `border-primary/30`
- Clic : ouvre le drawer contextuel

### 2.6 — Composant `frontend/src/components/ged/GedPage.tsx` — réécriture

Structure :

```tsx
export default function GedPage() {
  const { year } = useFiscalYearStore();
  const [activeTab, setActiveTab] = useState<'period' | 'category' | 'vendor' | 'type'>('period');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filters, setFilters] = useState<GedFilters>({});
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  
  const { data: tree } = useGedTree();
  const { data: documents } = useGedDocuments(filters);
  const { data: stats } = useGedStats();

  // Sync sélection arbre → filtres
  const handleNodeSelect = (nodeId: string, nodeFilters: Partial<GedFilters>) => {
    setSelectedNodeId(nodeId);
    setFilters(prev => ({ ...prev, ...nodeFilters }));
  };

  // Drawer contextuel selon type
  const selectedDoc = documents?.find(d => d.doc_id === selectedDocId);

  return (
    <div className="flex h-full">
      {/* Panneau arbre gauche — 260px */}
      <GedTreePanel
        tree={tree}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedNodeId={selectedNodeId}
        onNodeSelect={handleNodeSelect}
      />
      
      {/* Zone contenu */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <PageHeader
          title="Bibliothèque"
          description={`${stats?.total_documents ?? 0} documents`}
          actions={/* boutons upload, scan, toggle vue, comparaison */}
        />
        
        {/* Barre filtres */}
        <GedFilterBar
          filters={filters}
          onFiltersChange={setFilters}
          stats={stats}
        />
        
        {/* Contenu : grille ou liste */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4 overflow-y-auto">
            {documents?.map(doc => (
              <GedDocumentCard
                key={doc.doc_id}
                document={doc}
                isSelected={compareSelection.includes(doc.doc_id)}
                onSelect={() => /* toggle compareSelection */}
                onClick={() => setSelectedDocId(doc.doc_id)}
              />
            ))}
          </div>
        ) : (
          /* Tableau liste existant enrichi */
        )}
      </div>
      
      {/* Drawer contextuel */}
      {selectedDoc && (
        selectedDoc.type === 'rapport' ? (
          <GedReportDrawer
            document={selectedDoc}
            onClose={() => setSelectedDocId(null)}
          />
        ) : (
          <GedDocumentDrawer
            document={selectedDoc}
            onClose={() => setSelectedDocId(null)}
          />
        )
      )}
      
      {/* Drawer comparaison rapports */}
      {compareMode && compareSelection.length === 2 && (
        <GedReportCompareDrawer
          docIdA={compareSelection[0]}
          docIdB={compareSelection[1]}
          onClose={() => { setCompareMode(false); setCompareSelection([]); }}
        />
      )}
    </div>
  );
}
```

### 2.7 — Composant `frontend/src/components/ged/GedReportDrawer.tsx`

**Nouveau composant** — drawer rapport (absorbe `ReportPreviewDrawer`).

Largeur 800px, pattern translateX + backdrop. Contenu :

- Preview PDF iframe (identique à `ReportPreviewDrawer`)
- Section metadata : titre (éditable inline), description (éditable), template utilisé, filtres appliqués, date génération
- Boutons d'action :
  - ⭐ Favori (toggle)
  - 🔄 Re-générer (avec données actualisées)
  - 📥 Télécharger
  - 🗑 Supprimer
- Section fiscalité (poste comptable, déductibilité) — identique au drawer document classique
- Tags et notes

### 2.8 — Composant `frontend/src/components/ged/GedReportCompareDrawer.tsx`

**Nouveau composant** — absorbe `ReportCompareDrawer`.

Identique au drawer comparaison actuel, mais utilise les hooks GED au lieu des hooks rapports.

### 2.9 — Page `frontend/src/components/reports/ReportsPage.tsx` — simplification

Supprimer l'onglet "Bibliothèque". Garder uniquement :

- Section "Générer" (templates rapides + filtres avancés + formats)
- Bouton "Voir dans la bibliothèque →" qui navigue vers `/ged?type=rapport`
- Après génération réussie : toast avec lien "Voir dans la bibliothèque"

### 2.10 — Liens entrants — mise à jour

| Composant | Lien actuel | Nouveau lien |
|-----------|-------------|-------------|
| `DashboardPage.tsx` | Rappels rapports → `/reports` | → `/ged?type=rapport` |
| `DashboardPage.tsx` | Clic rapport rappel | → `/ged?type=rapport&year=X&month=Y` |
| `CloturePage.tsx` | Lien justificatifs/rapports | → `/ged?type=justificatif&year=X&month=Y` |
| `AlertesPage.tsx` | Lien justificatifs | → `/ged?type=justificatif` (si pertinent) |
| `PipelinePage.tsx` | Étape Justificatifs | → `/ged?type=justificatif&year=X&month=Y` (optionnel, vérifier) |

**Note** : La page `/ged` doit lire les query params au montage et initialiser les filtres en conséquence (via `useSearchParams`). Pattern :

```typescript
const [searchParams] = useSearchParams();
useEffect(() => {
  const initial: GedFilters = {};
  if (searchParams.get('type')) initial.type = searchParams.get('type')!;
  if (searchParams.get('year')) initial.year = parseInt(searchParams.get('year')!);
  if (searchParams.get('month')) initial.month = parseInt(searchParams.get('month')!);
  if (searchParams.get('categorie')) initial.categorie = searchParams.get('categorie')!;
  if (searchParams.get('fournisseur')) initial.fournisseur = searchParams.get('fournisseur')!;
  if (searchParams.get('format_type')) initial.format_type = searchParams.get('format_type')!;
  setFilters(initial);
  // Aussi sélectionner le bon onglet arbre
  if (initial.categorie) setActiveTab('category');
  else if (initial.fournisseur) setActiveTab('vendor');
  else if (initial.year) setActiveTab('period');
  else if (initial.type) setActiveTab('type');
}, []);
```

### 2.11 — Hook `frontend/src/hooks/useReports.ts` — nettoyage

**Supprimer** :
- `useReportGallery()`
- `useReportTree()`
- `useToggleReportFavorite()` (migré dans useGed)
- `useCompareReports()` (migré dans useGed)
- `usePendingReports()` (migré dans useGed)
- `useUpdateReport()` (édition titre/description → PATCH /api/ged/documents)

**Conserver** :
- `useReportTemplates()`
- `useGenerateReport()`
- `useRegenerateReport()` (optionnel, peut déléguer à useGed)
- `useDownloadReport()`
- `useDeleteReport()`

---

## Phase 3 — Nettoyage et mise à jour docs

### 3.1 — Fichiers à supprimer/nettoyer

- `frontend/src/components/reports/ReportPreviewDrawer.tsx` → logique absorbée par `GedReportDrawer.tsx`
- `frontend/src/components/reports/ReportCompareDrawer.tsx` → logique absorbée par `GedReportCompareDrawer.tsx`
- Les composants arbre rapport dans `reports/` qui ne sont plus utilisés

### 3.2 — Sidebar

Aucun changement de navigation. La page `/ged` reste sous DOCUMENTS > Bibliothèque (GED). La page `/reports` reste sous ANALYSE > Rapports (mais ne contient plus que la génération).

### 3.3 — Invalidation TanStack Query

Tous les mutations qui touchent les metadata GED doivent invalider `['ged']` :
- Association/dissociation justificatif
- Save éditeur (si changement catégorie)
- Génération rapport
- Suppression rapport
- Upload OCR / sandbox
- Toggle favori
- Modification metadata GED

---

## Ordre d'implémentation

1. **Backend modèle** : mettre à jour `models/ged.py` avec les nouveaux champs
2. **Backend service GED** : `enrich_metadata_on_association`, `clear_metadata_on_dissociation`, `register_rapport`, `propagate_category_change`, `enrich_metadata_on_ocr`, `migrate_reports_index`, `build_tree` 4 vues, `get_documents` filtres enrichis, `get_stats` enrichi, `get_pending_reports`, `toggle_rapport_favorite`, `regenerate_rapport`, `compare_reports`
3. **Backend intégrations** : brancher les appels dans `rapprochement_service`, `report_service`, `operations router`, `ocr_service`/`justificatif_service`/`sandbox_service`
4. **Backend router GED** : nouveaux endpoints, filtres enrichis
5. **Backend router reports** : supprimer endpoints migrés
6. **Frontend types** : `GedDocument`, `GedTree`, `GedStats`, `GedFilters`, `RapportMeta`
7. **Frontend hooks** : `useGed.ts` enrichi, `useReports.ts` nettoyé
8. **Frontend composants** : `GedTreePanel`, `GedFilterBar`, `GedDocumentCard`, `GedReportDrawer`, `GedReportCompareDrawer`
9. **Frontend GedPage** : réécriture complète
10. **Frontend ReportsPage** : suppression onglet Bibliothèque
11. **Frontend liens entrants** : Dashboard, Clôture, Pipeline, Alertes
12. **Nettoyage** : supprimer composants orphelins, mettre à jour CLAUDE.md

## Vérification

- [ ] `GET /api/ged/tree` retourne 4 arbres avec compteurs corrects
- [ ] `GET /api/ged/documents` filtre correctement par tous les axes
- [ ] Association justificatif enrichit le metadata (categorie, fournisseur, period)
- [ ] Dissociation reset les champs enrichis
- [ ] Génération rapport crée l'entrée GED avec rapport_meta
- [ ] Migration `reports_index.json` → `ged_metadata.json` fonctionne au boot
- [ ] Save éditeur propage les changements catégorie aux justificatifs liés
- [ ] OCR enrichit fournisseur, date_document, montant dans le metadata
- [ ] Badge "Reconstitué" visible sur les justificatifs `is_reconstitue`
- [ ] Arbre "Par catégorie" classe les docs libres via mapping poste → catégorie
- [ ] Arbre "Par fournisseur" exclut relevés et rapports
- [ ] Rapports favoris triés en premier dans la vue type > rapports
- [ ] Mode comparaison rapports fonctionne (sélection 2, drawer delta)
- [ ] Filtres croisés (arbre + barre) synchronisés bidirectionnellement
- [ ] Query params `/ged?type=rapport&year=2026` initialisent les filtres
- [ ] Dashboard rappels rapports utilisent `GET /api/ged/pending-reports`
- [ ] Liens CloturePage, AlertesPage, PipelinePage pointent vers `/ged?...`
- [ ] Recherche full-text inclut titres/descriptions rapports
- [ ] Stats incluent par_categorie, par_fournisseur, par_type
- [ ] Suppression rapport nettoie aussi l'entrée GED
- [ ] `reports_index.json` renommé en `.migrated` après migration
- [ ] Endpoints rapports supprimés (gallery, tree, favorite, compare, pending, PUT title) ne répondent plus
- [ ] Aucune régression sur les fonctionnalités GED existantes (upload, postes, thumbnails, search, open-native)
