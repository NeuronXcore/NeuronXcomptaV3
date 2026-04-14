# Prompt Claude Code — Dashboard V2 : Cockpit Exercice Comptable

## Contexte

Lire `CLAUDE.md` en premier. Le DashboardPage actuel (`/`) affiche des KPIs basiques et des opérations récentes. On le refactore en **cockpit annuel** centré sur la complétude de l'exercice comptable, avec alertes pondérées, jauge segmentée, feed d'activité et échéances fiscales.

La route reste `/` — on remplace le contenu de `DashboardPage`.

---

## 1. Backend — Nouveau endpoint agrégé

### Fichier : `backend/routers/analytics.py`

Ajouter `GET /api/analytics/year-overview`

**Paramètres query :** `year: int` (défaut = année courante)

**Logique (dans `backend/services/analytics_service.py`):**

```python
async def get_year_overview(year: int) -> dict:
```

Agrège les données suivantes en un seul appel :

#### a) Données mensuelles (12 mois)

Pour chaque mois 1-12, retourner :

| Champ | Source | Calcul |
|-------|--------|--------|
| `has_releve` | `cloture_service.get_annual_status(year)` | Déjà existant |
| `nb_operations` | idem | Déjà existant |
| `taux_lettrage` | idem | Déjà existant |
| `taux_justificatifs` | idem | Déjà existant |
| `taux_categorisation` | **Nouveau** : compter ops avec categorie non vide et ≠ "Autres" / total ops | Calculer depuis les opérations du fichier |
| `taux_rapprochement` | Compter ops ayant un `justificatif` non vide / total ops de type débit | Calculer depuis les opérations du fichier |
| `has_export` | **Nouveau** : vérifier si un ZIP existe dans `data/exports/` pour ce mois/année | Scanner les fichiers exports |
| `total_credit` | Somme des crédits du mois | Depuis opérations |
| `total_debit` | Somme des débits du mois | Depuis opérations |
| `filename` | Nom du fichier d'opérations | Déjà existant dans cloture |

#### b) KPIs annuels

| Champ | Calcul |
|-------|--------|
| `total_recettes` | Somme credits année |
| `total_charges` | Somme debits année |
| `bnc_estime` | `total_recettes - total_charges` |
| `nb_operations` | Total opérations année |
| `nb_mois_actifs` | Mois avec au moins 1 opération |
| `bnc_mensuel` | Array de 12 valeurs BNC par mois (pour sparkline) |

#### c) Delta N-1

Si des données existent pour `year - 1`, calculer les deltas % sur recettes, charges et BNC.

| Champ | Calcul |
|-------|--------|
| `prev_total_recettes` | Somme credits N-1 |
| `prev_total_charges` | Somme debits N-1 |
| `prev_bnc` | recettes - charges N-1 |
| `delta_recettes_pct` | variation % |
| `delta_charges_pct` | variation % |
| `delta_bnc_pct` | variation % |

#### d) Alertes pondérées

Scanner les 12 mois et générer une liste d'alertes, triées par `impact` décroissant :

| Type d'alerte | Condition | Impact |
|---------------|-----------|--------|
| `releve_manquant` | Mois passé sans relevé ET mois ≤ mois courant | 100 |
| `export_manquant` | Mois avec taux_lettrage = 1.0 ET taux_justificatifs = 1.0 mais pas d'export | 80 |
| `justificatifs_manquants` | taux_justificatifs < 1.0 sur mois passé | 55 + nb manquants |
| `categorisation_incomplete` | taux_categorisation < 1.0 sur mois passé | 40 |
| `lettrage_incomplet` | taux_lettrage < 1.0 sur mois passé | 25 |

