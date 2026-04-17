# Référence API

Base URL : `http://localhost:8000/api`

Documentation Swagger : `http://localhost:8000/docs`

---

## Operations (`/api/operations`)

### `GET /files`
Liste tous les fichiers d'opérations importés, triés en ordre chronologique (année, mois).

**Réponse :**
```json
[
  {
    "filename": "operations_20250520_094452_d9faa5a9.json",
    "count": 86,
    "total_debit": 61095.44,
    "total_credit": 34480.00,
    "month": 11,
    "year": 2024
  }
]
```

### `GET /{filename}`
Charge les opérations d'un fichier.

### `PUT /{filename}`
Sauvegarde les opérations (body : tableau d'opérations).

### `DELETE /{filename}`
Supprime un fichier d'opérations.

### `POST /import`
Importe un relevé bancaire PDF. Form-data avec champ `file`.

**Réponse :**
```json
{
  "filename": "operations_20250520_094452_d9faa5a9.json",
  "operations_count": 86,
  "is_duplicate": false,
  "pdf_hash": "d9faa5a9"
}
```

### `POST /create-empty`
Crée un fichier d'opérations vide pour un mois donné (saisie manuelle, typiquement notes de frais CB perso avant l'import du relevé bancaire). Route déclarée **avant** les routes dynamiques `/{filename}` pour éviter la collision FastAPI.

**Body :** `{ "year": 2026, "month": 4 }`

**Réponse :**
```json
{
  "filename": "operations_manual_202604_a777d8e5.json",
  "year": 2026,
  "month": 4
}
```

**Nommage** : `operations_manual_YYYYMM_<hex8>.json`. Le préfixe `manual_` trace l'origine (né hors import PDF). Le hash 8 chars via `secrets.token_hex(4)` évite les collisions si plusieurs fichiers sont créés pour le même mois.

**Listing intelligent** : `operation_service._file_meta` enrichi avec un fallback regex `r"_(\d{4})(\d{2})_"` sur le filename pour dériver `year`/`month` quand le fichier est vide (pas d'ops à agréger). Le dropdown EditorPage affiche `Mois (0 ops)` immédiatement après création.

**Fusion ultérieure** : quand le relevé bancaire sera importé pour le même mois, les scripts `split_multi_month_operations.py` + `merge_overlapping_monthly_files.py` gèrent la dédup par hash op-identité.

**Code HTTP** :
- `200 OK` — fichier créé
- `400 Bad Request` — `month` hors de `[1, 12]`
- `422 Unprocessable Entity` — body mal formé

### `POST /{filename}/categorize`
Catégorisation automatique IA des opérations du fichier. Body : `{ "mode": "empty_only" }` (défaut, ne remplit que les vides) ou `{ "mode": "all" }` (recatégorise tout). Déclenché automatiquement par EditorPage au chargement (mode empty_only).

**Respect du lock** : depuis Session 25, la boucle `categorize_file()` skippe les opérations avec `op.locked = true` **avant** le check `empty_only` — cohérent avec `run_auto_rapprochement()`. Protège les deux modes (`empty_only` + `all`) contre l'écrasement silencieux par la prédiction ML. Une op manuellement associée à un justif (auto-lockée par `associate_manual`) conserve sa catégorie / sous-catégorie même après un clic « Recatégoriser IA ».

### `GET /{filename}/has-pdf`
Vérifie si le relevé bancaire PDF original existe.

**Réponse :** `{ "has_pdf": true }`

### `GET /{filename}/pdf`
Sert le fichier PDF original du relevé bancaire (FileResponse).

### `PATCH /{filename}/{index}/csg-split`
Stocke (ou efface) la part CSG/CRDS non déductible sur une opération.

**Body :**
```json
{ "csg_non_deductible": 17.67 }
```
Passer `null` pour effacer le split.

**Réponse :** `{ "ok": true, "csg_non_deductible": 17.67 }`

### `PATCH /{filename}/{index}/lock`
Verrouille ou déverrouille une opération pour protéger son association justificatif contre l'auto-rapprochement.

**Body :**
```json
{ "locked": true }
```

**Réponse :**
```json
{ "locked": true, "locked_at": "2026-04-14T20:55:53" }
```

Passer `{ "locked": false }` pour déverrouiller (met `locked_at` à `null` dans la réponse).

**Effets collatéraux** :
- `run_auto_rapprochement` skippe désormais cette op silencieusement (couche 2 de protection)
- `POST /api/rapprochement/associate-manual` et `POST /api/justificatifs/dissociate` renvoient **HTTP 423** sur cette op tant qu'elle reste verrouillée (sauf `associate-manual` avec `force=true`)
- L'édition de catégorie/sous-catégorie/commentaire reste autorisée — seul le lien justificatif est protégé

**Code HTTP** :
- `200 OK` — lock/unlock appliqué
- `404 Not Found` — filename introuvable ou `index` hors bornes

---

### `PATCH /bulk-lock`
Verrouille/déverrouille N opérations en masse, potentiellement réparties sur plusieurs fichiers. Déclaré **avant** la route paramétrée `/{filename}/{index}/lock` pour éviter la collision FastAPI (`filename="bulk-lock"` matcherait sinon).

**Body :**
```json
{
  "items": [
    { "filename": "operations_2025-01.json", "index": 3,  "locked": true },
    { "filename": "operations_2025-01.json", "index": 7,  "locked": true },
    { "filename": "operations_2025-02.json", "index": 12, "locked": true }
  ]
}
```

**Réponse :**
```json
{
  "results": [
    { "filename": "operations_2025-01.json", "index": 3,  "locked": true, "locked_at": "2026-04-15T00:12:00", "error": null },
    { "filename": "operations_2025-01.json", "index": 7,  "locked": true, "locked_at": "2026-04-15T00:12:00", "error": null },
    { "filename": "operations_2025-02.json", "index": 12, "locked": true, "locked_at": "2026-04-15T00:12:00", "error": null }
  ],
  "success_count": 3,
  "error_count": 0
}
```

**Algorithme** :
- Les items sont **groupés par `filename`** via `itertools.groupby` (sort préalable)
- Pour chaque groupe : un seul `load_operations(filename)` + un seul `save_operations(filename)` — minimise les I/O
- Erreurs individuelles (fichier introuvable, index hors bornes) remontées dans `results[i].error` **sans stopper le batch**
- `locked_at = datetime.now().isoformat(timespec="seconds")` si `locked=true`, `None` si `locked=false`

**Cas d'usage frontend** :
- JustificatifsPage : sélection multi-ops via header 🔒 + checkbox hover → `BulkLockBar` flottante
- EditorPage : idem, masqué en year-wide (lecture seule)
- Toggle intelligent : si toutes les ops sélectionnées sont déjà verrouillées → mode Déverrouiller (envoie `locked=false`), sinon → mode Verrouiller (envoie `locked=true`)

**Code HTTP** :
- `200 OK` — batch traité (lire `results[i].error` pour les échecs par-item)
- `422 Unprocessable Entity` — body mal formé

---

## Categories (`/api/categories`)

### `GET /`
Retourne toutes les catégories groupées et brutes.

### `POST /`
Créer une catégorie. Body : `{ "name": "...", "color": "#..." }`

### `POST /subcategory`
Créer une sous-catégorie. Body : `{ "category": "...", "name": "...", "color": "#..." }`

### `PUT /{name}`
Modifier une catégorie. Body : `{ "color": "#...", "new_name": "..." }`

### `DELETE /{name}`
Supprimer une catégorie. Query : `?subcategory=...` pour supprimer une sous-catégorie.

### `GET /{name}/subcategories`
Sous-catégories d'une catégorie.

### `GET /colors`
Palette de couleurs par catégorie.

---

## ML (`/api/ml`)

### `GET /model`
Résumé du modèle (compteurs, stats, learning curve). Depuis Session 25, `stats.operations_processed` et `stats.success_rate` sont **agrégés dynamiquement** depuis les logs de monitoring (`_load_all_prediction_logs()` + `_load_all_corrections()`) au lieu d'être lus depuis `model.json` où ils étaient initialisés à 0 et jamais incrémentés. Fallback silencieux sur `model.json` si monitoring indisponible.

**Réponse :**
```json
{
  "exact_matches_count": 248,
  "keywords_count": 34,
  "subcategories_count": 120,
  "stats": {
    "operations_processed": 4209,
    "success_rate": 0.9529,
    "last_training": "2026-04-16T10:58:02",
    "learning_curve": { "dates": [...], "acc_train": [...], "acc_test": [...], ... }
  }
}
```

### `GET /model/full`
Modèle complet (`exact_matches`, `keywords`, `subcategories`, `subcategory_patterns`, `perso_override_patterns`, `stats`). Utilisé par l'onglet Monitoring pour afficher la courbe d'apprentissage + le dashboard Règles & Patterns.

### `POST /predict`
Prédire la catégorie d'un libellé.

**Body :** `{ "libelle": "PHARMACIE DUPONT" }`

**Réponse :**
```json
{
  "libelle_clean": "pharmacie dupont",
  "rules_prediction": "Santé",
  "rules_subcategory": "Pharmacie",
  "sklearn_prediction": "Santé",
  "confidence": 0.92,
  "hallucination_risk": false,
  "best_prediction": "Santé"
}
```

### `POST /train`
Entraîne le modèle scikit-learn. Pas de body attendu — important : le client frontend (`api.post('/ml/train')`) n'envoie plus `Content-Type: application/json` depuis Session 25 (sans body → pas de header JSON, évite le 400 custom déclenché par l'asymétrie Content-Type + body vide).

**Modèle** : `LinearSVC(max_iter=2000, class_weight="balanced", dual=True)` wrappé dans `CalibratedClassifierCV(cv=2)` pour exposer `predict_proba()` (utilisé par `evaluate_hallucination_risk`). `perso` filtré du training set (sur-représentation biaise le modèle). Seuil minimal ops/classe `≥3` pour garantir ≥2 ex en train après split stratifié 75/25.

**Réponse (succès) :**
```json
{
  "success": true,
  "metrics": {
    "acc_train": 0.8633,
    "acc_test": 0.2712,
    "f1": 0.167,
    "precision": 0.317,
    "recall": 0.271,
    "n_samples": 244,
    "n_classes": 20,
    "labels": ["Véhicule", "Telephone-Internet", ...],
    "confusion_matrix": [[...]]
  }
}
```

**Code HTTP** :
- `200 OK` — entraînement réussi
- `400 Bad Request` — pas assez d'exemples / classes < 2 / filtre too_few trop strict (détail dans `detail`)

### `POST /import-from-operations?year={year}`
**Nouveau Session 25.** Importe en bulk les opérations déjà catégorisées dans `data/imports/operations/*.json` comme exemples d'entraînement sklearn. Réutilise `clean_libelle()` + `add_training_examples_batch()` (dédup par `(libelle, categorie)`) + `update_rules_from_operations()` (exact_matches).

**Query params :**
- `year: Optional[int]` — si fourni, ne considère que les ops dont `Date` commence par cette année (filtre basé sur le champ `Date` plutôt que le filename, plus fiable pour les fichiers merged multi-mois). Omis = toutes années.

**Comportement** :
- Exclut les catégories `""`, `"Autres"`, `"Ventilé"`, `"perso"`, `"Perso"`
- Explose les ventilations en sous-exemples individuels (1 exemple par sous-ligne avec `vl.categorie` + `vl.sous_categorie`)
- Dédup finale via `add_training_examples_batch` qui scan `training_examples.json`

**Réponse :**
```json
{
  "success": true,
  "files_read": 30,
  "ops_scanned": 1879,
  "ops_skipped": 1220,
  "vent_sublines": 5,
  "examples_submitted": 662,
  "examples_added": 0,
  "rules_updated": 5,
  "total_training_data": 323,
  "year_filter": 2025
}
```

**Interprétation** :
- `examples_added` = nouveaux exemples **après dédup** (généralement faible car `clean_libelle` collapse beaucoup de variantes)
- `rules_updated` = nombre d'entrées `exact_matches` ajoutées/mises à jour dans `model.json`
- `total_training_data` = taille finale de `training_examples.json`

**UI** : bouton bleu `Database` dans ActionsRapides > « Importer données historiques », utilise `allYears` + `selectedYear` du store Zustand pour cohérence UX avec « Entraîner + Appliquer ».

### `GET /training-data`
Exemples d'entraînement.

### `POST /training-data`
Ajouter un exemple. Body : `{ "libelle": "...", "categorie": "...", "sous_categorie": "..." }`

