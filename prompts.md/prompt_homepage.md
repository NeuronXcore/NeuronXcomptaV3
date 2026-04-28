# HomePage — Vraie page d'accueil avec aurora, next action et quick actions

## À lire avant de coder

1. **`CLAUDE.md`** à la racine — conventions, contraintes Python 3.9, dark theme CSS vars, patterns hooks/composants
2. **`architecture.md`** — couches applicatives, routing actuel, structure sidebar
3. **`frontend/src/components/pipeline/PipelinePage.tsx`** — pattern de page racine actuelle (sera déplacée)
4. **`frontend/src/hooks/usePipeline.ts`** — référence pour le calcul de progression mensuelle (réutilisé par la pulse card #1)
5. **`frontend/src/components/layout/Sidebar.tsx`** — pattern d'item hors-groupe avec badge
6. **`backend/main.py`** — pour ajouter le mount statique de `backend/assets/` (logo)
7. **`backend/assets/logo_lockup_dark_400.png`** — vérifier la présence du fichier (PNG transparent ~400px de large, lockup logo + wordmark "NeuronXcompta")

---

## Objectif

Créer une **vraie page d'accueil chaleureuse** à l'ouverture de NeuronXcompta, à la place du Pipeline (qui devient `/pipeline`). Pas de duplication avec le Dashboard V2 : la Home pose la question *« et maintenant ? »* et propulse vers la bonne page.

**Rôles distincts des trois pages "résumé" :**
- **Home (`/`)** — *où en suis-je, que dois-je faire maintenant ?* (forward-looking, épuré)
- **Pipeline (`/pipeline`)** — *où j'en suis dans le processus* (stepper 7 étapes existant)
- **Dashboard (`/dashboard`)** — *comment va l'exercice ?* (analytique rétrospectif existant)

## Contraintes

- **Zéro nouveau endpoint de données backend** — toute la donnée vient des hooks existants (`useCloture`, `useAlertesSummary`, `useOperations`, `useEcheances`, etc.). Une seule modif backend : un `app.mount("/assets", StaticFiles(...))` dans `main.py` pour servir `backend/assets/` (logo).
- TypeScript strict, **aucun `any`**
- **Lucide icons uniquement**, jamais de SVG inline custom (sauf l'anneau de progression)
- **CSS variables dark theme** pour toutes les couleurs sauf l'aurora (qui a des couleurs signature hardcodées)
- TanStack Query pour data fetching
- Animations : **CSS keyframes** pour les entrées staggerées, **rAF (`requestAnimationFrame`)** pour les compteurs
- L'aurora doit être en `pointer-events: none` pour ne pas bloquer les clics

---

## Ordre d'implémentation

1. **Backend** — ajouter mount `/assets` dans `backend/main.py` (1 ligne)
2. **Frontend types** — interfaces `NextActionData`, `PulseCardData`, `HomeData`
3. **Frontend utils** — helpers `getGreeting()`, `formatDateLong()`, ajout `joursFr` si absent
4. **Frontend hooks** — `useCountUp`, `useNextAction`, `useHomeData`
5. **CSS keyframes** — ajouter dans `index.css`
6. **Composants** — `LogoLockup` → `AuroraBackground` → `HeroBlock` → `NextActionCard` → `PulseCard` → `QuickActions` → `HomePage`
7. **Routing** — `App.tsx` : `/` → `HomePage`, `/pipeline` → `PipelinePage`
8. **Sidebar** — ajout item Home en tête, Pipeline juste après avec route `/pipeline`

---

## Sections de la page (ordre vertical)

### 0. LogoLockup (en tête, au-dessus du Hero)

Logo + wordmark "NeuronXcompta" servis depuis `/assets/logo_lockup_dark_400.png` (mount FastAPI). Aligné à gauche, hauteur fixée à **40px**, largeur auto. Margin-bottom 28px pour respirer avant le Hero.

**Animation à l'entrée — 2 phases :**

**Phase 1 (t=0, 300ms)** — `nx-logo-enter` : opacity 0→1, scale 0.96→1, ease-out. Le logo apparaît doucement.

**Phase 2 (t=400ms, 1100ms)** — `nx-shimmer` : un trait de lumière diagonal balaie le logo de gauche à droite. Joue **1× au mount uniquement**, pas de loop.

**Technique du shimmer (mask-image) :**

Le wrapper `<div>` a comme `mask-image` le PNG du logo lui-même (alpha-mode), ce qui clippe tout son contenu à la silhouette du logo. À l'intérieur :
1. Un `<img>` avec le logo (toujours visible, c'est le rendu normal)
2. Un `<div>` overlay positionné `absolute inset-0` avec un `linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)` qui se déplace en `translateX(-100%) → translateX(100%)` sur 1100ms

Résultat : le shimmer est parfaitement clippé à la forme du logo, ne déborde jamais sur le rectangle.

```tsx
// LogoLockup.tsx — squelette
import { useState } from 'react';

export function LogoLockup() {
  return (
    <div className="nx-logo-wrap">
      <img
        src="/assets/logo_lockup_dark_400.png"
        alt="NeuronXcompta"
        className="nx-logo-img"
      />
      <div className="nx-logo-shimmer" aria-hidden />
    </div>
  );
}
```

```css
/* dans index.css ou Tailwind layer */
.nx-logo-wrap {
  position: relative;
  display: inline-block;
  height: 40px;
  opacity: 0;
  animation: nx-logo-enter 300ms ease-out 0ms forwards;
  /* Mask appliqué au wrapper pour clipper l'overlay shimmer à la silhouette du logo */
  -webkit-mask-image: url('/assets/logo_lockup_dark_400.png');
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: left center;
  mask-image: url('/assets/logo_lockup_dark_400.png');
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: left center;
}
.nx-logo-img {
  display: block;
  height: 100%;
  width: auto;
  pointer-events: none;
}
.nx-logo-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    transparent 0%,
    transparent 35%,
    rgba(255, 255, 255, 0.55) 50%,
    transparent 65%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: nx-shimmer 1100ms ease-out 400ms 1 forwards;
  pointer-events: none;
}
```

**Notes** :
- Le PNG doit avoir un canal alpha (background transparent) pour que le mask clippe correctement à la silhouette.
- Le mount FastAPI doit servir `/assets/logo_lockup_dark_400.png` aussi bien en dev (proxy vite) qu'en prod (FastAPI sert le frontend).
- Si le shimmer paraît trop fort, baisser l'opacité du gradient (0.55 → 0.40). S'il paraît trop lent, raccourcir à 900ms.
- **Pas de loop** : la shimmer doit jouer une seule fois à l'ouverture, sinon ça devient une distraction permanente.

### 1. AuroraBackground

3 blobs en `radial-gradient` à très faible opacité, dérivant lentement.

| Blob | Couleur | Position | Taille | Animation |
|------|---------|----------|--------|-----------|
| 1 | `rgba(127,119,221,0.32)` (violet primary) | top: -15%, left: 5% | 55% × 75% | `nx-aurora-1` 24s alternate |
| 2 | `rgba(93,202,165,0.20)` (emerald) | bottom: -25%, right: 0% | 55% × 70% | `nx-aurora-2` 28s alternate |
| 3 | `rgba(239,159,39,0.16)` (amber) | top: 30%, right: 18% | 38% × 50% | `nx-aurora-3` 32s alternate |

Gradient pattern (couleur centre 0% → couleur centre × 0.3 à 35% → transparent à 65%). **Pas de `filter: blur()`** — la diffusion vient du gradient lui-même. `pointer-events: none`, `position: absolute; inset: 0; z-index: 0`. Wrapper `overflow: hidden`.

### 2. HeroBlock — Greeting / Date / Rotating phrase

Trois lignes empilées :

- **Greeting** (`text-[12px] uppercase tracking-[0.10em] text-text-muted mb-2`) : 4 paliers selon `new Date().getHours()` :
  - `< 5h` → "Bonne nuit"
  - `< 12h` → "Bonjour"
  - `< 18h` → "Bon après-midi"
  - `≥ 18h` → "Bonsoir"
- **Date** (`text-[32px] font-medium tracking-tight mb-3 text-text`) : format français long via `formatDateLong()` → "mardi 28 avril 2026"
- **Rotating phrase** (`text-[14px] italic text-text-muted min-h-[18px]`, `transition: opacity 350ms ease`) : rotation toutes les **4500ms** avec cross-fade 350ms parmi 6 phrases :
  1. "Le BNC se construit ligne par ligne"
  2. "Belle journée pour pointer les justificatifs"
  3. "Une compta saine, l'esprit léger"
  4. "L'exercice {year} prend forme, doucement" *(year via `new Date().getFullYear()`)*
  5. "Chaque opération bien classée, un soulagement gagné"
  6. "La rigueur d'aujourd'hui, la sérénité de mai"

Implémentation rotation : `useEffect` + `setInterval` avec cleanup `clearInterval`. Index dans `useState`, le composant gère son propre fade via une classe CSS conditionnelle.

### 3. NextActionCard

Card large avec border-accent primary, icône Lucide à gauche, contenu central, CTA à droite. **Pulse infini** (scale 1 ↔ 1.013, période 3.2s) qui démarre **après** l'entrée (animation-delay 2600ms).

**Algorithme de calcul de la Next Action** (hook `useNextAction(year)`) — premier match gagne :

```typescript
type NextActionKind = 'echeance' | 'uncategorized' | 'orphan_justif' | 'cloture_ready' | 'idle';

interface NextActionData {
  kind: NextActionKind;
  iconName: string;        // nom du composant Lucide
  label: string;           // "À faire maintenant" / "Bel ouvrage" pour idle
  title: string;           // titre principal
  subtitle: string | null; // sous-titre optionnel
  ctaText: string;         // "Voir" / "Ouvrir l'éditeur" / etc.
  ctaPath: string;         // route cible
}
```

**Règles (premier match gagne) :**

1. **Échéance fiscale dans ≤ 7 jours** (depuis `useEcheances` existant) → `kind: 'echeance'`, icon `Clock`, title `"Déclaration ${nom} dans ${N} jours"`, subtitle `"Provision : ${montant} €"`, cta `"Voir"` → `/previsionnel?tab=echeances`
2. Sinon, **> 5 ops non catégorisées** sur le mois courant (depuis `useOperations` filtré sur catégorie vide ou "Autres") → `kind: 'uncategorized'`, icon `Tags`, title `"${N} opérations à catégoriser sur ${moisFr[m]}"`, cta `"Ouvrir l'éditeur"` → `/editor?filter=uncategorized`
3. Sinon, **> 3 justificatifs orphelins** (depuis `useCloture(year)` mois courant : `total - avec_justif`) → `kind: 'orphan_justif'`, icon `Paperclip`, title `"${N} justificatifs en attente d'association"`, cta `"Voir les justificatifs"` → `/justificatifs?filter=sans`
4. Sinon, **mois N-1 ≥ 95% complétion ET non clôturé** → `kind: 'cloture_ready'`, icon `CheckCircle2`, title `"${moisFr[m-1]} prêt à clôturer"`, cta `"Aller à la clôture"` → `/cloture`
5. Sinon, **idle chaleureux** → `kind: 'idle'`, icon `Sparkles`, label `"Bel ouvrage"`, title `"Tout est à jour"`, subtitle `"Plus rien d'urgent — bel exercice"`, cta `"Ouvrir le pipeline"` → `/pipeline`

### 4. PulseCards (3 cards en grid 1fr × 3, gap 14px)

#### Card 1 — Mois en cours
- Label : "{moisFr[m]} {year}" en uppercase
- **Anneau SVG** (r=40, stroke-width 6) qui draw de 0 à `taux_global_mois_courant` en **1.3s ease-out cubic** (delay 1300ms)
  - Calcul `circumference = 2π × 40 ≈ 251.33`
  - `dashoffset` cible = `251.33 × (1 - taux/100)`
  - Animation via keyframes : `from { stroke-dashoffset: 251.33 } to { stroke-dashoffset: var(--ring-target); }` avec `--ring-target` injecté en CSS var inline
- À droite de l'anneau : valeur en grand (`useCountUp` 1.1s) + sous-titre "complétion"

#### Card 2 — Prochaine échéance
- Label "Prochaine échéance"
- Valeur `J–${N}` en grand (CountUp 600ms sur N)
- Sous-titre = nom de l'échéance (ex. "URSSAF T1")

#### Card 3 — Alertes actives
- Label "Alertes actives"
- Dot animé `bg-warning` (8px, animation `nx-dot` 2s pulse opacity 0.7↔1) + nombre (CountUp 600ms)
- Sous-titre = criticité dominante en français : "faible" / "moyenne" / "critique" — calculée client-side : `critique` si ≥ 1 alerte impact ≥ 80, `moyenne` si ≥ 1 entre 40-79, `faible` sinon

**Stagger d'entrée des 3 cards** : 1100ms / 1200ms / 1300ms (animation `nx-fade-up` 320ms ease-out).

### 5. QuickActions (5 boutons en grid 1fr × 5, gap 10px)

| Position | Label | Icon Lucide | Route |
|----------|-------|-------------|-------|
| 1 | Importer | `Upload` | `/import` |
| 2 | OCR | `ScanLine` | `/ocr` |
| 3 | Éditeur | `Pencil` | `/editor` |
| 4 | Justificatifs | `Paperclip` | `/justificatifs` |
| 5 | Rapprocher | `Activity` | `/justificatifs?filter=sans` *(ou route dédiée si elle existe — vérifier)* |

Style : padding `16px 8px`, bg `bg-white/[0.025]`, border `border-white/[0.06]`, radius `12px`. Icône au-dessus, label en dessous (12px font-medium). **Hover** : `bg-primary/10`, `border-primary/30`, `translateY(-2px)`, icon color → `text-primary-light`. Transition `all 180ms ease`.

Stagger d'entrée : 1600ms / 1650ms / 1700ms / 1750ms / 1800ms (animation `nx-fade-up` 280ms).

Précédé d'un label section "Actions rapides" en uppercase 11px tracking-wide muted, fade-in à 1500ms.

---

## Chorégraphie complète (référence visuelle)

| t (ms) | Élément | Animation |
|--------|---------|-----------|
| 0 | LogoLockup | `nx-logo-enter` 300ms (opacity + scale 0.96→1) |
| 200 | Greeting | `nx-fade` 300ms |
| 350 | Date | `nx-fade-up` 400ms |
| 400 | Logo shimmer | `nx-shimmer` sweep 1100ms (joue 1×) |
| 750 | Phrase | `nx-fade` 300ms |
| 900 | NextAction | `nx-slide-up` 450ms |
| 1000 | NextAction days | CountUp rAF 600ms |
| 1100 | Pulse 1 | `nx-fade-up` 320ms |
| 1200 | Pulse 2 | `nx-fade-up` 320ms |
| 1300 | Pulse 3 + ring + %mois CountUp + J-N CountUp | draw 1.3s + counts |
| 1400 | Alertes CountUp | rAF 600ms |
| 1500 | Label "Actions rapides" | `nx-fade` 300ms |
| 1600-1800 | Quick actions ×5 | `nx-fade-up` 280ms (50ms gap) |
| 2600 | NextAction pulse | infini scale 1↔1.013 sur 3.2s |

> Le shimmer du logo joue pendant l'arrivée du greeting/date/phrase, sans conflit visuel (il est confiné à la silhouette du logo, sur la ligne du dessus).

---

## Fichiers à créer

### Composants

```
frontend/src/components/home/
├── HomePage.tsx          # page racine, orchestre les sections
├── LogoLockup.tsx        # logo + wordmark avec animation shimmer
├── AuroraBackground.tsx  # 3 blobs CSS animés
├── HeroBlock.tsx         # greeting + date + rotating phrase
├── NextActionCard.tsx    # card avec pulse
├── PulseCard.tsx         # card générique avec variantes (ring | value | dot)
└── QuickActions.tsx      # 5 boutons grid
```

### Hooks

```
frontend/src/hooks/
├── useNextAction.ts      # calcule la NextActionData
├── useHomeData.ts        # agrège les data des 3 pulse cards
└── useCountUp.ts         # hook réutilisable rAF (cleanup propre à l'unmount)
```

### Types

Ajouter dans `frontend/src/types/index.ts` : `NextActionData`, `NextActionKind`, `PulseCardData`, `PulseCardKind`, `HomeData`.

---

## Fichiers à modifier

### `backend/main.py`
Ajouter le mount statique pour servir le dossier `backend/assets/` (images, futurs fichiers statiques) :

```python
from fastapi.staticfiles import StaticFiles
from backend.core.config import BASE_DIR  # ou le path approprié

# Après la création de l'app FastAPI :
app.mount("/assets", StaticFiles(directory=str(BASE_DIR / "backend" / "assets")), name="assets")
```

Vérifier que `backend/assets/` existe et contient `logo_lockup_dark_400.png`. En dev, le proxy vite (configuré dans `vite.config.ts`) doit déjà transmettre `/assets/*` vers le backend `:8000`. Sinon, ajouter :

```ts
// vite.config.ts
server: {
  proxy: {
    '/assets': 'http://localhost:8000',
    // ... autres proxies existants
  }
}
```

### `frontend/src/App.tsx`
- Ajouter route `/` → `HomePage`
- Modifier route existante `/` (PipelinePage) → `/pipeline`

### `frontend/src/components/layout/Sidebar.tsx`
- Insérer item **Home** en tout premier hors-groupe (icône `Home` ou `Sparkles`, route `/`)
- **Pipeline** reste hors-groupe juste après, route `/pipeline`, badge % conservé
- Le badge sidebar `usePipelineProgress` doit pointer son `navigate('/')` vers `/pipeline`

### `frontend/src/lib/utils.ts`
- Ajouter `joursFr: readonly string[]` si absent (`['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']`)
- Ajouter `getGreeting(date?: Date): string` (4 paliers — voir HeroBlock)
- Ajouter `formatDateLong(date?: Date): string` retournant `"${joursFr[d]} ${jour} ${moisFr[m]} ${year}"`

### `frontend/src/index.css`
Ajouter à la suite des keyframes existantes :

```css
@keyframes nx-fade {
  to { opacity: 1; }
}
@keyframes nx-fade-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes nx-slide-up {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes nx-home-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.013); }
}
@keyframes nx-draw-ring {
  from { stroke-dashoffset: 251.33; }
  /* to: dashoffset défini en var(--ring-target) inline */
}
@keyframes nx-aurora-1 {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(8%, 10%) scale(1.18); }
}
@keyframes nx-aurora-2 {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(-9%, -8%) scale(1.22); }
}
@keyframes nx-aurora-3 {
  0% { transform: translate(0, 0) scale(0.95); }
  100% { transform: translate(7%, -10%) scale(1.12); }
}
@keyframes nx-dot {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
@keyframes nx-logo-enter {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes nx-shimmer {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
```

---

## Code de référence (mockup HTML standalone)

Le mockup interactif validé en discussion avec animations, aurora et chorégraphie complète est disponible. Il sert de **source de vérité visuelle** : timings, opacités, distances de stagger, couleurs aurora — tout y est calibré et approuvé.

> Localisation locale : à mettre dans `docs/mockups/home_mockup.html` côté repo si tu veux le garder en référence.

---

## Verification checklist

- [ ] Route `/` rend `HomePage`, route `/pipeline` rend `PipelinePage` (anciennement `/`)
- [ ] Sidebar : Home en premier hors-groupe avec icône, Pipeline juste après avec badge % (route mise à jour)
- [ ] **Backend `/assets/logo_lockup_dark_400.png` accessible** : `curl http://localhost:8000/assets/logo_lockup_dark_400.png -I` retourne 200
- [ ] **Logo apparaît au top-left** de la HomePage avec fade-in scale 0.96→1 au mount (300ms)
- [ ] **Shimmer du logo joue exactement 1× au mount**, balayage diagonal sur 1100ms à t=400ms — ne pas relancer en boucle
- [ ] Le shimmer est **clippé à la silhouette du logo** (mask-image fonctionne) — pas de rectangle blanc visible autour du PNG
- [ ] Le shimmer ne déclenche pas de relayout : `transform: translateX()` only, pas de `left/top`
- [ ] Greeting change selon l'heure du browser (test : modifier l'heure système)
- [ ] Date affichée en français long format ("mardi 28 avril 2026")
- [ ] Phrase tourne toutes les 4.5s avec cross-fade 350ms (testable en attendant ~5s)
- [ ] Phrase #4 contient l'année courante via `new Date().getFullYear()`
- [ ] **NextAction algo** — tester chacun des 5 cas en mockant les données ou en modifiant les seuils :
  - [ ] Cas 1 (échéance ≤ 7j) : créer une échéance fictive proche → NextAction la propose
  - [ ] Cas 2 (uncategorized > 5) : avoir 6+ ops sans catégorie sur le mois → NextAction propose l'éditeur
  - [ ] Cas 3 (orphan justif > 3) : avoir 4+ ops sans justif sur le mois → NextAction propose les justifs
  - [ ] Cas 4 (cloture ready) : mois N-1 à 95%+ non clôturé → NextAction propose la clôture
  - [ ] Cas 5 (idle) : tout vide / parfait → message chaleureux
- [ ] Anneau de progression draw correctement à la valeur réelle du mois courant (`taux_global` depuis `useCloture(year)`)
- [ ] Compteurs CountUp affichent toujours des **entiers** (pas de glitch float type `71.99999`)
- [ ] NextAction pulse infini démarre bien à t=2600ms (pas avant)
- [ ] Aurora drift visible mais subtil — vérifier sur écran calibré que les blobs ne sont pas trop saturés
- [ ] Hover des QuickActions : lift -2px + bordure accent + couleur icône change
- [ ] Pas de régression sur PipelinePage (vérifier que l'ancienne home fonctionne identiquement à `/pipeline`)
- [ ] Badge sidebar Pipeline pointe désormais vers `/pipeline` (pas `/`)
- [ ] **Pas de TypeScript `any` introduit** — `npx tsc -p tsconfig.app.json --noEmit` passe à 0 erreur
- [ ] Pas de `useEffect` mal nettoyé : tester unmount/remount via navigation rapide
- [ ] Aucun nouveau endpoint de données backend créé (le mount `/assets` n'est pas un endpoint applicatif)

---

## Acceptance — démo finale

À l'ouverture de l'app à `/`, l'utilisateur voit en ~1.9s la chorégraphie complète :

1. Le logo NeuronXcompta apparaît en haut à gauche (fade + slight scale-in)
2. Un trait de lumière diagonal balaie le logo (shimmer, 1×)
3. Une salutation contextuelle ("Bonsoir" à 21h, "Bonjour" à 9h) apparaît
4. La date complète du jour suit
5. Une phrase d'ambiance fade-in et tournera ensuite toutes les 4.5s
6. La carte "À faire maintenant" slide-up et commence à pulser doucement
7. Les 3 indicateurs cascade (anneau qui se draw, compteurs qui filent)
8. Les 5 actions rapides arrivent une par une
9. L'aurora dérive en arrière-plan (visible mais subtile, jamais distrayante)

Le tout sur fond `bg-background` avec les couleurs CSS vars existantes — l'aurora apporte la chaleur signature, le logo ancre la marque, le shimmer donne le moment "premium" à l'ouverture.