Chaque alerte contient : `type`, `mois`, `year`, `impact`, `message`, `detail` (ex: "14 justificatifs manquants"), `count` (nombre d'éléments concernés).

Limiter à 10 alertes max.

#### e) Progression globale

Calculer la progression globale de l'exercice et par critère :

```python
criteres = {
    "releves": nb_mois_avec_releve / 12 * 100,
    "categorisation": moyenne(taux_categorisation) * 100,
    "lettrage": moyenne(taux_lettrage) * 100,
    "justificatifs": moyenne(taux_justificatifs) * 100,
    "rapprochement": moyenne(taux_rapprochement) * 100,
    "exports": nb_mois_avec_export / 12 * 100,
}
progression_globale = moyenne(criteres.values())
```

#### f) Activité récente

Scanner les 10 dernières modifications dans :
- `data/imports/operations/` — imports de relevés (date = mtime fichier)
- `data/exports/` — exports générés
- `data/justificatifs/traites/` — justificatifs rapprochés récemment
- Logs OCR batch récents

Retourner : `type`, `message`, `timestamp`, `detail`

Trier par timestamp décroissant, limiter à 10.

**Réponse complète :**

```json
{
  "year": 2025,
  "mois": [
    {
      "mois": 1,
      "label": "Janvier",
      "has_releve": true,
      "nb_operations": 86,
      "taux_lettrage": 1.0,
      "taux_justificatifs": 1.0,
      "taux_categorisation": 1.0,
      "taux_rapprochement": 1.0,
      "has_export": true,
      "total_credit": 21200,
      "total_debit": 12800,
      "filename": "operations_xxx.json"
    }
  ],
  "kpis": {
    "total_recettes": 142800,
    "total_charges": 87340,
    "bnc_estime": 55460,
    "nb_operations": 847,
    "nb_mois_actifs": 7,
    "bnc_mensuel": [8400, 7900, 8700, 8200, 8500, 9100, 4560, 0, 0, 0, 0, 0]
  },
  "delta_n1": {
    "prev_total_recettes": 131900,
    "prev_total_charges": 84700,
    "prev_bnc": 47200,
    "delta_recettes_pct": 8.2,
    "delta_charges_pct": 3.1,
    "delta_bnc_pct": 16.4
  },
  "alertes": [
    {
      "type": "releve_manquant",
      "mois": 7,
      "year": 2025,
      "impact": 100,
      "message": "Relevé bancaire manquant",
      "detail": "Aucun relevé importé — bloque tout le mois",
      "count": 0
    }
  ],
  "progression": {
    "globale": 58,
    "criteres": {
      "releves": 50,
      "categorisation": 78,
      "lettrage": 73,
      "justificatifs": 66,
      "rapprochement": 63,
      "exports": 17
    }
  },
  "activite_recente": [
    {
      "type": "import",
      "message": "Import relevé juin 2025 — 94 opérations",
      "timestamp": "2025-07-15T14:30:00",
      "detail": "operations_xxx.json"
    }
  ]
}
```

### Modèle Pydantic

Fichier : `backend/models/analytics.py` (ajouter au fichier existant ou créer)

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional

class MoisOverview(BaseModel):
    mois: int
    label: str
    has_releve: bool
    nb_operations: int
    taux_lettrage: float
    taux_justificatifs: float
    taux_categorisation: float
    taux_rapprochement: float
    has_export: bool
    total_credit: float
    total_debit: float
    filename: Optional[str] = None

class KPIs(BaseModel):
    total_recettes: float
    total_charges: float
    bnc_estime: float
    nb_operations: int
    nb_mois_actifs: int
    bnc_mensuel: list[float]

class DeltaN1(BaseModel):
    prev_total_recettes: float
    prev_total_charges: float
    prev_bnc: float
    delta_recettes_pct: float
    delta_charges_pct: float
    delta_bnc_pct: float

class AlerteDashboard(BaseModel):
    type: str
    mois: int
    year: int
    impact: int
    message: str
    detail: str
    count: int

class ProgressionExercice(BaseModel):
    globale: float
    criteres: dict[str, float]

class ActiviteRecente(BaseModel):
    type: str
    message: str
    timestamp: str
    detail: str

class YearOverviewResponse(BaseModel):
    year: int
    mois: list[MoisOverview]
    kpis: KPIs
    delta_n1: Optional[DeltaN1] = None
    alertes: list[AlerteDashboard]
    progression: ProgressionExercice
    activite_recente: list[ActiviteRecente]
```

---

## 2. Frontend — Types

### Fichier : `frontend/src/types/index.ts`

Ajouter les interfaces correspondant au modèle Pydantic ci-dessus :

```typescript
export interface MoisOverview {
  mois: number;
  label: string;
  has_releve: boolean;
  nb_operations: number;
  taux_lettrage: number;
  taux_justificatifs: number;
  taux_categorisation: number;
  taux_rapprochement: number;
  has_export: boolean;
  total_credit: number;
  total_debit: number;
  filename: string | null;
}

export interface KPIs {
  total_recettes: number;
  total_charges: number;
  bnc_estime: number;
  nb_operations: number;
  nb_mois_actifs: number;
  bnc_mensuel: number[];
}

export interface DeltaN1 {
  prev_total_recettes: number;
  prev_total_charges: number;
  prev_bnc: number;
  delta_recettes_pct: number;
  delta_charges_pct: number;
  delta_bnc_pct: number;
}

export interface AlerteDashboard {
  type: string;
  mois: number;
  year: number;
  impact: number;
  message: string;
  detail: string;
  count: number;
}

export interface ProgressionExercice {
  globale: number;
  criteres: Record<string, number>;
}

export interface ActiviteRecente {
  type: string;
  message: string;
  timestamp: string;
  detail: string;
}

export interface YearOverviewResponse {
  year: number;
  mois: MoisOverview[];
  kpis: KPIs;
  delta_n1: DeltaN1 | null;
  alertes: AlerteDashboard[];
  progression: ProgressionExercice;
  activite_recente: ActiviteRecente[];
}
```

---

## 3. Frontend — Hook

### Fichier : `frontend/src/hooks/useApi.ts`

Ajouter le hook :

```typescript
export function useYearOverview(year: number) {
  return useQuery<YearOverviewResponse>({
    queryKey: ['year-overview', year],
    queryFn: () => api.get(`/analytics/year-overview?year=${year}`),
  });
}
```

Ajouter aussi un hook pour récupérer les années disponibles (réutiliser `useCloture` existant ou appeler `GET /api/cloture/years`).

---

## 4. Frontend — Composants

### Structure des fichiers

```
frontend/src/components/dashboard/
├── DashboardPage.tsx          # Page principale (REMPLACER le contenu existant)
├── YearSelector.tsx           # Dropdown année
├── ProgressionGauge.tsx       # Jauge segmentée 6 critères
├── KpiCards.tsx               # 4 cartes KPI avec sparkline BNC
├── MonthsGrid.tsx             # Grille 12 mois avec badges + expansion
├── MonthCard.tsx              # Carte individuelle d'un mois
├── AlertesSection.tsx         # Alertes pondérées triées par impact
├── FiscalDeadlines.tsx        # Échéances URSSAF/CARMF/ODM (statique V1)
├── ActivityFeed.tsx           # Feed d'activité récente
└── RevenueChart.tsx           # Mini bar chart recettes vs dépenses
```

### 4a. DashboardPage.tsx (refactored)

Layout vertical :

1. **Header** : `PageHeader` titre "Exercice comptable" + actions = `<YearSelector />`
2. **ProgressionGauge** : jauge segmentée
3. **KpiCards** : grille 4 colonnes
4. **MonthsGrid** : grille 6 colonnes (responsive → 4 → 3 colonnes)
5. **AlertesSection** : liste triée par impact
6. **FiscalDeadlines** : chips horizontales
7. **Grille bas** 2 colonnes : `RevenueChart` à gauche + `ActivityFeed` à droite

État local :
- `selectedYear: number` — useState, défaut = `new Date().getFullYear()`
- `expandedMonth: number | null` — useState pour l'expansion d'une carte mois

Données : `useYearOverview(selectedYear)` — un seul appel API pour tout.

### 4b. YearSelector.tsx

Props : `{ year: number; years: number[]; onChange: (y: number) => void }`

Composant simple : `<select>` avec les années disponibles. Stylé avec les classes Tailwind du projet (bg-surface, border-border, text-text).

Ajouter 3 boutons d'actions rapides à côté :
- "Importer relevé" → `navigate('/import')`
- "OCR batch" → `navigate('/ocr')`
- "Rapprochement auto" → appel `POST /api/rapprochement/run-auto` via mutation puis invalidation

### 4c. ProgressionGauge.tsx

Props : `{ progression: ProgressionExercice }`

Affichage :
- Titre "Progression globale — goulots d'étranglement" + % global à droite
- Barre horizontale segmentée en 6 parts égales, chacune avec opacité proportionnelle au % du critère
- Couleurs fixes par critère :
  - Relevés : `#378ADD` (bleu)
  - Catégorisation : `#7F77DD` (violet)
  - Lettrage : `#1D9E75` (vert)
  - Justificatifs : `#5DCAA5` (vert clair)
  - Rapprochement : `#EF9F27` (orange)
  - Exports : `#D85A30` (corail)
- Légende en dessous avec carrés de couleur + label + %

Container : `bg-surface rounded-lg p-4`

### 4d. KpiCards.tsx

Props : `{ kpis: KPIs; delta: DeltaN1 | null }`

4 cartes `MetricCard`-like :
1. **Recettes (quote-part SCP)** — `kpis.total_recettes` — delta `delta.delta_recettes_pct` (vert si positif)
2. **Charges totales** — `kpis.total_charges` — delta `delta.delta_charges_pct` (rouge si hausse)
3. **BNC estimé à date** — `kpis.bnc_estime` — delta `delta.delta_bnc_pct` + **sparkline** = mini barres de `kpis.bnc_mensuel` (hauteur 28px, barres violettes)
4. **Charges sociales provisionnées** — calculé comme ~39% du BNC (approximation URSSAF+CARMF+ODM) — sous-texte "URSSAF + CARMF + ODM"

Grille 4 colonnes. `formatCurrency()` de `lib/utils.ts`.

### 4e. MonthsGrid.tsx

Props : `{ mois: MoisOverview[]; year: number; expandedMonth: number | null; onToggle: (m: number) => void }`

Grille responsive :
```css
grid-template-columns: repeat(6, minmax(0, 1fr))
/* @media (max-width: 1200px) → repeat(4, ...) */
/* @media (max-width: 768px) → repeat(3, ...) */
```

Itère sur les 12 mois et rend `<MonthCard />` pour chacun.

### 4f. MonthCard.tsx

Props : `{ data: MoisOverview; year: number; isCurrent: boolean; isFuture: boolean; isExpanded: boolean; onToggle: () => void }`

**Logique d'affichage :**

- **Mois futur** (mois > mois courant) : `opacity-40 bg-surface`, badges grisés, texte "à venir"
- **Mois courant** : bordure violette `border-[#7F77DD] border-[1.5px]`
- **Mois passé incomplet** (a des données mais taux < 100) : `border-l-3 border-l-red-500` (indicateur "en retard")
- **Mois complet** : bordure normale

**Badges** (6 pastilles compactes) :

| Badge | Source | Vert | Orange | Rouge | Gris |
|-------|--------|------|--------|-------|------|
| Rel. | `has_releve` | true | — | false | pas de données |
| Cat. | `taux_categorisation` | =1.0 | ≥0.7 | <0.7 | — |
| Let. | `taux_lettrage` | =1.0 | ≥0.7 | <0.7 | — |
| Jus. | `taux_justificatifs` | =1.0 | ≥0.7 | <0.7 | — |
| Rap. | `taux_rapprochement` | =1.0 | ≥0.7 | <0.7 | — |
| Exp. | `has_export` | true | — | false | pas de données |

Classes TailwindCSS pour les badges :
- ok : `bg-green-500/15 text-green-400`
- partial : `bg-yellow-500/15 text-yellow-400`
- missing : `bg-red-500/15 text-red-400`
- na : `bg-surface text-text-muted/40`

Chaque badge = dot 5px + label 3 lettres, font-size 9px.

**Pourcentage global** en haut à droite = moyenne des 5 taux + export (0 ou 100) / 6.

**Expansion au clic** (transition max-height ou conditional render) :
- Ligne recettes (vert), dépenses (rouge), solde
- Boutons d'action contextuels :
  - Si pas de relevé → "Importer relevé" (navigate `/import`)
  - Si pas d'export mais mois complet → "Exporter" (navigate `/export`)
  - Si justificatifs < 100% → "Rapprocher" (navigate `/rapprochement`)
  - Toujours → "Éditer" (navigate `/editor` avec query param `?file=filename`)

### 4g. AlertesSection.tsx

Props : `{ alertes: AlerteDashboard[]; year: number }`

Affichage :
- Titre avec icône triangle Lucide (`AlertTriangle`) en rouge
- Badges compteurs à côté : "X critiques" (fond rouge), "Y modérées" (fond orange)
  - Critiques = impact ≥ 80
  - Modérées = impact < 80
- Liste d'alertes, chacune avec :
  - Barre latérale gauche 4px : rouge (impact ≥ 80), orange (40-79), bleu (<40)
  - Texte principal (bold) + détail
  - Badge "impact XX" discret
  - Mois concerné
  - Bouton action → navigate vers la page appropriée :
    - `releve_manquant` → `/import`
    - `export_manquant` → `/export`
    - `justificatifs_manquants` → `/rapprochement`
    - `categorisation_incomplete` → `/editor?file=...`
    - `lettrage_incomplet` → `/editor?file=...`

### 4h. FiscalDeadlines.tsx

**V1 statique** — données hardcodées dans le composant (les barèmes JSON existent mais l'intégration complète est un chantier séparé).

Props : aucun (données internes pour le moment)

4 chips horizontales avec :
- Label (URSSAF T1, T2, T3, T4 / CARMF / ODM / Acompte IR)
- Montant estimé
- Badge J-XX ou "Payé" (vert barré)
- Couleur : J-7 → rouge, J-30 → orange, J-30+ → vert, Payé → vert + line-through

**TODO en commentaire** : brancher sur les barèmes fiscaux JSON quand le module simulation sera intégré.

### 4i. ActivityFeed.tsx

Props : `{ activites: ActiviteRecente[] }`

Liste verticale compacte :
- Timestamp relatif ("Il y a 2h", "Hier", "Lun.") — utiliser `date-fns` `formatDistanceToNow` ou calcul manuel
- Dot coloré par type :
  - `import` → vert `#1D9E75`
  - `export` → vert
  - `rapprochement` → violet `#7F77DD`
  - `ocr` → orange `#EF9F27`
  - `categorisation` → bleu `#85B7EB`
  - `cloture` → vert
- Texte descriptif
- Séparateur `border-b border-border` entre items

### 4j. RevenueChart.tsx

Props : `{ mois: MoisOverview[] }`

Bar chart Recharts (déjà installé dans le projet) :
- Barres groupées : recettes (vert `#1D9E75`) vs dépenses (rouge `#E24B4A`)
- Axe X : labels mois abrégés
- Axe Y : format "XXk"
- Hauteur : 180px
- Légende custom en dessous (pas celle par défaut de Recharts)
- Ne montrer que les mois avec données (filtrer les mois à 0)

---

## 5. Routing

Le routing existant ne change pas. `/` reste mappé sur `DashboardPage`. On remplace juste le contenu.

---

## 6. Vérifications

- [ ] `GET /api/analytics/year-overview?year=2025` retourne les données correctes
- [ ] Les 12 cartes mois s'affichent avec badges corrects
- [ ] Clic sur une carte → expansion avec montants et boutons
- [ ] Les mois futurs sont visuellement désaturés
- [ ] Les mois passés incomplets ont un indicateur rouge à gauche
- [ ] Le mois courant a une bordure violette
- [ ] La jauge segmentée reflète les 6 critères
- [ ] Les alertes sont triées par impact décroissant
- [ ] Les boutons d'action naviguent vers les bonnes pages
- [ ] Le sparkline BNC s'affiche dans la carte KPI
- [ ] Le feed d'activité montre les actions récentes avec timestamps relatifs
- [ ] Le bar chart recettes/dépenses utilise Recharts
- [ ] `from __future__ import annotations` dans tout nouveau fichier Python
- [ ] Pas de `any` TypeScript
- [ ] Dark theme respecté (CSS variables bg-background, bg-surface, text-text, border-border)
- [ ] PageHeader avec actions prop
- [ ] TanStack Query pour le fetch
- [ ] Responsive : grille mois passe de 6 à 4 à 3 colonnes
- [ ] Lucide React pour les icônes (AlertTriangle, FileText, Download, Check, Clock, etc.)

---

## 7. Mise à jour CLAUDE.md

Après implémentation, mettre à jour :

- Section "Frontend Routes" : mettre à jour la description de `/` (DashboardPage)
- Section "Key Components" : ajouter les nouveaux composants dashboard/
- Section "Backend API Endpoints" : ajouter `GET /api/analytics/year-overview`
- Section "Hooks" : mentionner `useYearOverview`
