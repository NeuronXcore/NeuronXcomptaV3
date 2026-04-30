# Prompt Claude Code — Module Rappels Dashboard (V1)

> ⚠️ **Lis `CLAUDE.md` AVANT toute action.** Ce prompt suppose les conventions, paths et patterns documentés.

## 0. Contexte

NeuronXcompta a aujourd'hui un Dashboard (`/dashboard`) qui montre l'état de l'exercice (jauge, KPI, sparkline). Manque un **bandeau proactif** en haut de la page qui dit à l'utilisateur ce qu'il ne faut pas oublier (échéances fiscales, justificatifs en retard, mois non clôturés…).

On construit un **moteur de rappels extensible** + **3 règles pilotes** pour valider l'architecture. Les règles suivantes seront ajoutées au fur et à mesure.

⚠️ **Ne pas confondre avec `/api/alertes`** qui gère le compte d'attente (anomalies sur opérations). Le nouveau module s'appelle **`rappels`** et vit dans son propre namespace.

## 1. Architecture

### Backend

```
backend/models/rappel.py                    # NEW — Pydantic schemas
backend/services/rappels_service.py         # NEW — Engine + context loader
backend/services/rappels_rules/             # NEW — Un fichier par règle
  ├── __init__.py                           # Exporte ALL_RULES (liste)
  ├── _base.py                              # RappelContext + RappelRule protocol
  ├── justificatifs_manquants.py            # Règle 1
  ├── mois_non_cloture.py                   # Règle 2
  └── declaration_2035.py                   # Règle 3
backend/routers/rappels.py                  # NEW — GET /api/rappels, POST /snooze
backend/main.py                             # MODIFY — register router
backend/core/config.py                      # MODIFY — RAPPELS_SNOOZE_FILE
data/rappels_snooze.json                    # NEW — { "rule_id": "ISO_date_expiry" }
```

### Frontend

```
frontend/src/types/index.ts                  # MODIFY — Rappel, RappelLevel, RappelSummary
frontend/src/hooks/useRappels.ts             # NEW — useRappels, useSnoozeRappel
frontend/src/components/dashboard/
  ├── DashboardRappels.tsx                   # NEW — Carte conteneur repliable
  ├── RappelItem.tsx                         # NEW — Ligne individuelle
  └── RappelLevelIcon.tsx                    # NEW — Icône par niveau
frontend/src/components/dashboard/DashboardPage.tsx   # MODIFY — Intégrer en haut
frontend/src/hooks/useSettings.ts            # VERIFY — clé rappels_collapsed
```

### Storage

`data/rappels_snooze.json` est un dict simple :

```json
{
  "justif_manquant_30j": "2026-05-06T00:00:00",
  "decl_2035_2026": "2026-05-15T00:00:00"
}
```

Snooze = 7 jours par défaut (configurable côté serveur via constante).

## 2. Modèles Pydantic — `backend/models/rappel.py`

```python
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel

RappelLevel = Literal["critical", "warning", "info"]
RappelCategory = Literal["fiscal", "comptable", "scp", "patrimoine", "tresorerie"]


class RappelCTA(BaseModel):
    label: str
    route: str  # ex: "/justificatifs?filter=sans_justif"


class Rappel(BaseModel):
    id: str                       # stable, sert de clé snooze
    niveau: RappelLevel
    categorie: RappelCategory
    titre: str
    message: str
    cta: Optional[RappelCTA] = None
    snoozable: bool = True
    date_detection: str           # ISO date


class RappelsSummary(BaseModel):
    rappels: list[Rappel]
    counts: dict[RappelLevel, int]  # {"critical": 2, "warning": 3, "info": 0}
    total: int


class SnoozeRequest(BaseModel):
    days: int = 7  # 1, 7, 30
```

## 3. Service moteur — `backend/services/rappels_service.py`

### Responsabilités

- Construire le `RappelContext` (charge les données utiles UNE fois, partagé entre toutes les règles)
- Itérer `ALL_RULES`, appeler chaque `evaluate(ctx)`, collecter les rappels
- Filtrer les rappels snoozés (snooze actif si `expiry > now`)
- Trier par niveau (`critical > warning > info`) puis par date_detection
- Gérer le snooze : `snooze_rappel(rule_id, days)` → écrit `now + days` dans `rappels_snooze.json`

### `RappelContext`

Construit dans `_build_context()` une seule fois par requête :

