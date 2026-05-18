# NeuronXcompta — API reference

> Snapshot des endpoints **post-Session 39 P1**. La source de vérité reste les routers FastAPI (`backend/routers/*.py`). Ce document complète la table générale dans [CLAUDE.md](CLAUDE.md#backend-api-endpoints) en détaillant les payloads et codes HTTP des modules sensibles.

---

## Plaquette comptable (`/api/plaquette`)

Workflow de vérification ligne-à-ligne de la plaquette annuelle reçue du cabinet comptable, avec cycle de vie (Session 39 P1) jusqu'à la déclaration 2042 et conservation jusqu'à prescription (art. L169 LPF).

### Cycle de vie

3 statuts, transitions strictes :

| De \ Vers | en_cours | validation_finale | declare |
|-----------|:--------:|:-----------------:|:-------:|
| en_cours | — | ✓ | ✗ (passer par /finalize) |
| validation_finale | ✓ | — | ✓ (via /finalize uniquement) |
| declare | ✗ | ✗ | — (irréversible) |

- `en_cours` : items modifiables, journal appendable.
- `validation_finale` : items **read-only**, journal appendable, statut réversible.
- `declare` : exercice figé. Items read-only DÉFINITIF, journal toujours appendable (questions fisc post-déclaration). PDF watermarké en GED `protected=true`.

### Endpoints session 39 P1

#### `PATCH /api/plaquette/{year}/status`

Transition de statut hors `→DECLARE`.

**Body** :
```json
{ "new_status": "en_cours" | "validation_finale", "declaration_ref": null }
```

**Réponses** :
- `200` : `PlaquetteCheck` mis à jour
- `400` : transition invalide (matrice) ou tentative `→DECLARE`
- `404` : exercice introuvable

---

#### `POST /api/plaquette/{year}/finalize`

Transition atomique `validation_finale → declare`. Génère le PDF watermarké + snapshot JSON + protège en GED.

**Body** :
```json
{ "declaration_ref": "2042 N° 0123456789012 télédéclaré le 15/04/2026", "declared_at": null }
```

**Réponse 200** :
```json
{
  "plaquette_check": { "...PlaquetteCheck": "..." },
  "snapshot_ged_doc_id": "reports/plaquette_check_final_2025_20260518_140000.pdf",
  "snapshot_path": "data/plaquette_check/2025/final_snapshot.json"
}
```

**Erreurs** :
- `400` : `status != validation_finale` ou `declaration_ref` vide
- `404` : exercice introuvable
- `500` : échec PDF / GED (transaction non rollback — debug logs)

---

#### `POST /api/plaquette/{year}/journal/{entry_id}/attachments`

Upload d'une pièce jointe sur une entrée journal. **Toujours autorisé** (même post-DECLARE).

**Multipart** : `file=@chemin.pdf`

**Whitelist mime** : `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `message/rfc822`, `application/zip`.

**Limite taille** : 10 Mo.

**Réponse 200** : `JournalAttachment`
```json
{
  "filename": "facture-edf_a1b2c3d4.pdf",
  "storage_path": "data/plaquette_check/2025/journal_attachments/facture-edf_a1b2c3d4.pdf",
  "size_bytes": 123456,
  "mime_type": "application/pdf",
  "uploaded_at": "2026-05-18T14:30:00"
}
```

**Erreurs** :
- `400` : fichier vide
- `404` : `plaquette_not_found` ou `entry_not_found`
- `413` : > 10 Mo
- `415` : mime non whitelisté

---

#### `GET /api/plaquette/{year}/journal/{entry_id}/attachments/{filename}`

Preview/download inline d'un attachement. Retourne le fichier avec son mime d'origine et `Content-Disposition: inline` (preview navigateur direct).

**Erreurs** :
- `404` : attachement introuvable (entry ou filename)

---

#### `DELETE /api/plaquette/{year}/journal/{entry_id}/attachments/{filename}`

Suppression d'un attachement (JSON + fichier disque).

**Réponse 200** : `{"status": "deleted", "filename": "..."}`

**Erreurs** :
- `404` : attachement introuvable

---

#### `GET /api/plaquette/{year}/journal/grouped-by-item`

Vue alternative du journal groupée par item. Items sans entry retournés avec `entries: []` (filtrage côté frontend).

**Réponse 200** :
```json
{
  "it_abc1234567": {
    "item_id": "it_abc1234567",
    "compte_pcg": "60630000",
    "compte_label": "FOURNIT ENTRET ET PETIT EQUIPM",
    "rubrique_2035": "Petit outillage",
    "entries": [
      { "entry_id": "j_xyz", "timestamp": "...", "type": "email_in", "subject": "...", "body_excerpt": "...", "related_item_ids": ["it_abc1234567"], "attachments": [] }
    ]
  }
}
```

---

### Endpoints existants — gardes 423 ajoutées (Session 39 P1)

Les 5 endpoints suivants retournent désormais `423 Locked` si le statut n'est pas `en_cours` :

- `POST /api/plaquette/{year}/items`
- `PATCH /api/plaquette/{year}/items/{item_id}`
- `DELETE /api/plaquette/{year}/items/{item_id}`
- `PATCH /api/plaquette/{year}/totaux`
- `POST /api/plaquette/{year}/set-ged-ref`

**Body 423** :
```json
{ "detail": "plaquette frozen status=validation_finale" }
```

L'endpoint `POST /api/plaquette/{year}/journal` (création d'entrée) reste appendable en permanence — JAMAIS de 423.

---

### Endpoints existants — comportement étendu

#### `POST /api/plaquette/{year}/generate-pdf-report`

Génère un PDF rapport. Préserve désormais les snapshots `protected=true` (snapshots finaux ne sont jamais supprimés par l'auto-replace). Le rapport généré est `template_id="plaquette_check"` (vs `"plaquette_check_final"` pour les snapshots créés via `/finalize`).

#### `GET /api/plaquette/{year}`

Réponse enrichie avec les 5 champs cycle de vie (`status`, `validated_at`, `declared_at`, `declaration_ref`, `final_snapshot_ged_doc_id`). Migration douce — les JSON pré-P1 sans champ reçoivent `status="en_cours"` par défaut via Pydantic.

---

## Risque fiscal (Session 39 P2)

4 endpoints sous `/api/plaquette/{year}/risque/...` pour évaluer / surcharger le risque fiscal des items.

### Niveau de risque

4 niveaux : `faible` / `modere` / `eleve` / `critique`. Score auto plafonne à `eleve` (5 aggravants − 1 atténuant). `critique` réservé aux overrides manuels.

### Drivers de scoring

5 aggravants (+1 chacun) :
- `categorie_sensible` : item dans whitelist véhicule/repas/blanchissage/cadeaux/téléphone/internet/énergie
- `forfait_applique` : flags PCG mapping (quote-part véhicule, split CSG, split URSSAF)
- `taux_justif_bas` : min(taux_justif) < 0.80 sur les catégories de l'item
- `ecart_n1_anormal` : |Δ N-1| / N-1 > 0.50 ET commentaire vide
- `montant_eleve_sensible` : catégorie sensible ET montant_neuronx > 5 000 €

3 atténuants (-1 chacun) :
- `boi_cgi_cite` : regex BOI/CGI/LPF/article détectée dans le commentaire
- `statut_resolu` : item.statut == "resolu"
- `statut_refus_justifie` : item.statut == "refus_justifie"

Score → niveau : `< 2 → FAIBLE` / `≥ 2 < 3 → MODERE` / `≥ 3 → ELEVE` / `≥ 999 → CRITIQUE`.

### Endpoints

#### `POST /api/plaquette/{year}/risque/recompute`

Force le recalcul du risque de tous les items (ignore le cache `last_evaluated_at`). Préserve les overrides manuels.

**Réponse 200** : `{status, year, nb_items_evaluated, risque_score_global}`.

**Erreurs** :
- `404` : exercice introuvable
- `423` : `status == DECLARE` (snapshot figé)

---

#### `PATCH /api/plaquette/{year}/items/{item_id}/risque`

Override manuel du niveau. **Motif obligatoire** pour traçabilité (visible dans le tooltip frontend et le PDF final).

**Body** :
```json
{ "niveau": "critique", "motif": "Carnet de bord véhicule fourni au comptable + facture leasing détaillée" }
```

**Réponse 200** : `PlaquetteItem` mis à jour avec `risque_fiscal.auto_calcule=false` + `overridden_niveau` + `overridden_motif`.

**Erreurs** :
- `400` : motif vide
- `404` : item introuvable
- `423` : `status == DECLARE`

---

#### `DELETE /api/plaquette/{year}/items/{item_id}/risque/override`

Repasse un item en mode auto-calculé (efface l'override). Déclenche immédiatement un `evaluate_all_items(force_recompute=True)`.

**Réponse 200** : `PlaquetteItem` mis à jour.

**Erreurs** :
- `404` : item introuvable
- `423` : `status == DECLARE`

---

#### `GET /api/plaquette/{year}/risque/top?limit=5`

Top N items triés par niveau desc puis montant_neuronx desc. Exclut le niveau `faible`. **Autorisé en DECLARE** (lecture seule de la photo figée).

**Réponse 200** :
```json
{
  "year": 2025,
  "nb_items": 3,
  "items": [ /* PlaquetteItem[] avec risque_fiscal peuplé */ ],
  "risque_score_global": 0.39
}
```

---

## GED — flag `protected` (Session 39 P1)

### `register_rapport(..., protected: bool = False)`

Nouveau param keyword sur la fonction interne `ged_service.register_rapport`. Quand `protected=True`, le doc est marqué non-supprimable.

### `delete_document(doc_id)`

Si `doc.get("protected") is True`, retourne `False` sans rien faire (log warning). Affecte :
- `DELETE /api/ged/documents/{doc_id}` (404 retourné)
- Auto-replace via `plaquette_report_service._delete_previous_reports` (skip silencieux)

**Rétrocompatibilité** : docs GED existants sans champ `protected` se comportent comme `protected=false` via `.get()`.
