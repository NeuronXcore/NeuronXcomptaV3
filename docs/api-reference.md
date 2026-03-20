# Référence API

Base URL : `http://localhost:8000/api`

Documentation Swagger : `http://localhost:8000/docs`

---

## Operations (`/api/operations`)

### `GET /files`
Liste tous les fichiers d'opérations importés.

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

### `POST /{filename}/categorize`
Catégorisation automatique IA de toutes les opérations du fichier.

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
Résumé du modèle (compteurs, stats, learning curve).

### `GET /model/full`
Modèle complet (exact_matches, keywords, subcategories, stats).

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
Entraîner le modèle scikit-learn.

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

### `POST /restore/{backup_name}`
Restaurer une sauvegarde. Query : `?restore_training_data=true`

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

---

## Reports (`/api/reports`)

### `GET /gallery`
Liste les rapports générés.

### `POST /generate`
Générer un rapport.

**Body :**
```json
{
  "source_files": ["operations_xxx.json"],
  "format": "pdf",
  "title": "Rapport Novembre 2024",
  "filters": {
    "category": "Santé",
    "date_from": "2024-11-01",
    "date_to": "2024-11-30",
    "important_only": false,
    "min_amount": 50
  }
}
```

### `GET /download/{filename}`
Télécharger un rapport.

### `DELETE /{filename}`
Supprimer un rapport.

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
Liste avec filtres.

### `GET /stats`
Statistiques (en_attente, traites, total).

### `POST /upload`
Upload multi-fichiers PDF. Form-data : champ `files` (multiple).

### `GET /{filename}/preview`
Sert le PDF pour iframe.

### `GET /{filename}/suggestions`
Suggestions d'association (score date + montant + fournisseur OCR).

### `POST /associate`
Associer un justificatif.

**Body :** `{ "justificatif_filename": "...", "operation_file": "...", "operation_index": 5 }`

### `POST /dissociate`
Dissocier. Body : `{ "operation_file": "...", "operation_index": 5 }`

### `DELETE /{filename}`
Supprimer un justificatif.

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

### `GET /history?limit=20`
Historique des extractions.

### `GET /result/{filename}`
Résultat OCR caché pour un justificatif.

### `POST /extract`
Extraction manuelle. Body : `{ "filename": "justificatif_xxx.pdf" }`

### `POST /extract-upload`
Upload + extraction ad-hoc (fichier non sauvegardé). Form-data : `file`.

### `DELETE /cache/{filename}`
Supprimer le cache OCR.

---

## Exports (`/api/exports`)

### `GET /periods`
Périodes disponibles avec statistiques.

### `GET /list`
Liste des archives ZIP générées.

### `POST /generate`
Générer un export comptable.

**Body :**
```json
{
  "year": 2024,
  "month": 11,
  "include_csv": true,
  "include_pdf": true,
  "include_excel": false,
  "include_bank_statement": true,
  "include_justificatifs": true,
  "include_reports": false
}
```

### `GET /download/{filename}`
Télécharger un ZIP.

### `DELETE /{filename}`
Supprimer un export.

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