```python
@dataclass
class RappelContext:
    today: date                                       # injectable pour tests
    operation_files: list[dict]                       # operation_service.list_operation_files()
    cloture_status: dict[int, list[dict]]             # {year: cloture_service.get_annual_status(year)}
    settings: dict                                    # settings_service.load_settings()
    snooze_state: dict[str, datetime]                 # rappels actuellement snoozés
```

### Helpers / I/O

- `_load_snooze() -> dict[str, datetime]` — lit `RAPPELS_SNOOZE_FILE`, parse ISO, ignore les expired
- `_save_snooze(state: dict[str, datetime]) -> None` — écrit en JSON ISO
- `_is_snoozed(rule_id: str, snooze_state: dict, today: date) -> bool`
- Cleanup automatique des snoozes expirés à chaque save

### Conventions

- `from __future__ import annotations` en tête
- `Optional[X]` partout, jamais `X | None`
- `ensure_directories()` au top du module si besoin
- Tous les paths via `backend/core/config.py`
- Erreurs de chargement loggées en `warning` mais ne cassent JAMAIS le service (un rappel défaillant ne doit pas masquer les autres)

### API publique

```python
def get_all_rappels(today: Optional[date] = None) -> RappelsSummary: ...
def snooze_rappel(rule_id: str, days: int = 7) -> dict[str, str]: ...
def unsnooze_rappel(rule_id: str) -> None: ...
```

## 4. Règles — `backend/services/rappels_rules/`

### `_base.py`

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional, Protocol

from backend.models.rappel import Rappel


@dataclass
class RappelContext:
    today: date
    operation_files: list[dict]
    cloture_status: dict[int, list[dict]]
    settings: dict
    snooze_state: dict[str, datetime]


class RappelRule(Protocol):
    rule_id: str  # ex: "justif_manquant_30j" — préfixe stable
    
    def evaluate(self, ctx: RappelContext) -> list[Rappel]: ...
```

Une règle peut retourner **0, 1 ou plusieurs rappels** (cas justificatifs : 30j ET 60j = 2 rappels distincts avec ids différents).

### `__init__.py`

```python
from backend.services.rappels_rules.justificatifs_manquants import JustificatifsManquantsRule
from backend.services.rappels_rules.mois_non_cloture import MoisNonClotureRule
from backend.services.rappels_rules.declaration_2035 import Declaration2035Rule

ALL_RULES = [
    JustificatifsManquantsRule(),
    MoisNonClotureRule(),
    Declaration2035Rule(),
]
```

### Règle 1 — `justificatifs_manquants.py`

**Logique** :
1. Itérer toutes les opérations de tous les fichiers de l'année courante
2. Pour chaque op : skip si catégorie exemptée (lire `ctx.settings["justificatif_exemptions"]["categories"]` — liste type `["Perso", "CARMF", "URSSAF", "Honoraires"]`), skip si compte d'attente / cat vide, skip si ventilée (la check ventilation est plus complexe, hors scope V1)
3. Si `op["Lien justificatif"]` est vide ET op a un débit ou crédit non-zero : calculer l'âge (`today - op_date`)
4. Bucketer : `30 ≤ age < 60` → bucket warning, `age >= 60` → bucket critical
5. Si bucket non vide → 1 rappel par bucket

**Format date opération** : `op["Date"]` — string. Utilise `pd.to_datetime` ou `datetime.strptime` selon le format (vérifier dans `operation_service` ou `analytics_service` comment c'est parsé ailleurs ; format probable `"%Y-%m-%d"` ou format français — **inspecter le code existant avant d'implémenter**).

**Rappels produits** :

```python
# Si bucket 30-60j non vide :
Rappel(
    id="justif_manquant_30j",
    niveau="warning",
    categorie="comptable",
    titre=f"{count} justificatifs manquants depuis plus de 30 jours",
    message=f"Total impacté : {format_eur(total_amount)}",
    cta=RappelCTA(label="Voir", route="/justificatifs?filter=sans_justif"),
    snoozable=True,
    date_detection=ctx.today.isoformat(),
)