### `POST /rules`
Ajouter une règle exacte. Body : `{ "libelle": "...", "categorie": "...", "sous_categorie": "..." }`

### `DELETE /rules/{libelle}`
Supprimer une règle.

### `POST /backup`
Créer une sauvegarde du modèle.

### `GET /backups`
Lister les sauvegardes.

### `POST /train-and-apply`
Entraîner le modèle puis recatégoriser (mode empty_only) toutes les opérations.

**Query :** `?year=2026` (optionnel, sinon toutes les années)

**Réponse :**
```json
{
  "success": true,
  "train_metrics": { "acc_train": 0.91, "acc_test": 0.87, "f1": 0.85, ... },
  "apply_results": { "files_processed": 12, "total_operations": 340, "total_modified": 47, "year": 2026 }
}
```

### `POST /restore/{backup_name}`
Restaurer une sauvegarde. Query : `?restore_training_data=true`

### `GET /monitoring/stats`
Stats agrégées du monitoring ML.

**Query :** `?year=2026` (optionnel)

**Réponse :**
```json
{
  "coverage_rate": 0.68,
  "avg_confidence": 0.75,
  "confidence_distribution": { "high": 120, "medium": 30, "low": 5 },
  "correction_rate": 0.08,
  "hallucination_rate": 0.03,
  "top_errors": [{ "libelle": "...", "predicted": "...", "corrected": "...", "count": 3 }],
  "training_history": [{ "timestamp": "...", "examples_count": 150, "accuracy": 0.87, ... }],
  "correction_rate_history": [{ "month": "2026-01", "rate": 0.12 }],
  "knowledge_base": { "rules": 111, "keywords": 50, "examples": 150 },
  "confusion_pairs": [{ "from": "Véhicule", "to": "Matériel", "count": 5 }],
  "orphan_categories": [{ "category": "Poste", "examples_count": 2 }],
  "unknown_libelles_count": 3
}
```

### `GET /monitoring/health`
KPI résumé pour le Dashboard.

**Réponse :**
```json
{
  "coverage_rate": 0.68,
  "correction_rate": 0.08,
  "correction_trend": "improving",
  "hallucination_rate": 0.03,
  "last_training": "2026-04-06T10:30:00",
  "alert": null
}
```

### `GET /monitoring/confusion`
Matrice de confusion depuis les corrections loggées. Query : `?year=2026`

### `GET /monitoring/correction-history`
Taux de correction par mois.

---

## Analytics (`/api/analytics`)

### `GET /dashboard`
Données complètes du tableau de bord.

**Réponse :**
```json
{
  "total_debit": 450000,
  "total_credit": 320000,
  "solde": -130000,
  "nb_operations": 1024,
  "category_summary": [...],
  "recent_operations": [...],
  "monthly_evolution": [...]
}
```

### `GET /summary`
Résumé par catégorie.

### `GET /trends?months=6`
Tendances mensuelles. `months=0` pour toutes les données.

### `GET /anomalies?threshold=2.0`
Détection d'anomalies par écart-type.

**Paramètres communs (dashboard, summary, trends, anomalies) :**
- `year` (optional) : filtrer par année
- `quarter` (optional) : filtrer par trimestre (1-4)
- `month` (optional) : filtrer par mois (1-12)

### `GET /category-detail?category=Matériel`
Détail d'une catégorie : sous-catégories, évolution mensuelle, dernières opérations.

**Paramètres :** `category` (required), `year`, `quarter`, `month` (optional)

**Réponse :**
```json
{
  "category": "Matériel",
  "total_debit": 134194.51,
  "total_credit": 0,
  "nb_operations": 51,
  "subcategories": [
    { "name": "Consommables", "debit": 45000, "credit": 0, "count": 20 }
  ],
  "monthly_evolution": [
    { "month": "2024-01", "debit": 12000, "credit": 0 }
  ],
  "operations": [
    { "date": "2024-04-15", "libelle": "Fournisseur XYZ", "debit": 500, "credit": 0, "sous_categorie": "Consommables" }
  ]
}
```

### `GET /compare`
Compare deux périodes avec KPIs et ventilation par catégorie.

**Paramètres :** `year_a`, `quarter_a`, `month_a`, `year_b`, `quarter_b`, `month_b` (tous optional)

**Réponse :**
```json
{
  "period_a": { "total_debit": 210662, "total_credit": 140064, "solde": -70598, "nb_operations": 120 },
  "period_b": { "total_debit": 79802, "total_credit": 98755, "solde": 18952, "nb_operations": 176 },
  "delta": { "total_debit": -62.1, "total_credit": -29.5, "solde": -73.2, "nb_operations": 46.7 },
  "categories": [
    { "category": "Matériel", "a_debit": 30000, "a_credit": 0, "b_debit": 42000, "b_credit": 0, "delta_pct": 40.0, "a_ops": 15, "b_ops": 22 }
  ]
}
```

