# Prompt Claude Code — URSSAF : calcul automatique de la part déductible CSG/CRDS

## Contexte fiscal

Pour un médecin libéral BNC (PAMC/PAM), les cotisations URSSAF sont **quasi-intégralement déductibles**, à l'exception exclusive du bloc CSG/CRDS non déductible :

- CSG non déductible : **2,4 %**
- CRDS : **0,5 %**
- Total non déductible : **2,9 %** appliqué à l'assiette CSG/CRDS

**Assiette selon l'année :**
- ≤ 2024 : assiette = BNC + cotisations sociales obligatoires (URSSAF + CARMF estimés)
- ≥ 2025 : réforme — assiette unifiée = BNC × (1 − 26 %) = BNC × 0,74 (décret n° 2024-688 du 5 juillet 2024, effectif régularisation 2025 en 2026)

La part non déductible est stockée dans le champ `csg_non_deductible` de l'opération JSON et déduite du BNC charges dans les analytics.

---

## Étape 1 — Enrichir les barèmes JSON

### `data/baremes/urssaf_2024.json`

Ajouter au JSON existant la section `csg_crds` (merger avec l'existant, ne pas écraser les autres champs) :

```json
"csg_crds": {
  "taux_total": 0.097,
  "taux_deductible": 0.068,
  "taux_non_deductible": 0.029,
  "assiette_mode": "bnc_plus_cotisations",
  "assiette_abattement": null,
  "note": "CSG 6.8% déductible + CSG 2.4% + CRDS 0.5% non déductibles. Assiette = BNC + cotisations sociales obligatoires."
}
```

### Créer `data/baremes/urssaf_2025.json`

Copier `urssaf_2024.json` et modifier uniquement la section `csg_crds` :

```json
"csg_crds": {
  "taux_total": 0.097,
  "taux_deductible": 0.068,
  "taux_non_deductible": 0.029,
  "assiette_mode": "bnc_abattu",
  "assiette_abattement": 0.26,
  "note": "Réforme assiette sociale 2025 (décret 2024-688). Assiette unifiée = BNC × 74%. Effective pour régularisation 2025 traitée en 2026."
}
```

---

## Étape 2 — `backend/services/fiscal_service.py`

Ajouter la fonction suivante (avec `from __future__ import annotations`) :

```python
def compute_urssaf_deductible(
    montant_brut: float,
    bnc_estime: float,
    year: int,
    cotisations_sociales_estime: Optional[float] = None,
) -> dict:
    """
    Calcule la part déductible et non déductible d'une cotisation URSSAF brute.

    La seule part non déductible est la CSG non déductible (2,4%) + CRDS (0,5%) = 2,9%
    appliquée à l'assiette CSG/CRDS (dépend de l'année).

    Args:
        montant_brut: cotisation URSSAF totale payée (€)
        bnc_estime: BNC prévisionnel de l'année (€), issu de /api/simulation/historique
        year: année fiscale
        cotisations_sociales_estime: total cotisations sociales obligatoires estimées
            (URSSAF + CARMF + ODM). Requis si assiette_mode == "bnc_plus_cotisations".
            Si None, utilise bnc_estime × 0.25 comme fallback raisonnable.

    Returns:
        dict avec: montant_brut, assiette_csg_crds, part_non_deductible,
                   part_deductible, ratio_non_deductible, assiette_mode, year
    """
    bareme = _load_bareme("urssaf", year)
    csg = bareme.get("csg_crds", {
        "taux_non_deductible": 0.029,
        "assiette_mode": "bnc_plus_cotisations",
        "assiette_abattement": None,
    })

    taux_nd = csg.get("taux_non_deductible", 0.029)
    mode = csg.get("assiette_mode", "bnc_plus_cotisations")

    if mode == "bnc_abattu":
        abattement = csg.get("assiette_abattement", 0.26)
        assiette = bnc_estime * (1.0 - abattement)
    else:
        # bnc_plus_cotisations : assiette = BNC + cotis sociales obligatoires
        cotis = cotisations_sociales_estime if cotisations_sociales_estime is not None else bnc_estime * 0.25
        assiette = bnc_estime + cotis

    non_deductible = round(assiette * taux_nd, 2)
    # La part non déductible ne peut pas dépasser le montant brut
    non_deductible = min(non_deductible, montant_brut)
    deductible = round(montant_brut - non_deductible, 2)

    return {
        "year": year,
        "montant_brut": montant_brut,
        "assiette_csg_crds": round(assiette, 2),
        "assiette_mode": mode,
        "taux_non_deductible": taux_nd,
        "part_non_deductible": non_deductible,
        "part_deductible": deductible,
        "ratio_non_deductible": round(non_deductible / montant_brut, 4) if montant_brut else 0.0,
        "bnc_estime_utilise": bnc_estime,
        "cotisations_sociales_utilisees": cotisations_sociales_estime,
    }
```

---

## Étape 3 — `backend/models/simulation.py`

Ajouter les modèles Pydantic :

```python
class UrssafDeductibleRequest(BaseModel):
    montant_brut: float
    bnc_estime: float
    year: int = 2024
    cotisations_sociales_estime: Optional[float] = None

class UrssafDeductibleResult(BaseModel):
    year: int
    montant_brut: float
    assiette_csg_crds: float
    assiette_mode: str  # "bnc_plus_cotisations" | "bnc_abattu"
    taux_non_deductible: float
    part_non_deductible: float
    part_deductible: float
    ratio_non_deductible: float
    bnc_estime_utilise: float
    cotisations_sociales_utilisees: Optional[float]
```

---

## Étape 4 — `backend/routers/simulation.py`

Ajouter l'endpoint sous le préfixe `/api/simulation` :

```python
@router.post("/urssaf-deductible", response_model=UrssafDeductibleResult)
def compute_urssaf_deductible_endpoint(body: UrssafDeductibleRequest):
    """
    Calcule la part déductible et non déductible d'une cotisation URSSAF brute.
    Utilise les barèmes versionnés. Aucun effet de bord.
    """
    result = fiscal_service.compute_urssaf_deductible(
        montant_brut=body.montant_brut,
        bnc_estime=body.bnc_estime,
        year=body.year,
        cotisations_sociales_estime=body.cotisations_sociales_estime,
    )
    return result
```

---

## Étape 5 — Champ `csg_non_deductible` dans les opérations

### `backend/services/operation_service.py`

La structure opération JSON accepte déjà des champs additionnels (dict libre). Ajouter un endpoint PATCH dédié pour stocker la valeur calculée sur une opération spécifique.

### `backend/routers/operations.py`

```python
class CsgSplitUpdate(BaseModel):
    csg_non_deductible: Optional[float]  # None = effacer le split

@router.patch("/{filename}/{index}/csg-split")
def update_csg_split(filename: str, index: int, body: CsgSplitUpdate):
    """
    Stocke (ou efface) la part CSG/CRDS non déductible calculée sur une opération.
    Champ: csg_non_deductible (float ou null).
    """
    ops = operation_service.load_operations(filename)
    if index < 0 or index >= len(ops):
        raise HTTPException(404, "Opération introuvable")
    if body.csg_non_deductible is None:
        ops[index].pop("csg_non_deductible", None)
    else:
        ops[index]["csg_non_deductible"] = body.csg_non_deductible
    operation_service.save_operations(filename, ops)
    return {"ok": True, "csg_non_deductible": body.csg_non_deductible}
```

---

## Étape 6 — Analytics : déduire `csg_non_deductible` du BNC

### `backend/services/analytics_service.py`

Dans la fonction qui calcule les charges déductibles BNC (utilisée par `/api/analytics/summary`, `/api/analytics/year-overview`, et la clôture) :

Lors du calcul des `charges_deductibles`, pour chaque opération de charges professionnelles :

```python
# Déduire la part CSG/CRDS non déductible si renseignée
montant_effectif = op.get("Montant", 0.0)
csg_nd = op.get("csg_non_deductible")
if csg_nd and isinstance(csg_nd, (int, float)) and csg_nd > 0:
    montant_effectif = montant_effectif - csg_nd  # retire la part non déductible
charges_deductibles += montant_effectif
```

> Note : appliquer uniquement sur les opérations de **charges** (Montant < 0 ou sens débit selon convention), catégorie non "Perso", non "Ventilé" (itérer sur sous-lignes à la place).

---

## Étape 7 — Frontend : composant `UrssafSplitWidget`

### Détection des opérations URSSAF

Une opération est considérée "URSSAF" si :
```typescript
const isUrssafOp = (op: Operation): boolean => {
  const libelle = (op["Libellé"] || "").toLowerCase()
  const cat = (op["Catégorie"] || "").toLowerCase()
  const sous = (op["Sous-catégorie"] || "").toLowerCase()
  return (
    libelle.includes("urssaf") ||
    libelle.includes("dspamc") ||
    libelle.includes("cotis") ||
    (cat.includes("cotisations") && sous.includes("urssaf"))
  )
}
```

### `frontend/src/components/editor/UrssafSplitWidget.tsx`

Composant inline affiché dans la ligne opération de l'EditorPage (colonne supplémentaire ou tooltip) pour les opérations URSSAF. S'affiche uniquement si l'op est détectée comme URSSAF.

**Props :**
```typescript
interface UrssafSplitWidgetProps {
  op: Operation
  filename: string
  index: number
  year: number
  bnc_estime: number         // issu de useSimulation hook (historique)
  onSplitSaved: () => void   // invalide le cache opérations
}
```

**Comportement :**
1. Affiche un badge violet compact `≈ X € déd.` si `csg_non_deductible` déjà stocké sur l'op
2. Si non calculé : bouton `Calculer ⚡` (icône `Zap` de Lucide)
3. Au clic → appel `POST /api/simulation/urssaf-deductible` avec le montant de l'op + bnc_estime + year
4. Affiche le résultat dans un petit popover :
   ```
   Cotisation brute      1 200,00 €
   ├── Part déductible   1 043,50 €
   └── CSG/CRDS non déd.   156,50 €  ← rouge/ambre
   Assiette estimée     54 000,00 €  (BNC × 74%)  [ℹ️ tooltip réforme 2025]
   [Appliquer]  [Annuler]
   ```
5. `[Appliquer]` → `PATCH /api/operations/{filename}/{index}/csg-split` avec `{ csg_non_deductible: 156.50 }` → toast succès → `onSplitSaved()`
6. Badge passe à `156,50 € non déd.` en rouge pâle. Badge cliquable pour recalculer.

**Style :** dark theme CSS variables, composant compact (ne pas casser la grille de l'EditorPage).

### Intégration dans `EditorPage`

Dans le composant de ligne opération (ou la colonne Catégorie / colonne actions) :
- Si `isUrssafOp(op)` : afficher `<UrssafSplitWidget ... />`
- Passer `bnc_estime` depuis `useQuery` sur `/api/simulation/historique` (déjà utilisé dans SimulationPage, mutualiser via hook `useSimulation`)
- `onSplitSaved` → invalide TanStack Query key `['operations', filename]`

---

## Étape 8 — Hook `useUrssafSplit`

### `frontend/src/hooks/useSimulation.ts`

Ajouter dans le fichier existant :

```typescript
// Compute URSSAF deductible split (no cache — mutation sémantique)
export function useUrssafDeductible() {
  return useMutation({
    mutationFn: (body: {
      montant_brut: number
      bnc_estime: number
      year: number
      cotisations_sociales_estime?: number
    }) => api.post<UrssafDeductibleResult>('/simulation/urssaf-deductible', body),
  })
}

// Patch CSG split on an operation
export function usePatchCsgSplit(filename: string, index: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (csg_non_deductible: number | null) =>
      api.patch(`/operations/${filename}/${index}/csg-split`, { csg_non_deductible }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
    },
  })
}
```

### `frontend/src/types/index.ts`

Ajouter :

```typescript
export interface UrssafDeductibleResult {
  year: number
  montant_brut: number
  assiette_csg_crds: number
  assiette_mode: 'bnc_plus_cotisations' | 'bnc_abattu'
  taux_non_deductible: number
  part_non_deductible: number
  part_deductible: number
  ratio_non_deductible: number
  bnc_estime_utilise: number
  cotisations_sociales_utilisees: number | null
}
```

Et dans le type `Operation` (si typé) ajouter :
```typescript
csg_non_deductible?: number
```

---

## Checklist de vérification

- [ ] `data/baremes/urssaf_2024.json` contient la section `csg_crds` sans écraser les champs existants
- [ ] `data/baremes/urssaf_2025.json` créé avec `assiette_mode: "bnc_abattu"`
- [ ] `POST /api/simulation/urssaf-deductible` répond 200 avec les champs attendus
- [ ] Pour BNC 120 000 € en 2024 : assiette ≈ 150 000 € (+ 25% cotis), part_non_deductible ≈ 4 350 €
- [ ] Pour BNC 120 000 € en 2025 : assiette = 88 800 €, part_non_deductible ≈ 2 575 €
- [ ] `PATCH /api/operations/{filename}/{index}/csg-split` stocke et retourne la valeur
- [ ] `PATCH` avec `csg_non_deductible: null` efface le champ
- [ ] Analytics BNC : charges_deductibles diminuées du montant `csg_non_deductible` si présent
- [ ] `UrssafSplitWidget` visible uniquement sur les opérations détectées URSSAF
- [ ] Badge `~X € non déd.` rouge pâle affiché si déjà calculé
- [ ] Bouton `Calculer ⚡` → popover avec décomposition → `[Appliquer]` → toast
- [ ] Pas de régression sur EditorPage (grille inchangée si non URSSAF)
- [ ] `from __future__ import annotations` en tête de tous les nouveaux fichiers Python
