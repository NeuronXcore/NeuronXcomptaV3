# Phase 2 — Propagation du filtre "déjà associé" sur tous les endpoints

## Prérequis

**Phase 1 terminée et commitée** : `get_all_referenced_justificatifs()` et
`invalidate_referenced_cache()` existent dans `justificatif_service.py`.

## Objectif

Appliquer le filtre d'exclusion des justificatifs déjà associés dans les
5 points de retour qui alimentent les drawers et indicateurs.

---

## Endpoint 1 — Suggestions scorées sens direct

**Fichier** : `backend/routers/rapprochement.py` (ou `rapprochement_service.py`
selon où se trouve la logique — vérifier)

**Route** : `GET /{filename}/{index}/suggestions`

### Après calcul des suggestions, avant le return :

```python
from backend.services.justificatif_service import get_all_referenced_justificatifs

referenced = get_all_referenced_justificatifs()

# Exception : autoriser la ré-association sur la même op
# Récupérer le justificatif déjà associé à cette opération (si existant)
current_justif: str | None = None
ops = load_operations(filename)  # utiliser le loader existant
if ops and 0 <= index < len(ops):
    op = ops[index]
    # Opération normale
    current_justif = op.get("Lien justificatif") or None
    # Opération ventilée : si ventilation_index fourni, chercher sur la sous-ligne
    if ventilation_index is not None:
        vlines = op.get("ventilation", [])
        if 0 <= ventilation_index < len(vlines):
            current_justif = vlines[ventilation_index].get("justificatif") or None

if current_justif:
    referenced.discard(current_justif)

suggestions = [s for s in suggestions if s["filename"] not in referenced]
```

---

## Endpoint 2 — Recherche libre dans le drawer

**Fichier** : `backend/routers/justificatifs.py`

**Route** : `GET /` avec query params `status=en_attente` et `search=...`

### Après filtrage par statut/recherche, avant le return :

```python
from backend.services.justificatif_service import get_all_referenced_justificatifs

referenced = get_all_referenced_justificatifs()
results = [r for r in results if r["filename"] not in referenced]
```

> Pas d'exception ici : la recherche libre ne connaît pas l'opération cible.

---

## Endpoint 3 — Suggestions sens inverse (OCR Historique)

**Fichier** : router ou service qui implémente les suggestions d'opérations pour
un justificatif donné (endpoint `GET /suggestions/justificatif/{filename}` ou
`GET /{filename}/suggestions` selon la route réelle — vérifier).

### Filtre : exclure les opérations déjà associées à un autre justificatif

```python
# Après calcul des opérations candidates, avant le return

def _op_is_free(op: dict, current_justif_filename: str) -> bool:
    """
    Retourne True si l'opération est disponible pour association.
    - Op normale : pas de Lien justificatif (ou lien = ce justificatif lui-même)
    - Op ventilée : au moins une sous-ligne sans justificatif
    """
    # Op normale
    lien = op.get("Lien justificatif", "")
    if not lien or lien == current_justif_filename:
        # Vérifier aussi les ventilations si présentes
        vlines = op.get("ventilation", [])
        if not vlines:
            return True  # op simple, libre
        # Op ventilée : libre si au moins une sous-ligne sans justificatif
        return any(not vl.get("justificatif", "") for vl in vlines)
    # Op normale avec un autre justificatif → occupée
    return False

candidates = [c for c in candidates if _op_is_free(c["operation"], filename)]
```

> `filename` ici est le justificatif courant (param de la route).

---

## Endpoint 4 — `GET /batch-justificatif-scores`

**Fichier** : `backend/routers/rapprochement.py`

**Route** : `GET /batch-justificatif-scores`

Cet endpoint retourne le meilleur score de chaque justificatif en attente.
Il alimente potentiellement des indicateurs/badges qui doivent ne montrer
que les justificatifs réellement libres.

### Après calcul des scores, avant le return :

```python
referenced = get_all_referenced_justificatifs()
scores = {k: v for k, v in scores.items() if k not in referenced}
```

> Format exact de `scores` à adapter selon le type de retour réel de l'endpoint.

---

## Endpoint 5 — `GET /unmatched`

**Fichier** : `backend/routers/rapprochement.py`

**Route** : `GET /unmatched`

Ce compteur "justificatifs en attente" est actuellement basé sur le nombre de
fichiers dans `en_attente/`. Il devrait exclure les justificatifs physiquement
en `en_attente/` mais déjà référencés (cas `misplaced_to_move_to_traites`
détecté par scan-links mais pas encore réparé).

### Ajuster le compteur :

```python
referenced = get_all_referenced_justificatifs()
attente_files = list(EN_ATTENTE_DIR.glob("*.pdf"))
# Exclure les déjà-référencés du compte "en attente libre"
free_attente = [f for f in attente_files if f.name not in referenced]
justificatifs_libres = len(free_attente)
```

> Le compteur `operations_sans_justificatif` (opérations côté) n'est pas modifié.

---

## Ordre d'implémentation

1. Endpoint 1 (suggestions scorées directes) — impact le plus visible
2. Endpoint 2 (recherche libre drawer) — même session
3. Endpoint 3 (sens inverse OCR Historique)
4. Endpoint 4 (batch-justificatif-scores)
5. Endpoint 5 (unmatched)

---

## Checklist de vérification

- [ ] Drawer rapprochement (EditorPage / JustificatifsPage) : aucun justificatif déjà associé visible
- [ ] Drawer rapprochement : le justificatif de l'op courante reste visible (ré-association)
- [ ] Recherche libre dans le drawer : aucun justificatif déjà associé
- [ ] OCR Historique — JustificatifOperationLink en attente : aucune op déjà couverte proposée
- [ ] Op ventilée avec sous-lignes libres : reste proposée dans l'OCR Historique
- [ ] Op ventilée toutes sous-lignes couvertes : exclue des propositions
- [ ] `GET /unmatched` compteur justificatifs = fichiers libres uniquement
- [ ] `GET /batch-justificatif-scores` ne retourne pas de justificatifs déjà associés
- [ ] Pas de régression sur l'auto-rapprochement (`run-auto` a sa propre logique)
- [ ] Mettre à jour CLAUDE.md : noter les 5 endpoints filtrés
