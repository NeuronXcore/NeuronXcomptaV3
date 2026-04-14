# Prompt Claude Code — Module Échéancier NeuronXcompta V3

## Contexte

Tu travailles sur **NeuronXcompta V3**, une application full-stack de comptabilité pour cabinet dentaire.
Lis **CLAUDE.md** en premier — il contient toutes les contraintes critiques du projet (Python 3.9, dark theme, patterns hooks, etc.).

## Objectif

Implémenter le module **Échéancier** de A à Z : détection automatique des paiements récurrents depuis les relevés bancaires importés, projection calendaire sur 6 mois, et solde prévisionnel.

---

## Fichiers à créer

### Backend

**`backend/services/echeancier_service.py`**

Logique métier complète :

```
- normalize_libelle(libelle: str) -> str
    Supprime les éléments variables (chiffres, références, dates) avec re.sub.
    Exemple : "LOYER JANVIER 2024 REF123456" → "LOYER"

- detect_recurrences(all_operations: list[dict]) -> list[Recurrence]
    Charge tous les fichiers via operation_service.
    Groupe par libellé normalisé.
    Calcule les intervalles en jours entre occurrences (numpy).
    Classifie la périodicité : hebdomadaire(7j), bi_mensuel(15j), mensuel(30j),
      trimestriel(91j), semestriel(182j), annuel(365j). Tolérance ±3 jours.
    Filtre : au moins 2 occurrences ET std_intervalle < 10 jours.
    Score fiabilite = 1 - (std_interval / avg_interval), clampé entre 0 et 1.

- generate_echeancier(recurrences, horizon_mois: int = 6) -> list[Echeance]
    Pour chaque récurrence, projette les prochaines occurrences jusqu'à horizon.
    Chaque échéance a : date_prevue, date_min (−3j), date_max (+3j),
      montant_prevu, incertitude (std montant), statut="prevu".

- compute_solde_previsionnel(solde_actuel: float, echeances: list[Echeance]) -> list[dict]
    Timeline triée par date avec solde cumulé et flag alerte si solde < 0.

- confirm_echeance(echeance_id: str, operation_file: str, operation_index: int)
    Marque une échéance statut="realise" et enregistre le lien vers l'opération réelle.

- get_echeancier_stats(echeances: list[Echeance]) -> dict
    total, par_periodicite (dict), montant_mensuel_moyen, nb_alertes_decouvert.
```

Contraintes :
- `from __future__ import annotations` en tête de fichier
- Utiliser `Optional[X]` (pas `X | None`)
- Appeler `ensure_directories()` au démarrage
- Réutiliser `operation_service.load_operations(filename)` pour charger les données
- Gérer les NaN via `_sanitize_value()` déjà présent dans operation_service

---

**`backend/models/echeancier.py`**

Schémas Pydantic :

```python
class Recurrence(BaseModel):
    id: str                    # hash(libelle_normalized)
    libelle_display: str       # Libellé original de la dernière occurrence
    libelle_normalized: str
    periodicite: str           # hebdomadaire | bi_mensuel | mensuel | trimestriel | semestriel | annuel
    montant_moyen: float
    montant_std: float
    derniere_occurrence: str   # ISO date
    nb_occurrences: int
    fiabilite: float           # 0.0 – 1.0
    categorie: Optional[str]

class Echeance(BaseModel):
    id: str                    # uuid4
    recurrence_id: str
    date_prevue: str
    date_min: str
    date_max: str
    libelle: str
    montant_prevu: float
    incertitude: float
    periodicite: str
    fiabilite: float
    statut: str                # prevu | realise | annule
    operation_liee: Optional[str]   # "filename::index"

class EcheancierStats(BaseModel):
    total: int
    par_periodicite: dict
    montant_mensuel_moyen: float
    nb_alertes_decouvert: int

class ConfirmEcheanceRequest(BaseModel):
    echeance_id: str
    operation_file: str
    operation_index: int

class SoldePrevisionnel(BaseModel):
    date: str
    solde: float
    evenement: str
    montant: float
    alerte: bool
```

---

**`backend/routers/echeancier.py`**

Endpoints :

```
GET  /api/echeancier/recurrences          → list[Recurrence]  (détection depuis tous les fichiers)
GET  /api/echeancier/calendar             → list[Echeance]    (?horizon=6)
GET  /api/echeancier/stats                → EcheancierStats
GET  /api/echeancier/solde-previsionnel   → list[SoldePrevisionnel]  (?solde_actuel=0.0&horizon=6)
PUT  /api/echeancier/{echeance_id}/confirm → Echeance         (body: ConfirmEcheanceRequest)
PUT  /api/echeancier/{echeance_id}/annuler → Echeance
```

---

**`backend/main.py`** — Ajouter le router :

```python
from backend.routers import echeancier
app.include_router(echeancier.router, prefix="/api/echeancier", tags=["echeancier"])
```

---

### Frontend

**`frontend/src/hooks/useEcheancier.ts`**

