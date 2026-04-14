# Implémentation : Système d'Alertes / Compte d'Attente

## Contexte

NeuronXcompta V3 — assistant comptable pour cabinet dentaire.
Stack : FastAPI (Python 3.9+) + React 19 + TypeScript + TailwindCSS 4 + TanStack Query 5.
Stockage : fichiers JSON dans `data/imports/operations/`, PDF relevés dans `data/imports/releves/`.

Contraintes critiques (TOUJOURS respecter) :
- Python 3.9 : `from __future__ import annotations` dans TOUS les fichiers backend
- Utiliser `Optional[X]` (pas `X | None`), `List[X]` avec `from typing import`
- Couleurs via CSS variables : `bg-background`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`
- `PageHeader` utilise le prop `actions` (pas children) pour les boutons
- Hooks : TanStack Query (`useQuery`, `useMutation`, `useQueryClient`) pour TOUS les appels API
- Backend services : toujours appeler `ensure_directories()` en début de service

---

## Objectif

Implémenter un **système d'alertes automatiques** sur les opérations comptables.
Une opération entre en **compte d'attente** (`compte_attente: true`) dès qu'elle a au moins une alerte non résolue.

---

## Fichiers à créer

### 1. `backend/services/alerte_service.py`

Service de calcul des alertes. Fonctions à implémenter :

**`compute_alertes(op, stats, seen_keys) -> List[str]`**

Détecte les alertes sur une opération selon ces règles :
- `"justificatif_manquant"` : `justificatif_filename` absent ET `is_virement_interne` est falsy
- `"a_categoriser"` : champ `categorie` vide, absent, ou égal à `"Non catégorisé"` ou `"?"`
- `"confiance_faible"` : `categorisation_source == "ml"` ET `ml_confidence < 0.60`
- `"montant_a_verifier"` : Z-score > 3.0 (sur `abs(debit or credit)`) via `stats["mean"]` et `stats["std"]`
- `"doublon_suspect"` : même `(libelle, debit, credit)` apparaît plus d'une fois dans le fichier

Ne jamais remettre une alerte déjà présente dans `op["alertes_resolues"]`.

**`refresh_alertes_fichier(operations) -> List[Dict]`**

Recalcule les alertes sur toute la liste :
1. Calcule mean/std des montants (via `statistics` stdlib — pas numpy, pas de NaN)
2. Détecte les doublons par clé `(libelle, debit, credit)`
3. Pour chaque op : appelle `compute_alertes()`, filtre les déjà résolues, met à jour `op["alertes"]` et `op["compte_attente"]`
4. Retourne la liste modifiée en place

Gérer les NaN avec `_sanitize_montant(val) -> float` : retourner `0.0` si `val` est None, NaN ou Inf.

---

### 2. `backend/routers/alertes.py`

Router FastAPI avec prefix `/api/alertes`.

**Endpoints :**

`GET /summary`
- Parcourt tous les fichiers JSON dans `data/imports/operations/`
- Retourne :
```json
{
  "total_en_attente": 12,
  "par_type": {
    "justificatif_manquant": 6,
    "a_categoriser": 4,
    "montant_a_verifier": 1,
    "doublon_suspect": 1,
    "confiance_faible": 0
  },
  "par_fichier": [
    { "filename": "operations_xxx.json", "nb_alertes": 7, "nb_operations": 86 }
  ]
}
```

`GET /{filename}`
- Charge le fichier, retourne uniquement les opérations où `compte_attente == True`
- Inclure l'index original de chaque opération dans un champ `_index`

`POST /{filename}/{index}/resolve`
- Body : `{ "alerte_type": str, "note": Optional[str] }`
- Déplace `alerte_type` de `alertes[]` vers `alertes_resolues[]`
- Met à jour `compte_attente` (false si `alertes` devient vide)
- Sauvegarde le fichier
- Retourne l'opération mise à jour

`POST /{filename}/refresh`
- Force le recalcul complet via `refresh_alertes_fichier()`
- Sauvegarde le fichier
- Retourne `{ "nb_alertes": int, "nb_operations": int }`

---

### 3. `backend/models/alerte.py`

```python
from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel

class AlerteType(str, Enum):
    JUSTIFICATIF_MANQUANT = "justificatif_manquant"
    A_CATEGORISER         = "a_categoriser"
    MONTANT_A_VERIFIER    = "montant_a_verifier"
    DOUBLON_SUSPECT       = "doublon_suspect"
    CONFIANCE_FAIBLE      = "confiance_faible"

class ResolveAlerteBody(BaseModel):
    alerte_type: AlerteType
    note: Optional[str] = None
