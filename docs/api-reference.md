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

### `POST /{filename}/categorize`
Catégorisation automatique IA des opérations du fichier. Body : `{ "mode": "empty_only" }` (défaut, ne remplit que les vides) ou `{ "mode": "all" }` (recatégorise tout). Déclenché automatiquement par EditorPage au chargement (mode empty_only).

### `GET /{filename}/has-pdf`
Vérifie si le relevé bancaire PDF original existe.

**Réponse :** `{ "has_pdf": true }`

### `GET /{filename}/pdf`
Sert le fichier PDF original du relevé bancaire (FileResponse).

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
Upload multi-fichiers PDF/JPG/PNG. Form-data : champ `files` (multiple). Les images sont automatiquement converties en PDF.

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

## Rapprochement (`/api/rapprochement`)

### `POST /run-auto`
Rapprochement automatique : parcourt tous les justificatifs en attente, auto-associe ceux avec score >= 0.95 et match unique.

**Réponse :**
```json
{
  "total_justificatifs_traites": 15,
  "associations_auto": 8,
  "suggestions_fortes": 3,
  "sans_correspondance": 4,
  "ran_at": "2024-04-15T10:30:00"
}
```

### `POST /associate-manual`
Association manuelle opération ↔ justificatif avec métadonnées.

**Body :** `{ "justificatif_filename": "...", "operation_file": "...", "operation_index": 5, "rapprochement_score": 0.75 }`

### `GET /unmatched`
Compteurs : opérations sans justificatif / justificatifs en attente.

### `GET /log?limit=20`
Dernières associations automatiques.

### `GET /batch-hints/{filename}`
Best scores par index pour un fichier d'opérations.

### `GET /batch-justificatif-scores`
Best score par justificatif en attente.

### `GET /suggestions/operation/{file}/{index}`
Suggestions de justificatifs pour une opération.

### `GET /suggestions/justificatif/{filename}`
Suggestions d'opérations pour un justificatif.

### `GET /{filename}/{index}/suggestions`
Suggestions filtrées pour le rapprochement manuel (drawer).

**Paramètres :** `montant_min`, `montant_max`, `date_from`, `date_to`, `search` (tous optional)

**Réponse :**
```json
[
  {
    "filename": "justificatif_xxx.pdf",
    "ocr_date": "2024-04-10",
    "ocr_montant": 500.00,
    "ocr_fournisseur": "Fournisseur XYZ",
    "score": 0.85,
    "size_human": "245.3 Ko"
  }
]
```

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
- Fichier traité : `data: {"filename": "facture.pdf", "status": "processed", "timestamp": "2024-11-20T14:30:00"}`
- Erreur OCR : `data: {"filename": "facture.pdf", "status": "error", "timestamp": "..."}`
- Keepalive (30s) : `: ping`

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

---

## GED (`/api/ged`)

### `GET /tree`
Arborescence complète. Scanne les sources (relevés, justificatifs, rapports, documents libres) puis construit deux vues.

**Réponse :**
```json
{
  "by_type": [
    { "id": "releves", "label": "Relevés bancaires", "count": 26, "icon": "FileText", "children": [...] },
    { "id": "justificatifs", "label": "Justificatifs", "count": 0, "icon": "Receipt", "children": [...] },
    { "id": "rapports", "label": "Rapports", "count": 0, "icon": "BarChart3", "children": [...] },
    { "id": "documents-libres", "label": "Documents libres", "count": 0, "icon": "FolderOpen", "children": [...] }
  ],
  "by_year": [
    { "id": "year-2025", "label": "2025", "count": 12, "icon": "Calendar", "children": [
      { "id": "year-2025-releve", "label": "Relevés", "count": 12, "icon": "FileText", "children": [...] }
    ]}
  ]
}
```

### `GET /documents?type=&year=&month=&poste_comptable=&tags=&search=&sort_by=added_at&sort_order=desc`
Liste filtrée des documents indexés. Tags séparés par virgule.

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
Statistiques globales par poste comptable.

**Réponse :**
```json
{
  "total_documents": 26,
  "total_brut": 5000.00,
  "total_deductible": 3500.00,
  "disk_size_human": "7.3 Mo",
  "par_poste": [
    { "poste_id": "vehicule", "poste_label": "Véhicule", "deductible_pct": 70, "nb_docs": 3, "total_brut": 1200, "total_deductible": 840 }
  ]
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
Force un re-scan des sources. Utile après import/OCR.

**Réponse :** `{ "success": true, "total_documents": 26 }`

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