**Note :** Le frontend sépare les catégories en recettes (credit > debit) et dépenses, avec 2 tableaux et 2 graphiques distincts.
```

---

## Reports V2 (`/api/reports`)

> **Note** : Les endpoints gallery, tree, pending, favorite, compare et update titre ont ete migres vers la GED V2 (`/api/ged`). Voir section GED ci-dessous.

### `GET /templates`
3 templates predefinis (BNC annuel, Ventilation charges, Recapitulatif social).

### `POST /generate`
Générer un rapport avec déduplication (même filtres+format = remplacement).

**Body :**
```json
{
  "format": "pdf",
  "title": "Santé — Novembre 2024",
  "filters": {
    "categories": ["Santé"],
    "year": 2024,
    "month": 11,
    "type": "debit"
  },
  "template_id": null
}
```

**Réponse :** inclut `replaced: "ancien_filename.pdf"` si déduplication.

**Ventilation** : les opérations ventilées sont **éclatées en N sous-lignes** avant les filtres via `_explode_ventilations()`. Chaque sous-ligne apparaît dans le rapport avec :
- Libellé suffixé `[V{i+1}/{N}]` (ex: `PRLVSEPAAMAZON... [V1/2]`)
- Catégorie / sous-catégorie / montant / justificatif de la sous-ligne
- Date / commentaire / flag Important hérités du parent

La catégorie `"Ventilé"` n'apparaît jamais dans les rapports — les totaux sont correctement répartis par sous-catégorie. Appliqué aux formats **PDF et CSV** (Excel non modifié).

### `POST /{filename}/regenerate`
Re-génère un rapport existant (même titre/description, données actualisées).

### `POST /regenerate-all`
Régénère tous les rapports existants (met à jour logo, colonnes, format).

**Réponse :**
```json
{ "regenerated": 15, "errors": 0, "total": 15 }
```

### `POST /{filename}/open-native`
Ouvre le rapport dans l'application native macOS (Apercu pour PDF, Numbers pour CSV, Excel pour XLSX).

### `POST /export-zip`
Crée un ZIP contenant les rapports sélectionnés (pour envoi au comptable).

**Body :**
```json
{ "filenames": ["rapport_1.pdf", "rapport_2.csv"] }
```

**Réponse :** ZIP téléchargeable (`Rapports_Comptable_YYYYMMDD_HHMMSS.zip`).

### `PUT /{filename}`
Éditer titre et/ou description. Body : `{ "title": "...", "description": "..." }`

### `GET /preview/{filename}`
Sert le fichier avec `Content-Disposition: inline` pour preview iframe.

### `GET /download/{filename}`
Télécharger un rapport.

### `DELETE /all`
Supprime tous les rapports (fichiers + index).

### `DELETE /{filename}`
Supprime le fichier + l'entrée dans l'index.

---

## Queries (`/api/queries`)

### `POST /query`
Exécuter une requête analytique.

**Body :**
```json
{
  "categories": ["Santé", "Professionnel"],
  "date_from": "2024-01-01",
  "date_to": "2024-12-31",
  "type": "debit",
  "grouping": "month_category",
  "min_amount": 100
}
```

### `GET /queries`
Lister les presets (prédéfinis + personnalisés).

### `POST /queries`
Sauvegarder un preset.

### `DELETE /queries/{preset_id}`
Supprimer un preset.

---

## Justificatifs (`/api/justificatifs`)

### `GET /?status=all&search=&year=2024&month=11&sort_by=date&sort_order=desc`
Liste avec filtres. **Quand `status=en_attente`**, les justificatifs déjà référencés par une opération (dans ops JSON ou sous-lignes de ventilation) sont automatiquement exclus via `get_all_referenced_justificatifs()` (cache TTL 5s).

### `GET /stats`
Statistiques (en_attente, traites, total).

### `POST /upload`
Upload multi-fichiers PDF/JPG/PNG. Form-data : champ `files` (multiple). Les images sont automatiquement converties en PDF.

### `GET /{filename}/preview`
Sert le PDF pour iframe.

### `GET /{filename}/suggestions`
Suggestions d'association (score date + montant + fournisseur OCR). Exclut les opérations déjà liées à un autre justificatif (conserve celles liées au justificatif courant pour ré-association).

### `GET /reverse-lookup/{filename}`
Trouve les operations liees a un justificatif donne. Retourne une liste avec `operation_file`, `operation_index`, `date`, `libelle`, `debit`, `credit`, `categorie`, `sous_categorie`, `ventilation_index`.

### `POST /associate`
Associer un justificatif. Declenche auto-pointage si le setting `auto_pointage` est actif.

**Body :** `{ "justificatif_filename": "...", "operation_file": "...", "operation_index": 5 }`

### `POST /dissociate`
Dissocier. Efface les `category_hint` et `sous_categorie_hint` du `.ocr.json` pour ne pas biaiser les futurs rapprochements. Body : `{ "operation_file": "...", "operation_index": 5 }`

**Garde verrouillage** : si l'opération cible a `locked=true`, le router retourne **HTTP 423** avec le message « Opération verrouillée — déverrouillez avant de dissocier. ». Pas de bypass disponible (contrairement à `associate-manual` qui accepte `force=true`) — il faut explicitement appeler `PATCH /api/operations/{filename}/{index}/lock` avec `{locked: false}` avant de pouvoir dissocier.

### `GET /{filename}/thumbnail`
**Nouveau endpoint cross-location.** Retourne le thumbnail PNG d'un justificatif en résolvant automatiquement `en_attente/` puis `traites/` via `get_justificatif_path()`, puis délègue à `ged_service.get_thumbnail_path()`.

Le thumbnail est généré à la volée via `pdf2image` + `poppler` si absent du cache (`data/ged/thumbnails/{md5}.png`), puis servi en PNG. Résout le bug historique des blank thumbnails quand un composant frontend hard-codait `en_attente/` alors que le fichier était déjà en `traites/` (cas ford-revision).

Utilisé par les composants frontend `Thumbnail`, `SuggestionCard`, `SkippedItemEditor`, `OcrEditDrawer`, `PreviewSubDrawer`.

### `POST /{filename}/rename`
Renommer un justificatif. Met a jour PDF + .ocr.json + associations operations + GED metadata.

`_invalidate_thumbnail_for_path()` est appelé avant le rename pour purger le cache thumbnail GED (évite les orphelins).

**Body :**
```json
{ "new_filename": "fournisseur_20250315_50.00.pdf" }
```

**Reponse 200 :**
```json
{ "old": "justificatif_20250315_143022_edf.pdf", "new": "fournisseur_20250315_50.00.pdf", "location": "en_attente" }
```

**Reponse 200 — dédup silencieuse (cible existe cross-location avec MÊME MD5) :**
```json
{ "old": "amazon_20250128_89.99_20260417_104502.pdf", "new": "amazon_20250128_89.99.pdf", "location": "traites", "status": "deduplicated" }
```
Source (+ `.ocr.json` + thumbnail) supprimée ; la cible existante est conservée.

**Reponse 409 — collision avec hash différent :**
```json
{
  "detail": {
    "error": "rename_collision",
    "message": "Un fichier 'udemy_20251201_274.75.pdf' existe déjà avec un contenu différent.",
    "existing_location": "en_attente",
    "suggestion": "udemy_20251201_274.75_2.pdf"
  }
}
```
Le frontend (`FilenameEditor`) parse `detail` via `isRenameCollision()` et propose un bouton « Utiliser {suggestion} » qui relance la mutation. La source et la cible restent intactes (zéro side-effect sur le 409).

La résolution est cross-location (en_attente ↔ traites) via `get_justificatif_path()`. Idempotent si `old == new`. Source absente → 404.

### `POST /scan-rename?apply=&apply_ocr=&scope=both`
Scanner + renommer en lot selon la convention `fournisseur_YYYYMMDD_montant.XX.pdf` via la stratégie filename-first (cf. `rename_service.compute_canonical_name()`).

**Query params :**
- `apply: bool = false` — Par défaut, dry-run (renvoie juste le plan sans modifier). `apply=true` exécute les renommages.
- `apply_ocr: bool = false` — Inclure les renames basés sur l'OCR (bucket `to_rename_ocr`, confiance plus faible). Opt-in explicite.
- `scope: "en_attente" | "traites" | "both" = "both"` — Dossiers à scanner. Défaut `both` fusionne les deux.

**Réponse (dry-run) :**
```json
{
  "scope": "both",
  "scanned": 398,
  "already_canonical": 387,
  "to_rename_safe": [{"old": "ldlc-20250524_409.90.pdf", "new": "ldlc_20250524_409.90.pdf"}],
  "to_rename_ocr": [{"old": "facture_9053945213_2026-01-26.pdf", "new": "facture_20260126_35.65.pdf", "supplier_ocr": "Facture"}],
  "skipped": {
    "no_ocr": ["reconstitue_20260408_194132_essence.pdf"],
    "bad_supplier": [{"filename": "justificatif_20260409_064405_Sans_titre_16.pdf", "supplier": "Le."}],
    "no_date_amount": ["09042026.pdf"]
  }
}
```

**Réponse (apply=true) :** ajoute le champ `applied: { ok: 163, errors: [], renamed: [...] }`, et **chaîne automatiquement `rapprochement_service.run_auto_rapprochement()`** après le batch de renames. Le résumé retourné inclut alors :
- `auto_associated` (int) — nb d'associations confirmées avec un score ≥ 0.80
- `strong_suggestions` (int) — nb de suggestions fortes (0.65-0.80) prêtes pour review manuel

Le frontend `useApplyScanRename` affiche ces 2 compteurs dans le toast de succès, créant un flux one-click « Scanner & Renommer → auto-associer ce qui matche » depuis OCR > Gestion OCR.

**Stratégie filename-first** : 6 buckets de classification.
- `to_rename_from_name` (SAFE) : parsé depuis le filename existant via 3 regex tolérantes (underscore, dash, pas de séparateur), avec garde-fous (supplier non-générique, date 2000-2100, montant ≤ 100 000 €).
- `to_rename_from_ocr` (review) : filename non structuré, fallback sur les données OCR du `.ocr.json` si supplier non-suspect.
- `skipped_no_ocr` : pas de `.ocr.json` ET filename non parsable.
- `skipped_bad_supplier` : supplier OCR vide/court/dans la liste `SUSPICIOUS_SUPPLIERS`.
- `skipped_no_date_amount` : OCR incomplet (pas de `best_date` ou `best_amount`).
- `already_canonical` : matche déjà `^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}(_[a-z0-9]+)*\.pdf$`.

**Convention** : point décimal (`107.45`, pas `107,45`). Suffix optionnel `_fs` (fac-similé), `_a`/`_b` (ventilation multi-justif), `_2`/`_3` (dédup).

Déclenché aussi automatiquement après OCR via `justificatif_service.auto_rename_from_ocr()` qui délègue à `rename_service.compute_canonical_name()`.

### `GET /scan-links`
Dry-run : scanne les justificatifs et détecte les incohérences disque ↔ opérations, sans rien modifier.

Détecte 6 catégories :
- `duplicates_to_delete_attente` — fichier référencé par une op, présent en double dans `en_attente/` ET `traites/` avec hashes MD5 identiques. La copie de `en_attente/` est fantôme (`get_justificatif_path()` la sert en premier alors que le lien stocké pointe vers `traites/`).
- `misplaced_to_move_to_traites` — fichier référencé par une op, présent uniquement dans `en_attente/` (pas déplacé lors d'une association antérieure).
- `orphans_to_delete_traites` — fichier dans `traites/` sans op qui le référence, mais duplicate identique présent en `en_attente/` → la copie `traites/` est orpheline.
- `orphans_to_move_to_attente` — fichier dans `traites/` sans op ET sans duplicate ailleurs → doit redevenir attribuable en `en_attente/`.
- `hash_conflicts` — fichier en double avec hashes MD5 différents. **Jamais modifié automatiquement** (inspection manuelle requise).
- `ghost_refs` — op dont `Lien justificatif` pointe vers un fichier absent des deux dossiers → clear du lien.

**Réponse :**
```json
{
  "scanned": { "traites": 248, "attente": 139, "op_refs": 251 },
  "duplicates_to_delete_attente": [
    { "name": "amazon_20250101_107.45.pdf", "refs": 1, "hash": "abc123..." }
  ],
  "misplaced_to_move_to_traites": [
    { "name": "auchan_20250330_111.19_fs_3.pdf", "refs": 1 }
  ],
  "orphans_to_delete_traites": [
    { "name": "amazon_20250128_139.85.pdf", "hash": "def456..." }
  ],
  "orphans_to_move_to_attente": [
    { "name": "orange_20251212_46.99.pdf" }
  ],
  "hash_conflicts": [
    {
      "name": "auchan_20241229_34.78_fs.pdf",
      "hash_attente": "ee5a0fb5...",
      "hash_traites": "c26da2eb...",
      "location": "both",
      "refs": 1
    }
  ],
  "ghost_refs": [],
  "reconnectable_ventilation": [
    {
      "name": "amazon_20250128_49.86.pdf",
      "op_file": "operations_split_202501_...json",
      "op_index": 70,
      "ventilation_index": 1,
      "montant": 49.86,
      "date": "2025-01-28",
      "supplier": "Amazon"
    }
  ]
}
```

**Bucket `reconnectable_ventilation` (Session 27)** : orphans de `traites/` dont le filename canonique (`supplier_YYYYMMDD_montant.pdf`) matche une sous-ligne ventilée **vide** au même `date + montant (±0.01 €)`. Match unique requis (ambiguïtés skippées). Calculé par `_detect_ventilation_reconnects()` via `rename_service.try_parse_filename()`. Ces orphans sont retirés de `orphans_to_move_to_attente` (ils seront reconnectés à leur slot plutôt que renvoyés en attente).

### `POST /repair-links`
Apply : répare les incohérences détectées par `scan-links`.

Ordre d'exécution : A1 delete en_attente → A2 move vers traites → B1 delete traites → **3b reconnect ventilation** → B2 move vers en_attente → C clear ghost refs. Les `hash_conflicts` sont systématiquement **skippés** (jamais de perte automatique). Le `.ocr.json` compagnon est toujours propagé lors des moves/deletes. La reconnexion ventilation groupe les writes par fichier d'ops + re-check idempotence avant d'écrire `vl[i].justificatif`.

**Réponse :**
```json
{
  "deleted_from_attente": 11,
  "moved_to_traites": 1,
  "deleted_from_traites": 2,
  "moved_to_attente": 5,
  "ventilation_reconnected": 4,
  "ghost_refs_cleared": 0,
  "conflicts_skipped": 2,
  "errors": []
}
```

**Automatisation** : `apply_link_repair()` est également appelé silencieusement au démarrage du backend via le `lifespan()` dans `backend/main.py`. Les logs sortent en `INFO` si des actions ont été appliquées, en `WARNING` si des conflits restent non résolus.

Frontend : exposé via la section « Intégrité des justificatifs » dans `SettingsPage > Stockage` (bouton Scanner puis bouton Réparer).

### `DELETE /{filename}`
Supprimer un justificatif avec **nettoyage complet** (PDF + .ocr.json + thumbnail GED + metadata GED + liens ops parentes + sous-lignes ventilées + cache `get_all_referenced_justificatifs`).

**Réponse :**
```json
{
  "deleted": "amazon_20260102_39.99.pdf",
  "ops_unlinked": [
    {"file": "operations_YYYYMMDD_xxx.json", "libelle": "PRLVSEPAAMAZON...", "index": 36}
  ],
  "thumbnail_deleted": true,
  "ged_cleaned": true,
  "ocr_cache_deleted": true
}
```

Retourne 404 si le fichier n'existe pas. Le frontend affiche un toast détaillé (`showDeleteSuccessToast`) listant les éléments nettoyés : "lien opération nettoyé, thumbnail purgée, GED nettoyée, cache OCR purgé".

Bouton Supprimer accessible depuis **3 pages** :
- OCR Gestion OCR (colonne Actions, opacity-0 group-hover:opacity-100)
- EditorPage (preview panel footer)
- JustificatifsPage (preview panel footer)

---

## OCR (`/api/ocr`)

### `GET /status`
Statut du moteur OCR.

```json
{
  "reader_loaded": false,
  "easyocr_available": true,
  "poppler_available": true,
  "total_extractions": 12
}
```

### `GET /history?limit=2000`
Historique des extractions OCR. **Limit par défaut passée de 100 à 2000** en Session 12 pour couvrir toute l'année OCR sans pagination côté frontend (la Gestion OCR itère tous les items pour la recherche multifocale).

Chaque item retourne : `filename`, `processed_at`, `ocr_success`, `extracted_data` (best_amount, best_date, supplier, …), et depuis Session 12 les hints `category_hint` + `sous_categorie_hint` au top-level.

Utilisé par l'onglet Gestion OCR de `/ocr` (ex-Historique) pour alimenter le tri `scan_date`, les filtres d'association, la recherche multifocale, et les badges.

### `GET /result/{filename}`
Résultat OCR caché pour un justificatif.

### `POST /extract`
Extraction manuelle. Body : `{ "filename": "justificatif_xxx.pdf" }`

### `POST /extract-upload`
Upload + extraction ad-hoc (fichier non sauvegardé). Accepte PDF/JPG/PNG. Form-data : `file`. Les images sont converties en PDF avant OCR.

### `POST /batch-upload`
Upload batch de justificatifs PDF/JPG/PNG + OCR synchrone. Form-data : `files` (multiple). Les images sont converties en PDF à l'intake.

**Réponse :**
```json
[
  {
    "filename": "justificatif_20240415_xxxx.pdf",
    "original_name": "facture_fournisseur.pdf",
    "success": true,
    "ocr_success": true,
    "ocr_data": {
      "best_amount": 500.00,
      "best_date": "2024-04-15",
      "supplier": "Fournisseur XYZ"
    }
  }
]
```

### `PATCH /{filename}/extracted-data`
Mise à jour manuelle des données OCR extraites. Permet de corriger `best_amount`, `best_date`, `supplier`, et depuis Session 12 les **hints comptables** `category_hint` + `sous_categorie_hint`.

**Body :**
```json
{
  "best_amount": 1439.87,
  "best_date": "2025-01-18",
  "supplier": "FCE Bank plc",
  "category_hint": "Matériel",
  "sous_categorie_hint": "Informatique"
}
```

Tous les champs optionnels — seuls les champs fournis sont mis à jour. Ajoute `manual_edit: true` et `manual_edit_at` au `.ocr.json` pour traçabilité.

**Hints comptables** :
- Stockés au **top-level** du `.ocr.json` (hors `extracted_data` pour ne pas polluer les arrays OCR)
- Écrits automatiquement par `justificatif_service.associate()` à chaque association (skip `""` / `Autres` / `Ventilé`)
- Lus par `rapprochement_service.score_categorie()` en **override prioritaire** de la prédiction ML : hint présent → score 1.0 si match op, 0.6 si sous-cat différente, 0.0 sinon ; pas de hint → fallback ML classique
- Effet cascade : chaque association enrichit le fichier → prochain rapprochement auto plus précis
- Éditables via `OcrEditDrawer` / `SkippedItemEditor` (dropdowns cat/sous-cat)
- Modèle Pydantic `OcrManualEdit` étendu avec `category_hint: Optional[str] = None` + `sous_categorie_hint: Optional[str] = None`

### `DELETE /cache/{filename}`
Supprimer le cache OCR.

---

## Ventilation (`/api/ventilation`)

Permet de ventiler une opération bancaire en N sous-lignes (≥2) avec catégorie, sous-catégorie, montant et justificatif individuels.

### `PUT /{filename}/{op_index}`
Créer ou remplacer la ventilation d'une opération.

**Body :**
```json
{
  "lines": [
    { "montant": 1000.00, "categorie": "Matériel", "sous_categorie": "Informatique", "libelle": "Cartouches" },
    { "montant": 439.87, "categorie": "Véhicule", "sous_categorie": "Entretien", "libelle": "Pneus" }
  ]
}
```

**Validation :** ≥ 2 lignes, chaque montant > 0, `sum(montants)` == montant opération (tolérance 0.01€). La catégorie parente est automatiquement mise à "Ventilé".

**Auto-rapprochement post-ventilation** : après chaque création/modification de ventilation, `rapprochement_service.run_auto_rapprochement()` est lancé en arrière-plan via `BackgroundTasks`. Chaque sous-ligne créée est scorée contre les justificatifs en attente (scoring v2, seuil 0.80). Évite d'avoir à cliquer "Associer automatiquement" manuellement après chaque ventilation.

### `DELETE /{filename}/{op_index}`
Supprimer la ventilation. Remet la catégorie à "" (sera recatégorisée).

### `PATCH /{filename}/{op_index}/{line_index}`
Modifier une sous-ligne de ventilation.

**Body :** champs partiels (ex: `{ "categorie": "Santé", "justificatif": "facture.pdf" }`)

---

## Exports (`/api/exports`)

Export comptable V3 avec grille calendrier. Chaque export est un ZIP contenant PDF+CSV+relevés+rapports+justificatifs organisés en dossiers.

### `GET /periods`
Périodes disponibles avec statistiques.

### `GET /list`
Liste des archives ZIP générées.

### `GET /status/{year}`
Statut mensuel des exports pour une année : 12 mois × `{ nb_operations, has_data, has_pdf, has_csv, nb_releves, nb_rapports, nb_justificatifs }`.

### `GET /available-reports/{year}/{month}`
Rapports disponibles pour inclusion dans un export mensuel. Retourne auto-détectés (flag) + galerie complète.

### `GET /contents/{filename}`
Liste les fichiers contenus dans un ZIP d'export avec noms enrichis (relevés → "Relevé Mois Année").

### `POST /generate`
Générer un export comptable ZIP (endpoint legacy avec options granulaires).

### `POST /generate-month`
Générer un export mensuel. Produit un ZIP avec PDF+CSV+relevés+rapports+justificatifs+compte_attente.

**Body :**
```json
{
  "year": 2025,
  "month": 1,
  "format": "pdf",
  "report_filenames": null,
  "include_compte_attente": true
}
```

- `include_compte_attente` : défaut `true`. Inclut `compte_attente/` (PDF + CSV) dans le ZIP.
- Les fichiers Export Comptable sont aussi copiés en standalone dans `data/reports/` et enregistrés dans la GED.

### `POST /generate-batch`
Générer un batch d'exports pour plusieurs mois dans un seul ZIP (sous-dossiers par mois).

**Body :**
```json
{
  "year": 2025,
  "months": [1, 2, 3],
  "format": "pdf"
}
```

### `GET /download/{filename}`
Télécharger un export (ZIP, PDF ou CSV).

### `DELETE /{filename}`
Supprimer un export.

---

## Email (`/api/email`)

Envoi de documents comptables par email via SMTP Gmail. Email HTML avec logo, ZIP unique en pièce jointe.

### `POST /test-connection`
Tester la connexion SMTP avec les credentials des settings. Retourne `{ success, message }`.

### `GET /documents`
Lister les documents disponibles pour envoi. Scan de 5 répertoires (exports, rapports, relevés, justificatifs, GED).

**Query params :** `type` (optionnel), `year` (optionnel), `month` (optionnel)

### `POST /preview`
Prévisualisation de l'email : génère objet + corps automatiques depuis les documents sélectionnés.

**Body :** `EmailSendRequest { documents: DocumentRef[], destinataires, objet?, corps? }`

### `POST /send`
Envoyer des documents par email. Zippe tous les documents en un seul ZIP, envoie un email HTML avec logo.

**Body :** `EmailSendRequest { documents: DocumentRef[], destinataires, objet?, corps? }`

**Réponse :** `EmailSendResponse { success, message, destinataires, fichiers_envoyes, taille_totale_mo }`

### `GET /history`
Historique des envois email. **Query params :** `year` (optionnel), `limit` (défaut 50).

### `GET /coverage/{year}`
Couverture d'envoi par mois pour une année : `{ 1: true, 2: false, ... }`.

---

## Rapprochement (`/api/rapprochement`)

**Scoring v2 — 4 critères + pondération dynamique** (backend `rapprochement_service.compute_score()`) :
- `score_montant` : paliers graduels 0/1%/2%/5% → 1.0/0.95/0.85/0.60/0.0 + test HT/TTC (plancher 0.95)
- `score_date` : paliers symétriques ±0/±1/±3/±7/±14 → 1.0/0.95/0.80/0.50/0.20/0.0
- `score_fournisseur` : `max(substring, Jaccard, Levenshtein)` (difflib, seuil 0.5)
- `score_categorie` : inférence ML (`ml_service.predict_category(fournisseur)` → rules + sklearn fallback confiance ≥0.5) comparée à `op.categorie` (1.0 / 0.6 / 0.0). Retourne `None` si non-inférable → critère neutre.
- `compute_total_score` : `0.35*M + 0.25*F + 0.20*D + 0.20*C` quand C présent, sinon redistribution `0.4375*M + 0.3125*F + 0.25*D` sur les 3 critères restants.
- Retour : `{ total: float, detail: { montant, date, fournisseur, categorie }, confidence_level }` — les 4 sous-scores sont exposés dans `detail` pour affichage frontend (`ScorePills`).

### `POST /run-auto`
Rapprochement automatique : parcourt tous les justificatifs en attente, auto-associe ceux avec score >= 0.80 et match unique (écart >= 0.02 avec le 2ème meilleur). Déclenché automatiquement après chaque upload de justificatif (via OCR background, batch upload OCR, et sandbox watchdog).

**Gate date obligatoire (Session 27)** : refuse toute auto-association si `best_match.score.detail.date <= 0.0` (i.e., écart > 14 jours) **indépendamment du score total**. Protège contre les cross-year hallucinés où montant + fournisseur + catégorie parfaits compensaient l'absence de date pour atteindre pile 0.80. Les rejetés passent en `suggestions_fortes` (visibles dans le drawer manuel).

**Auto-lock ≥ 0.95 (Session 27)** : si `best_score >= 0.95`, l'op est immédiatement verrouillée après l'association (`locked: true` + `locked_at`). Détail exposé dans `associations_detail[].locked` et propagé dans les events SSE sandbox.

**Réponse :**
```json
{
  "total_justificatifs_traites": 15,
  "associations_auto": 8,
  "associations_detail": [
    {
      "justificatif": "amazon_20250128_49.86.pdf",
      "operation_file": "operations_split_202501_...json",
      "operation_index": 70,
      "ventilation_index": 1,
      "libelle": "DU280125AMAZONPAYMENTSPAYLI2441535/ 202,84",
      "date": "2025-01-28",
      "montant": 49.86,
      "score": 0.98,
      "locked": true
    }
  ],
  "suggestions_fortes": 3,
  "sans_correspondance": 4,
  "justificatifs_restants": 4,
  "ran_at": "2024-04-15T10:30:00"
}
```

### `POST /associate-manual`
Association manuelle opération ↔ justificatif avec métadonnées.

**Body :** `{ "justificatif_filename": "...", "operation_file": "...", "operation_index": 5, "rapprochement_score": 0.75, "ventilation_index": null, "force": false }`

Le champ `ventilation_index` est optionnel. Si fourni, l'association écrit le justificatif dans la sous-ligne de ventilation correspondante.

Le champ `force` (défaut `false`) permet de bypasser la garde lock. Sans `force=true`, le router répond **HTTP 423** si l'opération cible a `locked=true`.

**Side-effect** : après succès, le router set automatiquement `locked=true` + `locked_at=<ISO>` sur l'op — toute association manuelle verrouille donc l'opération contre un éventuel écrasement par `run_auto_rapprochement`.

### `GET /unmatched`
Compteurs : opérations sans justificatif / justificatifs en attente. Le compteur `justificatifs_en_attente` exclut les fichiers physiquement en `en_attente/` mais déjà référencés par une opération (via `get_all_referenced_justificatifs()`).

### `GET /log?limit=20`
Dernières associations automatiques.

### `GET /batch-hints/{filename}`
Best scores par index pour un fichier d'opérations. Les justificatifs déjà référencés par une opération sont exclus des candidats (`get_all_referenced_justificatifs()`).

### `GET /batch-justificatif-scores`
Best score par justificatif en attente. Les justificatifs déjà référencés sont exclus avant le calcul de score.

### `GET /suggestions/operation/{file}/{index}?ventilation_index=`
Suggestions de justificatifs pour une opération. Si `ventilation_index` fourni, score avec le montant de la sous-ligne. Si op ventilée sans `ventilation_index`, retourne `{ ventilated: true, ventilation_lines: [...] }`.

### `GET /suggestions/justificatif/{filename}`
Suggestions d'opérations pour un justificatif. Inclut les sous-lignes ventilées. Utilisé par `useJustificatifSuggestions` et par le nouveau **`JustifToOpDrawer`** (sens inverse justif → op, ouvert depuis `GedDocumentDrawer`).

**Réponse :** liste d'objets avec la structure suivante :
```json
[
  {
    "justificatif_filename": "fournisseur_20250109_amount.pdf",
    "operation_file": "operations_merged_202501_xxx.json",
    "operation_index": 42,
    "operation_libelle": "LIBELLE OPERATION",
    "operation_date": "2025-01-09",
    "operation_montant": 19.99,
    "score": {
      "total": 0.85,
      "detail": { "montant": 1.0, "date": 0.95, "fournisseur": 0.8, "categorie": 0.6 },
      "confidence_level": "fort"
    },
    "ventilation_index": null,
    "op_locked": false,
    "op_locked_at": null
  }
]
```

**Session 26** : les champs `op_locked: bool` + `op_locked_at: str|null` sont désormais exposés dans chaque suggestion (lit `op.get("locked")` + `op.get("locked_at")` lors du scoring). Permet au `JustifToOpDrawer` d'afficher un badge `Lock` warning + bouton « Déverrouiller » directement sur la row — sans fetch lazy côté client. Compatible avec `ManualAssociationDrawer` (types optionnels, pas de breaking change pour les consommateurs existants).

### `GET /{filename}/{index}/suggestions`
Suggestions filtrées pour le `RapprochementWorkflowDrawer` (drawer unifié). Utilise `rename_service.compute_canonical_name()` indirectement via `compute_score()` pour le scoring v2.

**Paramètres :** `montant_min`, `montant_max`, `date_from`, `date_to`, `search`, `ventilation_index` (tous optional)

**Réponse :**
```json
[
  {
    "filename": "justificatif_xxx.pdf",
    "ocr_date": "2024-04-10",
    "ocr_montant": 500.00,
    "ocr_fournisseur": "Fournisseur XYZ",
    "score": 0.85,
    "score_detail": {
      "montant": 1.0,
      "date": 0.95,
      "fournisseur": 1.0,
      "categorie": 1.0
    },
    "size_human": "245.3 Ko"
  }
]
```

Le champ `score_detail` expose les 4 sous-scores (M/D/F/C) pour permettre au frontend d'afficher des `ScorePills` avec couleurs dynamiques. `categorie` peut être `null` si le critère est non-inférable.

**Filtre déjà-référencés** : les justificatifs déjà associés à une opération sont automatiquement exclus des suggestions via `get_all_referenced_justificatifs()` (cache TTL 5s). Exception : le justificatif de l'opération courante reste proposé (ré-association autorisée).

---

## Lettrage (`/api/lettrage`)

### `POST /{filename}/{index}`
Toggle le champ `lettre` (bool) d'une opération.

**Réponse :** `{ "index": 5, "lettre": true }`

### `POST /{filename}/bulk`
Applique le lettrage sur plusieurs opérations.

**Body :** `{ "indices": [0, 1, 5, 12], "lettre": true }`

**Réponse :** `{ "count": 4, "lettre": true }`

### `GET /{filename}/stats`
Statistiques de lettrage pour un fichier.

**Réponse :**
```json
{
  "total": 86,
  "lettrees": 42,
  "non_lettrees": 44,
  "taux": 0.49
}
```

---

## Clôture (`/api/cloture`)

### `GET /years`
Années disponibles (extraites des fichiers d'opérations).

**Réponse :** `[2024, 2023]`

### `GET /{year}`
Statut annuel — 12 mois avec complétude lettrage et justificatifs.

**Réponse :**
```json
[
  {
    "mois": 1,
    "label": "Janvier",
    "has_releve": true,
    "filename": "operations_20250520_094452_d9faa5a9.json",
    "nb_operations": 86,
    "nb_lettrees": 42,
    "taux_lettrage": 0.49,
    "nb_justificatifs_total": 86,
    "nb_justificatifs_ok": 38,
    "taux_justificatifs": 0.44,
    "statut": "partiel"
  }
]
```

Valeurs de `statut` :
- `complet` : relevé + 100% lettrage + 100% justificatifs
- `partiel` : relevé chargé mais incomplet
- `manquant` : pas de relevé pour ce mois

---

## Sandbox (`/api/sandbox`)

### `GET /events`
Stream SSE (Server-Sent Events) des événements sandbox. Se connecte et reste ouvert.

**Content-Type :** `text/event-stream`

**Événements :**
- Connexion : `data: {"status": "connected", "timestamp": ""}`
- Fichier en cours d'analyse (Session 27) : `data: {"event_id": "facture.pdf@...@scanning", "filename": "facture.pdf", "status": "scanning", "timestamp": "...", "original_filename": null}` — poussé dès le move sandbox → en_attente, avant OCR. Frontend affiche un `toast.loading()` neutre.
- Fichier traité : `data: {"event_id": "facture.pdf@...@processed", "filename": "facture.pdf", "status": "processed", "timestamp": "<processed_at_ocr>", "supplier": "Auchan", "best_date": "2025-01-28", "best_amount": 49.86, "auto_renamed": false, "auto_associated": true, "operation_ref": {"file": "operations_split_202501_....json", "index": 70, "ventilation_index": 1, "libelle": "DU280125AMAZONPAYMENTSPAYLI/ 202,84", "date": "2025-01-28", "montant": 49.86, "locked": true, "score": 0.98}}` — fin de pipeline (OCR + rename + auto-rapprochement). `auto_associated + operation_ref` présents si match trouvé (seuil 0.80).
- Erreur OCR : `data: {"filename": "facture.pdf", "status": "error", "timestamp": "..."}`
- Keepalive (30s) : `: ping`
- **Rejeu au connect (Session 27)** : les events récents (< 180s) sont rejoués avec `replayed: true` depuis un ring buffer en mémoire **ET** seedé au boot depuis `en_attente/` + `traites/` via `seed_recent_events_from_disk()`. Permet de rattraper les events perdus lors d'un reload uvicorn ou d'une reconnexion EventSource. Frontend déduplique via `event_id = {filename}@{timestamp}@{status}`.

### `GET /list`
Liste les fichiers (PDF/JPG/PNG) actuellement dans le dossier sandbox (non encore traités).

**Réponse :**
```json
[
  {
    "filename": "facture_novembre.pdf",
    "size": 245760,
    "size_human": "240.0 Ko",
    "modified": "2024-11-20T14:30:00"
  }
]
```

### `POST /process`
Declenche le traitement de tous les fichiers en attente dans le sandbox (OCR + deplacement vers en_attente). Traitement parallele (3 threads).

**Réponse :** `{ "status": "started", "count": 42 }`

### `DELETE /{filename}`
Supprime un fichier du sandbox sans le traiter.

**Réponse :** `{ "status": "deleted", "filename": "facture_novembre.pdf" }`

---

## Alertes / Compte d'attente (`/api/alertes`)

### `GET /summary`
Résumé global des alertes, trié chronologiquement.

**Réponse :**
```json
{
  "total_en_attente": 1200,
  "par_type": {
    "justificatif_manquant": 400,
    "a_categoriser": 300,
    "montant_a_verifier": 200,
    "doublon_suspect": 150,
    "confiance_faible": 150
  },
  "par_fichier": [
    { "filename": "operations_xxx.json", "nb_alertes": 54, "nb_operations": 54, "month": 3, "year": 2024 }
  ]
}
```

### `GET /{filename}`
Opérations en compte d'attente pour un fichier (celles avec `compte_attente: true`).

### `POST /{filename}/{index}/resolve`
Résout une alerte. Body : `{ "alerte_type": "justificatif_manquant", "note": "..." }`

### `POST /{filename}/refresh`
Recalcule les alertes pour un fichier. Retourne `{ "nb_alertes": 18, "nb_operations": 54 }`.

### `POST /export`
Exporte les opérations en compte d'attente en PDF ou CSV.

**Body :**
```json
{
  "year": 2025,
  "month": 1,
  "format": "pdf"
}
```

- `month` : optionnel. Si omis, exporte l'année entière.
- `format` : `"pdf"` ou `"csv"`.
- Cas 0 opérations : fichier généré quand même (preuve mois clean).
- Le fichier est enregistré automatiquement dans la GED comme rapport (`report_type: "compte_attente"`).
- Déduplication : régénérer écrase le fichier et met à jour l'entrée GED.

**Réponse :**
```json
{
  "filename": "compte_attente_janvier.pdf",
  "nb_operations": 58,
  "total_debit": 18424.66,
  "total_credit": 50730.15
}
```

### `GET /export/download/{filename}`
Télécharge un export du compte d'attente depuis `data/exports/`.

---

## GED V2 (`/api/ged`)

### `GET /tree`
Arborescence complete. Scanne les sources (releves, justificatifs, rapports, documents libres), backfill les justificatifs traites, migre les rapports, puis construit 5 vues.

**Reponse :**
```json
{
  "by_period": [
    { "id": "period-2025", "label": "2025", "count": 60, "icon": "Calendar", "children": [
      { "id": "period-2025-T1", "label": "T1", "count": 24, "children": [
        { "id": "period-2025-1", "label": "Janvier", "count": 8, "children": [] }
      ]}
    ]}
  ],
  "by_category": [
    { "id": "cat-non-classes", "label": "Non classes", "count": 5, "icon": "AlertTriangle" },
    { "id": "cat-Vehicule", "label": "Vehicule", "count": 18, "children": [
      { "id": "cat-Vehicule-Carburant", "label": "Carburant", "count": 6 }
    ]}
  ],
  "by_vendor": [
    { "id": "vendor-orange", "label": "Orange", "count": 27, "icon": "Building2", "children": [
      { "id": "vendor-orange-2025", "label": "2025", "count": 20 }
    ]}
  ],
  "by_type": [
    { "id": "releves", "label": "Releves bancaires", "count": 26, "icon": "FileText", "children": [...] },
    { "id": "justificatifs", "label": "Justificatifs", "count": 78, "icon": "Receipt", "children": [
      { "id": "justificatifs-en-attente", "label": "En attente", "count": 19 },
      { "id": "justificatifs-traites", "label": "Traites", "count": 59, "children": [...] }
    ]},
    { "id": "rapports", "label": "Rapports", "count": 0, "icon": "BarChart3", "children": [
      { "id": "rapport-pdf", "label": "PDF", "count": 0 }
    ]},
    { "id": "documents-libres", "label": "Documents libres", "count": 0, "icon": "FolderOpen" }
  ],
  "by_year": [
    { "id": "year-2025", "label": "2025", "count": 60, "icon": "Calendar", "children": [
      { "id": "year-2025-releve", "label": "Releves", "count": 12, "icon": "FileText", "children": [...] },
      { "id": "year-2025-justificatif", "label": "Justificatifs", "count": 48, "children": [...] }
    ]}
  ]
}
```

### `GET /documents?type=&year=&month=&quarter=&categorie=&sous_categorie=&fournisseur=&format_type=&favorite=&poste_comptable=&tags=&search=&montant_min=&montant_max=&sort_by=added_at&sort_order=desc`
Liste filtree des documents indexes. Filtres croises : tous combinables. Tags separes par virgule. Recherche full-text inclut noms, OCR, titres/descriptions rapports, fournisseur.

**Session 26 — enrichissement dynamique lock + self-heal** : pour chaque document `type=justificatif` avec `operation_ref` non-null, la réponse ajoute à la volée :
- `op_locked: bool` — reflète `operations[ref.index].locked` du fichier source
- `op_locked_at: str|null` — timestamp ISO

Groupe les refs par fichier et charge chaque fichier une seule fois via `operation_service.load_operations` (cache mtime interne). **Self-heal** : si l'op à `ref.index` ne pointe pas vers le justif via `Lien justificatif` (désynchronisation après un merge/split antérieur), un helper `_op_points_to()` scanne le fichier pour retrouver l'op qui pointe réellement vers le justif (check main + ventilation sous-lignes) et **corrige l'index dans la réponse** — les métadonnées disque restent inchangées (pour un futur job de réconciliation). Non-bloquant : wrappé dans `try/except` silencieux.

**Session 26 — tri refait pour None safety** : le tri sépare les docs avec valeur et les docs sans valeur en 2 listes, les trie individuellement, puis concatène les None **en fin** (pour `asc` ET `desc`, évite les None en tête de liste avec `sort_order=asc`). Support des paths pointés (`period.year`). Fallbacks : `sort_by=montant` tombe sur `montant_brut` si absent ; `sort_by=date_document` tombe sur `date_operation` puis `period.year`. Filet `try/except` qui coerce tout en string si types hétérogènes. Utilisé par le nouveau sélecteur de tri header + les headers cliquables de la vue liste (`SortableHeader` avec icônes `ArrowUp`/`ArrowDown`/`ArrowUpDown`).

**Params montant** : `montant_min` / `montant_max` filtrent sur `montant || montant_brut` (consolidation identique à l'affichage des cartes).

### `POST /upload`
Upload document libre. Form-data : `file` + `metadata_json` (JSON string avec type, year, month, poste_comptable, tags, notes). Images (JPG/PNG) converties en PDF.

### `PATCH /documents/{doc_id:path}`
Modifier les métadonnées d'un document.

**Body :**
```json
{
  "poste_comptable": "vehicule",
  "tags": ["fiscal", "2025"],
  "notes": "Facture carburant",
  "montant_brut": 85.50,
  "deductible_pct_override": 70
}
```

### `DELETE /documents/{doc_id:path}`
Supprime un document libre uniquement. Refuse pour relevés/justificatifs/rapports.

### `GET /documents/{doc_id:path}/preview`
Sert le fichier (PDF, CSV, XLSX) via FileResponse.

### `GET /documents/{doc_id:path}/thumbnail`
Thumbnail PNG de la première page du PDF (200px de large). Généré à la demande via pdf2image, caché dans `data/ged/thumbnails/`. 404 si non-PDF.

### `POST /documents/{doc_id:path}/open-native`
Ouvre le fichier dans l'application macOS par défaut (Aperçu pour les PDF) via `subprocess.Popen(["open", path])`.

**Réponse :** `{ "status": "opened" }`

### `GET /search?q=...`
Recherche full-text (min 2 chars) dans noms de fichiers, tags, notes, contenu OCR. Retourne max 50 résultats triés par score.

### `GET /stats`
Statistiques globales enrichies.

**Reponse :**
```json
{
  "total_documents": 104,
  "total_brut": 5000.00,
  "total_deductible": 3500.00,
  "disk_size_human": "14.0 Mo",
  "par_poste": [
    { "poste_id": "vehicule", "poste_label": "Vehicule", "deductible_pct": 70, "nb_docs": 3, "total_brut": 1200, "total_deductible": 840 }
  ],
  "par_categorie": [
    { "categorie": "Vehicule", "count": 18, "total_montant": 15000 }
  ],
  "par_fournisseur": [
    { "fournisseur": "Orange", "count": 27, "total_montant": 2500 }
  ],
  "par_type": { "releve": 26, "justificatif": 78, "rapport": 0, "document_libre": 0 },
  "non_classes": 22,
  "rapports_favoris": 0
}
```

### `GET /postes`
Liste des postes comptables avec % de déductibilité (16 postes par défaut).

### `PUT /postes`
Sauvegarder tous les postes. Body : `PostesConfig` (version, exercice, postes[]).

### `POST /postes`
Ajouter un poste custom. Body : objet poste.

### `DELETE /postes/{id}`
Supprimer un poste custom (pas les postes système).

### `POST /bulk-tag`
Tagger plusieurs documents. Body : `{ "doc_ids": [...], "tags": [...] }`

### `POST /scan`
Force un re-scan des sources + backfill justificatifs traites + migration rapports.

**Reponse :** `{ "success": true, "total_documents": 104 }`

### `GET /pending-reports?year=2025`
Rapports mensuels non generes pour les mois passes de l'annee (remplace l'ancien `GET /reports/pending`).

**Reponse :**
```json
[
  { "type": "mensuel", "year": 2025, "month": 3, "label": "Rapport mensuel — Mars 2025" }
]
```

### `POST /documents/{doc_id:path}/favorite`
Toggle le favori sur un rapport. Sync avec le report_service index.

### `POST /documents/{doc_id:path}/regenerate`
Re-genere un rapport avec donnees actualisees (delegue a report_service).

### `POST /documents/compare-reports`
Compare 2 rapports. Body : `{ "doc_id_a": "...", "doc_id_b": "..." }`. Retourne deltas montants/ops/%.

---

## Amortissements (`/api/amortissements`)

### `GET /`
Liste des immobilisations avec champs calculés (`avancement_pct`, `vnc_actuelle`).

**Query params :** `statut` (en_cours/amorti/sorti), `poste`, `year`

### `GET /kpis?year=2025`
KPIs : nb actives/amorties/sorties, nb candidates, dotation exercice, total VNC, ventilation par poste.

### `GET /{immo_id}`
Détail d'une immobilisation avec tableau d'amortissement complet calculé.

### `POST /`
Créer une immobilisation. Body : `ImmobilisationCreate`.

### `PATCH /{immo_id}`
Modifier une immobilisation. Auto-update statut si date_sortie renseignée ou VNC = 0.

### `DELETE /{immo_id}`
Supprimer une immobilisation du registre.

### `GET /dotations/{year}`
Dotations de l'exercice : total brut, total déductible, détail par immobilisation.

### `GET /projections?years=5`
Projections des dotations sur N années à partir de l'année courante.

### `GET /tableau/{immo_id}`
Tableau d'amortissement seul (sans metadata de l'immobilisation).

### `GET /candidates`
Opérations candidates à l'immobilisation : montant > seuil, catégorie éligible, pas déjà immobilisées/ignorées.

### `POST /candidates/immobiliser`
Crée l'immobilisation + lie l'opération source (change catégorie à "Immobilisations"). Body : `ImmobilisationCreate` avec `operation_source`.

### `POST /candidates/ignore`
Marque l'opération comme ignorée (`immobilisation_ignored: true`). Body : `{ "filename": "...", "index": 5 }`

### `POST /cession/{immo_id}`
Sortie d'actif : calcule VNC à la date de sortie, plus/moins-value, régime fiscal (court/long terme). Met à jour l'immobilisation avec statut "sorti". Body : `{ "date_sortie": "2025-06-15", "motif_sortie": "cession", "prix_cession": 5000 }`

**Réponse :**
```json
{
  "vnc_sortie": 3400.00,
  "plus_value": 1600.00,
  "moins_value": null,
  "duree_detention_mois": 36,
  "regime": "long_terme"
}
```

### `GET /config`
Configuration : seuil, durées par défaut, catégories éligibles, sous-catégories exclues.

### `PUT /config`
Sauvegarder la configuration. Body : `AmortissementConfig`.

---

## Settings (`/api/settings`)

### `GET /`
Charger les paramètres.

```json
{
  "theme_settings": {
    "primary_color": "#811971",
    "background_color": "#cccce2",
    "text_color": "#f1efe8"
  },
  "dark_mode": true,
  "notifications": true,
  "num_operations": 50,
  "export_format": "PDF",
  "include_graphs": true,
  "compress_exports": false
}
```

### `PUT /`
Sauvegarder les paramètres (body : objet AppSettings complet).

### `GET /disk-space`
Espace disque.

### `GET /data-stats`
Statistiques par dossier de données.

### `GET /system-info`
Informations système (version app, Python, plateforme).

### `POST /restart`
Redémarre le backend en touchant un sentinel Python (`backend/_reload_trigger.py`). Uvicorn `--reload` détecte la modification et redémarre automatiquement (~2-3s).

**Contrainte :** fonctionne UNIQUEMENT en mode dev (uvicorn lancé avec `--reload`). En production, un supervisor externe (systemd, launchd, PM2) serait nécessaire.

**Réponse :**
```json
{ "restarting": true, "sentinel": "_reload_trigger.py" }
```

Le frontend (hook `useRestartBackend` dans `useApi.ts`) gère ensuite automatiquement :
1. Sleep 1.5s pour laisser uvicorn kill l'ancien process
2. Poll `GET /api/settings` toutes les 500ms (timeout 20s) jusqu'à réponse
3. `window.location.reload()` hard pour re-fetch le bundle frontend

Usage principal : rejouer la réparation des liens justificatifs au boot (via le `lifespan()`) après une modification manuelle, sans avoir à quitter le terminal.

Bouton « Redémarrer backend » disponible dans `SettingsPage > Stockage > Intégrité des justificatifs`.

---

## Simulation (`/api/simulation`)

### `GET /baremes`
Charge tous les barèmes fiscaux pour une année donnée.

**Paramètres :** `year` (int, défaut 2024)

**Réponse :** Objet avec clés `urssaf`, `carmf`, `ir`, `odm`, `year`.

### `GET /baremes/{type_bareme}`
Charge un barème spécifique (urssaf, carmf, ir, odm). Fallback sur l'année la plus récente si inexistant.

**Paramètres :** `year` (int, défaut 2024)

### `PUT /baremes/{type_bareme}`
Met à jour un barème. Body : objet JSON du barème complet.

**Paramètres :** `year` (int, défaut 2024)

### `POST /calculate`
Simulation multi-leviers complète.

**Body :**
```json
{
  "bnc_actuel": 125000,
  "year": 2024,
  "parts": 1.75,
  "leviers": {
    "madelin": 0,
    "per": 0,
    "carmf_classe": "M",
    "investissement": 0,
    "investissement_duree": 5,
    "investissement_prorata_mois": 6,
    "formation_dpc": 0,
    "remplacement": 0,
    "depense_pro": 0,
    "depenses_detail": {}
  }
}
```

**Réponse :** Objet `SimulationResult` avec actuel/simulé/delta pour chaque organisme (URSSAF, CARMF, ODM, IR), revenu net, détail investissement.

### `GET /taux-marginal`
Calcule le taux marginal réel combiné (IR + URSSAF + CARMF) par delta +1€.

**Paramètres :** `bnc` (float), `year` (int), `parts` (float)

### `GET /seuils`
Identifie les seuils critiques où le taux marginal saute (tranches IR, maladie, allocations familiales).

**Paramètres :** `year` (int), `parts` (float)

### `GET /historique`
Calcule le BNC historique depuis les fichiers d'opérations (mensuel, annuel, profil saisonnier).

**Paramètres :** `years` (string, optionnel, ex: "2024,2025")

### `GET /previsions`
Projette les revenus futurs par analyse saisonnière ou moyenne simple.

**Paramètres :** `horizon` (int, défaut 12), `methode` (string, défaut "saisonnier")

### `POST /urssaf-deductible`
Calcule la part déductible et non déductible d'une cotisation URSSAF brute. Aucun effet de bord.

**Body :**
```json
{
  "montant_brut": 5232.0,
  "bnc_estime": 120000,
  "year": 2025,
  "cotisations_sociales_estime": null
}
```

**Réponse :**
```json
{
  "year": 2025,
  "montant_brut": 5232.0,
  "assiette_csg_crds": 88800.0,
  "assiette_mode": "bnc_abattu",
  "taux_non_deductible": 0.029,
  "part_non_deductible": 2575.2,
  "part_deductible": 2656.8,
  "ratio_non_deductible": 0.4923,
  "bnc_estime_utilise": 120000,
  "cotisations_sociales_utilisees": null
}
```

### `POST /batch-csg-split`
Calcule et stocke le split CSG/CRDS pour toutes les opérations URSSAF d'une année en un clic.

**Paramètres :** `year` (int, required), `force` (bool, défaut false — si true recalcule même les ops déjà splitées)

**Réponse :**
```json
{
  "year": 2025,
  "bnc_estime": 823.45,
  "updated": 12,
  "skipped": 0,
  "total_non_deductible": 212.04
}
```

---

## Prévisionnel (`/api/previsionnel`)

Calendrier de trésorerie annuel combinant charges attendues, recettes projetées et réalisé.

### `GET /timeline`
Vue 12 mois avec charges, recettes, solde et solde cumulé.

**Paramètres :** `year` (int, required)

**Réponse :**
```json
{
  "year": 2026,
  "mois": [
    {
      "mois": 1,
      "label": "janvier",
      "statut_mois": "clos",
      "charges": [
        { "id": "provider:urssaf-trimestriel:1", "label": "Cotisations URSSAF", "montant": 3500, "source": "provider", "statut": "recu" }
      ],
      "charges_total": 12500,
      "recettes": [
        { "id": "rec:Honoraires:1", "label": "Honoraires", "montant": 45000, "source": "realise", "statut": "realise" }
      ],
      "recettes_total": 45000,
      "solde": 32500,
      "solde_cumule": 32500
    }
  ],
  "charges_annuelles": 150000,
  "recettes_annuelles": 540000,
  "solde_annuel": 390000,
  "taux_verification": 0.75
}
```

### `GET /providers`
Liste les fournisseurs récurrents configurés.

### `POST /providers`
Ajouter un fournisseur. Body : `PrevProviderCreate`.

**Body :**
```json
{
  "fournisseur": "URSSAF",
  "label": "Cotisations URSSAF",
  "mode": "facture",
  "periodicite": "trimestriel",
  "mois_attendus": [1, 4, 7, 10],
  "jour_attendu": 15,
  "montant_estime": 3500,
  "keywords_ocr": ["urssaf", "cotisation"]
}
```

### `PUT /providers/{id}`
Modifier un fournisseur. Body : `PrevProviderUpdate` (champs optionnels).

### `DELETE /providers/{id}`
Supprimer un fournisseur et ses échéances liées.

### `GET /echeances`
Échéances filtrées. Query : `year` (int, optional), `statut` (string, optional).

### `GET /dashboard`
KPIs du prévisionnel. Query : `year` (int, required).

**Réponse :**
```json
{
  "total_echeances": 12,
  "recues": 6,
  "en_attente": 4,
  "en_retard": 2,
  "taux_completion": 0.5,
  "montant_total_estime": 42000,
  "prelevements_verifies": 8,
  "prelevements_total": 12,
  "taux_prelevements": 0.67
}
```

### `POST /scan`
Scanner les documents OCR et GED pour auto-associer aux échéances. Score ≥0.75 + match unique = auto-association.

### `POST /refresh`
Régénérer les échéances de l'année (sans écraser les existantes). Query : `year` (int, required).

### `POST /echeances/{id}/link`
Association manuelle d'un document à une échéance.

**Body :**
```json
{
  "document_ref": "justificatif_xxx.pdf",
  "document_source": "justificatif",
  "montant_reel": 3450
}
```

### `POST /echeances/{id}/unlink`
Dissocier un document d'une échéance.

### `POST /echeances/{id}/dismiss`
Marquer une échéance comme non applicable.

### `POST /echeances/{id}/prelevements`
Saisir les montants mensuels (mode échéancier).

**Body :**
```json
{
  "prelevements": [
    { "mois": 1, "montant": 850.00 },
    { "mois": 2, "montant": 850.00 }
  ]
}
```

### `POST /echeances/{id}/auto-populate`
Forcer le re-parsing OCR du document lié pour extraire les prélèvements mensuels (3 formats supportés).

### `POST /echeances/{id}/scan-prelevements`
Scanner les opérations bancaires pour vérifier les prélèvements attendus (match par keywords + montant ± tolérance).

### `POST /echeances/{id}/prelevements/{mois}/verify`
Vérification manuelle d'un prélèvement.

### `POST /echeances/{id}/prelevements/{mois}/unverify`
Annuler la vérification d'un prélèvement.

### `GET /settings`
Charger les paramètres du module (seuil, catégories exclues/recettes, overrides).

### `PUT /settings`
Sauvegarder les paramètres.

**Body :**
```json
{
  "seuil_montant": 200,
  "categories_exclues": ["perso"],
  "categories_recettes": ["Honoraires"],
  "annees_reference": [2024, 2025],
  "overrides_mensuels": { "recettes-7": 8000 }
}
```

---

## Templates Justificatifs (`/api/templates`)

Gestion des templates de justificatifs par fournisseur. Un template peut être créé à partir d'un justificatif existant (OCR extraction) ou à partir d'un **PDF vierge** (pas d'OCR, placement manuel des champs via click-to-position). La génération produit des PDF fac-similés quand l'original est manquant, avec **propagation automatique des hints catégorie** dans le `.ocr.json` généré pour booster le rapprochement.

### `GET /`
Liste tous les templates.

**Réponse :**
```json
[
  {
    "id": "tpl_9a0d79cc",
    "vendor": "TotalEnergies",
    "vendor_aliases": ["total", "totalenergies"],
    "category": "Véhicule",
    "sous_categorie": "Carburant",
    "source_justificatif": "justificatif_20260315_143022_ticket_total.pdf",
    "fields": [
      {
        "key": "date",
        "label": "Date",
        "type": "date",
        "source": "operation",
        "required": true
      },
      {
        "key": "montant_ttc",
        "label": "Montant TTC",
        "type": "currency",
        "source": "operation",
        "required": true
      },
      {
        "key": "tva_rate",
        "label": "Taux TVA",
        "type": "percent",
        "source": "fixed",
        "default": 20
      },
      {
        "key": "montant_ht",
        "label": "Montant HT",
        "type": "currency",
        "source": "computed",
        "formula": "montant_ttc / (1 + tva_rate / 100)"
      }
    ],
    "created_at": "2026-04-05T14:30:00",
    "created_from": "scan",
    "usage_count": 3,
    "is_blank_template": false,
    "page_width_pt": null,
    "page_height_pt": null,
    "taux_tva": 10.0
  }
]
```

**Champs additionnels pour les templates créés depuis un PDF vierge :**
- `is_blank_template: bool` — True si créé via `POST /from-blank`
- `page_width_pt: float` — largeur de la page 0 en points PDF
- `page_height_pt: float` — hauteur de la page 0 en points PDF

**Champ TVA (tous templates) :**
- `taux_tva: float = 10.0` — taux TVA par défaut (%) utilisé par `generate_reconstitue()` pour ventiler TTC/HT/TVA automatiquement : `ttc = abs(op.montant)`, `ht = ttc / (1 + taux_tva/100)`, `tva = ttc - ht`. Valeurs UI recommandées : 10 (restauration), 5.5 (alimentation), 20 (standard), 0 (exonéré). Persisté via `PUT /{id}` ou passé à la création via `POST /from-blank` (form field).

### `GET /{template_id}`
Retourne un template par ID.

### `POST /`
Crée un nouveau template.

**Body :**
```json
{
  "vendor": "TotalEnergies",
  "vendor_aliases": ["total", "totalenergies", "total access"],
  "category": "Véhicule",
  "sous_categorie": "Carburant",
  "source_justificatif": "justificatif_xxx.pdf",
  "fields": [
    {
      "key": "date",
      "label": "Date",
      "type": "date",
      "source": "operation",
      "required": true
    }
  ]
}
```

### `POST /from-blank`
Crée un template depuis un **PDF vierge** (template graphique fournisseur, formulaire type). Aucun OCR n'est lancé — l'utilisateur positionnera les champs manuellement via click-to-position dans l'éditeur frontend.

**Body** : `multipart/form-data`
- `file` : PDF obligatoire (validation magic bytes `%PDF`)
- `vendor` : str obligatoire
- `vendor_aliases` : JSON array string (optionnel, défaut `"[]"`)
- `category` : str (optionnel)
- `sous_categorie` : str (optionnel)
- `taux_tva` : float (optionnel, défaut `10.0`) — taux TVA (%) persisté sur le template

**Logique backend :**
1. Sauvegarde le PDF dans `data/templates/{template_id}/background.pdf`
2. Rasterise page 0 → `thumbnail.png` 200px de large (`pdf2image` + Pillow)
3. Lit les dimensions de page via `pdfplumber` (`page_width_pt`, `page_height_pt`)
4. Crée l'entrée template avec `is_blank_template=True`, `fields=[]`, `source_justificatif=None`, `taux_tva=<form>`

**Réponse :** le template créé (même schéma que `GET /`), avec `is_blank_template: true`, les dimensions et le `taux_tva`.

**Génération fac-similé pour blank template** (`POST /generate`) : `generate_reconstitue()` détecte le flag `is_blank_template` et résout automatiquement le PDF source via `get_blank_template_background_path(id)` (au lieu du `source_justificatif` qui est `None`). Deux modes :
- **Avec placeholders textuels** (`{KEY}`, `(KEY)` dans le text layer du background) : extraction via `pdfplumber.extract_words()` + regex `[{(][A-Z][A-Z0-9_]*[})]`, substitution inline à la position exacte (rectangle blanc + valeur Helvetica 7-10pt auto-sized). Clés supportées : `DATE`/`DATE_FR`, `MONTANT_TTC`/`TTC`/`MONTANT`, `MONTANT_HT`/`HT`, `MONTANT_TVA`/`TVA`, `TAUX_TVA`/`TVA_RATE`, `FOURNISSEUR`/`VENDOR`/`VENDEUR`, `REF_OPERATION`. Montants formatés **sans** symbole € (templates ont généralement `€` en dur après le placeholder).
- **Sans placeholders + coordonnées explicites** (champs positionnés via click-to-position) : pipeline `_generate_pdf_facsimile()` classique.
- **Sans placeholders ni coordonnées** : fallback overlay date + TTC en haut à droite de la page 0 (conserve le layout du background).

Le fac-similé généré respecte la ventilation TTC/HT/TVA calculée via `taux_tva` dans `_build_field_values()`.

### `GET /{template_id}/thumbnail`
Retourne le thumbnail PNG 200px d'un blank template. Cache local (`data/templates/{id}/thumbnail.png`), régénéré si le PDF source est plus récent. 404 si `is_blank_template=false`.

### `GET /{template_id}/background`
Retourne le PDF de fond d'un blank template (FileResponse PDF complet pour aperçu haute résolution ou click-to-position). 404 si `is_blank_template=false`.

### `GET /{template_id}/page-size`
Retourne les dimensions de la page 0 en points PDF pour le click-to-position côté client.

**Réponse :** `{ "width_pt": 595.28, "height_pt": 841.89, "page": 0 }`

### `GET /ged-summary`
Liste enrichie pour la GED (axe Templates). Inclut un compteur `facsimiles_generated` obtenu en scannant tous les `.ocr.json` dans `data/justificatifs/en_attente/` + `traites/` et en comptant ceux avec `source == "reconstitue"` et `template_id` correspondant.

**Réponse :**
```json
[
  {
    "id": "tpl_1c760f2a",
    "vendor": "Auchan",
    "vendor_aliases": ["auchan", "auchandac"],
    "category": "Véhicule",
    "sous_categorie": "Essence",
    "is_blank_template": false,
    "fields_count": 3,
    "thumbnail_url": "/api/justificatifs/justificatif_xxx.pdf/thumbnail",
    "created_at": "2026-04-09T07:20:04",
    "usage_count": 12,
    "facsimiles_generated": 6
  }
]
```

### `GET /{template_id}/ged-detail`
Détail d'un template + liste des 50 fac-similés les plus récents générés depuis ce template (triés par `generated_at` décroissant). Utilisé par le drawer `GedTemplateDetailDrawer`.

**Réponse :** même structure que `GedTemplateItem` + champ `facsimiles: list[GedTemplateFacsimile]`.
```json
{
  "id": "tpl_1c760f2a",
  "vendor": "Auchan",
  "facsimiles_generated": 6,
  "facsimiles": [
    {
      "filename": "auchan_20241229_34.78_fs.pdf",
      "generated_at": "2026-04-09T10:15:00",
      "best_amount": 34.78,
      "best_date": "2024-12-29",
      "operation_ref": { "file": "operations_xxx.json", "index": 37 }
    }
  ]
}
```

### `PUT /{template_id}`
Met à jour un template existant. Même body que `POST /`, avec champ optionnel `is_blank_template: bool` (préservé si fourni, inchangé sinon).

**Propagation automatique des hints catégorie** : lors de la génération via `POST /generate`, si `template.category` est définie, le `.ocr.json` généré recevra `category_hint` + `sous_categorie_hint` au top-level. Ces hints sont lus en priorité par `rapprochement_service.score_categorie()`.

### `DELETE /{template_id}`
Supprime un template. **Comportement intentionnel : les fac-similés déjà générés ne sont PAS supprimés** — les PDF fac-similés, leurs `.ocr.json` (hints compris), et les associations aux opérations restent intacts. Pour un blank template, le dossier `data/templates/{id}/` (background.pdf + thumbnail.png) devient orphelin sur disque (pas de cleanup automatique — petit leak ~70-100 Ko par template supprimé).

### `POST /extract`
Extrait les champs structurés d'un justificatif existant pour aider à créer un template. Tente Ollama/Qwen2-VL d'abord, fallback sur les données `.ocr.json` basiques.

**Body :**
```json
{
  "filename": "justificatif_20260315_143022_ticket_total.pdf"
}
```

**Réponse :**
```json
{
  "vendor": "TOTALENERGIES",
  "suggested_aliases": ["totalenergies", "total"],
  "detected_fields": [
    {
      "key": "date",
      "label": "Date",
      "value": "2026-03-15",
      "type": "date",
      "confidence": 0.85,
      "suggested_source": "operation"
    },
    {
      "key": "montant_ttc",
      "label": "Montant TTC",
      "value": "72.45",
      "type": "currency",
      "confidence": 0.80,
      "suggested_source": "operation"
    }
  ]
}
```

### `POST /generate`
Génère un PDF justificatif reconstitué depuis un template + opération. Le PDF est sobre (format A5, Helvetica) sans aucune mention de reconstitution. La traçabilité est dans le `.ocr.json` compagnon (`"source": "reconstitue"`).

**Body :**
```json
{
  "template_id": "tpl_9a0d79cc",
  "operation_file": "operations_20260320_xxx.json",
  "operation_index": 12,
  "field_values": {
    "litrage": 35.2,
    "type_carburant": "SP95"
  },
  "auto_associate": true
}
```

**Réponse :**
```json
{
  "filename": "reconstitue_20260405_143000_totalenergies.pdf",
  "associated": true
}
```

Fichiers générés dans `data/justificatifs/en_attente/` :
- `vendor_YYYYMMDD_amount.XX_fs.pdf` — le justificatif PDF (convention canonique + suffix `_fs`)
- `vendor_YYYYMMDD_amount.XX_fs.ocr.json` — métadonnées avec `"source": "reconstitue"`, `template_id`, `operation_ref`, et **si le template a une catégorie**, `category_hint` + `sous_categorie_hint` au top-level pour booster le score rapprochement

Fallback (si date/montant manquants) : ancien format `reconstitue_YYYYMMDD_HHMMSS_vendor.pdf`.

### `GET /suggest/{operation_file}/{operation_index}`
Suggère des templates correspondant au libellé de l'opération. Les alias du template sont matchés dans le libellé bancaire (insensible à la casse, trié par longueur du match).

**Réponse :**
```json
[
  {
    "template_id": "tpl_9a0d79cc",
    "vendor": "TotalEnergies",
    "match_score": 0.5,
    "matched_alias": "totalenergies",
    "fields_count": 5
  }
]
```

### `POST /batch-suggest`
Groupe une liste d'operations par meilleur template suggere. Strategie de matching : 1) categorie/sous-categorie du template, 2) alias fournisseur dans le libelle, 3) sinon → unmatched.

**Body :**
```json
{
  "operations": [
    { "operation_file": "operations_xxx.json", "operation_index": 37 },
    { "operation_file": "operations_xxx.json", "operation_index": 68 }
  ]
}
```

**Reponse :**
```json
{
  "groups": [
    {
      "template_id": "tpl_1c760f2a",
      "template_vendor": "Auchan",
      "operations": [
        { "operation_file": "operations_xxx.json", "operation_index": 37, "libelle": "DU291224AUCHANDAC..." },
        { "operation_file": "operations_xxx.json", "operation_index": 68, "libelle": "DU260125AUCHANDAC..." }
      ]
    }
  ],
  "unmatched": []
}
```

### `POST /batch-candidates`
Trouve les operations sans justificatif matchant un template donne pour une annee.

**Body :** `{ "template_id": "tpl_xxx", "year": 2025 }`

**Reponse :** `BatchCandidatesResponse` avec liste de `BatchCandidate` (operation_file, index, date, libelle, montant, mois, categorie).

### `POST /batch-generate`
Genere des fac-similes en batch pour une liste d'operations avec un template donne. Chaque operation est traitee sequentiellement (sleep 0.1s entre chaque pour eviter les collisions de timestamp).

**Body :**
```json
{
  "template_id": "tpl_1c760f2a",
  "operations": [
    { "operation_file": "operations_xxx.json", "operation_index": 37 },
    { "operation_file": "operations_xxx.json", "operation_index": 68 }
  ]
}
```

**Reponse :**
```json
{
  "generated": 2,
  "errors": 0,
  "total": 2,
  "results": [
    { "operation_file": "operations_xxx.json", "operation_index": 37, "filename": "reconstitue_xxx.pdf", "associated": true },
    { "operation_file": "operations_xxx.json", "operation_index": 68, "filename": "reconstitue_yyy.pdf", "associated": true }
  ]
}
```

### `GET /ops-without-justificatif`
Retourne toutes les operations sans justificatif pour une annee, groupees par categorie/sous-categorie avec auto-suggestion de template.

**Query params :** `year` (int, requis)

**Reponse :** `OpsWithoutJustificatifResponse` avec groupes (`OpsGroup[]`), chaque groupe contenant `suggested_template_id` et `operations`.

### Types de champs

| `type` | Description | Format |
|--------|-------------|--------|
| `text` | Texte libre | string |
| `date` | Date | `YYYY-MM-DD` |
| `currency` | Montant EUR | float, affiché `XX,XX €` |
| `number` | Nombre | float |
| `percent` | Pourcentage | int 0-100 |
| `select` | Choix parmi `options` | string |

### Sources de champs

| `source` | Comportement |
|----------|-------------|
| `operation` | Auto-rempli depuis l'opération bancaire (date, montant) |
| `ocr` | Pré-rempli depuis le libellé OCR |
| `manual` | L'utilisateur remplit manuellement |
| `computed` | Calculé via `formula` (expressions arithmétiques simples) |
| `fixed` | Valeur par défaut fixe (modifiable) |

---

## Tasks (`/api/tasks`)

Module de suivi des actions comptables avec tâches auto-générées et manuelles, scopées par année.

### `GET /`

Liste les tâches.

**Query params** :
| Param | Type | Description |
|-------|------|-------------|
| `year` | int (optionnel) | Filtrer par année |
| `include_dismissed` | bool | Inclure les tâches auto ignorées (défaut: false) |

**Réponse** : `Task[]`

### `POST /`

Créer une tâche manuelle. Le champ `source` est forcé à `"manual"`.

**Body** : `TaskCreate`
| Champ | Type | Description |
|-------|------|-------------|
| `title` | string | Titre (requis) |
| `description` | string? | Description optionnelle |
| `status` | `"todo"` \| `"in_progress"` \| `"done"` | Défaut: `"todo"` |
| `priority` | `"haute"` \| `"normale"` \| `"basse"` | Défaut: `"normale"` |
| `year` | int? | Année d'exercice |
| `due_date` | string? | Date d'échéance `YYYY-MM-DD` |

**Réponse** : `Task`

### `PATCH /{task_id}`

Modifier une tâche. Si `status` passe à `"done"`, `completed_at` est renseigné automatiquement.

**Body** : `TaskUpdate` (tous champs optionnels)

**Réponse** : `Task` | 404

### `DELETE /{task_id}`

Supprimer une tâche **manuelle uniquement**. Retourne 400 pour les tâches auto (utiliser PATCH `dismissed: true`).

**Réponse** : `{ "success": true }` | 400 | 404

### `POST /reorder`

Persister l'ordre visuel des tâches au sein d'une colonne.

**Body** :
| Champ | Type | Description |
|-------|------|-------------|
| `ordered_ids` | string[] | Liste ordonnée des IDs de tâches |

**Réponse** : `{ "success": true }`

### `POST /refresh`

Régénère les tâches auto pour l'année donnée et applique la déduplication.

**Query params** :
| Param | Type | Description |
|-------|------|-------------|
| `year` | int (requis) | Année à scanner |

**Logique de déduplication** :
- Nouveau `auto_key` → ajouté
- `auto_key` existant avec status done ou dismissed → ignoré (pas recréé)
- `auto_key` existant actif → titre/description/priorité mis à jour
- `auto_key` disparu (problème résolu) → tâche supprimée

**5 détections auto** :
1. Opérations non catégorisées (par fichier de l'année)
2. Justificatifs en attente de rapprochement
3. Clôture incomplète (mois partiels)
4. Mois sans relevé importé
5. Alertes non résolues (compte d'attente)

**Réponse** : `{ "added": N, "updated": N, "removed": N }`

### Modèle Task

```json
{
  "id": "a1b2c3d4",
  "title": "Catégoriser 34 opérations — février 2026",
  "description": "Fichier operations_xxx.json contient 34 opérations...",
  "status": "todo",
  "priority": "haute",
  "source": "auto",
  "year": 2026,
  "auto_key": "categorize:operations_xxx.json",
  "due_date": null,
  "dismissed": false,
  "created_at": "2026-04-05T20:45:07.245",
  "completed_at": null,
  "order": 0
}