# Si bucket ≥60j non vide :
Rappel(
    id="justif_manquant_60j",
    niveau="critical",
    ...même schema avec "60 jours" et chiffres correspondants
)
```

### Règle 2 — `mois_non_cloture.py`

**Logique** :
1. Si `today.day <= 15` → return `[]` (on laisse 15 jours de grâce)
2. Calculer `M_minus_1 = today - 1 month` (avec passage d'année)
3. Lire `ctx.cloture_status[M_minus_1.year]`, trouver l'entrée du mois M-1
4. Si cette entrée n'existe pas, ou si `taux_lettrage >= 1.0 AND taux_justificatifs >= 1.0` → return `[]`
5. Sinon → 1 rappel warning

**Rappel produit** :

```python
Rappel(
    id=f"mois_non_cloture_{M_minus_1.year}_{M_minus_1.month:02d}",
    niveau="warning",
    categorie="comptable",
    titre=f"{MOIS_FR[M_minus_1.month-1]} {M_minus_1.year} non clôturé",
    message=f"Lettrage {pct(taux_lettrage)} · Justificatifs {pct(taux_justificatifs)}",
    cta=RappelCTA(label="Clôturer", route=f"/cloture?year={M_minus_1.year}&month={M_minus_1.month}"),
    snoozable=True,
    date_detection=ctx.today.isoformat(),
)
```

`MOIS_FR` est déjà dans `backend/core/config.py`.

### Règle 3 — `declaration_2035.py`

**Logique** :
1. Si `today.month != 4` (avril) → return `[]`
2. Calculer `days_remaining = 30 - today.day`
3. Niveau : `today.day <= 15` → warning, `today.day > 15` → critical
4. Toujours 1 rappel

**Rappel produit** :

```python
niveau = "critical" if ctx.today.day > 15 else "warning"
Rappel(
    id=f"decl_2035_{ctx.today.year}",
    niveau=niveau,
    categorie="fiscal",
    titre="Déclaration 2035 à déposer",
    message=f"Date butoir : 30 avril {ctx.today.year} (dans {days_remaining} jour{'s' if days_remaining > 1 else ''})",
    cta=RappelCTA(label="Préparer", route="/exports"),  # adapter selon route existante pour préparer 2035
    snoozable=True,
    date_detection=ctx.today.isoformat(),
)
```

> Si la route `/exports` n'est pas la bonne pour préparer la 2035, mettre une route plausible existante. Le CTA peut être perfectionné plus tard.

## 5. Router — `backend/routers/rappels.py`

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from backend.models.rappel import RappelsSummary, SnoozeRequest
from backend.services import rappels_service

router = APIRouter(prefix="/api/rappels", tags=["rappels"])


@router.get("", response_model=RappelsSummary)
def get_rappels():
    return rappels_service.get_all_rappels()


@router.post("/{rule_id}/snooze")
def snooze(rule_id: str, payload: SnoozeRequest):
    if payload.days not in (1, 7, 30):
        raise HTTPException(400, "days must be 1, 7 or 30")
    return rappels_service.snooze_rappel(rule_id, payload.days)


@router.delete("/{rule_id}/snooze")
def unsnooze(rule_id: str):
    rappels_service.unsnooze_rappel(rule_id)
    return {"status": "unsnoozed", "rule_id": rule_id}
```

⚠️ **Ordre des routes** : la route racine `GET ""` est OK (pas de collision). Le `{rule_id}` dynamique est dans des sous-paths donc pas de conflit avec d'autres routes.

Enregistrer dans `backend/main.py` (avec les autres `app.include_router(...)`).

## 6. Settings extension

Ajouter dans `backend/models/settings.py` (ou équivalent — chercher la classe `AppSettings`) :

```python
rappels_collapsed: bool = True  # Le bandeau Dashboard est replié par défaut
```

Le frontend utilisera `useSettings()` pour lire/persister cette valeur (pattern existant — chercher `auto_pointage` qui suit exactement le même schema).

## 7. Frontend — Types

Dans `frontend/src/types/index.ts` ajouter :

```typescript
export type RappelLevel = "critical" | "warning" | "info";
export type RappelCategory = "fiscal" | "comptable" | "scp" | "patrimoine" | "tresorerie";

export interface RappelCTA {
  label: string;
  route: string;
}

export interface Rappel {
  id: string;
  niveau: RappelLevel;
  categorie: RappelCategory;
  titre: string;
  message: string;
  cta: RappelCTA | null;
  snoozable: boolean;
  date_detection: string;
}

export interface RappelsSummary {
  rappels: Rappel[];
  counts: Record<RappelLevel, number>;
  total: number;
}
```

⚠️ Pas de `any`. Si besoin, utiliser `unknown` + narrowing.

## 8. Frontend — Hook `useRappels.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { RappelsSummary } from "@/types";

