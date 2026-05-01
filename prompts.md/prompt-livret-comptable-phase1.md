# Prompt Phase 1 — Livret comptable vivant

> ⚠️ Session longue — bon moment pour commit + push avant de démarrer.
>
> **Lire `CLAUDE.md` à la racine du repo AVANT toute implémentation** pour s'aligner sur les conventions du projet (patterns hooks, drawers, sidebar, services, dark theme, etc.).

---

## 1 — Contexte

NeuronXcompta dispose déjà de tous les modules métier nécessaires (Editor, Ventilation, Justificatifs, Rapprochement, Charges forfaitaires, Amortissements, Provisions, Liasse SCP, Prévisionnel, Simulation BNC). Il manque une **vue de synthèse narrative annuelle** qui rassemble tout ça en un livret consultable, qui se met à jour en continu et qu'on peut figer en instantané pour archive ou envoi comptable.

Ce module **n'introduit aucune donnée nouvelle** — c'est un **agrégateur + composeur** sur les services existants. Le livret est :

- **Vivant** : route permanente `/livret/:year`, refetch périodique TanStack Query → la vue reflète l'état courant à quelques secondes près.
- **Niveau 3** : drill-down jusqu'à l'opération individuelle avec ses sous-lignes de ventilation.
- **Hybride passé / projection** : mois passés en données réelles, mois courant partiel, mois futurs projetés via `previsionnel_service`.
- **Archivable** (Phase 3) : snapshots HTML autonomes + PDF paginés, automatiques mensuels + à la clôture + manuels.

## 2 — Phasage global (rappel)

| Phase | Périmètre | Statut |
|---|---|---|
| **1 (ce prompt)** | Fondations backend + frontend, `ProjectionService`, 3 chapitres pilotes (01 Synthèse · 02 Recettes · 03 Charges professionnelles), cadence mensuelle 12 mois | À faire |
| 2 | Chapitres 04→09 (Forfaitaires, Sociales, Amortissements, Provisions, BNC fiscal, Annexes) | Plus tard |
| 3 | Snapshots auto/manuels + génération HTML autonome + PDF ReportLab + page Archives | Plus tard |
| 4 | Toggle comparaison N-1 (YTD comparable / Année pleine) + deltas par métrique et par chapitre | Plus tard |

**Hors scope Phase 1 mais à stubber dans l'UI :**
- Boutons "Figer instantané", "Archives", "↓ PDF", "↓ HTML" → rendus mais désactivés avec tooltip `Phase 3`.
- Toggle `YTD comparable / Année pleine` → rendu mais désactivé avec tooltip `Phase 4`.

## 3 — Architecture cible

```
┌──────────────────────────────────────────────────────────────┐
│ /api/livret/{year}                                            │
│   → livret_service.build_livret(year)                         │
│       │                                                       │
│       ├─ analytics_service.get_year_overview(year)            │
│       ├─ analytics_service.get_dashboard_data(year, ca)       │
│       ├─ bnc_service.compute_bnc(year)                        │
│       ├─ liasse_scp_service.get_ca_for_bnc(year)              │
│       ├─ projection_service.project(year, as_of=today)        │
│       │     └─ V1 = adaptateur previsionnel_service.timeline  │
│       │     └─ Fallback YTD × 12/n si Prévisionnel vide       │
│       │                                                       │
│       └─ Composition par chapitre :                           │
│            01 Synthèse → metrics + cadence mensuelle 12 mois  │
│            02 Recettes → sous-cat + ops groupées              │
│            03 Charges pro → sous-cat + ops éclatées (vent.)   │
└──────────────────────────────────────────────────────────────┘
```

**Pattern fondamental :** le `LivretService` ne touche jamais directement aux fichiers JSON d'opérations. Il consomme uniquement les services métier existants. Cela rend le module trivial à brancher sur SQLite plus tard (les services sous-jacents migreront, le livret n'aura rien à changer).

## 4 — Backend

### 4.1 — Modèles Pydantic

`backend/models/livret.py`

