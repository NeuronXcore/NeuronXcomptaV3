# Prompt Phase 4 — Livret comptable : comparaison N-1 (YTD comparable + Année pleine)

> ⚠️ Session longue — bon moment pour commit + push avant de démarrer.
>
> **Lire `CLAUDE.md` à la racine du repo AVANT toute implémentation**, ainsi que :
> - `backend/services/livret_service.py` (Phase 1+2)
> - `backend/services/projection_service.py`
> - `backend/services/snapshot_service.py` (Phase 3)
> - `frontend/src/components/livret/LivretPage.tsx` et toolbar
> - Référence existante : `analytics_service.compare_periods()` qui calcule déjà des deltas N vs N-1 sur le dashboard — s'en inspirer pour la cohérence des calculs.

---

## 1 — Contexte

Le toggle `YTD comparable / Année pleine` est rendu mais désactivé depuis la Phase 1. Phase 4 active cette comparaison N-1 :

- **Mode YTD comparable** : compare la période [01/01/N → as_of] avec [01/01/(N-1) → même date N-1]. Pertinent en cours d'année pour piloter (ex: au 30 avril, comparer 4 mois à 4 mois).
- **Mode Année pleine** : compare l'exercice complet N avec l'exercice complet (N-1). Pertinent à la clôture.

Les deltas s'affichent partout : metrics de synthèse, totaux de chapitre, totaux de sous-catégorie, et une superposition optionnelle sur la cadence mensuelle.

## 2 — Périmètre Phase 4

- Backend : extension `livret_service` avec param `compare_n1: Optional[Literal["ytd_comparable", "annee_pleine"]]`.
- Modèles Pydantic : `LivretDelta` (montant absolu + %).
- Calcul des deltas à tous les niveaux pertinents.
- Frontend : activation du toggle dans `LivretSubBar`, affichage des deltas via composant `LivretDeltaPill`, code couleur (vert/rouge selon le sens favorable/défavorable).
- Intégration Phase 3 : option `include_comparison` à la création de snapshots → embarqué dans HTML/PDF.

## 3 — Backend

### 3.1 — Modèles

Ajouter à `backend/models/livret.py` :

```python
class LivretDelta(BaseModel):
    value_n1: float
    value_diff: float                  # value_n - value_n1
    value_diff_pct: Optional[float]    # (value_n - value_n1) / value_n1 * 100, None si value_n1 == 0
    direction: Literal["up", "down", "stable"]
    is_favorable: bool                 # vert si True, rouge si False
```

Étendre les modèles existants pour inclure un champ optionnel :

```python
class LivretMetric(BaseModel):
    ...
    delta_n1: Optional[LivretDelta] = None

class LivretSubcategory(BaseModel):
    ...
    delta_n1: Optional[LivretDelta] = None  # sur total_ytd

class LivretChapter(BaseModel):
    ...
    delta_n1: Optional[LivretDelta] = None  # sur total_ytd

class LivretMonthPoint(BaseModel):
    ...
    recettes_n1: Optional[float] = None  # valeur N-1 même mois
    charges_n1: Optional[float] = None
```

`LivretMetadata` enrichi :

```python
class LivretMetadata(BaseModel):
    ...
    compare_mode: Optional[Literal["ytd_comparable", "annee_pleine"]] = None
    as_of_date_n1: Optional[str] = None  # rempli si compare_mode actif
    has_n1_data: bool = False            # False si l'année N-1 n'a aucune donnée
```

### 3.2 — Logique de calcul

Étendre `livret_service.build_livret` :

