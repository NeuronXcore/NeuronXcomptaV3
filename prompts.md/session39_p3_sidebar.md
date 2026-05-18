# Session 39 — P3 : entrée sidebar « Vérification plaquette »

> **Dépendances** : P1 (`PlaquetteCheckStatus`) **et** P2 (`risque_fiscal`) mergés.
> Sans P2, le badge ne peut pas dériver le niveau de risque — refuser d'exécuter si
> les champs ne sont pas en place côté backend.
>
> **Token budget** : ~1.5 k tokens. Prompt court, frontend-dominé.

## Objectif

Exposer l'accès au module Vérification plaquette dans la sidebar (groupe CLÔTURE,
après `Check d'envoi`), avec un badge dynamique qui dérive du statut et du niveau
de risque agrégé pour l'année sélectionnée. Pattern bouton-drawer (comme `Envoi
comptable`) — pas de nouvelle page, ouvre directement le `PlaquetteCheckDrawer`
existant via `plaquetteCheckDrawerStore.open(year)`.

## Contexte

Aujourd'hui le drawer Plaquette n'est accessible que depuis la GED, en cliquant sur
un document `plaquette_comptable` puis sur le bouton « Ouvrir vérification ». Avec
les ajouts P1 (cycle de vie 3 statuts) + P2 (score risque par item), le drawer porte
une vraie épaisseur fonctionnelle qui mérite un accès direct sans passer par la GED.
Bénéfice secondaire : permettre à l'utilisateur d'**anticiper** la vérification avant
même réception de la plaquette du comptable (consultation des agrégats NeuronX,
estimation pré-réception).

## Backend

### 1. Endpoint summary — `backend/routers/plaquette.py`

Nouveau endpoint léger consommé par le badge sidebar (polling sidebar potentiel,
doit être rapide) :

```python
@router.get("/{year}/summary")
def get_plaquette_summary(year: int) -> dict:
    """
    Retourne un résumé léger pour le badge sidebar.
    Ne déclenche PAS de recalcul risque (lit le cache via load_or_create_check
    qui gère déjà le caching côté plaquette_service).
    """
```

Réponse :

```json
{
  "year": 2025,
  "exists": true,
  "status": "en_cours",
  "has_plaquette_upload": false,
  "n_items_total": 28,
  "n_a_challenger": 5,
  "n_en_discussion": 2,
  "n_resolu": 8,
  "n_risque_critique": 1,
  "n_risque_eleve": 3,
  "risque_score_global": 1.8,
  "declared_at": null,
  "declaration_ref": null
}
```

Si `exists=false`, retourne uniquement `{year, exists: false}`. Pas de 404 — le badge
sidebar interroge l'année courante même quand rien n'existe (gracieux). Cache HTTP
`Cache-Control: private, max-age=10` pour limiter le poll.

## Frontend

### 1. Types — `frontend/src/types/plaquette.ts`

```typescript
export interface PlaquetteSummary {
  year: number;
  exists: boolean;
  status: PlaquetteCheckStatus | null;
  has_plaquette_upload: boolean;
  n_items_total: number;
  n_a_challenger: number;
  n_en_discussion: number;
  n_resolu: number;
  n_risque_critique: number;
  n_risque_eleve: number;
  risque_score_global: number | null;
  declared_at: string | null;
  declaration_ref: string | null;
}
```

### 2. Hook — `frontend/src/hooks/usePlaquetteCheck.ts`

```typescript
export const usePlaquetteSummary = (year: number) => {
  return useQuery({
    queryKey: ['plaquette-summary', year],
    queryFn: () => apiClient.get<PlaquetteSummary>(`/api/plaquette/${year}/summary`),
    staleTime: 30_000, // 30s
    refetchOnWindowFocus: true,
  });
};
```

Invalider sur toute mutation plaquette : ajouter `qc.invalidateQueries({ queryKey: ['plaquette-summary'] })`
dans les `onSuccess` des hooks `usePatchPlaquetteItem`, `usePatchPlaquetteStatus`,
`useFinalizePlaquette`, `useLogComptableResponse`, `usePatchItemRisque`, etc.

### 3. Composant badge — `frontend/src/components/layout/PlaquetteSidebarBadge.tsx` (**NOUVEAU**)

Composant local consommé uniquement par la sidebar :

```typescript
interface PlaquetteSidebarBadgeProps { year: number; }
```

Logique d'affichage (ordre de priorité, premier vrai gagne) :

| Condition | Badge | Couleur | Tooltip |
|---|---|---|---|
| `!exists` | aucun | — | « Aucune vérification démarrée pour {year} » |
| `status === 'declare'` | icône `Lock` | vert foncé (`bg-emerald-500/15 text-emerald-400`) | « Déclaré le {date short} » |
| `n_risque_critique > 0` | `{n}!` | rouge (`bg-red-500/15 text-red-400`) | « {n} risque(s) critique(s) à traiter » |
| `n_risque_eleve > 0` | `{n}!` | orange (`bg-orange-500/15 text-orange-400`) | « {n} risque(s) élevé(s) à traiter » |
| `n_a_challenger > 0` | `{n}` | ambre (`bg-amber-500/15 text-amber-400`) | « {n} item(s) à challenger » |
| sinon | aucun | — | — |

Cohérence visuelle avec les badges `Check d'envoi` et `Pipeline` déjà en sidebar
(même taille, mêmes utilities Tailwind, position à droite du label).