```python
from __future__ import annotations
from typing import Optional, Literal
from pydantic import BaseModel
from datetime import date

# --- Métadonnées ---
class LivretMetadata(BaseModel):
    year: int
    generated_at: str  # ISO datetime
    as_of_date: str  # date à laquelle "YTD" s'arrête (= aujourd'hui en mode live, ou snapshot date)
    months_elapsed: int  # nombre de mois écoulés (0..12)
    months_remaining: int
    is_live: bool  # True si vue live, False si snapshot
    snapshot_id: Optional[str] = None  # rempli en Phase 3
    data_sources: dict[str, bool]  # ex: {"liasse_scp": True, "previsionnel": True, ...}

# --- Synthèse ---
class LivretMetric(BaseModel):
    label: str
    value: float
    unit: Literal["EUR", "PCT", "COUNT"] = "EUR"
    is_projection: bool = False  # True pour les valeurs projetées (style pointillé côté UI)

class LivretMonthPoint(BaseModel):
    month: int  # 1..12
    label: str  # "jan", "fév", ..., "déc"
    recettes: float
    charges: float
    is_past: bool       # True si mois clos
    is_current: bool    # True si mois courant (partiellement écoulé)
    is_projection: bool # True si mois futur (valeurs venant du ProjectionService)

class LivretSyntheseChapter(BaseModel):
    metrics: list[LivretMetric]  # 4 metrics : Recettes YTD, Charges YTD, BNC YTD, BNC projeté annuel
    cadence_mensuelle: list[LivretMonthPoint]  # 12 points

# --- Chapitres détaillés (Recettes, Charges pro) ---
class LivretFlag(BaseModel):
    a_revoir: bool = False
    important: bool = False
    justificatif_manquant: bool = False
    locked: bool = False
    lettre: bool = False
    is_mixte: bool = False  # taux pro < 100%

class LivretOperation(BaseModel):
    """Une ligne unitaire affichée dans une sous-catégorie.
    En mode éclaté, peut représenter une sous-ligne de ventilation (op_index + ventilation_index).
    En mode groupé, représente l'opération mère et inclut ses sous-lignes en arborescence."""
    operation_file: str
    operation_index: int
    ventilation_index: Optional[int] = None  # None si op mère ou non-ventilée
    date: str  # ISO date
    libelle: str
    libelle_meta: Optional[str] = None  # ex: "mixte 70%", "Forfait barème"
    montant: float  # déjà ajusté en mode éclaté (sous-ligne) ou brut (groupé)
    montant_brut: Optional[float] = None  # en mode mixte : montant total avant taux pro
    taux_pro: Optional[float] = None  # 0..100
    flags: LivretFlag
    sub_lines: Optional[list[LivretOperation]] = None  # populé en mode groupé pour ops ventilées

class LivretSubcategory(BaseModel):
    name: str
    total_ytd: float
    total_projected_annual: Optional[float] = None  # pour les sous-cat où Prévisionnel a des données
    nb_operations: int
    nb_a_revoir: int
    nb_justif_manquant: int
    nb_mixte: int
    operations: list[LivretOperation]

class LivretChapter(BaseModel):
    number: str   # "01", "02", "03"
    title: str
    tag: Optional[str] = None  # ex: "Ventilation éclatée", "Ventilation groupée", "YTD au 30 avril"
    ventilation_mode: Literal["eclate", "groupe", "none"]
    total_ytd: float
    total_projected_annual: Optional[float] = None
    subcategories: list[LivretSubcategory]
    # Phase 4 : delta_n1: Optional[LivretDelta] = None

# --- Réponse principale ---
class LivretSynthese(LivretChapter):
    """Le chapitre 01 a une structure spéciale (metrics + cadence) en plus de subcategories vides."""
    synthese: LivretSyntheseChapter

class Livret(BaseModel):
    metadata: LivretMetadata
    chapters: dict[str, LivretChapter | LivretSynthese]  # clé = "01", "02", "03"
    toc: list[dict[str, str]]  # [{"number": "01", "title": "Synthèse exécutive"}, ...]
```

### 4.2 — `projection_service.py` (V1 = adaptateur Prévisionnel)

`backend/services/projection_service.py`

**Interface (Protocol)** — définie pour permettre une V2 plus tard sans toucher au livret :

```python
class ProjectionResult(BaseModel):
    year: int
    as_of_date: str
    monthly_recettes: dict[int, float]  # {1: 45000.0, 2: ...}
    monthly_charges: dict[int, float]
    annual_recettes_projected: float
    annual_charges_projected: float
    bnc_projected_annual: float
    source: Literal["previsionnel", "fallback_ytd_extrapolation"]
    confidence: Literal["high", "medium", "low"]

class IProjectionProvider(Protocol):
    def project(self, year: int, as_of_date: date) -> ProjectionResult: ...
```

