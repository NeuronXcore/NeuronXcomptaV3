# Prompt Claude Code — Ventilation d'opérations

> Lire `CLAUDE.md` en premier.

## Contexte

Cas d'usage : un prélèvement bancaire unique (ex: Amazon) correspond à plusieurs factures avec des catégories différentes. On veut pouvoir **ventiler** une opération en N sous-lignes, chacune avec son montant, sa catégorie, sa sous-catégorie et son justificatif.

Règles métier :
- L'opération bancaire reste unique (mouvement réel)
- `sum(ventilation[].montant)` **doit** égaler le montant de l'opération (débit ou crédit)
- Chaque sous-ligne peut être rapprochée individuellement avec un justificatif
- Une opération ventilée est considérée **lettrée** si toutes ses sous-lignes sont lettrées
- Une opération ventilée est considérée **justifiée** si toutes ses sous-lignes ont un justificatif
- Dans les analytics, les sous-lignes comptent individuellement par catégorie (pas l'opération parente)
- La catégorie de l'opération parente passe à `"Ventilé"` quand la ventilation est active

---

## 1. Backend — Modèle

### Fichier : `backend/models/operation.py`

Ajouter le modèle `VentilationLine` et le champ sur l'opération :

```python
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel

class VentilationLine(BaseModel):
    index: int  # 0-based, position dans la ventilation
    montant: float
    categorie: str = ""
    sous_categorie: str = ""
    libelle: str = ""  # description libre (ex: "Cartouches imprimante")
    justificatif: Optional[str] = None
    lettre: bool = False
```

Dans le schéma Operation existant (ou dans `types/index.ts` côté frontend), ajouter :

```python
ventilation: list[VentilationLine] = []  # [] = non ventilée
```

---

## 2. Backend — Service

### Fichier : `backend/services/ventilation_service.py` (nouveau)

```python
from __future__ import annotations
from typing import Optional
import json
from pathlib import Path
from backend.core.config import OPERATIONS_DIR

def set_ventilation(filename: str, op_index: int, lines: list[dict]) -> dict:
    """
    Remplace la ventilation d'une opération.
    Valide que sum(montants) == montant opération.
    Met la catégorie parente à "Ventilé" si lines non vide, restore si vide.
    Retourne l'opération mise à jour.
    """

def remove_ventilation(filename: str, op_index: int) -> dict:
    """
    Supprime la ventilation, remet catégorie à "" (sera recatégorisée).
    """

def update_ventilation_line(filename: str, op_index: int, line_index: int, updates: dict) -> dict:
    """
    Met à jour un champ d'une sous-ligne (catégorie, justificatif, lettre...).
    """
```

Fonctions internes :
- `_validate_ventilation(operation: dict, lines: list[dict]) -> None` : raise `ValueError` si somme != montant (tolérance 0.01€)
- `_reindex_lines(lines: list[dict]) -> list[dict]` : recalcule les index 0..N-1

### Fichier : `backend/services/operation_service.py` — modifications

Dans `_sanitize_value()`, gérer le champ `ventilation` (liste de dicts).

### Fichier : `backend/services/cloture_service.py` — modifications

Dans `get_annual_status()`, pour le calcul de `taux_justificatifs` et `taux_lettrage` :
- Si `op.ventilation` est non vide → compter chaque sous-ligne individuellement
- `nb_justificatifs_ok` += nombre de sous-lignes avec `justificatif` non null
- `nb_justificatifs_total` += nombre de sous-lignes (pas 1 pour l'op parente)
- `nb_lettrees` += nombre de sous-lignes avec `lettre == True`
- Même logique : une op ventilée ne compte pas comme une seule op pour ces taux

### Fichier : `backend/services/analytics_service.py` — modifications

Dans les fonctions de résumé par catégorie (`get_summary`, `get_dashboard`, `get_category_detail`, `get_compare`) :
- Si `op.ventilation` est non vide → itérer sur les sous-lignes au lieu de l'op parente
- Chaque sous-ligne contribue son `montant` à sa propre `categorie`
- L'op parente (catégorie "Ventilé") n'apparaît PAS dans les ventilations analytiques

### Fichier : `backend/services/alerte_service.py` — modifications

Dans `compute_alertes()` :
- Type `justificatif_manquant` : pour une op ventilée, créer une alerte par sous-ligne sans justificatif (pas une seule alerte pour l'op entière)

### Fichier : `backend/services/rapprochement_service.py` — modifications

Dans les fonctions de suggestions et d'association :
- Ajouter un paramètre optionnel `ventilation_index: Optional[int]`
- Si fourni, l'association écrit le justificatif dans `ventilation[ventilation_index].justificatif` au lieu de `op.justificatif`
- Les suggestions pour une sous-ligne utilisent `sous_ligne.montant` (pas le montant total de l'op)

---

## 3. Backend — Router

### Fichier : `backend/routers/ventilation.py` (nouveau)

Prefix : `/api/ventilation`

| Méthode | Route | Description |
|---------|-------|-------------|
| `PUT` | `/{filename}/{op_index}` | Créer/remplacer la ventilation. Body : `{ "lines": [...] }` |
| `DELETE` | `/{filename}/{op_index}` | Supprimer la ventilation |
| `PATCH` | `/{filename}/{op_index}/{line_index}` | Modifier une sous-ligne. Body : `{ "categorie": "...", ... }` |

Validation dans le router :
- `lines` : au moins 2 éléments (sinon pas de ventilation)
- Chaque `line.montant` > 0
- `sum(montants)` == montant opération (tolérance 0.01€) → 422 si écart

Réponse : l'opération complète mise à jour (avec `ventilation` peuplée).

### Fichier : `backend/main.py`

Ajouter `from backend.routers import ventilation` + `app.include_router(ventilation.router)`.

### Fichier : `backend/routers/rapprochement.py` — modifications

`POST /associate-manual` : accepter champ optionnel `ventilation_index` dans le body. Si présent, passer au service pour écrire dans la sous-ligne.

---

## 4. Frontend — Types

### Fichier : `frontend/src/types/index.ts`

```typescript
export interface VentilationLine {
  index: number;
  montant: number;
  categorie: string;
  sous_categorie: string;
  libelle: string;
  justificatif: string | null;
  lettre: boolean;
}
```

Ajouter à l'interface `Operation` :

```typescript
ventilation?: VentilationLine[];
```

---

## 5. Frontend — Hook

### Fichier : `frontend/src/hooks/useVentilation.ts` (nouveau)

```typescript
// useSetVentilation — PUT /api/ventilation/{filename}/{opIndex}
// body: { lines: VentilationLine[] }
// onSuccess: invalidate ['operations', filename]

// useRemoveVentilation — DELETE /api/ventilation/{filename}/{opIndex}
// onSuccess: invalidate ['operations', filename]

// useUpdateVentilationLine — PATCH /api/ventilation/{filename}/{opIndex}/{lineIndex}
// body: Partial<VentilationLine>
// onSuccess: invalidate ['operations', filename]
```

3 mutations TanStack Query, pattern standard du projet.

---

## 6. Frontend — Composants

### Fichier : `frontend/src/components/editor/VentilationDrawer.tsx` (nouveau)

Drawer 600px ouvert depuis le bouton "Ventiler" d'une opération.

**Structure :**
- Header : libellé opération + montant total (badge)
- Tableau sous-lignes éditable :
  - Colonnes : Montant (input number, step 0.01), Catégorie (select), Sous-catégorie (select dépendant), Libellé (input text), Actions (supprimer ligne)
  - Bouton `+ Ajouter une ligne` en bas
- Barre solde : `Reste à ventiler : XX,XX €` — vert si 0, rouge sinon
  - Calcul : `montant_op - sum(lignes)`, affiché en temps réel
- Boutons footer : `Annuler` / `Valider` (disabled si reste ≠ 0 ou < 2 lignes)
- Bouton `Supprimer la ventilation` (si déjà ventilée, avec confirmation)

**Comportement :**
- À l'ouverture sur une op non ventilée : 2 lignes vides pré-créées, la 1ère avec le montant total
- À l'ouverture sur une op déjà ventilée : charge les lignes existantes
- Les selects catégorie/sous-catégorie utilisent les mêmes données que EditorPage
- Icône : `Scissors` (lucide-react)

### Fichier : `frontend/src/components/editor/VentilationLines.tsx` (nouveau)

Composant pour afficher les sous-lignes indentées sous une opération ventilée dans le tableau de l'éditeur.

**Affichage dans EditorPage :**
- Sous l'opération parente (qui affiche catégorie "Ventilé" en badge gris), N lignes indentées (padding-left + trait vertical fin)
- Chaque sous-ligne affiche : montant, catégorie (badge couleur), sous-catégorie, libellé, icône trombone si justificatif
- Clic sur la ligne parente → ouvre `VentilationDrawer`
- Pas d'édition inline des sous-lignes (tout passe par le drawer)

### Fichier : `frontend/src/components/editor/EditorPage.tsx` — modifications

- Ajouter bouton `Scissors` dans la colonne actions (à côté de suppression) → ouvre `VentilationDrawer`
- Après chaque ligne d'opération ventilée (`op.ventilation?.length > 0`), rendre `<VentilationLines>` 
- La ligne parente affiche catégorie = "Ventilé" (badge gris), le montant reste affiché
- En mode année complète (lecture seule) : les sous-lignes sont visibles mais le bouton Scissors est masqué

### Fichier : `frontend/src/components/rapprochement/RapprochementManuelDrawer.tsx` — modifications

- Si l'opération est ventilée, afficher un sélecteur de sous-ligne en haut du drawer : "Rapprocher pour la sous-ligne N : [libellé] (XX,XX €)"
- Le montant utilisé pour le scoring est celui de la sous-ligne sélectionnée
- L'association passe `ventilation_index` dans le body

---

## 7. Routing & sidebar

Pas de nouvelle route. Pas de nouvelle entrée sidebar. La ventilation est intégrée dans l'éditeur existant.

---

## 8. CLAUDE.md — Ajouts

### Section Architecture

Ajouter :

```
- **Ventilation**: Une opération bancaire peut être ventilée en N sous-lignes (≥2) avec catégorie, sous-catégorie, montant et justificatif individuels. sum(montants) doit égaler le montant de l'opération. Catégorie parente = "Ventilé". Les analytics, lettrage, justificatifs et clôture itèrent sur les sous-lignes au lieu de l'op parente. Données inline dans l'opération JSON (champ `ventilation: []`).
```

### Section Backend API Endpoints

Ajouter :

```
| ventilation | `/api/ventilation` | PUT /{file}/{idx}, DELETE /{file}/{idx}, PATCH /{file}/{idx}/{line_idx} |
```

### Section Patterns to Follow

Ajouter :

```
- **Ventilation opérations** : bouton Scissors dans EditorPage ouvre VentilationDrawer (600px). Sous-lignes indentées sous l'op parente. sum(montants) == montant op (tolérance 0.01€). Catégorie parente = "Ventilé". Rapprochement par sous-ligne via `ventilation_index`. Analytics/clôture itèrent les sous-lignes.
```

### Section Dependencies

Aucune nouvelle dépendance.

---

## 9. Ordre d'implémentation

1. `backend/models/operation.py` — VentilationLine model
2. `backend/services/ventilation_service.py` — CRUD ventilation (nouveau)
3. `backend/routers/ventilation.py` — 3 endpoints (nouveau)
4. `backend/main.py` — inclure le router
5. `backend/services/operation_service.py` — sanitize ventilation
6. `backend/services/cloture_service.py` — taux lettrage/justificatifs avec sous-lignes
7. `backend/services/analytics_service.py` — ventilation dans résumés catégories
8. `backend/services/alerte_service.py` — alertes par sous-ligne
9. `backend/services/rapprochement_service.py` — association par sous-ligne
10. `backend/routers/rapprochement.py` — champ ventilation_index
11. `frontend/src/types/index.ts` — VentilationLine + champ Operation
12. `frontend/src/hooks/useVentilation.ts` — 3 mutations
13. `frontend/src/components/editor/VentilationDrawer.tsx` — drawer formulaire
14. `frontend/src/components/editor/VentilationLines.tsx` — sous-lignes indentées
15. `frontend/src/components/editor/EditorPage.tsx` — bouton Scissors + rendu sous-lignes
16. `frontend/src/components/rapprochement/RapprochementManuelDrawer.tsx` — sélecteur sous-ligne
17. `CLAUDE.md` — documenter la feature

---

## 10. Checklist de vérification

- [ ] `VentilationLine` Pydantic model avec `from __future__ import annotations`
- [ ] `PUT /api/ventilation/{file}/{idx}` crée la ventilation, valide somme == montant (422 si écart > 0.01)
- [ ] `DELETE /api/ventilation/{file}/{idx}` supprime et remet catégorie à ""
- [ ] `PATCH /api/ventilation/{file}/{idx}/{line_idx}` met à jour une sous-ligne
- [ ] Catégorie parente = "Ventilé" quand ventilation active
- [ ] `cloture_service` : taux lettrage et justificatifs comptent les sous-lignes individuellement
- [ ] `analytics_service` : résumés par catégorie itèrent les sous-lignes, "Ventilé" n'apparaît pas
- [ ] `alerte_service` : une alerte par sous-ligne sans justificatif
- [ ] `rapprochement_service` : association avec `ventilation_index` écrit dans la bonne sous-ligne
- [ ] Frontend : `VentilationDrawer` s'ouvre, solde temps réel, validation ≥ 2 lignes
- [ ] Frontend : sous-lignes indentées visibles dans EditorPage sous l'op parente
- [ ] Frontend : `RapprochementManuelDrawer` propose sélection sous-ligne si op ventilée
- [ ] Mode année complète : sous-lignes visibles, bouton Scissors masqué
- [ ] Les opérations JSON existantes sans `ventilation` chargent normalement (champ absent = `[]`)
- [ ] `CLAUDE.md` mis à jour (architecture, endpoints, patterns)
- [ ] Pas de `any` TypeScript, `from __future__ import annotations` partout