---

## Charges Forfaitaires (`/api/charges-forfaitaires`)

### `POST /calculer/blanchissage`
Calcule le montant déductible sans générer d'OD.

**Body :**
```json
{
  "year": 2026,
  "jours_travailles": 176.5,
  "mode": "domicile",
  "honoraires_liasse": 300000
}
```

**Réponse :** `ForfaitResult` avec `montant_deductible`, `cout_jour`, `detail[]`, `reference_legale`.

### `POST /generer`
Génère l'OD + PDF rapport + enregistrement GED.

**Body :**
```json
{
  "type_forfait": "blanchissage",
  "year": 2026,
  "jours_travailles": 176.5,
  "mode": "domicile",
  "honoraires_liasse": 300000
}
```

**Réponse :**
```json
{
  "od_filename": "operations_xxx.json",
  "od_index": 89,
  "pdf_filename": "blanchissage_20261231_2347,45.pdf",
  "ged_doc_id": "data/reports/blanchissage_20261231_2347,45.pdf",
  "montant": 2347.45
}
```

**Erreur 409** si un forfait blanchissage existe déjà pour l'année.

### `GET /generes?year=2026`
Liste les forfaits déjà générés pour l'année. Retourne `pdf_filename` et `ged_doc_id` pour preview et navigation.