```python
def build_livret(
    year: int,
    as_of_date: Optional[date] = None,
    compare_n1: Optional[Literal["ytd_comparable", "annee_pleine"]] = None,
    snapshot_id: Optional[str] = None,
) -> Livret:
    livret_n = _build_livret_internal(year, as_of_date, ...)
    if compare_n1:
        as_of_n1 = _compute_as_of_n1(year, as_of_date, compare_n1)
        livret_n1 = _build_livret_internal(year - 1, as_of_n1, ...)
        livret_n.metadata.compare_mode = compare_n1
        livret_n.metadata.as_of_date_n1 = as_of_n1.isoformat()
        livret_n.metadata.has_n1_data = _has_data(year - 1)
        if livret_n.metadata.has_n1_data:
            _annotate_deltas(livret_n, livret_n1)
    return livret_n


def _compute_as_of_n1(year: int, as_of: date, mode: str) -> date:
    if mode == "ytd_comparable":
        # Même mois/jour en N-1 (clamp 29 fév -> 28 fév en année non-bissextile)
        return date(year - 1, as_of.month, min(as_of.day, last_day(year-1, as_of.month)))
    elif mode == "annee_pleine":
        return date(year - 1, 12, 31)
    raise ValueError(f"Mode comparaison inconnu: {mode}")
```

`_annotate_deltas(n, n1)` traverse les 2 livrets en parallèle et annote les `delta_n1` :

- Chaque `LivretMetric` du chap 01 (Recettes, Charges, BNC ; **pas** la projection annuelle).
- `total_ytd` de chaque chapitre (sauf 09 Annexes, non comparable).
- `total_ytd` de chaque sous-catégorie — matching par nom. Si la sous-cat existe en N mais pas en N-1, `value_n1 = 0`. **Si la sous-cat existe en N-1 mais plus en N, créer une ligne fantôme** dans le livret N avec `total_ytd = 0` et delta négatif (sinon une dérive passe inaperçue).
- `recettes_n1` / `charges_n1` de chaque `LivretMonthPoint`.

**Calcul `is_favorable`** :

```python
def _is_favorable(direction: str, context: str) -> bool:
    favorable_up = {"recettes", "bnc", "provisions"}
    if context in favorable_up:
        return direction == "up"
    # charges, charges sociales, etc. : favorable si baisse
    return direction == "down" or direction == "stable"
```