### 4. Sidebar — `frontend/src/components/layout/Sidebar.tsx`

Ajouter l'entrée dans le groupe **CLÔTURE**, **après `Check d'envoi`** :

```typescript
{
  label: 'Vérification plaquette',
  icon: FileSearch,  // lucide-react
  type: 'button-drawer',
  onClick: () => plaquetteCheckDrawerStore.getState().open({
    year: selectedYear,
    gedDocId: null,  // ouverture sans contexte GED
  }),
  badge: <PlaquetteSidebarBadge year={selectedYear} />,
}
```

`selectedYear` lu via `useFiscalYearStore((s) => s.selectedYear)`. Si la sidebar
utilise une structure d'items déclarative ailleurs (à vérifier dans le fichier),
adapter au pattern en place — copier exactement le style de l'entrée `Envoi
comptable` qui est déjà un bouton-drawer.

### 5. Store ouverture sans GED — `frontend/src/stores/plaquetteCheckDrawerStore.ts`

Étendre `OpenPayload` :

```typescript
interface OpenPayload {
  year: number;
  gedDocId: string | null;  // null = ouverture sidebar
  initialTab?: 'comparatif' | 'saisie' | 'email' | 'archives' | 'journal';
}
```

### 6. Gestion gracieuse « pas de plaquette uploadée » — `frontend/src/components/plaquette/PlaquetteCheckDrawer.tsx`

Quand `gedDocId === null` ET `!check.has_plaquette_upload`, afficher en haut du drawer
(au-dessus du bandeau BNC) une card info ambre discrète :

```
┌─────────────────────────────────────────────────────────────────────┐
│ ℹ Aucune plaquette comptable {year} n'est encore téléversée.       │
│                                                                     │
│ Vous pouvez quand même préparer la vérification en consultant vos  │
│ agrégats NeuronX ci-dessous. Saisissez les montants plaquette       │
│ manuellement, ou téléversez le PDF dès réception du comptable.      │
│                                                                     │
│ [Téléverser la plaquette →]  (lien /ged?type=plaquette_comptable&year={year})│
└─────────────────────────────────────────────────────────────────────┘
```

Le drawer reste pleinement fonctionnel — l'utilisateur peut éditer les montants
plaquette manuellement (déjà supporté par `PATCH /items/{id}`), poser des
commentaires, etc.

### 7. Sélecteur d'année dans le drawer — `frontend/src/components/plaquette/PlaquetteCheckDrawer.tsx`

Petite amélioration UX : ajouter à côté du titre header un `<select>` discret avec
les années pour lesquelles `GET /api/plaquette/{year}/exists` retourne `true`, plus
l'année courante de `useFiscalYearStore` et `selectedYear - 1`. Permet de switcher
sans fermer le drawer.

Si non trivial (route `exists` doit être appelée pour chaque candidat), différer cette
amélioration et ne mettre qu'un texte statique `{year}` pour cette session.

## Documentation (même commit)

### `CLAUDE.md`

Dans le tableau **Sidebar Navigation**, mettre à jour la ligne CLÔTURE :

```
| **CLÔTURE** | Clôture, Amortissements, Charges forfaitaires, Export Comptable, Check d'envoi, **Vérification plaquette** |
```

Dans la rubrique **Vérification plaquette comptable**, ajouter une phrase : « Accessible
depuis la sidebar (groupe CLÔTURE, bouton-drawer pattern) et depuis le drawer GED sur
les documents `plaquette_comptable`. »

### `CHANGELOG.md`

```
### Added (YYYY-MM-DD) — Plaquette : entrée sidebar avec badge dynamique (Session 39 — P3)
- Endpoint léger `GET /api/plaquette/{year}/summary` pour le badge.
- Entrée sidebar `Vérification plaquette` dans le groupe CLÔTURE, après Check d'envoi.
- Badge dynamique : vert (déclaré) / rouge (risque critique) / orange (risque élevé) /
  ambre (items à challenger) selon priorité.