### `DELETE /supprimer/{type_forfait}?year=2026`
Supprime l'OD + PDF (reports + justificatifs legacy) + entrée GED.

### `GET /config?year=2026`
Retourne la config persistée pour l'année (jours travaillés, honoraires liasse).

### `PUT /config?year=2026`
Met à jour la config persistée. Body partiel accepté. Champs véhicule inclus.

```json
{
  "honoraires_liasse": 300000,
  "jours_travailles": 176.5,
  "vehicule_distance_km": 18,
  "vehicule_km_supplementaires": 1200,
  "vehicule_km_totaux_compteur": 14000
}
```

### `POST /calculer/repas`
Calcule le forfait repas déductible sans générer d'OD.

**Body :**
```json
{
  "year": 2026,
  "jours_travailles": 176.5
}
```

**Réponse :** `RepasResult` avec `montant_deductible`, `cout_jour`, `seuil_repas_maison`, `plafond_repas_restaurant`, `reference_legale`.

### `GET /bareme/repas?year=2026`
Retourne le barème repas URSSAF + `forfait_jour` calculé (plafond − seuil).

**Réponse :**
```json
{
  "year": 2026,
  "seuil_repas_maison": 5.35,
  "plafond_repas_restaurant": 20.20,
  "forfait_jour": 14.85,
  "reference_legale": "BOI-BNC-BASE-40-60",
  "source": "URSSAF 2026"
}
```

