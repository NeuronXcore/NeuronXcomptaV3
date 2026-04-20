# Compta Analytique — Split Pro/Perso + Liasse fiscale SCP

## Contexte

Actuellement, `analytics_service.py` calcule `total_debit`, `total_credit` et `solde` sur **toutes** les opérations, perso compris. Résultat : le "Solde" affiché dans Compta Analytique et Dashboard n'est PAS le BNC — c'est une variation de trésorerie mixte pro+perso, et son signe est de surcroît inversé (charges − recettes au lieu de recettes − charges).

La règle fiscale réelle pour un médecin en SCP :

```
BNC = Recettes pro (quote-part SCP) − Charges pro déductibles
```

Les opérations perso (catégorie = "perso") sont **totalement hors assiette BNC** — ni ajoutées aux recettes, ni soustraites des charges. L'export comptable (`_prepare_export_operations`) fait déjà ce tri correctement ; cette règle doit devenir **source of truth unique** dans tout le backend et le frontend.

De plus, le CA bancaire crédité (somme des virements SCP reçus) n'est qu'un **proxy** du vrai CA fiscal — qui est celui déclaré sur la **liasse fiscale 2035 de la SCP** (ligne AG, quote-part). Écart habituel dû aux décalages de trésorerie (janv. N+1 rattaché à N), prélèvements SCP, régularisations.

Tant que la liasse n'est pas saisie : BNC **provisoire** basé sur les crédits bancaires.
Dès que la liasse est saisie : BNC **définitif** basé sur le CA liasse.

## Objectif

1. Corriger le calcul BNC dans `analytics_service.py` (exclusion perso + signe correct)
2. Exposer un modèle de données clair : `bnc` / `perso` / `attente` / `tresorerie`
3. Ajouter un nouveau type GED `liasse_fiscale_scp` + stockage annuel du CA déclaré
4. Drawer de saisie du CA liasse accessible depuis la GED + depuis un bandeau sur Compta Analytique
5. Refonte Compta Analytique : 3 KPIs (Recettes pro / Dépenses totales / BNC estimé) + ventilation dépenses Pro/Perso + segmented control Pro/Perso/Tout qui pilote tableaux **et** graphes
6. Dashboard : KPI "Recettes pro" utilise le CA liasse si disponible (badge `liasse`), sinon crédits bancaires (badge `provisoire`)

## Ordre d'implémentation

1. **Backend — modèle de données BNC**
2. **Backend — stockage liasse SCP**
3. **Backend — endpoints liasse**
4. **Frontend — hooks + types liasse**
5. **Frontend — drawer saisie CA liasse**
6. **Frontend — GED : type `liasse_fiscale_scp` + bouton "Saisir CA"**
7. **Frontend — refonte Compta Analytique**
8. **Frontend — Dashboard KPI Recettes pro**
9. **CLAUDE.md + CHANGELOG**

---

## 1. Backend — modèle de données BNC

### Fichier : `backend/services/analytics_service.py`

Introduire une fonction pivot utilisée par tous les endpoints :

```python
def _split_operations_by_nature(operations: list[dict]) -> dict:
    """
    Sépare les opérations en 3 groupes selon la logique fiscale BNC.

    Returns:
        {
            "pro": [...],       # catégorie valide ET != "perso"
            "perso": [...],     # catégorie.lower() == "perso"
            "attente": [...],   # vide, None, "Autres", "Ventilé" sans sous-lignes
        }

    Les opérations ventilées (categorie == "Ventilé") sont explosées en sous-lignes
    avant classification, chaque sous-ligne étant classée selon sa propre catégorie.
    Réutiliser `_explode_ventilations()` de `export_service.py` ou dupliquer la logique.
    """
```

Puis une fonction de calcul unifiée :