export function useRappels() {
  return useQuery<RappelsSummary>({
    queryKey: ["rappels"],
    queryFn: () => api.get("/rappels"),
    staleTime: 5 * 60 * 1000,  // 5 min — les rappels ne changent pas seconde par seconde
  });
}

export function useSnoozeRappel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, days }: { ruleId: string; days: number }) =>
      api.post(`/rappels/${ruleId}/snooze`, { days }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rappels"] });
    },
  });
}
```

## 9. Frontend — Composants

### `DashboardRappels.tsx` — Conteneur

Comportement :
- Lit `useRappels()` et `useSettings()`
- Si `total === 0` → affiche carte "Tout est à jour" avec icône `Check` cerclée success
- Sinon → carte avec header cliquable (Bell + titre + badges de comptage par niveau + Chevron)
- Le state `collapsed` est persisté via `settings.rappels_collapsed` (use mutation `useUpdateSettings` existant — chercher comment `auto_pointage` toggle est sauvegardé pour suivre le pattern)
- **Par défaut : replié** (`rappels_collapsed: true`)
- Body déplié = liste de `<RappelItem>` séparés par border-tertiary

Structure JSX simplifiée :

```tsx
<div className="bg-surface border border-border rounded-lg overflow-hidden">
  <button onClick={toggleCollapsed} className="w-full flex items-center justify-between px-4 py-3 hover:bg-background transition-colors">
    <div className="flex items-center gap-2.5">
      <Bell className="w-4 h-4 text-text-muted" />
      <span className="font-medium text-sm text-text">À ne pas oublier · {total}</span>
    </div>
    <div className="flex items-center gap-2">
      {counts.critical > 0 && <Badge level="critical">{counts.critical} critique{counts.critical > 1 ? 's' : ''}</Badge>}
      {counts.warning > 0 && <Badge level="warning">{counts.warning} à prévoir</Badge>}
      {counts.info > 0 && <Badge level="info">{counts.info} info</Badge>}
      <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform", !collapsed && "rotate-180")} />
    </div>
  </button>
  {!collapsed && (
    <div className="border-t border-border">
      {rappels.map(r => <RappelItem key={r.id} rappel={r} />)}
    </div>
  )}
</div>
```

### `RappelItem.tsx`

Layout :
- Icône colorée 28px à gauche (par niveau via `RappelLevelIcon`)
- Bloc central : catégorie en uppercase 11px (`text-text-muted`), titre 14px medium, message 13px muted
- Boutons à droite : `[CTA label] [→]` puis `[Reporter] [⏱]` si `snoozable`

Interactions :
- Clic CTA → `navigate(rappel.cta.route)`
- Clic Reporter → menu contextuel ou direct ? **V1 : direct snooze 7 jours**, toast confirm "Reporté de 7 jours". Animation slide-out (transition opacity + translateX 20px + max-height 0 sur 280ms) avant que la mutation `useSnoozeRappel` invalide la query.

### `RappelLevelIcon.tsx`

Mapping :
- `critical` → `AlertCircle` dans cercle `bg-danger/15 text-danger`
- `warning` → `AlertTriangle` dans cercle `bg-warning/15 text-warning`
- `info` → `Info` dans cercle `bg-primary/15 text-primary` (ou couleur info équivalente)

⚠️ Vérifier les classes Tailwind effectives dans `index.css` — utiliser EXCLUSIVEMENT les CSS variables existantes (`bg-warning/15`, `text-danger`, etc.). Pas de hex hardcodés.

## 10. Intégration dans `DashboardPage.tsx`

Insérer `<DashboardRappels />` **TOUT EN HAUT** de la page, AVANT la jauge segmentée et les KPI cards. Il doit être le tout premier élément après `<PageHeader>`.

## 11. Invalidation de cache croisée

Quand l'utilisateur fait des actions qui changent les données sous-jacentes des règles, le cache `['rappels']` doit être invalidé. Ajouter dans les mutations existantes :

- `useAssociateJustificatif` (ou équivalent) → `invalidateQueries(["rappels"])` dans `onSuccess`
- `useDissociateJustificatif` → idem
- Toute mutation qui change `Lien justificatif`, `Catégorie`, `lettre`, ou la clôture mensuelle

⚠️ Ne pas tout invalider partout — viser les ~5-6 mutations qui touchent vraiment les règles V1. Liste à valider en explorant les hooks existants.

## 12. Implementation order

Suivre cet ordre strict pour éviter les imports cassés :

1. `backend/core/config.py` — ajouter `RAPPELS_SNOOZE_FILE`
2. `backend/models/rappel.py` — schemas Pydantic
3. `backend/services/rappels_rules/_base.py` — context + protocol
4. `backend/services/rappels_rules/{justificatifs_manquants,mois_non_cloture,declaration_2035}.py`
5. `backend/services/rappels_rules/__init__.py` — export ALL_RULES
6. `backend/services/rappels_service.py` — engine + I/O snooze
7. `backend/routers/rappels.py` — endpoints
8. `backend/main.py` — register router
9. `backend/models/settings.py` (ou équivalent) — ajouter `rappels_collapsed`
10. **Test backend** : `curl http://localhost:8000/api/rappels` doit renvoyer un payload valide
11. `frontend/src/types/index.ts` — types
12. `frontend/src/hooks/useRappels.ts` — hooks
13. `frontend/src/components/dashboard/RappelLevelIcon.tsx`
14. `frontend/src/components/dashboard/RappelItem.tsx`
15. `frontend/src/components/dashboard/DashboardRappels.tsx`
16. `frontend/src/components/dashboard/DashboardPage.tsx` — intégration
17. Cross-invalidation : modifier les mutations identifiées en §11