```

---

### 4. `frontend/src/hooks/useAlertes.ts`

```typescript
export function useAlertesSummary()          // GET /api/alertes/summary — staleTime: 15_000
export function useAlertesFichier(filename)  // GET /api/alertes/{filename} — enabled: !!filename
export function useResolveAlerte(filename)   // POST — invalide alertes + alertes-summary + operations
export function useRefreshAlertes(filename)  // POST /refresh — invalide alertes + operations
```

---

### 5. `frontend/src/types/index.ts` — extensions

Ajouter dans l'interface `Operation` existante :
```typescript
alertes?: AlerteType[]
alertes_resolues?: AlerteType[]
compte_attente?: boolean
alerte_note?: string
_index?: number
```

Ajouter le type :
```typescript
export type AlerteType =
  | 'justificatif_manquant'
  | 'a_categoriser'
  | 'montant_a_verifier'
  | 'doublon_suspect'
  | 'confiance_faible'
```

---

### 6. `frontend/src/components/AlerteBadge.tsx`

Composant badge pour afficher une alerte sur une ligne d'opération.

Config visuelle :
```
justificatif_manquant → icône FileX    — couleur orange  — label "Justif."
a_categoriser         → icône Tag      — couleur yellow  — label "Catégo."
montant_a_verifier    → icône AlertTriangle — couleur red — label "Montant"
doublon_suspect       → icône Copy     — couleur purple  — label "Doublon"
confiance_faible      → icône Brain    — couleur blue    — label "ML < 60%"
```

Props : `{ type: AlerteType, size?: 'sm' | 'md', onResolve?: () => void }`

Si `onResolve` fourni : afficher une croix cliquable sur le badge.
Utiliser `cn()` et les icônes Lucide React.

---

### 7. `frontend/src/pages/AlertesPage.tsx`

Page complète accessible sur `/alertes`.

**Structure :**

```
PageHeader
  title="Compte d'attente"
  description="Opérations nécessitant une action"
  actions={<bouton Rafraîchir>}

// Barre de stats (5 MetricCard)
nb total en attente | justif. manquants | à catégoriser | montants suspects | doublons

// Sélecteur fichier (select ou tabs si <= 6 fichiers)

// Tableau des opérations en attente du fichier sélectionné
Colonnes : Date | Libellé | Débit | Crédit | Alertes (badges) | Actions

// Drawer de résolution (slide depuis la droite, 500px)
Déclenché au clic sur une ligne
Affiche : détail opération + liste des alertes avec bouton "Marquer résolue" par alerte
```

Comportement :
- Tri par défaut : montant_a_verifier en premier, puis justificatif_manquant, puis reste
- Bouton "Résoudre" sur chaque badge dans le drawer → appelle `useResolveAlerte`
- Après résolution complète d'une op : la ligne disparaît du tableau (TanStack Query refetch)
- `LoadingSpinner` pendant les chargements

---

## Fichiers à modifier

### `backend/main.py`
Importer et enregistrer le nouveau router :
```python
from backend.routers.alertes import router as alertes_router
app.include_router(alertes_router)
```

### `backend/services/operation_service.py`
Dans la fonction `save_operations()` (ou équivalent PUT), appeler `refresh_alertes_fichier()` juste avant la sérialisation JSON finale.

### `backend/routers/justificatifs.py`
Dans `associate()` et `dissociate()` : après modification, recharger le fichier d'opérations concerné et appeler `refresh_alertes_fichier()`, puis resauvegarder.

### `backend/routers/operations.py`
Dans `categorize_all()` : après catégorisation, appeler `refresh_alertes_fichier()` avant sauvegarde.

### `frontend/src/App.tsx`
Ajouter la route :
```tsx
<Route path="/alertes" element={<AlertesPage />} />
```

### `frontend/src/components/Sidebar.tsx` (ou nav principal)
Ajouter l'entrée de navigation :
```
icône : AlertTriangle
label : "Compte d'attente"
path  : /alertes
badge : nombre d'opérations en attente (via useAlertesSummary — mis à jour toutes les 30s)
```

### `frontend/src/pages/EditorPage.tsx`
Sur chaque ligne du tableau d'opérations, afficher les badges `<AlerteBadge>` de `op.alertes` si non vide.
Ne pas modifier la logique existante d'édition.

---

## Ordre d'implémentation recommandé

1. `backend/models/alerte.py`
2. `backend/services/alerte_service.py` + tests manuels dans Python REPL
3. `backend/routers/alertes.py` + enregistrement dans `main.py`
4. Modifications `operation_service.py`, `justificatifs.py`, `operations.py`
5. `frontend/src/types/index.ts` — extensions
6. `frontend/src/hooks/useAlertes.ts`
7. `frontend/src/components/AlerteBadge.tsx`
8. `frontend/src/pages/AlertesPage.tsx`
9. Modifications `App.tsx` + Sidebar + `EditorPage.tsx`

---

## Vérification finale

```bash
# Backend : vérifier que le router répond
curl http://localhost:8000/api/alertes/summary

# Frontend : TypeScript sans erreurs
cd frontend && npx tsc --noEmit
```

Aucun placeholder. Toutes les fonctions doivent être complètement implémentées.