### `DELETE /supprimer/repas?year=2026`
Supprime l'OD repas + PDF + entrée GED.

### `POST /calculer/vehicule`
Calcule le ratio pro sans persister. Retourne aussi le delta avec le poste GED actuel.

**Body :**
```json
{
  "year": 2025,
  "distance_domicile_clinique_km": 18,
  "jours_travailles": 176.5,
  "km_supplementaires": 1200,
  "km_totaux_compteur": 14000
}
```

**Réponse :** `VehiculeResult` avec `ratio_pro`, `ratio_perso`, `km_trajet_habituel`, `km_pro_total`, `ancien_ratio`, `delta_ratio`.

### `POST /appliquer/vehicule`
Applique le ratio : met à jour le poste GED `deductible_pct` + génère PDF rapport + enregistre GED + historique barème.

**Body :** même que `/calculer/vehicule`

**Réponse :**
```json
{
  "ratio_pro": 54.0,
  "ancien_ratio": 70.0,
  "pdf_filename": "quote_part_vehicule_2025.pdf",
  "ged_doc_id": "data/reports/quote_part_vehicule_2025.pdf",
  "poste_updated": true
}
```

### `POST /regenerer-pdf/vehicule?year=2025`
Regénère uniquement le PDF rapport véhicule avec les dépenses à jour (sans modifier le ratio ni le poste).