**V1 implémentation : `PrevisionnelProjectionProvider`**

1. Appelle `previsionnel_service.get_timeline(year)` (existe déjà).
2. Pour chaque mois > `as_of_date.month` : utilise `mois.charges_total` et `mois.recettes_total` de la timeline (Prévisionnel projette déjà via régression linéaire + saisonnalité + providers récurrents).
3. Pour chaque mois ≤ `as_of_date.month` : récupère les **données réelles** depuis `analytics_service.get_year_overview(year).mois_data[m].bnc_recettes_pro` et `bnc_charges_pro`.
4. `annual_recettes_projected = sum(monthly_recettes)` ; idem charges.
5. `bnc_projected_annual = annual_recettes_projected − annual_charges_projected − dotations_amortissements − forfaits_total`.
   - Dotations via `amortissement_service.get_dotations(year).total_deductible`.
   - Forfaits via `charges_forfaitaires_service.get_total_deductible_year(year)`.
6. `source = "previsionnel"` si la timeline a des données (`charges_annuelles > 0` ou `recettes_annuelles > 0`), sinon V1 retombe sur **fallback**.

**Fallback : `FallbackProjectionProvider`**

Si Prévisionnel ne retourne rien d'exploitable :
- `monthly_recettes[m] = ytd_recettes / months_elapsed` pour tous les mois futurs (extrapolation linéaire moyenne YTD).
- `monthly_charges[m]` idem.
- `confidence = "low"`.
- `source = "fallback_ytd_extrapolation"`.

**Service public unique :**

```python
def project(year: int, as_of_date: Optional[date] = None) -> ProjectionResult:
    """Tente PrevisionnelProjectionProvider, retombe sur Fallback si vide.
    as_of_date par défaut = today (mode live)."""
```

### 4.3 — `livret_service.py` (agrégateur)

`backend/services/livret_service.py`

```python
def build_livret(
    year: int,
    as_of_date: Optional[date] = None,  # default = today (mode live)
    snapshot_id: Optional[str] = None,  # toujours None en Phase 1
) -> Livret:
    """Compose le livret depuis les services existants."""
```

**Étapes :**

1. **Métadonnées** : `as_of_date = as_of_date or today()`. Calcul `months_elapsed`, `months_remaining`. Probe `data_sources` (liasse_scp saisie ? prévisionnel a des données ? amortissements actifs ? etc.).
2. **Projection** : `proj = projection_service.project(year, as_of_date)`.
3. **Chapitre 01 — Synthèse** :
   - Récupère `bnc_service.compute_bnc(year)` pour les chiffres YTD réels.
   - 4 metrics : Recettes YTD, Charges YTD, BNC YTD, BNC projeté annuel (depuis `proj.bnc_projected_annual`, `is_projection: True`).
   - `cadence_mensuelle` : 12 `LivretMonthPoint`. Pour chaque mois, marque `is_past` / `is_current` / `is_projection` selon `as_of_date`. Mois passés et courant : depuis `analytics_service.get_year_overview(year).mois_data`. Mois futurs : depuis `proj.monthly_*`.
4. **Chapitre 02 — Recettes (mode groupé)** :
   - Source : `analytics_service.get_dashboard_data(year)` filtré sur `nature == "pro"` et `Crédit > 0` (pas `Débit`).
   - Sous-catégories : groupé par `Sous-Catégorie` (typiquement "Quote-part SCP", "Honoraires propres", "Vacations", "Remplacement"…).
   - `LivretOperation` en mode groupé : op mère affichée une fois, sous-lignes de ventilation en `sub_lines` arborescence.
   - `total_projected_annual` = `proj.annual_recettes_projected` au niveau du chapitre.
5. **Chapitre 03 — Charges professionnelles (mode éclaté)** :
   - Source : `analytics_service.get_dashboard_data(year)` filtré `nature == "pro"` et `Débit > 0`.
   - Exclusions : `Immobilisations`, `Dotations aux amortissements`, `Ventilé` (catégorie parente — on prend les sous-lignes à la place via `_explode_ventilations`-like logic), forfaits (`Blanchissage professionnel`, `Repas pro` source forfait, `Véhicule` quote-part — eux apparaîtront en chapitre 04 Phase 2).
   - `LivretOperation` en mode éclaté : chaque sous-ligne de ventilation est une `LivretOperation` distincte dans sa sous-catégorie. Le champ `ventilation_index` est rempli. `montant_brut` et `taux_pro` remplis si l'op a un poste comptable mixte (lookup dans le poste GED via `_resolve_taux_pro`).
   - Helper `_explode_operations_for_livret(ops)` à factoriser depuis le pattern existant de `export_service._explode_ventilations` mais adapté aux besoins du livret (préservation des flags + résolution taux pro).

