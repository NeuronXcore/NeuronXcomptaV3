# Prompt Claude Code — Fix bug rename justificatif (collision + regex canonique trop permissive)

## Contexte

Le rename manuel d'un justificatif via `FilenameEditor` (inline dans **OCR > Gestion OCR** et dans les drawers) échoue silencieusement ou ne fait rien dans certains cas. Cas repro :

- Fichier présent : `amazon_20250128_89.99_20260417_104502.pdf`
- Le suffixe `_20260417_104502` est un **timestamp de dédup** ajouté par `sandbox_service._move_to_en_attente()` quand un fichier du même nom existe déjà
- L'utilisateur veut le renommer en `amazon_20250128_89.99.pdf` (nom canonique propre)
- Le rename échoue ou ne se déclenche pas

## Root causes identifiées

### Cause 1 — Regex canonique trop permissive

Dans `backend/services/rename_service.py`, le pattern :

```python
CANONICAL_PATTERN = r"^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}(_[a-z0-9]+)*\.pdf$"
```

Le groupe `(_[a-z0-9]+)*` est censé accepter `_fs`, `_a`, `_b`, `_2`, `_3`. Mais il accepte aussi `_20260417`, `_104502`, `_12345678`, etc. — donc `amazon_20250128_89.99_20260417_104502.pdf` tombe dans le bucket `already_canonical` du scan et n'est jamais proposé au rename.

**Fix** : restreindre le suffixe aux formes légitimes :

```python
# Suffixes autorisés : _fs, _a, _b, ..., _aa, _2..._99, _fs_2, _a_3
CANONICAL_SUFFIX = r"(?:_(?:[a-z]{1,3}|\d{1,2}))*"
CANONICAL_PATTERN = rf"^[a-z0-9][a-z0-9\-]*_\d{{8}}_\d+\.\d{{2}}{CANONICAL_SUFFIX}\.pdf$"
```

Ce pattern :
- Accepte `_fs`, `_a`, `_b`, `_ab`, `_2`, `_3`, `_99`, `_fs_2`, `_a_3`
- Rejette `_20260417` (8 chiffres), `_104502` (6 chiffres)

Ajouter un test unitaire `tests/test_rename_service.py::test_canonical_pattern_rejects_timestamp_suffix` qui vérifie que `amazon_20250128_89.99_20260417_104502.pdf` n'est PAS canonique.

### Cause 2 — Collision silencieuse au rename

Dans `backend/services/justificatif_service.rename_justificatif()`, vérifier le comportement quand la cible existe déjà (cas repro : on renomme `X_20260417_104502.pdf` en `X.pdf` mais `X.pdf` existe en `en_attente/` ou `traites/`).

**Fix attendu** :

1. Résoudre les emplacements source ET cible via `get_justificatif_path()` (cross-location en_attente + traites)
2. Si la cible existe :
   - **Cas A** : même hash MD5 que la source → rename = suppression logique du doublon (supprimer la source + `.ocr.json` + invalidation thumbnail)
   - **Cas B** : hash différent → lever `HTTPException(409)` avec message explicite :
     ```python
     raise HTTPException(
         status_code=409,
         detail={
             "error": "rename_collision",
             "message": f"Un fichier '{new_filename}' existe déjà avec un contenu différent.",
             "existing_location": location,
             "suggestion": naming_service.deduplicate_filename(new_filename, existing_names),
         },
     )
     ```
3. Garder l'idempotence : si `old_filename == new_filename`, retour 200 sans opération

### Cause 3 — Frontend ne remonte pas l'erreur

Dans `frontend/src/hooks/useRenameJustificatif.ts` et dans le composant `FilenameEditor` :

1. Le `onError` du hook doit afficher un toast `react-hot-toast` avec le `detail.message` et le `detail.suggestion` du 409
2. Si `detail.error === "rename_collision"`, proposer un bouton "Utiliser le nom suggéré" dans le toast qui retente avec `detail.suggestion`
3. Rollback le state local du `FilenameEditor` à l'ancien filename si le mutation échoue (éviter l'affichage du nouveau nom alors que le fichier disque n'a pas bougé)