### `GET /vehicule/genere?year=2025`
Vérifie si la quote-part véhicule a été appliquée pour l'année. Retourne `null` si non appliqué, sinon `VehiculeGenere` avec `ratio_pro`, `pdf_filename`, `ged_doc_id`, paramètres.

### `DELETE /supprimer/vehicule?year=2025`
Supprime le PDF rapport + entrée GED + réinitialise le barème (garde l'historique pour traçabilité). Ne modifie pas le poste GED.

---

## Snapshots (`/api/snapshots`)

Sélections nommées d'opérations réutilisables (ad-hoc folders pour suivi). Stockage dans `data/snapshots.json` avec structure `{snapshots: [...]}`. Les refs pointent sur `(file, index)` et sont **self-healing** via hash op-identité + archive lookup en cas de déplacement/archivage du fichier source.

### `GET /`
Retourne tous les snapshots, triés par `created_at` desc (plus récents en premier).

**Réponse :**
```json
[
  {
    "id": "03d6299c63",
    "name": "Janvier 2025 — Honoraires — (3 ops)",
    "description": null,
    "color": "#10b981",
    "ops_refs": [
      { "file": "operations_split_202501_20260414_233641.json", "index": 3 },
      { "file": "operations_split_202501_20260414_233641.json", "index": 4 },
      { "file": "operations_split_202501_20260414_233641.json", "index": 34 }
    ],
    "context_year": 2025,
    "context_month": 1,
    "context_filters": { "columnFilters": [{ "id": "Catégorie", "value": "Honoraires" }] },
    "created_at": "2026-04-15T00:15:25",
    "updated_at": null
  }
]
```

### `GET /{snapshot_id}`
Retourne un snapshot par son ID. `404` si introuvable.

### `GET /{snapshot_id}/operations`
Charge les **opérations réelles** référencées par le snapshot (auto-repair transparent si refs cassées).

**Réponse :**
```json
{
  "snapshot": { /* Snapshot complet */ },
  "operations": [
    { "Date": "2025-01-06", "Libellé": "...", "Débit": 0, "Crédit": 3000, "Catégorie": "Honoraires", "_sourceFile": "operations_split_202501_20260414_233641.json", "_index": 3 },
    { "Date": "2025-01-13", /* ... */ },
    { "Date": "2025-01-28", /* ... */ }
  ],
  "resolved_count": 3,
  "expected_count": 3
}
```

**Auto-repair** : si une ref pointe vers un fichier inexistant (ex. archivé par split/merge), le service :
1. Cherche le fichier dans `data/imports/operations/_archive/{name}.bak_*` (plus récent d'abord)
2. Charge l'op à l'ancien `index`
3. Hash l'op identity `(Date, Libellé.strip(), Débit, Crédit)`
4. Cherche le même hash dans tous les fichiers actifs
5. Si trouvé → met à jour `ops_refs` du snapshot et **persiste** le fichier `snapshots.json` (évite le coût au prochain accès)

Les refs irrécupérables (hash absent des fichiers actifs) sont gardées telles quelles et comptées via `expected_count - resolved_count` pour affichage d'un badge « refs cassées ».

### `POST /`
Crée un snapshot. Body :
```json
{
  "name": "Litige Amazon Q4",
  "description": "À vérifier avec le comptable",
  "color": "#ef4444",
  "ops_refs": [
    { "file": "operations_merged_202511_20260414_234739.json", "index": 12 },
    { "file": "operations_merged_202512_20260414_234739.json", "index": 7 }
  ],
  "context_year": 2025,
  "context_month": 11,
  "context_filters": { "globalFilter": "AMAZON" }
}
```

**Validation** :
- `name` non vide (400 sinon)
- `ops_refs` non vide (400 sinon)

Réponse : le `Snapshot` créé (avec `id` généré, `created_at` à l'ISO courant).

### `PATCH /{snapshot_id}`
Met à jour partiellement un snapshot (champs `name`, `description`, `color`, `ops_refs` optionnels). Utilisé pour renommage inline depuis le viewer.

### `DELETE /{snapshot_id}`
Supprime un snapshot. Retourne `{"deleted": true}`.

**Note** : ne touche jamais aux fichiers d'opérations ni aux justificatifs — le snapshot est un simple conteneur de refs.