- Ouverture du drawer sans contexte GED (pré-réception plaquette possible).
```

### `api-reference.md`

Documenter `GET /{year}/summary` sous la section Plaquette comptable.

## Vérification

**Backend** :
- [ ] `GET /api/plaquette/2025/summary` → 200 avec tous les compteurs.
- [ ] `GET /api/plaquette/2030/summary` (année inexistante) → 200 `{year: 2030, exists: false}`.
- [ ] Header `Cache-Control: private, max-age=10` présent.

**Frontend** :
- [ ] Entrée sidebar visible dans CLÔTURE, position correcte (après Check d'envoi).
- [ ] Clic → ouvre `PlaquetteCheckDrawer` pour `selectedYear`.
- [ ] Badge dynamique :
  - Test scénario 1 : exercice avec 5 `a_challenger`, 0 risque élevé → badge ambre `5`.
  - Test scénario 2 : ajouter 1 item override `critique` → badge rouge `1!`.
  - Test scénario 3 : finaliser (P1) → badge vert avec icône Lock.
- [ ] Ouverture sidebar avec selectedYear=année sans upload plaquette → drawer affiche
      la card info ambre + lien GED fonctionnel.
- [ ] Switch selectedYear depuis la sidebar → badge se met à jour (invalidation
      `['plaquette-summary']` câblée).
- [ ] `npx tsc --noEmit && npm run lint` clean.

**Smoke test cross-session** :
- Ouvrir le drawer depuis la sidebar avec un exercice `validation_finale` (P1 mergé).
- Vérifier que le mode read-only est bien actif (P1).
- Vérifier que les chips Risque sont affichées (P2).

**Commit** : `feat(plaquette): entrée sidebar avec badge dynamique (Session 39 P3)`

## Notes

- **Pas de page dédiée** — c'est volontaire. Toutes les fonctionnalités vivent dans
  le drawer existant. Si à terme le besoin émerge d'une vraie page (historique
  multi-années, recherche cross-année, dashboard risque), extraire à ce moment-là.
- **Pas de modification du `plaquetteCheckDrawerStore` au-delà du champ `gedDocId: null`**.
  Le drawer s'adapte au cas « no upload » via une condition dans le composant — pas
  besoin d'un mode dédié.
- **Polling** : staleTime 30s + refetchOnWindowFocus suffit. Pas besoin de SSE ou
  d'intervalle court — les mutations invalident la queryKey explicitement.
- **Hors scope** : sélecteur multi-année dans le drawer (différé si non trivial),
  préchargement du summary pour N-2/N+1 (inutile).