`context` est inféré du chapitre/sous-catégorie courant (passer en paramètre lors de l'annotation).

### 3.3 — Endpoint

Le endpoint existant `GET /api/livret/{year}` accepte un nouveau paramètre :

```
GET /api/livret/{year}?compare_n1=ytd_comparable
GET /api/livret/{year}?compare_n1=annee_pleine
```

Si non fourni, comportement Phase 1+2 inchangé (pas de delta).

**Performance** : la double composition double approximativement le temps de réponse. Cibler **< 1.5 s**. Si dépassement, mettre en cache mémoire `_build_livret_internal` avec clé `(year, as_of_date, snapshot_id)` et TTL 60 s. Invalidation simple : flush du cache à chaque appel `invalidate_livret()` (helper backend à exposer si pas déjà présent).

## 4 — Frontend

### 4.1 — State global du mode comparaison

Ajouter au store Zustand existant `useFiscalYearStore` ou créer `useLivretStore` (préférence : nouveau store dédié pour clarté) :

```typescript
interface LivretStore {
  compareMode: 'none' | 'ytd_comparable' | 'annee_pleine'
  setCompareMode: (mode: 'none' | 'ytd_comparable' | 'annee_pleine') => void
  showN1OnCadence: boolean   // toggle indépendant pour la ligne N-1 sur la cadence mensuelle
  setShowN1OnCadence: (val: boolean) => void
}
```

Persisté via `persist` middleware Zustand (clé `livret-store`).

### 4.2 — Hook updaté

`useLivret(year)` consomme `compareMode` du store et passe `?compare_n1=...` si activé. Le `queryKey` inclut `compareMode` pour invalidation correcte :

```typescript
return useQuery({
  queryKey: ['livret', year, compareMode],
  queryFn: () => api.get<Livret>(`/livret/${year}${compareMode !== 'none' ? `?compare_n1=${compareMode}` : ''}`),
  ...
})
```

### 4.3 — Toggle activé dans `LivretSubBar`

Trois états : `Sans` / `YTD comparable` / `Année pleine`. Préférer 3 boutons radio segmented (pattern existant `MonthYearToggle.tsx` du module `check-envoi`).

Quand `Sans` est actif, masquer toutes les pills delta dans l'UI.

### 4.4 — Composant `LivretDeltaPill`

Nouveau composant `frontend/src/components/livret/LivretDeltaPill.tsx` :

```tsx
interface DeltaProps {
  delta: LivretDelta | null | undefined
  size?: 'sm' | 'md'
  showAbsolute?: boolean        // affiche aussi la valeur absolue diff
  hideIfNoBaseline?: boolean    // si value_n1 == 0, masquer plutôt que d'afficher "+∞%"
}
```

Rendu :

- Pas de delta → rien.
- Delta favorable → pastille verte avec flèche ↑/↓ + `+5,4 %` (ou `−2,1 %`).
- Delta défavorable → pastille rouge.
- Stable (`|diff_pct| < 0.5%`) → pastille grise.
- `value_n1 == 0` et `hideIfNoBaseline=true` → masqué. Sinon `Nouvelle ligne` ou `+100 %` selon contexte.

Style : reprendre les couleurs success/danger des CSS variables existantes du dark theme.

### 4.5 — Câblage dans les chapitres

Mettre à jour les composants Phase 1+2 pour afficher `LivretDeltaPill` :

- `LivretSyntheseChapter` : sous chaque metric (Recettes, Charges, BNC ; pas sur la projection annuelle).
- `LivretChapterShell` : à côté du `total_ytd` dans `<ch-totals>`.
- `LivretSubcategorySection` : à côté de `subcat-amount`.
- `LivretBncChapter` (Phase 2) : delta sur le BNC réalisé YTD uniquement, pas sur les lignes de la formule.

### 4.6 — Cadence mensuelle enrichie

`LivretCadenceMensuelle` mode N-1 actif (état `showN1OnCadence`) :

- Ajouter une ligne pointillée fine au-dessus des barres représentant `recettes_n1 + charges_n1` (ou `recettes_n1 - charges_n1` selon ce qu'on veut comparer — proposer `solde_n1` : recettes_n1 − charges_n1).
- Tooltip Recharts enrichi : `Avril 2026 : 38 750 € · vs Avril 2025 : 41 200 € (-5,9 %)`.
- Toggle séparé visible en sous-bar (à côté du selector mode comparaison) : `Afficher N-1 sur la cadence ☑/☐`.

### 4.7 — Encadré informatif "Pas de N-1"

Si `metadata.has_n1_data == false`, afficher un encadré ambre en haut du livret (au-dessus du chapitre 01) :

> ⚠️ Pas de comparaison disponible — l'exercice {year-1} n'a aucune donnée enregistrée. Le mode comparaison reste actif mais les deltas ne s'afficheront pas.

L'utilisateur peut toujours basculer le toggle ; l'absence visuelle des pills est explicable.

## 5 — Cas limites

- **N-1 = première année avec données** (ex: 2024 demandé en compare_n1 alors qu'il n'y a pas d'ops 2023) : `has_n1_data = false`, encadré informatif affiché, aucun delta calculé.
- **`as_of_date` du 29 février en année non bissextile précédente** : clamp au 28/02 (déjà géré dans `_compute_as_of_n1`).
- **Mode `annee_pleine` sur exercice en cours** : compare avec N-1 complet mais N partiel — UX doit avertir (encadré ambre "Comparaison incomplète : exercice {year} non clôturé — les chiffres N sont partiels").
- **Sous-cat existe en N-1 mais plus en N** : exposée dans la liste avec `total_ytd_n = 0` et delta négatif. Marquer visuellement avec un badge "absent en {year}".
- **Snapshots Phase 3 + comparaison** : à la création d'un snapshot, ajouter option `include_comparison: bool = False` dans `CreateSnapshotRequest`. Si `True`, le HTML/PDF embarquent les deltas (le HTML peut afficher/masquer avec un toggle local ; le PDF embarque la version active au moment de la génération).

## 6 — Intégration Phase 3 (snapshots)

Étendre :

- `CreateSnapshotRequest` : ajouter `include_comparison: Optional[Literal["ytd_comparable", "annee_pleine"]] = None`.
- `snapshot_service.create_snapshot` : passer le mode au `livret_service.build_livret`.
- Manifest enrichi : `"comparison_mode": "ytd_comparable" | "annee_pleine" | null`.
- HTML generator : si `comparison_mode` présent, le template Jinja2 affiche les pills delta + encadré "Comparaison N-1 incluse — mode : {mode}".
- PDF generator : idem, deltas inclus dans les tableaux et metrics.
- Frontend `LivretSnapshotDrawer` : ajouter une section "Inclure la comparaison N-1 ?" avec 3 options (Aucune / YTD / Année pleine), default = mode courant du livret.

## 7 — Vérifications manuelles

1. Toggle `Sans / YTD comparable / Année pleine` fonctionnel et persisté entre sessions navigateur.
2. Mode YTD comparable au 30 avril 2026 : les deltas sont calculés vs 30 avril 2025.
3. Recettes ↑ → pastille verte ; Charges ↑ → pastille rouge ; Provisions ↑ → pastille verte.
4. Cadence mensuelle : ligne pointillée N-1 visible quand `showN1OnCadence` activé.
5. Tooltip Recharts donne les 2 valeurs N et N-1 + diff %.
6. Sous-cat orpheline (présente en N-1, vide en N) → ligne affichée avec badge "absent en 2026" et delta négatif.
7. Année 2024 demandée en compare_n1 alors qu'il n'y a pas d'ops 2023 → encadré "Pas de comparaison" + toggle reste fonctionnel sans crash.
8. Snapshot créé avec `include_comparison: "ytd_comparable"` → HTML embarque les deltas et le toggle local UI fonctionne.
9. Snapshot créé avec `include_comparison: "ytd_comparable"` → PDF embarque les deltas dans les colonnes de tableaux et les metrics.
10. Performance : `/api/livret/2026?compare_n1=ytd_comparable` < 1.5 s.

## 8 — Documentation finale

- `CLAUDE.md` : section Livret enrichie du mode comparaison N-1 + cas limites + perf + intégration snapshots.
- `CHANGELOG.md` : `Added: Livret Phase 4 — comparaison N-1 (YTD + année pleine)`.
- `api-reference.md` : ajout du paramètre `compare_n1` à `GET /api/livret/{year}` + ajout de `include_comparison` à la doc du POST snapshot.

## 9 — Ordre d'implémentation

1. Modèles delta + extension Metadata.
2. `_compute_as_of_n1` + `_annotate_deltas` + helpers `is_favorable` (côté backend).
3. Extension `build_livret` avec branche `compare_n1`.
4. Cache mémoire si nécessaire pour rester < 1.5 s.
5. Endpoint param + tests `curl`.
6. Store Zustand + hook `useLivret` updaté.
7. `LivretDeltaPill` composant.
8. Câblage dans synthèse + chapitre shell + sous-cat.
9. Cadence mensuelle enrichie (Recharts) + toggle dédié.
10. Toggle activation dans `LivretSubBar` (3 états).
11. Encadrés "pas de N-1", "exercice non clos".
12. Intégration Phase 3 : `include_comparison` côté backend (snapshot_service, generators) + UI drawer.
13. Vérifications manuelles.
14. Documentation.

Conventional Commits suggérés :

- `feat(livret): pydantic delta models + metadata extension`
- `feat(livret): _compute_as_of_n1 + _annotate_deltas helpers`
- `feat(livret): build_livret with compare_n1 branch + memo cache`
- `feat(livret): /api/livret/{year}?compare_n1=... endpoint param`
- `feat(livret): zustand store + useLivret with compareMode`
- `feat(livret): LivretDeltaPill component`
- `feat(livret): wire deltas in synthese, chapter shell, subcategories`
- `feat(livret): cadence mensuelle with N-1 overlay + tooltip`
- `feat(livret): activate compare toggle in subbar`
- `feat(livret): no-N1 + non-clos contextual banners`
- `feat(livret): integrate include_comparison in phase 3 snapshots (backend + UI)`
- `docs(livret): CLAUDE.md + CHANGELOG + api-reference for phase 4`