### 4.4 — Router `/api/livret`

`backend/routers/livret.py`

```python
@router.get("/{year}")
def get_livret(year: int, as_of: Optional[str] = None) -> Livret:
    """Vue live du livret. `as_of` (ISO date) optionnel pour figer la date d'arrêt YTD."""

@router.get("/{year}/metadata")
def get_metadata(year: int) -> LivretMetadata:
    """Endpoint léger pour le polling / live indicator (sans recomposer tout le livret)."""

@router.get("/{year}/projection")
def get_projection(year: int) -> ProjectionResult:
    """Expose la projection seule pour debug / inspection."""
```

Enregistrer le router dans `backend/main.py` :

```python
app.include_router(livret_router, prefix="/api/livret", tags=["livret"])
```

## 5 — Frontend

### 5.1 — Types TypeScript

`frontend/src/types/livret.ts` — copie miroir des modèles Pydantic. Réutilise les utilitaires d'export TS existants si applicables.

### 5.2 — Hooks TanStack Query

`frontend/src/hooks/useLivret.ts`

```typescript
export function useLivret(year: number) {
  return useQuery({
    queryKey: ['livret', year],
    queryFn: () => api.get<Livret>(`/livret/${year}`),
    staleTime: 0,
    refetchInterval: 60_000,        // refresh chaque minute
    refetchOnWindowFocus: true,     // refresh au retour sur l'onglet
    refetchOnMount: 'always',
  })
}

export function useLivretMetadata(year: number) {
  // Pour le live indicator dans la toolbar (poll plus rapide, payload léger)
  return useQuery({
    queryKey: ['livret', year, 'metadata'],
    queryFn: () => api.get<LivretMetadata>(`/livret/${year}/metadata`),
    refetchInterval: 30_000,
    staleTime: 0,
  })
}

export function useLivretProjection(year: number) {
  return useQuery({
    queryKey: ['livret', year, 'projection'],
    queryFn: () => api.get<ProjectionResult>(`/livret/${year}/projection`),
  })
}

// Helper exporté pour invalidation depuis d'autres hooks de mutation
export function invalidateLivret(queryClient: QueryClient, year?: number) {
  queryClient.invalidateQueries({ queryKey: year ? ['livret', year] : ['livret'] })
}
```