```python
def _compute_bnc_metrics(
    pro_ops: list[dict],
    perso_ops: list[dict],
    attente_ops: list[dict],
    ca_liasse: float | None = None,
) -> dict:
    """
    Calcule les métriques BNC à partir des 3 groupes.

    Règles :
    - recettes_pro_bancaires = somme crédits groupe "pro"
    - charges_pro = somme débits groupe "pro" - somme csg_non_deductible des ops URSSAF
    - recettes_pro = ca_liasse if ca_liasse else recettes_pro_bancaires
    - solde_bnc = recettes_pro - charges_pro  (signe POSITIF = bénéfice)
    - base_recettes = "liasse" | "bancaire"

    Returns:
        {
            "bnc": {
                "recettes_pro": float,
                "recettes_pro_bancaires": float,  # toujours exposé pour comparaison
                "ca_liasse": float | None,
                "base_recettes": "liasse" | "bancaire",
                "charges_pro": float,
                "solde_bnc": float,
                "nb_ops_pro": int,
            },
            "perso": {
                "total_debit": float,
                "total_credit": float,
                "nb_ops": int,
            },
            "attente": {
                "total_debit": float,
                "total_credit": float,
                "nb_ops": int,
            },
            "tresorerie": {
                "total_debit": float,   # tous groupes confondus
                "total_credit": float,
                "solde": float,         # credit - debit (signe correct)
                "nb_ops": int,
            },
        }
    """
```

### Modifier les endpoints existants

Dans `analytics_service.py` (et `backend/routers/analytics.py` si nécessaire) :

**`GET /api/analytics/dashboard`** — retourner la nouvelle structure en PLUS des champs existants (pour non-régression des consommateurs actuels). Ajouter :
- `bnc` : objet complet
- `perso` : objet complet
- `attente` : objet complet
- `tresorerie` : renommage du bloc actuel (total_debit / total_credit / solde) — garder aussi les champs plats pour compat
- `category_summary` : enrichir chaque entrée avec `nature: "pro" | "perso" | "attente"`

**`GET /api/analytics/summary`** — ajouter `nature` sur chaque catégorie + agrégats par nature.