## 13. Verification checklist

À cocher après implémentation :

- [ ] Backend démarre sans erreur (`uvicorn` sans warning sur les imports)
- [ ] `GET /api/rappels` renvoie 200 avec un payload `RappelsSummary` valide
- [ ] `POST /api/rappels/test_id/snooze` avec body `{"days": 7}` crée bien l'entrée dans `data/rappels_snooze.json`
- [ ] Un rappel snoozé n'apparaît plus dans la prochaine réponse de `GET /api/rappels`
- [ ] Au-delà de l'expiry, le rappel réapparaît
- [ ] Côté frontend, ouvrir `/dashboard` : le bandeau apparaît tout en haut
- [ ] **État initial = replié** (juste le titre + badges de comptage)
- [ ] Clic sur le header → déplie + persiste `rappels_collapsed: false` dans settings
- [ ] Clic CTA navigue correctement vers la route
- [ ] Clic Reporter → animation slide-out + toast + l'item disparaît
- [ ] Si total = 0 → affiche "Tout est à jour" avec check vert
- [ ] Aucun warning TypeScript (`npx tsc -p tsconfig.app.json --noEmit` clean)
- [ ] Aucune erreur runtime dans la console navigateur
- [ ] Les 3 règles peuvent être désactivées indépendamment en commentant une ligne dans `ALL_RULES` sans casser le reste
- [ ] `from __future__ import annotations` présent dans tous les fichiers Python créés
- [ ] Aucun `Optional` remplacé par `X | None`
- [ ] Aucun `any` TypeScript

## 14. Testabilité (bonus, recommandé)

Pour faciliter les futures règles, structurer pour qu'on puisse tester une règle isolément :

```python
# Quelque part dans backend/services/rappels_service.py
def get_all_rappels(today: Optional[date] = None) -> RappelsSummary:
    if today is None:
        today = date.today()
    ctx = _build_context(today)
    ...
```

`today` injectable permet plus tard d'écrire :

```python
def test_decl_2035_critical_after_april_15():
    rule = Declaration2035Rule()
    ctx = _make_test_context(today=date(2026, 4, 20))
    rappels = rule.evaluate(ctx)
    assert len(rappels) == 1
    assert rappels[0].niveau == "critical"
```

Pas de tests obligatoires en V1 mais l'API doit le permettre.

## 15. Hors scope (pour mémoire, NE PAS implémenter)

- Menu déroulant pour choisir la durée du snooze (1j / 7j / 30j) — V1 = 7j en dur
- Notifications push / toast au démarrage si critique
- Ré-ordonnancement manuel des rappels
- Désactivation/activation de règles via l'UI (Settings)
- Historique des snoozes / des rappels résolus
- Métriques "score de santé comptable" agrégé

Tout ça arrivera dans des prompts ultérieurs après validation UX du V1.

---

**Quand tu as fini, mets à jour `CLAUDE.md`** avec une section dédiée au module Rappels Dashboard (paths, comment ajouter une règle, comment ajouter un niveau de criticité). Signale aussi tout écart vs ce prompt et les routes/clés exactes que tu as utilisées (au cas où certains noms diffèrent de ce que j'ai supposé).