**Câbler `invalidateLivret()` dans les `onSuccess` de ces mutations existantes** (à chercher dans le code et compléter — ne pas réécrire les hooks, ajouter une ligne d'invalidation supplémentaire) :
- `useUpdateOperation`, `usePatchOperation`
- `useSetVentilation`, `useDeleteVentilation`, `usePatchVentilationLine`
- `useToggleLock`, `useToggleLettre`, `useBulkLockOperations`
- `useAssociateJustificatif`, `useDissociateJustificatif`, `useAutoRapprocher`
- `usePatchCsgSplit`, `useBatchCsgSplit`
- `useCalculerBlanchissage`, `useCalculerRepas`, `useGenererDotation`
- `useUpsertLiasseScp`, `useDeleteLiasseScp`

> Ne pas chercher à être exhaustif : 80% des cas via le combo `refetchInterval: 60_000` + invalidation sur les hooks ci-dessus suffit largement à donner la sensation "live".

### 5.3 — Composants

Tous dans `frontend/src/components/livret/` :

| Composant | Rôle |
|---|---|
| `LivretPage.tsx` | Page principale, route `/livret/:year`. Compose Toolbar + SubBar + FilterChips + Toc + chapitres dans l'ordre |
| `LivretToolbar.tsx` | Header sticky : titre + année (Zustand `useFiscalYearStore` existant) + live dot pulsant + horodatage MAJ + boutons stubbed |
| `LivretSubBar.tsx` | "Au {date} · X mois écoulés · Y à projeter" + toggle comparaison stubbed (Phase 4) |
| `LivretFilterChips.tsx` | Chips locaux : Tout, À revoir, Justif manquant, Mixte, Verrouillé. State local (useState) — n'affecte que les tables d'ops dans les chapitres |
| `LivretToc.tsx` | Sommaire grid 9 chapitres. Clic = scrollIntoView vers la section |
| `LivretSyntheseChapter.tsx` | Chap 01 : 4 MetricCards + `LivretCadenceMensuelle` |
| `LivretCadenceMensuelle.tsx` | Visualisation 12 mois empilées. Mois passés en plein, courant marqué d'un point pulsant, futurs en pointillés. Recharts ou SVG inline (préférer Recharts pour cohérence avec le reste du projet) |
| `LivretRecettesChapter.tsx` | Chap 02, mode groupé |
| `LivretChargesProChapter.tsx` | Chap 03, mode éclaté |
| `LivretChapterShell.tsx` | Wrapper commun : `<ch-head>` (number + title + tag + ch-totals) + `<children>` |
| `LivretSubcategorySection.tsx` | Header sous-cat (titre + total + meta "X opérations · Y mixtes · Z à revoir") + `LivretOpsTable` |
| `LivretOpsTable.tsx` | Tableau opérations niveau 3. Columns : toggle expand · date · libellé · flags · montant. Expand row = `LivretVentilationDetail` |
| `LivretVentilationDetail.tsx` | Dépliable : sous-lignes pro/perso, justificatif (lien GED), méta lock/lettre |
| `LivretFiltersCounter.tsx` | Affiche "12 / 47 affichées" si filtres actifs (au-dessus de chaque table d'ops impactée) |

**Filtres locaux** : `LivretPage` détient le state `activeFilters: Set<FilterKey>`. Le passe en prop aux chapitres détaillés. Chaque `LivretSubcategorySection` filtre ses ops avant de les passer à la table. **Les totaux YTD au niveau chapitre/sous-cat ne sont jamais filtrés** — c'est documenté dans le compteur "X / Y affichées".

**Style** : reprendre les CSS variables et tokens du dark theme du projet (cf. `CLAUDE.md` patterns). Indicateurs flags = pastilles 6×6 px : vert (lettré OK), ambre (à revoir), rouge (justif manquant), gris (verrouillé), bleu pointillé (projection / source forfait).

### 5.4 — Routing & Sidebar

- Route `/livret/:year?` dans `App.tsx`. Si pas d'année dans l'URL, redirige vers `/livret/{currentYear}` via le store Zustand.
- Sidebar : ajouter une entrée `Livret comptable` dans le groupe **ANALYSE** (au-dessus ou à côté de `Compta Analytique`). Icône Lucide : `BookOpen`.

## 6 — Stratégie de rafraîchissement live (récap)

| Mécanisme | Fréquence | Effet |
|---|---|---|
| `refetchInterval` sur `useLivret` | 60 s | Le livret se réactualise tout seul si l'onglet reste ouvert |
| `refetchOnWindowFocus` | À chaque retour sur l'onglet | Pour qui passe d'un module à un autre |
| `invalidateLivret()` dans les mutations clés | À chaque action utilisateur impactante | Refresh quasi-immédiat après édition |
| `useLivretMetadata` poll 30 s | 30 s | Met à jour le `MAJ il y a X` de la toolbar plus finement |

> Pas de SSE en Phase 1. Si le besoin se précise plus tard (multi-onglets, multi-utilisateurs), envisager une bus events FastAPI → SSE en Phase 5 hors roadmap actuelle.

## 7 — Données & stockage

**Phase 1 ne crée AUCUN fichier de données.** Tout est calculé à la volée depuis les services existants.

Préparer toutefois la structure pour la Phase 3 (snapshots) :

- Créer le dossier `data/livret_snapshots/` au lifespan via `ensure_directories()`.
- Y créer un `manifest.json` vide initial : `{"snapshots": []}`.
- Dans `config.py`, ajouter `LIVRET_SNAPSHOTS_DIR = DATA_DIR / "livret_snapshots"`.

## 8 — Cas limites & garde-fous

- **Année future** (ex: `/livret/2027` quand on est en 2026) : retourner `metadata.is_live = true`, `months_elapsed = 0`, projection complète si Prévisionnel a des données pour 2027, sinon réponse vide gracieuse (chapitres vides, pas d'erreur 500).
- **Année passée clôturée** (ex: 2024) : `as_of_date` clampé au 31 décembre de l'année. Toutes les valeurs sont réelles, aucune projection. UI affiche "Exercice clôturé" en sub-bar.
- **Liasse SCP saisie partiellement / absente** : `bnc_service.compute_bnc` gère déjà la base bancaire en proxy. Récupérer le champ `base_recettes` ("liasse" | "bancaire") et le propager dans `metadata.data_sources`.
- **Catégorie `Ventilé`** : exclue des sous-cat affichées en chap 03 (les sous-lignes individuelles sont injectées à la place dans leurs vraies sous-cat).
- **Op verrouillée (`locked: true`)** : `flags.locked = true` côté livret, badge gris dans l'UI. Les ops verrouillées restent éditables depuis l'Editor — le livret se rafraîchira au prochain refetch.
- **Performance** : un appel `/api/livret/{year}` doit rester < 800 ms en local. Si dépassement, profiler avec `LIVRET_PROFILING=1` (env var). Cibler la mise en cache mémoire de `analytics_service.get_year_overview(year)` (déjà cache existant à vérifier).

## 9 — Vérifications manuelles avant commit

1. `GET /api/livret/2025` retourne un JSON conforme aux modèles, code 200.
2. `GET /api/livret/2026/metadata` retourne en < 200 ms.
3. La page `/livret/2026` charge en mode live : le live dot pulse, l'horodatage évolue.
4. Modifier une opération depuis `/editor` → revenir sur `/livret/2026` → la valeur a changé (au plus tard après 60 s ou au focus de l'onglet, immédiatement si l'invalidation est câblée).
5. Filtre `À revoir` → la colonne "X / Y affichées" apparaît, les totaux chapitre/sous-cat ne bougent pas.
6. Cadence mensuelle : mois passés pleins, mois courant marqué, futurs en pointillés.
7. Chapitre 03 : une op ventilée mixte est éclatée en sous-lignes par sous-catégorie distincte ; la part perso n'apparaît pas dans les charges déductibles.
8. Année 2027 : page se charge sans erreur, chapitres vides, message "Exercice à venir".
9. Mode dark : tous les badges, pastilles et chiffres restent lisibles.

## 10 — Documentation finale (étape obligatoire avant commit)

Mettre à jour les 3 fichiers du repo :

- **`CLAUDE.md`** : ajouter une section **Livret comptable** dans la liste des modules. Documenter : le contrat `IProjectionProvider`, le pattern d'invalidation `invalidateLivret`, les exclusions catégorielles du chap 03, le mécanisme de refetch live.
- **`CHANGELOG.md`** : entrée `Added (YYYY-MM-DD)` avec la liste des fichiers créés et le périmètre Phase 1.
- **`api-reference.md`** : nouvelle section `## Livret (\`/api/livret\`)` avec les 3 endpoints documentés (paramètres, réponses JSON exemples).

## 11 — Ordre d'implémentation suggéré

1. `backend/models/livret.py` (Pydantic)
2. `backend/services/projection_service.py` — interface + V1 + fallback. **Tester unitairement** : year passé clôturé, year courante in-progress, year future sans données → fallback.
3. `backend/services/livret_service.py` — `build_livret`. Tester avec un `curl` direct sur l'année courante.
4. `backend/routers/livret.py` + enregistrement dans `main.py`.
5. `frontend/src/types/livret.ts`
6. `frontend/src/hooks/useLivret.ts`
7. `frontend/src/components/livret/` — démarrer par `LivretChapterShell`, `LivretOpsTable`, `LivretSubcategorySection` (le squelette réutilisable), puis empiler les chapitres dessus.
8. Routing + sidebar entry.
9. Câbler `invalidateLivret` dans les hooks de mutation listés en §5.2.
10. Vérifications manuelles §9.
11. Documentation §10.
12. Commit + push (Conventional Commits : `feat(livret): phase 1 — fondations + 3 chapitres pilotes`).

---

**Conventional Commits suggérés** (un commit par étape majeure pour faciliter la review) :

- `feat(livret): pydantic models + projection service interface`
- `feat(livret): projection service V1 (previsionnel adapter + fallback)`
- `feat(livret): livret_service aggregator + 3 pilot chapters`
- `feat(livret): /api/livret endpoints`
- `feat(livret): frontend types + hooks + page shell`
- `feat(livret): synthèse chapter + cadence mensuelle`
- `feat(livret): recettes + charges pro chapters with vent. modes`
- `feat(livret): wire invalidateLivret in mutations`
- `docs(livret): CLAUDE.md + CHANGELOG + api-reference`
