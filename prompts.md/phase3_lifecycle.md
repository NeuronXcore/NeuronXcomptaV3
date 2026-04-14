# Phase 3 — Cycle de vie : hints OCR à la dissociation + auto_associate template

## Prérequis

Phases 1 et 2 terminées et commitées.

## Objectif

Corriger deux bugs de cycle de vie qui biaísent le scoring et l'état physique
des fichiers après certaines opérations.

---

## Fix A — Effacer les category hints à la dissociation

### Problème

`justificatif_service.associate()` écrit `category_hint` et `sous_categorie_hint`
dans le `.ocr.json` du justificatif pour enrichir les futurs rapprochements.

`dissociate()` ne les efface pas. Si le justificatif est ensuite proposé pour une
opération de catégorie différente, le hint périmé biaise `score_categorie()` :
- ancienne cat : Matériel / Informatique
- nouvelle op cible : Santé / Consultation
- score_categorie retourne 0.0 au lieu de None (critère neutre)
- le bon candidat est pénalisé dans le classement

### Correction dans `dissociate()`

Après le move `traites/ → en_attente/` et la mise à jour des ops,
**effacer les hints** dans le `.ocr.json` :

```python
# Dans justificatif_service.dissociate() — après save des opérations

from backend.services import ocr_service  # si pas déjà importé

try:
    ocr_service.update_extracted_data(
        filename,
        {
            "category_hint": None,
            "sous_categorie_hint": None,
        }
    )
except Exception:
    pass  # hints non critiques, ne pas bloquer la dissociation
```

> `update_extracted_data` accepte des valeurs `None` et les supprime du JSON
> (ou les écrit à `null`) — vérifier le comportement exact et adapter si nécessaire.
> Si `None` écrit `null` au lieu de supprimer la clé, utiliser `""` ou
> implémenter une suppression de clé dans `ocr_service`.

### Comportement attendu après fix

| Situation | `score_categorie()` |
|---|---|
| Justificatif jamais associé | `None` (critère neutre, redistribution 3 critères) |
| Justificatif associé à op A | Hint = cat de A → score calculé |
| Justificatif dissocié puis libre | `None` (hint effacé) |
| Justificatif ré-associé à op B | Hint = cat de B (écrit par `associate()`) |

---

## Fix B — `POST /templates/generate` avec `auto_associate: true`

### Problème

`template_service.generate_reconstitue()` crée le PDF dans `en_attente/` puis
appelle `auto_associate: true` pour lier le justificatif à l'opération source.

Si l'association via `template_service` passe par un chemin différent de
`justificatif_service.associate()` (ex: écriture directe dans le JSON op sans
déplacement de fichier), le PDF reste dans `en_attente/` alors qu'il est référencé.

Cela cause :
1. Le justificatif réapparaît dans les suggestions d'autres opérations (filtré
   seulement par dossier physique)
2. `scan_link_issues()` le détecte comme `misplaced_to_move_to_traites` et le
   déplacera au prochain démarrage backend — comportement éventuellement correct
   mais retardé

### Vérification à faire en premier

Lire `template_service.generate_reconstitue()` et identifier comment
`auto_associate` est implémenté :

**Cas A** : appelle `justificatif_service.associate(filename, op_file, op_index)` 
→ le move est déjà géré, pas de bug → **aucun changement nécessaire**

**Cas B** : écrit directement dans le JSON op sans appeler `associate()`
→ **fix nécessaire** : remplacer par un appel à `justificatif_service.associate()`

### Si fix nécessaire (Cas B)

Dans `template_service.generate_reconstitue()` :

```python
if auto_associate and operation_ref:
    from backend.services import justificatif_service
    try:
        justificatif_service.associate(
            filename=generated_filename,
            operation_file=operation_ref["file"],
            operation_index=operation_ref["index"],
        )
        # associate() gère : move en_attente→traites, update ops JSON,
        # thumbnail invalidation, GED metadata, auto-pointage, cache invalidation
    except Exception as e:
        logger.warning(f"auto_associate failed for {generated_filename}: {e}")
```

Supprimer toute logique d'écriture directe dans les ops JSON qui existait avant
dans le Cas B.

---

## Fix C (optionnel mais recommandé) — `update_extracted_data` avec suppression de clé

Si `ocr_service.update_extracted_data()` ne supporte pas la suppression de clés
(cas où `None` écrit `null` mais ne supprime pas la clé), étendre la signature :

```python
def update_extracted_data(
    filename: str,
    updates: dict,
    delete_keys: list[str] | None = None
) -> None:
    """
    Met à jour le .ocr.json.
    `delete_keys` : liste de clés top-level à supprimer complètement.
    """
    # ... logique existante pour updates ...
    if delete_keys:
        for k in delete_keys:
            data.pop(k, None)
    # ... save ...
```

Appel depuis `dissociate()` :

```python
ocr_service.update_extracted_data(
    filename,
    updates={},
    delete_keys=["category_hint", "sous_categorie_hint"]
)
```

N'implémenter Fix C que si nécessaire après vérification du comportement actuel
de `update_extracted_data` avec `None`.

---

## Ordre d'implémentation

1. **Fix A** : lire `dissociate()`, ajouter l'effacement des hints
2. **Fix B** : lire `generate_reconstitue()`, identifier Cas A ou B, corriger si Cas B
3. **Fix C** : seulement si Fix A en a besoin

---

## Checklist de vérification

**Fix A :**
- [ ] Associer un justificatif à op A (cat Matériel) → `.ocr.json` contient `category_hint: "Matériel"`
- [ ] Dissocier → `.ocr.json` ne contient plus `category_hint` (clé absente ou null)
- [ ] Re-proposer ce justificatif pour op B (cat Santé) → `score_categorie()` retourne `None` (pas 0.0)
- [ ] Re-associer à op B → `.ocr.json` contient `category_hint: "Santé"`

**Fix B :**
- [ ] Générer un fac-similé avec `auto_associate: true`
- [ ] Vérifier que le fichier est dans `traites/` (pas `en_attente/`) après génération
- [ ] Vérifier que l'opération source a `Lien justificatif` = nom du fac-similé
- [ ] Vérifier que `scan_link_issues()` ne remonte pas ce fichier en `misplaced_to_move_to_traites`
- [ ] Le fac-similé n'apparaît pas dans les suggestions d'autres opérations

**Fix C (si applicable) :**
- [ ] `update_extracted_data(..., delete_keys=["category_hint"])` supprime la clé du JSON (pas null)

**Général :**
- [ ] `associate()` non modifié (continue d'écrire les hints)
- [ ] `scan_link_issues()` non modifié
- [ ] Mettre à jour CLAUDE.md : noter que `dissociate()` efface les hints