## Fichiers à modifier

### Backend

1. `backend/services/rename_service.py`
   - Extraire `CANONICAL_SUFFIX` en constante
   - Restreindre `CANONICAL_PATTERN` (voir Cause 1)
   - Vérifier que `is_canonical()`, `scan_and_plan_renames()`, `compute_canonical_name()` utilisent bien la nouvelle regex
   - **Migration one-shot** : dans `lifespan()` de `main.py` (après `scan_link_issues`), loguer les fichiers qui deviennent non-canoniques avec la nouvelle regex (`rename_service.find_legacy_pseudo_canonical()`), sans renommer automatiquement — le scan-rename drawer les proposera au prochain passage utilisateur.

2. `backend/services/justificatif_service.py` — fonction `rename_justificatif()`
   - Résoudre source + cible via `get_justificatif_path()`
   - Ajouter `_md5_file()` check si cible existe
   - Hash identique → supprime source, retourne `{status: "deduplicated", old, new}`
   - Hash différent → `HTTPException(409)` avec structure typée
   - Idempotence `old == new`

3. `backend/routers/justificatifs.py`
   - Le handler `POST /{filename}/rename` propage correctement le détail du 409 (pas de catch générique qui retourne 500)

4. `tests/test_rename_service.py`
   - `test_canonical_pattern_rejects_timestamp_suffix`
   - `test_canonical_pattern_accepts_fs_a_2_suffixes`
   - `test_legacy_pseudo_canonical_detection`

5. `tests/test_justificatif_service.py`
   - `test_rename_collision_same_hash_dedups_source`
   - `test_rename_collision_different_hash_raises_409`
   - `test_rename_idempotent_when_same_name`

### Frontend

6. `frontend/src/hooks/useRenameJustificatif.ts`
   - Type du `onError` : parser `error.response.data.detail` pour les 409
   - Retourner `{ error, suggestion }` typés à la caller

7. `frontend/src/components/ocr/FilenameEditor.tsx`
   - Rollback du state local sur erreur (useEffect qui resync depuis prop `value` en cas de mutation failed)
   - Toast custom avec bouton "Utiliser le nom suggéré" → re-mutation avec `suggestion`

8. `frontend/src/components/ocr/HistoriqueTab.tsx` (ou équivalent Gestion OCR)
   - Si un item devient non-canonique après migration regex, afficher le badge ambre "Pseudo-canonique" + CTA "Corriger" qui ouvre `OcrEditDrawer`

## Ordre d'implémentation

1. Backend : `rename_service.py` (regex + tests)
2. Backend : `justificatif_service.py` (collision + tests)
3. Backend : migration lifespan log-only (pas de rename auto)
4. Frontend : `useRenameJustificatif` (error handling)
5. Frontend : `FilenameEditor` (rollback + toast)
6. Frontend : badge pseudo-canonique (optionnel, peut être Session suivante)

## Tests manuels de validation

- [ ] Le fichier `amazon_20250128_89.99_20260417_104502.pdf` apparaît dans `to_rename_from_name` du scan-rename (plus dans `already_canonical`)
- [ ] Rename inline de ce fichier vers `amazon_20250128_89.99.pdf` marche si cible absente
- [ ] Si cible présente avec même hash → toast "Doublon supprimé"
- [ ] Si cible présente avec hash différent → toast 409 avec bouton "Utiliser `amazon_20250128_89.99_2.pdf`"
- [ ] Les suffixes légitimes (`_fs`, `_a`, `_2`) continuent à passer `is_canonical()`
- [ ] Les fac-similés existants (ex: `auchan_20260408_194132_essence_fs.pdf`) ne régressent pas

## Ne pas toucher

- Le pattern timestamp de dédup dans `sandbox_service._move_to_en_attente()` reste tel quel pour l'instant (il sera court-circuité par le Prompt #2 avec la Boîte d'arrivée)
- Le flow auto-rapprochement post-rename
- Les hints `category_hint` / `sous_categorie_hint`
