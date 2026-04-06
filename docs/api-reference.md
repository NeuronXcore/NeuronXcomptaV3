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

### `GET /gallery`
Liste complète des rapports avec années disponibles et nombre total.

### `GET /tree`
Arbre triple vue : `{ by_year: [...], by_category: [...], by_format: [...] }`.

### `GET /templates`
3 templates prédéfinis (BNC annuel, Ventilation charges, Récapitulatif social).

### `GET /pending?year=2025`
Rapports mensuels/trimestriels non générés pour les mois passés (rappels dashboard).

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

### `POST /{filename}/regenerate`
Re-génère un rapport existant (même titre/description, données actualisées).

### `POST /{filename}/favorite`
Toggle le favori d'un rapport.

### `POST /compare`
Compare 2 rapports. Body : `{ "filename_a": "...", "filename_b": "..." }`. Retourne deltas montants, ops, %.

### `PUT /{filename}`
Éditer titre et/ou description. Body : `{ "title": "...", "description": "..." }`

### `GET /preview/{filename}`
Sert le fichier avec `Content-Disposition: inline` pour preview iframe.

### `GET /download/{filename}`
Télécharger un rapport.

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

Gestion des templates de justificatifs par fournisseur. Permet de créer des templates depuis des justificatifs scannés et de générer des PDF reconstitués quand l'original est manquant.

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
    "usage_count": 3
  }
]
```

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

### `PUT /{template_id}`
Met à jour un template existant. Même body que `POST /`.

### `DELETE /{template_id}`
Supprime un template.

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
- `reconstitue_YYYYMMDD_HHMMSS_vendor.pdf` — le justificatif PDF
- `reconstitue_YYYYMMDD_HHMMSS_vendor.ocr.json` — métadonnées avec `"source": "reconstitue"` et `operation_ref`

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
  "completed_at": null
}