**`GET /api/analytics/trends`** — retourner 3 séries mensuelles parallèles : `trends_pro`, `trends_perso`, `trends_all` (l'existant). Chacune avec `{ month, debit, credit }`.

**`GET /api/analytics/compare`** — ajouter sur chaque entrée `categories[]` le champ `nature`, et retourner les KPIs ventilés :
```json
{
  "period_a": { "bnc": {...}, "perso": {...}, "tresorerie": {...} },
  "period_b": { "bnc": {...}, "perso": {...}, "tresorerie": {...} },
  "delta": { "bnc_solde": ..., "recettes_pro": ..., "charges_pro": ..., "perso_debit": ... }
}
```

### Intégration CA liasse

Injecter `ca_liasse` depuis le service liasse (ci-dessous) quand `year` est fourni. Si `year is None` ou si pas de liasse pour cette année → `ca_liasse = None` → `base_recettes = "bancaire"`.

### Tests manuels à passer

Après implémentation, vérifier avec les données 2025 actuelles (recettes ≈ 386 447 €, dépenses totales ≈ 459 441 €) :

- `bnc.recettes_pro_bancaires` ≈ somme crédits ops non-perso non-attente
- `bnc.charges_pro` ≈ somme débits ops non-perso non-attente − CSG non déductible
- `bnc.solde_bnc` est **positif** (bénéfice) et égal à recettes_pro − charges_pro
- `perso.total_debit` + `bnc.charges_pro` + `attente.total_debit` ≈ 459 441 € (réconciliation trésorerie)
- `tresorerie.solde` = credit − debit (signe correct, peut être négatif si l'année est déficitaire en cash)

---

## 2. Backend — stockage liasse SCP

### Fichier : `backend/services/liasse_scp_service.py` (nouveau)

```python
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

DATA_DIR = Path("data/liasse_scp")
DATA_DIR.mkdir(parents=True, exist_ok=True)

def _path(year: int) -> Path:
    return DATA_DIR / f"liasse_{year}.json"

def get_liasse(year: int) -> dict | None:
    """Retourne la liasse pour une année, ou None si absente."""
    p = _path(year)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))

def save_liasse(year: int, ca_declare: float, ged_document_id: str | None = None, note: str | None = None) -> dict:
    """Sauvegarde/update la liasse. Écrase si existante."""
    payload = {
        "year": year,
        "ca_declare": float(ca_declare),
        "ged_document_id": ged_document_id,
        "note": note,
        "saved_at": datetime.now().isoformat(),
    }
    _path(year).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload

def delete_liasse(year: int) -> bool:
    p = _path(year)
    if p.exists():
        p.unlink()
        return True
    return False

def list_liasses() -> list[dict]:
    """Liste toutes les liasses stockées, triées par année DESC."""
    out = []
    for p in DATA_DIR.glob("liasse_*.json"):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    out.sort(key=lambda x: x.get("year", 0), reverse=True)
    return out

def get_ca_for_bnc(year: int) -> float | None:
    """Helper utilisé par analytics_service pour injection dans _compute_bnc_metrics."""
    liasse = get_liasse(year)
    return liasse["ca_declare"] if liasse else None
```

### Structure du fichier stocké

`data/liasse_scp/liasse_2025.json` :

```json
{
  "year": 2025,
  "ca_declare": 312580.00,
  "ged_document_id": "doc_abc123",
  "note": null,
  "saved_at": "2026-04-18T14:30:00"
}
```

---

## 3. Backend — endpoints liasse

### Fichier : `backend/routers/liasse_scp.py` (nouveau)

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services import liasse_scp_service, analytics_service

router = APIRouter(prefix="/api/liasse-scp", tags=["liasse-scp"])


class LiasseCreate(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    ca_declare: float = Field(..., gt=0)
    ged_document_id: str | None = None
    note: str | None = None


class LiasseComparator(BaseModel):
    year: int
    ca_liasse: float
    honoraires_bancaires: float
    ecart_absolu: float       # ca_liasse - honoraires_bancaires
    ecart_pct: float          # ecart_absolu / honoraires_bancaires * 100


@router.get("/")
def list_all():
    return liasse_scp_service.list_liasses()


@router.get("/{year}")
def get_year(year: int):
    liasse = liasse_scp_service.get_liasse(year)
    if not liasse:
        raise HTTPException(404, f"Aucune liasse pour {year}")
    return liasse


@router.post("/")
def upsert(payload: LiasseCreate):
    return liasse_scp_service.save_liasse(
        year=payload.year,
        ca_declare=payload.ca_declare,
        ged_document_id=payload.ged_document_id,
        note=payload.note,
    )


@router.delete("/{year}")
def delete(year: int):
    if not liasse_scp_service.delete_liasse(year):
        raise HTTPException(404, f"Aucune liasse pour {year}")
    return {"deleted": year}


@router.get("/{year}/comparator", response_model=LiasseComparator)
def comparator(year: int):
    """Compare CA liasse avec honoraires crédités bancaires de l'année."""
    liasse = liasse_scp_service.get_liasse(year)
    if not liasse:
        raise HTTPException(404, f"Aucune liasse pour {year}")

    # Récupère les recettes bancaires via analytics_service (année complète, pas de filtre)
    metrics = analytics_service.get_dashboard_metrics(year=year)
    honoraires_bancaires = metrics["bnc"]["recettes_pro_bancaires"]
    ca = liasse["ca_declare"]
    ecart = ca - honoraires_bancaires
    ecart_pct = (ecart / honoraires_bancaires * 100) if honoraires_bancaires else 0.0

    return LiasseComparator(
        year=year,
        ca_liasse=ca,
        honoraires_bancaires=honoraires_bancaires,
        ecart_absolu=ecart,
        ecart_pct=ecart_pct,
    )
```

Enregistrer le router dans `backend/main.py`.

### Référentiel GED — nouveau type

Dans le référentiel des types GED (fichier de config ou constantes selon l'existant — chercher où sont définis `facture`, `releve`, `rapport`, etc.), ajouter :

```python
"liasse_fiscale_scp": {
    "label": "Liasse fiscale SCP",
    "description": "Déclaration 2035 annuelle de la SCP (quote-part)",
    "icon": "FileText",
    "color": "amber",
}
```

Si la GED utilise du champ libre (datalist), s'assurer que `liasse_fiscale_scp` apparaît dans les suggestions.

---

## 4. Frontend — hooks + types liasse

### Fichier : `frontend/src/types/index.ts`

Ajouter :

```typescript
export interface LiasseScp {
  year: number;
  ca_declare: number;
  ged_document_id: string | null;
  note: string | null;
  saved_at: string;
}

export interface LiasseComparator {
  year: number;
  ca_liasse: number;
  honoraires_bancaires: number;
  ecart_absolu: number;
  ecart_pct: number;
}

// Nouveau — enrichir les types analytics existants
export interface BncMetrics {
  recettes_pro: number;
  recettes_pro_bancaires: number;
  ca_liasse: number | null;
  base_recettes: "liasse" | "bancaire";
  charges_pro: number;
  solde_bnc: number;
  nb_ops_pro: number;
}

export interface PersoMetrics {
  total_debit: number;
  total_credit: number;
  nb_ops: number;
}

export interface TresorerieMetrics {
  total_debit: number;
  total_credit: number;
  solde: number;
  nb_ops: number;
}
```

Sur `CategorySummary` existant, ajouter `nature?: "pro" | "perso" | "attente"`.

### Fichier : `frontend/src/hooks/useLiasseScp.ts` (nouveau)

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LiasseScp, LiasseComparator } from "@/types";

export function useLiasseScp(year: number | null) {
  return useQuery<LiasseScp | null>({
    queryKey: ["liasse-scp", year],
    queryFn: async () => {
      if (!year) return null;
      try {
        return await api.get(`/liasse-scp/${year}`);
      } catch (e: any) {
        if (e?.response?.status === 404) return null;
        throw e;
      }
    },
    enabled: year !== null,
  });
}

export function useLiasseList() {
  return useQuery<LiasseScp[]>({
    queryKey: ["liasse-scp", "list"],
    queryFn: () => api.get("/liasse-scp/"),
  });
}

export function useLiasseComparator(year: number | null, enabled: boolean) {
  return useQuery<LiasseComparator>({
    queryKey: ["liasse-scp", year, "comparator"],
    queryFn: () => api.get(`/liasse-scp/${year}/comparator`),
    enabled: enabled && year !== null,
  });
}

export function useSaveLiasse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { year: number; ca_declare: number; ged_document_id?: string; note?: string }) =>
      api.post("/liasse-scp/", data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["liasse-scp"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });  // KPIs se refont
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteLiasse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => api.delete(`/liasse-scp/${year}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["liasse-scp"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
```

---

## 5. Frontend — drawer saisie CA liasse

### Fichier : `frontend/src/components/liasse/LiasseScpDrawer.tsx` (nouveau)

Spécifications :

- **Overlay drawer** ~520px, slide depuis la droite, même système que les autres drawers (Radix ou custom selon stack actuel — s'aligner sur `VentilationDrawer` / `RapprochementWorkflowDrawer`)
- Header : label `Liasse fiscale SCP` + titre `Exercice {year}` + close button
- Section 1 — **Document GED** (si `ged_document_id` fourni) : card avec icône fichier + nom + date d'upload + bouton "Ouvrir" qui déclenche `subprocess open` côté backend (endpoint GED existant)
- Section 2 — **Input CA** : label `CA déclaré quote-part (ligne AG du 2035)`, input large (18px) avec format français (espaces milliers, virgule décimale), suffixe `€`
- Section 3 — **Comparateur** : card grise avec
  - Ligne "CA liasse SCP" + valeur
  - Ligne "Honoraires crédités en {year}" + valeur (tiré de `useLiasseComparator` — fetch live dès que l'input CA change, debounce 300ms, ou calculé côté client avec `honoraires_bancaires` fetché une fois)
  - Ligne "Écart" avec valeur absolue + pourcentage, couleur rouge si écart > 10%, orange si 5-10%, gris sinon
  - Hint info-box bleue : "Écart attendu : décalages de trésorerie (janv. N+1 rattaché à N), prélèvements SCP, régularisations. S'il reste inexpliqué, vérifier avec le comptable SCP."
- Footer : bouton `Annuler` + bouton violet `Valider le CA` (ou `Mettre à jour` si édition d'une liasse existante)
- Toast brandé à la validation (aligné sur le toast custom des charges forfaitaires)

### Résolution de l'année dans le drawer

L'année affichée / utilisée pour le stockage suit cette cascade de priorités :

1. **GED métadonnées** (priorité max) — si le document GED référencé a un champ année fiable :
   - Soit `gedDoc.year` si le champ existe
   - Soit l'année extraite de `gedDoc.date` (formats `YYYY-MM-DD`, `YYYY`)
   - Soit l'année extraite du nom de fichier via regex `/\b(20\d{2})\b/` (ex: `liasse_scp_2025.pdf` → 2025) **uniquement si l'extraction est non-ambiguë** (une seule occurrence YYYY entre 2000 et année courante)
2. **Store fiscal year global** (`useFiscalYearStore`) en fallback
3. **Selector éditable dans le drawer** — toujours présent, avec la valeur résolue pré-remplie ; l'utilisateur peut corriger avant de valider

Le selector est un `<select>` compact en haut du drawer, à côté du titre "Exercice", listant les 5 dernières années + 1 future. Quand l'utilisateur change l'année, les données rechargent (comparateur, liasse existante pour cette année si applicable).

**Règle critique** : la fonction `resolveLiasseYear(gedDoc, fiscalYearStore)` est pure et testable séparément, placée dans `frontend/src/lib/liasse-year-resolver.ts` :

```typescript
export function resolveLiasseYear(
  gedDoc: { year?: number; date?: string; filename?: string } | null,
  fallbackYear: number
): { year: number; source: "ged_year" | "ged_date" | "ged_filename" | "fiscal_store" } {
  if (gedDoc?.year && gedDoc.year >= 2000 && gedDoc.year <= new Date().getFullYear() + 1) {
    return { year: gedDoc.year, source: "ged_year" };
  }
  if (gedDoc?.date) {
    const match = gedDoc.date.match(/^(\d{4})/);
    if (match) {
      const y = parseInt(match[1], 10);
      if (y >= 2000 && y <= new Date().getFullYear() + 1) {
        return { year: y, source: "ged_date" };
      }
    }
  }
  if (gedDoc?.filename) {
    const matches = gedDoc.filename.match(/\b(20\d{2})\b/g);
    const currentYear = new Date().getFullYear();
    if (matches && matches.length === 1) {
      const y = parseInt(matches[0], 10);
      if (y >= 2000 && y <= currentYear + 1) {
        return { year: y, source: "ged_filename" };
      }
    }
  }
  return { year: fallbackYear, source: "fiscal_store" };
}
```

Dans le drawer, afficher une petite info-line à côté du selector quand la source n'est pas `fiscal_store` :
- `ged_year` / `ged_date` / `ged_filename` → pastille verte discrète `détecté depuis le document`
- `fiscal_store` → pas de pastille, ou pastille grise `année par défaut`

Si l'utilisateur change manuellement l'année dans le selector, masquer la pastille de détection (il reprend la main).

### Store Zustand pour ouvrir le drawer depuis n'importe où

`frontend/src/stores/liasseScpDrawerStore.ts` :

```typescript
import { create } from "zustand";

interface LiasseScpDrawerState {
  isOpen: boolean;
  initialYear: number | null;       // année résolue à l'ouverture (peut être corrigée dans le drawer)
  gedDocumentId: string | null;
  open: (initialYear: number, gedDocumentId?: string | null) => void;
  close: () => void;
}

export const useLiasseScpDrawerStore = create<LiasseScpDrawerState>((set) => ({
  isOpen: false,
  initialYear: null,
  gedDocumentId: null,
  open: (initialYear, gedDocumentId = null) => set({ isOpen: true, initialYear, gedDocumentId }),
  close: () => set({ isOpen: false }),
}));
```

Le caller (GED, bandeau Compta Analytique, badge Dashboard) calcule l'année résolue via `resolveLiasseYear()` et la passe à `open()`. Le drawer maintient ensuite sa propre state locale `year` initialisée depuis `initialYear`, modifiable via le selector.

Monter `<LiasseScpDrawer />` une seule fois dans `App.tsx` ou `Layout` (pattern des autres drawers globaux).

---

## 6. Frontend — GED : type `liasse_fiscale_scp` + bouton "Saisir CA"

### Fichier : `frontend/src/pages/GedPage.tsx` (ou équivalent)

- Ajouter `liasse_fiscale_scp` aux suggestions du champ type (datalist existant)
- Dans la grille / liste des documents : pour chaque document de type `liasse_fiscale_scp`, afficher un **bouton d'action secondaire "Saisir le CA"** (ou "Modifier le CA" si liasse déjà enregistrée pour l'année résolue) qui calcule l'année via `resolveLiasseYear(gedDoc, fiscalStoreYear)` puis ouvre le drawer via `useLiasseScpDrawerStore().open(resolvedYear, documentId)`
- L'utilisateur pourra toujours corriger l'année dans le drawer si la résolution est erronée
- Badge discret sur la card GED : `CA saisi : 312 580 €` (vert) ou `CA non saisi` (ambre) — affiché pour l'année résolue

### Dans le drawer détail GED (si existant)

Même bouton "Saisir le CA" en tête des actions quand `type === "liasse_fiscale_scp"`.

---

## 7. Frontend — refonte Compta Analytique

### Fichier : `frontend/src/pages/ComptaAnalytiquePage.tsx`

#### 7.1. Bandeau BNC provisoire / définitif

Au-dessus des KPIs, afficher conditionnellement :

- **Si `bnc.base_recettes === "bancaire"`** : bandeau ambre
  > ⚠ BNC provisoire — base définitive dès saisie du CA liasse fiscale SCP. Les crédits bancaires servent ici de proxy indicatif.
  > [Saisir le CA →]  (bouton qui ouvre le drawer avec l'année courante)

- **Si `bnc.base_recettes === "liasse"`** : bandeau vert discret
  > ✓ BNC définitif — base liasse fiscale SCP ({ca_liasse} €). Écart avec bancaire : {delta} € ({delta_pct} %).
  > [Modifier →]  (ouvre le drawer)

#### 7.2. Refonte des 3 KPI cards

Remplacer les KPIs actuels par :

1. **Recettes pro** — `bnc.recettes_pro` en grand, sous-label `crédits bancaires · provisoire` OU `liasse SCP · définitif` (selon `base_recettes`)
2. **Dépenses totales** — `bnc.charges_pro + perso.total_debit` en grand, sous-label `pro + perso confondus`
3. **BNC estimé** / **BNC** — `bnc.solde_bnc` en grand, couleur verte si positif, sous-label `recettes pro − charges pro`

Supprimer l'affichage "Solde" basé sur trésorerie brute dans les KPIs principaux (le rétrograder en info secondaire ou le supprimer).

#### 7.3. Card "Ventilation des dépenses"

Nouvelle card raised (bordure 0.5px, fond blanc, radius-lg) en dessous des KPIs :

- Header : "Ventilation des dépenses" + sous-titre année en cours
- Barre empilée horizontale 10px de haut :
  - Segment violet (`#7F77DD`) = pourcentage pro
  - Segment gris (`#B4B2A9`) = pourcentage perso
- Grid 2 colonnes sous la barre :
  - **Colonne Pro** : pastille violette + label `Pro déductible` + badge `dans le BNC` à droite ; grosse valeur ; ligne info `{pct}% · {nb_ops} ops` + liste courte des catégories principales
  - **Colonne Perso** : pastille grise + label `Perso` + badge `hors BNC` à droite ; grosse valeur ; ligne info `{pct}% · {nb_ops} ops` + liste courte des catégories principales

#### 7.4. Segmented control Pro / Perso / Tout

Nouveau composant `NatureFilter.tsx` (pill group 3 options) stocké dans un `useState` local de la page :

```typescript
type NatureFilter = "pro" | "perso" | "all";
const [natureFilter, setNatureFilter] = useState<NatureFilter>("pro");
```

**Propagation du filtre** — il doit piloter :

- ✅ Le tableau des catégories (filtrer par `nature === natureFilter` sauf si `"all"`)
- ✅ Le graphique bar chart mensuel (utiliser `trends_pro` / `trends_perso` / `trends_all` selon le filtre)
- ✅ Le comparatif A/B si le user est sur cet onglet (filtrer les catégories affichées par `nature`)
- ✅ Les 2 sous-graphiques recettes/dépenses du mode comparatif (même logique)

Placer le segmented control au-dessus du tableau des catégories et du graphe, ligne dédiée, petite précision à droite "le tableau et les graphes filtrent en conséquence".

Par défaut : **Pro** (c'est la vue utile pour l'exercice fiscal).

#### 7.5. CategoryDetailDrawer

Ajouter dans le header du drawer un badge nature : `pro` (violet) / `perso` (gris) / `attente` (ambre).

---

## 8. Frontend — Dashboard KPI Recettes pro

### Fichier : `frontend/src/pages/DashboardPage.tsx`

La card "Recettes" (ou équivalent) doit utiliser `bnc.recettes_pro` avec :

- Badge discret `liasse` (vert) si `base_recettes === "liasse"`
- Badge discret `provisoire` (ambre) si `base_recettes === "bancaire"`, cliquable → ouvre le drawer liasse

La sparkline BNC mensuelle reste basée sur les données mensuelles bancaires (seule granularité disponible — la liasse est annuelle).

Si la liasse est saisie, ajouter sur le chart annuel (bar chart recettes vs dépenses) une **ligne horizontale en pointillés** au niveau du CA liasse, avec label `CA liasse 312 580 €` — visualisation de l'écart.

---

## 9. CLAUDE.md + CHANGELOG

### CLAUDE.md

Ajouter une section **BNC — définition et source of truth** au début des règles fiscales, après le bloc URSSAF Déductible :

```markdown
- **BNC (définition fiscale unique)**: `BNC = recettes_pro − charges_pro_déductibles`. Les ops "perso" sont **hors assiette** (ni dans les recettes, ni dans les charges — elles ne réduisent PAS le BNC). `recettes_pro = CA liasse SCP` si la liasse de l'année est saisie (`data/liasse_scp/liasse_{year}.json`), sinon `recettes_pro = sum(crédits bancaires pro)` (proxy provisoire). `charges_pro = sum(débits bancaires pro) - sum(csg_non_deductible URSSAF)`. Source of truth : `analytics_service._split_operations_by_nature()` + `_compute_bnc_metrics()`. Cohérent avec `export_service._prepare_export_operations()`.
- **Liasse fiscale SCP**: Stockage `data/liasse_scp/liasse_{year}.json` avec `ca_declare`, `ged_document_id`, `note`, `saved_at`. Un fichier par exercice. Écriture via `liasse_scp_service.save_liasse()`. Type GED `liasse_fiscale_scp` pour le PDF scanné. Drawer `LiasseScpDrawer` accessible depuis : (a) bouton "Saisir le CA" sur la card GED du document, (b) bandeau BNC provisoire sur Compta Analytique, (c) badge provisoire du KPI Recettes pro sur le Dashboard. Résolution d'année via `resolveLiasseYear()` pure (priorité GED year > GED date > GED filename regex non-ambigu > fiscal store), toujours corrigeable via selector dans le drawer. Pastille discrète `détecté depuis le document` quand résolu depuis GED. Comparateur intégré : écart CA liasse − honoraires crédités bancaires avec seuil d'alerte (>10% rouge, 5-10% orange). Endpoints `/api/liasse-scp/*`. Store Zustand global `useLiasseScpDrawerStore`.
```

### CHANGELOG.md

Nouvelle entrée `### Added (2026-04-18) — Session NN` :

- Fix critique calcul BNC : exclusion systématique des ops perso dans `analytics_service.py`, signe du solde corrigé (recettes − charges)
- Modèle de données analytics enrichi : `bnc` / `perso` / `attente` / `tresorerie` avec `nature` sur chaque catégorie
- Module Liasse fiscale SCP : service, endpoints, stockage annuel, comparateur bancaire
- Drawer `LiasseScpDrawer` avec input CA + comparateur écart temps réel
- Type GED `liasse_fiscale_scp` + bouton "Saisir le CA" sur les documents
- Compta Analytique : refonte KPIs (Recettes pro / Dépenses totales / BNC estimé), card "Ventilation des dépenses" Pro/Perso avec barre empilée, segmented control Pro/Perso/Tout qui filtre tableaux ET graphes, bandeau BNC provisoire/définitif
- Dashboard : KPI Recettes pro basé sur CA liasse si dispo (badge `liasse`) sinon bancaire (badge `provisoire`), ligne horizontale CA liasse sur bar chart annuel

---

## Points d'attention

- **Non-régression** : tous les consommateurs actuels de `total_debit` / `total_credit` / `solde` doivent continuer à fonctionner. Garder ces champs plats en output, exposer la nouvelle structure en plus.
- **Ventilations** : les sous-lignes de ventilation doivent être classées individuellement (une op ventilée peut être partiellement pro, partiellement perso).
- **CSG non déductible** : la déduction sur `charges_pro` est déjà en place dans l'existant, mais s'assurer qu'elle n'est pas appliquée deux fois dans le nouveau pipeline.
- **Cache TanStack Query** : l'invalidation `["analytics"]` et `["dashboard"]` après save/delete liasse est essentielle — sinon KPIs désynchronisés.
- **Format numérique** : l'input CA doit accepter "312 580,00", "312580", "312580.00", "312 580.00" — tolérer les variations FR/EN, stocker en float.
- **Pas de CSS global modifié** — tout dans les composants nouveaux ou existants, classes Tailwind.
- **Pas de `any` TypeScript** — typer strictement via les nouveaux types ajoutés.