```typescript
// useRecurrences()     → useQuery queryKey: ['echeancier-recurrences']
// useEcheancier(horizon: number)  → useQuery queryKey: ['echeancier', horizon]
// useEcheancierStats() → useQuery queryKey: ['echeancier-stats']
// useSoldePrevisionnel(soldeActuel, horizon) → useQuery queryKey: ['solde-previsionnel', ...]
// useConfirmEcheance() → useMutation, onSuccess: invalidate ['echeancier', 'echeancier-stats']
// useAnnulerEcheance() → useMutation, onSuccess: invalidate ['echeancier']
```

---

**`frontend/src/types/index.ts`** — Ajouter :

```typescript
interface Recurrence {
  id: string
  libelle_display: string
  libelle_normalized: string
  periodicite: 'hebdomadaire' | 'bi_mensuel' | 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel'
  montant_moyen: number
  montant_std: number
  derniere_occurrence: string
  nb_occurrences: number
  fiabilite: number
  categorie?: string
}

interface Echeance {
  id: string
  recurrence_id: string
  date_prevue: string
  date_min: string
  date_max: string
  libelle: string
  montant_prevu: number
  incertitude: number
  periodicite: string
  fiabilite: number
  statut: 'prevu' | 'realise' | 'annule'
  operation_liee?: string
}

interface SoldePrevisionnel {
  date: string
  solde: number
  evenement: string
  montant: number
  alerte: boolean
}
```

---

**`frontend/src/pages/EcheancierPage.tsx`**

Page complète avec **3 onglets** (pattern identique aux autres pages du projet) :

**Onglet 1 — Calendrier**
- Grille 6 mois × semaines (pattern similaire à `CloturePage`)
- Chaque échéance = badge coloré par périodicité positionné sur sa date prévue
- Clic sur badge → drawer latéral avec détail + bouton confirmer/annuler
- Badge fiabilité : vert ≥0.8, orange ≥0.5, rouge <0.5

**Onglet 2 — Liste**
- Tableau TanStack Table avec colonnes : Date prévue | Libellé | Montant prévu ± incertitude | Périodicité | Fiabilité | Statut | Actions
- Filtre par statut (prevu / realise / annule) et par périodicité
- Tri par date par défaut
- Actions : ✓ Confirmer | ✗ Annuler (seulement si statut=prevu)

**Onglet 3 — Solde prévisionnel**
- `<AreaChart>` Recharts avec `solde` en Y et `date` en X
- Zone rouge si solde < 0 (ReferenceLine y={0} + fill différent)
- MetricCards en haut : solde actuel (input éditable), montant mensuel moyen, nb alertes découvert
- Input `solde_actuel` en euros qui recharge la query via `queryKey`

**PageHeader** :
```tsx
actions={
  <>
    <select value={horizon} onChange={...}>  {/* 3 / 6 / 12 mois */}
    <Button onClick={refetch}>↺ Actualiser</Button>
  </>
}
```

---

**`frontend/src/App.tsx`** — Ajouter la route :

```tsx
import EcheancierPage from './pages/EcheancierPage'
// ...
<Route path="/echeancier" element={<EcheancierPage />} />
```

---

**Navigation** — Ajouter le lien dans le composant sidebar/nav existant :
- Icône : `CalendarClock` (Lucide)
- Label : `Échéancier`
- Path : `/echeancier`

---

## Contraintes de style (dark theme)

- Toutes les couleurs via CSS variables : `bg-background`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`
- Aucune couleur hardcodée (pas de `bg-white`, `text-gray-900`, etc.)
- Classes Tailwind uniquement, `cn()` pour les classes conditionnelles
- Icônes Lucide React exclusivement

## Couleurs des badges de périodicité

```typescript
const PERIODICITE_COLORS: Record<string, string> = {
  hebdomadaire: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  bi_mensuel:   'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  mensuel:      'bg-violet-500/20 text-violet-400 border-violet-500/30',
  trimestriel:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  semestriel:   'bg-orange-500/20 text-orange-400 border-orange-500/30',
  annuel:       'bg-rose-500/20 text-rose-400 border-rose-500/30',
}
```

---

## Ordre d'implémentation recommandé

1. `backend/models/echeancier.py`
2. `backend/services/echeancier_service.py`
3. `backend/routers/echeancier.py`
4. Enregistrement dans `backend/main.py`
5. `frontend/src/types/index.ts` (ajout interfaces)
6. `frontend/src/hooks/useEcheancier.ts`
7. `frontend/src/pages/EcheancierPage.tsx`
8. Ajout route dans `App.tsx` et lien dans la nav

## Validation finale

Après implémentation, vérifie :
- [ ] `npx tsc --noEmit` passe sans erreur
- [ ] `GET /api/echeancier/recurrences` retourne une liste (vide si pas de données)
- [ ] `GET /api/echeancier/calendar?horizon=6` retourne une liste d'échéances projetées
- [ ] La page `/echeancier` s'affiche sans erreur avec les 3 onglets
- [ ] Le graphique Recharts s'affiche dans l'onglet Solde prévisionnel
