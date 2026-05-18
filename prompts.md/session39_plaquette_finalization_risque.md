# Session 39 — Plaquette : workflow validation finale + évaluation risque fiscal

> **Ordre d'exécution strict** : P1 puis P2. P2 dépend du statut `PlaquetteCheckStatus`
> introduit dans P1 (le snapshot final embarque la section risque).
>
> **Token discipline** : ~6 k tokens chacun. Ne pas merger les deux prompts.
>
> **Avant chaque prompt** : `git status` propre, `git pull`, lecture `CLAUDE.md`.
> **Après chaque prompt** : commit unique, push, mise à jour CLAUDE.md + CHANGELOG + api-reference.md
> **dans le même commit** que le code.

---

# P1 — Workflow validation finale + freeze + snapshot immuable + attachements journal

## Objectif

Étendre le module Plaquette comptable (Session 38) pour couvrir le cycle complet
jusqu'à la déclaration 2042 : statuts au niveau `PlaquetteCheck`, freeze progressif des
items, snapshot immuable à la déclaration, attachements PDF/EML par entrée journal,
vue alternative « fil par item » dans l'onglet Journal.

## Contexte métier

Aujourd'hui la plaquette est un workflow interne (user vs comptable) sans état global.
Une fois la déclaration 2042 envoyée à l'administration, l'état doit être figé pour
la durée de prescription fiscale (4 ans, art. L169 LPF). Si un contrôle survient
2 ans plus tard, on doit pouvoir produire l'état exact des décisions au moment de
la déclaration. Le journal des échanges avec le comptable fait partie de la
documentation défensive, mais reste appendable post-déclaration (questions fisc à logguer).

## Backend

### 1. Modèles — `backend/models/plaquette_check.py`

Ajouter aux enums existants (en haut de fichier) :

```python
class PlaquetteCheckStatus(str, Enum):
    EN_COURS = "en_cours"
    VALIDATION_FINALE = "validation_finale"
    DECLARE = "declare"
```

Nouveau modèle `JournalAttachment` :

```python
class JournalAttachment(BaseModel):
    filename: str
    storage_path: str  # relatif à data/plaquette_check/{year}/journal_attachments/
    size_bytes: int
    mime_type: str
    uploaded_at: datetime
```

Étendre `JournalEntry` (champ optionnel pour rétrocompatibilité) :

```python
attachments: List[JournalAttachment] = Field(default_factory=list)
```

Étendre `PlaquetteCheck` :

```python
status: PlaquetteCheckStatus = PlaquetteCheckStatus.EN_COURS
validated_at: Optional[datetime] = None
declared_at: Optional[datetime] = None
declaration_ref: Optional[str] = None  # ex. "2042 N° 0123456789012 télédéclaré le 15/04/2026"
final_snapshot_ged_doc_id: Optional[str] = None
```

Nouveau request model :

```python
class PlaquetteStatusUpdate(BaseModel):
    new_status: PlaquetteCheckStatus
    declaration_ref: Optional[str] = None  # requis si new_status=DECLARE

class FinalizePlaquetteRequest(BaseModel):
    declaration_ref: str
    declared_at: Optional[datetime] = None  # défaut = now()
```

### 2. Service finalisation — `backend/services/plaquette_finalization_service.py` (**NOUVEAU**)

Responsabilités :

- `transition_status(year, new_status, declaration_ref=None) → PlaquetteCheck` : applique
  les règles de transition, lève `ValueError` si transition invalide.
- `is_item_modifiable(check: PlaquetteCheck) → bool` : `True` ssi `status == EN_COURS`.
- `is_journal_appendable(check: PlaquetteCheck) → bool` : toujours `True` (journal
  reste appendable même post-déclare pour logger les questions fisc).
- `is_status_revertable(check: PlaquetteCheck) → bool` : `True` ssi `status != DECLARE`.
- `finalize(year, declaration_ref, declared_at=None) → dict` : action atomique
  status→DECLARE :
  1. Vérifie status courant `VALIDATION_FINALE` (sinon `ValueError`).
  2. Génère PDF rapport final via `plaquette_report_service.generate_and_register(year, final=True)`.
     Le PDF final porte un watermark `Version définitive — déclarée le {date}` en filigrane
     diagonal léger (voir ci-dessous).
  3. Copie le JSON `data/plaquette_check/{year}.json` vers
     `data/plaquette_check/{year}/final_snapshot.json` (immutable).
  4. Register le PDF en GED avec :
     - `type=rapport`
     - `rapport_meta.source_module=plaquette`
     - `rapport_meta.report_type=plaquette_check_final`
     - `protected=True`
  5. Met à jour `PlaquetteCheck` : status=DECLARE, declared_at, declaration_ref,
     final_snapshot_ged_doc_id.
  6. Retourne `{plaquette_check, snapshot_ged_doc_id, snapshot_path}`.

Matrice transitions autorisées :

| De \ Vers           | en_cours | validation_finale | declare |
|---------------------|:--------:|:-----------------:|:-------:|
| en_cours            |    —     |        ✓          |    ✗    |
| validation_finale   |    ✓     |        —          |    ✓    |
| declare             |    ✗     |        ✗          |    —    |

### 3. Watermark PDF — `backend/services/plaquette_report_service.py`

Ajouter paramètre `final: bool = False` à `generate_and_register(year, final=False)`.
Si `final=True`, ajouter un canvas overlay diagonal (45°) sur chaque page :

```python
def _draw_watermark(canvas_obj, doc, declared_at: str):
    canvas_obj.saveState()
    canvas_obj.setFont("Helvetica-Bold", 48)
    canvas_obj.setFillColorRGB(0.85, 0.85, 0.9, alpha=0.15)
    canvas_obj.translate(A4[0]/2, A4[1]/2)
    canvas_obj.rotate(45)
    canvas_obj.drawCentredString(0, 0, "VERSION DÉFINITIVE")
    canvas_obj.setFont("Helvetica", 14)
    canvas_obj.drawCentredString(0, -30, f"Déclarée le {declared_at}")
    canvas_obj.restoreState()
```

Câbler via `onFirstPage` + `onLaterPages` du `BaseDocTemplate`.

### 4. Attachements journal — `backend/services/plaquette_service.py`

Ajouter fonctions :

- `add_journal_attachment(year, entry_id, file_upload: UploadFile) → JournalAttachment` :
  - Crée `data/plaquette_check/{year}/journal_attachments/` si absent.
  - Filename safe (slug + uuid8 + ext originale).
  - Whitelist mime : `application/pdf, image/png, image/jpeg, image/webp, message/rfc822, application/zip`.
  - Max 10 Mo par fichier.
  - Append à `journal[entry_id].attachments`.
  - Écriture atomique du JSON (pattern `tempfile.mkstemp + os.replace` déjà utilisé).
- `remove_journal_attachment(year, entry_id, filename)` : supprime du JSON + disque.
- `get_journal_attachment_path(year, entry_id, filename) → Path` : pour le serve endpoint.
- `get_journal_grouped_by_item(year) → dict[str, list[JournalEntry]]` :
  groupe les entries par `related_item_ids` (un entry peut apparaître dans plusieurs
  groupes s'il référence plusieurs items). Items sans entry retournent liste vide.

### 5. Garde modifiabilité — `backend/services/plaquette_service.py`

Toutes les fonctions de mutation existantes doivent vérifier `is_item_modifiable` :
- `update_item`, `create_item`, `delete_item`
- `update_totaux_plaquette`
- `set_ged_ref`

En cas de freeze, lever `PermissionError("plaquette frozen status=...")` que le router
traduit en HTTP **423 Locked** (cohérent avec le pattern de verrouillage des opérations).

`add_journal_entry` reste toujours autorisé (journal appendable même post-declare).

### 6. Endpoints — `backend/routers/plaquette.py`

Nouveaux endpoints :

| Méthode | Route | Body | Description |
|---------|-------|------|-------------|
| `PATCH` | `/{year}/status` | `PlaquetteStatusUpdate` | Transition status (sauf →DECLARE) |
| `POST`  | `/{year}/finalize` | `FinalizePlaquetteRequest` | Transition atomique →DECLARE + snapshot |
| `POST`  | `/{year}/journal/{entry_id}/attachments` | multipart `file` | Upload attachement |
| `DELETE`| `/{year}/journal/{entry_id}/attachments/{filename}` | — | Suppression |
| `GET`   | `/{year}/journal/{entry_id}/attachments/{filename}` | — | Téléchargement (FileResponse inline) |
| `GET`   | `/{year}/journal/grouped-by-item` | — | Vue groupée par item |

Modifications endpoints existants :
- `PATCH /{year}/items/{item_id}` : try/except `PermissionError` → 423.
- `POST /{year}/items`, `DELETE /{year}/items/{item_id}` : idem.
- `PATCH /{year}/totaux`, `POST /{year}/set-ged-ref` : idem.

Codes HTTP :
- `400` transition invalide (matrice ci-dessus) ou `declaration_ref` manquante.
- `409` snapshot final déjà existant et non re-générable (sauf `?force=true`).
- `413` upload > 10 Mo.
- `415` mime non whitelisté.
- `423` mutation tentée sur plaquette gelée.

### 7. Migration douce

Au `lifespan` boot, lecture défensive : un `data/plaquette_check/{year}.json` existant
sans champ `status` → `status=EN_COURS` par défaut (Pydantic gère via default).
Pas de script de migration explicite.

## Frontend

### 1. Types — `frontend/src/types/plaquette.ts`

```typescript
export type PlaquetteCheckStatus = 'en_cours' | 'validation_finale' | 'declare';

export interface JournalAttachment {
  filename: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
  uploaded_at: string;
}

export interface JournalEntry {
  // existant +
  attachments: JournalAttachment[];
}

export interface PlaquetteCheck {
  // existant +
  status: PlaquetteCheckStatus;
  validated_at: string | null;
  declared_at: string | null;
  declaration_ref: string | null;
  final_snapshot_ged_doc_id: string | null;
}
```

### 2. Hooks — `frontend/src/hooks/usePlaquetteCheck.ts`

Nouveaux hooks (suivre le pattern TanStack Query existant avec invalidations cascade
`['plaquette-check', year]` + `['ged-documents']` + `['ged-tree']`) :

- `usePatchPlaquetteStatus()` — `PATCH /status`
- `useFinalizePlaquette()` — `POST /finalize` ; invalide AUSSI `['livret']` (snapshot impacte le livret)
- `useUploadJournalAttachment()` — multipart POST
- `useDeleteJournalAttachment()`
- `useJournalGroupedByItem(year)`

Helper URL : `journalAttachmentUrl(year, entryId, filename)` pour preview/download.

### 3. Composants — `frontend/src/components/plaquette/`

**`PlaquetteStatusBadge.tsx`** (NOUVEAU) :
Pill colorée pilotée par status :
- `en_cours` → ambre, icône `FileEdit`, label « En cours »
- `validation_finale` → bleu, icône `CheckCircle2`, label « Validation finale »
- `declare` → vert foncé, icône `Lock`, label « Déclarée · {date court} »

Affiché dans le header du `PlaquetteCheckDrawer` à droite du titre, avec tooltip
`declared_at` + `declaration_ref` au survol.

**`PlaquetteStatusActionsMenu.tsx`** (NOUVEAU) :
Boutons contextuels au header selon status :
- `en_cours` → bouton primary `Passer en validation finale` (ouvre confirm modal).
- `validation_finale` → 2 boutons : outline `Revenir en cours` (déverrouille) + primary
  `Finaliser et déclarer` (ouvre `PlaquetteFinalizationModal`).
- `declare` → bouton outline disabled avec tooltip « Exercice déclaré — figé jusqu'à
  prescription (N+4) ».

**`PlaquetteFinalizationModal.tsx`** (NOUVEAU, 640px centré z-[70]) :
Wizard 3 étapes :
1. **Récap pré-vol** : compteurs items par statut (color-coded), warning ambre s'il
   reste des `a_challenger` ou `non_revu` non `refus_justifie`. Possibilité de
   continuer malgré warning (case à cocher « J'accepte de finaliser malgré N items
   non résolus »).
2. **Saisie** : champ `declaration_ref` (placeholder `2042 N° XXXXXXXXXXXXX télédéclaré
   le JJ/MM/AAAA`), date picker `declared_at` (défaut aujourd'hui), preview du nom
   du snapshot GED.
3. **Confirmation** : récap + bouton primary `Finaliser et générer le snapshot`.
   Toast custom (réutiliser `EmailSentToast` pattern) avec lien vers GED filtrée.

**`JournalAttachmentList.tsx`** (NOUVEAU) :
Sous chaque `JournalEntry` dans l'onglet Journal : grille horizontale de chips
(`filename`, taille, icône selon mime, bouton Trash2 au hover si `is_journal_appendable`).
Drop zone discrète en bas de chaque entry « Glisser un fichier (PDF, EML, PNG…) ».

**`JournalByItemView.tsx`** (NOUVEAU) :
Vue alternative à la timeline plate. Liste des items ayant ≥ 1 entry dans le journal,
chacun expandable montrant ses entries chronologiquement. Items sans échange masqués
par défaut, toggle « Voir aussi les items sans échange ».

**Modifier `PlaquetteCheckDrawer.tsx`** :
- Header : ajouter `PlaquetteStatusBadge` + `PlaquetteStatusActionsMenu`.
- Onglet Journal : segmented control en tête `Timeline | Par item` ; intègre
  `JournalAttachmentList` sous chaque entry de la timeline existante.
- Tous les inputs/selects/textareas inline du Comparatif : prop `readOnly` câblée à
  `!is_item_modifiable(check)`. Affichage statut éditorial discret en haut du tab :
  « 🔒 Items verrouillés (validation finale) » ou « 🔒 Exercice déclaré le {date} ».
- Tab `Email challenge` : si `status === 'declare'`, bannière info en haut « Exercice
  déclaré le {date}. Les rapports et envois restent consultables en lecture seule. »
  + désactivation des boutons `Générer/Re-générer rapport` et `Préparer envoi groupé`.

### 4. State — `frontend/src/stores/plaquetteCheckDrawerStore.ts`

Ajouter `journalView: 'timeline' | 'by-item'` (défaut `'timeline'`) + setter.

## Documentation (dans le même commit)

### `CLAUDE.md`
Sous la rubrique **Vérification plaquette comptable** existante, ajouter un paragraphe
sur le cycle de vie (3 statuts + matrice transitions + snapshot final protégé en GED).
Mentionner que le journal reste appendable post-declare.

### `CHANGELOG.md`
Nouvelle entrée `### Added (YYYY-MM-DD) — Plaquette : cycle de vie + snapshot final + attachements journal (Session 39 — P1)`.
Détailler : modèles, service finalisation, watermark PDF, endpoints (6 nouveaux), 5 composants frontend.

### `api-reference.md`
Documenter les 6 nouveaux endpoints sous la section Plaquette comptable existante.

## Vérification

**Backend** (`cd backend && python -m pytest -xvs tests/ -k plaquette` si tests présents,
sinon manuel via `curl`) :
- [ ] GET `/{year}` sur exercice existant pré-P1 → status=`en_cours` par défaut (migration douce).
- [ ] PATCH `/{year}/status` `en_cours → validation_finale` → 200.
- [ ] PATCH `/{year}/items/{id}` avec status=`validation_finale` → 423.
- [ ] POST `/{year}/journal` avec status=`validation_finale` → 200 (toujours OK).
- [ ] POST `/{year}/finalize` sans status=`validation_finale` → 400.
- [ ] POST `/{year}/finalize` OK → fichier `data/plaquette_check/{year}/final_snapshot.json` créé,
      PDF en GED avec `protected=true` et watermark visible, `final_snapshot_ged_doc_id` peuplé.
- [ ] POST `/{year}/journal` avec status=`declare` → 200 (journal toujours appendable).
- [ ] PATCH `/{year}/items/{id}` avec status=`declare` → 423.
- [ ] Upload journal attachment 8 Mo → 200 ; 12 Mo → 413 ; .exe → 415.
- [ ] GET `/{year}/journal/grouped-by-item` → dict keyed par item_id.

**Frontend** (`cd frontend && npx tsc --noEmit && npm run lint`) :
- [ ] Pas de regression TypeScript.
- [ ] Drawer affiche le badge status + boutons contextuels selon statut.
- [ ] Wizard finalisation accessible depuis status=`validation_finale`, refuse step 3 si
      champ `declaration_ref` vide.
- [ ] Onglet Journal segmented control fonctionnel, attachements upload + delete OK.
- [ ] Comparatif passe en read-only visuel post-validation_finale.
- [ ] Tab Email Challenge désactivé post-declare avec bannière.

**Commit** : `feat(plaquette): cycle de vie + snapshot final + attachements journal (Session 39 P1)`

---

# P2 — Évaluation risque fiscal par item + section PDF préparation contrôle

> **Dépendance** : nécessite P1 mergé. Le champ `risque_fiscal` est figé dans le
> `final_snapshot.json` au moment du `declare`.

## Objectif

Ajouter une dimension défensive au module Plaquette : score de risque fiscal par item
de la déclaration 2035, calculé automatiquement par règles (catégorie sensible, taux
justificatifs, écart N-1, montants, références BOI citées), surchargeable manuellement.
Nouvelle section 7 du PDF rapport « Préparation contrôle fiscal » avec top 5 risques
de l'exercice. Bascule la lecture de la plaquette de l'angle interne (challenge
comptable) vers l'angle externe (défendabilité fisc).

## Contexte métier

Prescription fiscale BNC = N+3 (droit commun art. L169 LPF), 6 ans en cas de soupçon
de fraude. Les zones à risque connues pour un médecin BNC SCP :
- Charges mixtes pro/perso (véhicule, téléphone, internet, énergie)
- Forfaits & quote-parts (repas BOI-BNC-BASE-40-60, blanchissage BOI-BNC-BASE-40-20,
  véhicule BOI-BNC-BASE-40-60-40)
- Cohérence CA bancaire vs liasse 2035
- DAS-2 honoraires rétrocédés > 1 200 €/bénéficiaire (art. 240 CGI)
- Pièces justificatives (art. 93 CGI)
- Plafonds CO2 véhicule (art. 39-4 CGI)
- Cadeaux clientèle / réception (limites tolérance)

Le score doit aider l'utilisateur à voir le trade-off : « cette déduction te ramène
800 €, niveau de risque `élevé`, drivers : forfait + catégorie sensible + taux justif
60 % » → décision éclairée.

## Backend

### 1. Modèles — `backend/models/plaquette_check.py`

Ajouter enum :

```python
class RisqueNiveau(str, Enum):
    FAIBLE = "faible"
    MODERE = "modere"
    ELEVE = "eleve"
    CRITIQUE = "critique"
```

Nouveau modèle :

```python
class RisqueDriver(BaseModel):
    code: str  # ex. "categorie_sensible", "forfait_applique", "taux_justif_bas"
    label: str  # libellé humain
    delta_score: int  # +1, +2, -1
    detail: Optional[str] = None  # ex. "Taux justif Véhicule = 62 %"

class RisqueFiscalEvaluation(BaseModel):
    niveau: RisqueNiveau
    score: int  # raw score, peut être négatif
    drivers: List[RisqueDriver] = Field(default_factory=list)
    pieces_disponibles: List[str] = Field(default_factory=list)  # ex. ["13 justifs sur 21 ops", "BOI-BNC-BASE-40-60 cité"]
    auto_calcule: bool = True
    overridden_niveau: Optional[RisqueNiveau] = None
    overridden_motif: Optional[str] = None
    last_evaluated_at: datetime
```

Étendre `PlaquetteItem` :

```python
risque_fiscal: Optional[RisqueFiscalEvaluation] = None
```

Étendre `PlaquetteCheck` :

```python
risque_score_global: Optional[float] = None  # moyenne pondérée des items
```

Request model pour override :

```python
class RisqueOverrideRequest(BaseModel):
    niveau: RisqueNiveau
    motif: str  # obligatoire pour traçabilité
```

### 2. Service risque — `backend/services/plaquette_risque_service.py` (**NOUVEAU**)

Constantes au top :

```python
CATEGORIES_SENSIBLES = {
    "véhicule", "vehicule", "repas", "restauration", "blanchissage",
    "cadeaux", "réception", "reception", "téléphone", "telephone",
    "internet", "energie", "énergie", "abonnement", "abonnements"
}

# Seuils
TAUX_JUSTIF_BAS = 0.80
ECART_N1_ANORMAL = 0.50  # 50 % d'écart vs N-1
MONTANT_ELEVE_SEUIL = 5000.0  # € sur catégorie sensible

# Score → niveau
SCORE_THRESHOLDS = [
    (0, RisqueNiveau.FAIBLE),
    (2, RisqueNiveau.MODERE),
    (3, RisqueNiveau.ELEVE),
    (999, RisqueNiveau.CRITIQUE),
]
```

Fonctions :

```python
def evaluate_item(
    item: PlaquetteItem,
    mapping_compte: dict,
    taux_justif_categorie: dict[str, float],  # {cat_neuronx: rate}
) -> RisqueFiscalEvaluation:
    """
    Règles de scoring (chaque driver appliqué une seule fois) :

    +1  categorie_sensible       : item.categories_neuronx ∩ CATEGORIES_SENSIBLES non vide
    +1  forfait_applique         : mapping_compte a un flag apply_quote_part_vehicule
                                    OU split_csg_deductible OU split_urssaf_cotisations
    +1  taux_justif_bas          : min(taux_justif des categories_neuronx) < TAUX_JUSTIF_BAS
    +1  ecart_n1_anormal         : |montant_plaquette - montant_plaquette_n1| / max(N-1, 1) > 0.50
                                    ET pas de commentaire utilisateur
    +1  montant_eleve_sensible   : categorie_sensible ET montant_neuronx > MONTANT_ELEVE_SEUIL
    -1  boi_cgi_cite             : regex BOI-?... ou art\.?\s*\d+ dans item.commentaire
    -1  statut_resolu            : item.statut == "resolu"
    -1  statut_refus_justifie    : item.statut == "refus_justifie"

    Pièces disponibles (informatives, n'affectent pas le score) :
    - "{n} justifs sur {m} ops" (depuis taux_justif_categorie)
    - "BOI/CGI cité : {refs}" si regex match
    - "Sub-lines ventilées" si item lié à des ops avec sub_lines
    - "Item résolu après discussion comptable" si statut=resolu

    score → niveau via SCORE_THRESHOLDS.
    """

def evaluate_all_items(plaquette_check: PlaquetteCheck) -> PlaquetteCheck:
    """
    Pour chaque item, calcule risque_fiscal SI auto_calcule=True OU si pas encore évalué.
    Préserve les overrides manuels (overridden_niveau non None).
    Met à jour risque_score_global = moyenne pondérée par montant_neuronx.
    """

def override_item_risque(
    plaquette_check: PlaquetteCheck,
    item_id: str,
    niveau: RisqueNiveau,
    motif: str,
) -> PlaquetteItem:
    """Force le niveau et figer auto_calcule=False, stocker motif."""

def reset_item_risque_auto(plaquette_check: PlaquetteCheck, item_id: str):
    """Repasse à auto_calcule=True, recalcule au prochain evaluate."""

def compute_global_score(items: List[PlaquetteItem]) -> float:
    """Moyenne pondérée par montant_neuronx, niveau → poids
    (faible=0, modere=1, eleve=2, critique=3). Score sur 3."""
```

### 3. Intégration GET — `backend/services/plaquette_service.py`

Dans `load_or_create_check(year)` (la fonction qui charge + recalcule montants à la
volée), ajouter à la fin :
```python
check = plaquette_risque_service.evaluate_all_items(check)
_save_check(year, check)
```
Cache implicite : evaluate ne re-calcule que les items avec `last_evaluated_at` plus
ancien que `updated_at` de l'item OU pas d'évaluation existante (skip si frais).

**Important** : NE PAS re-calculer si `status == DECLARE` (snapshot figé) — bypass total.

### 4. Endpoints — `backend/routers/plaquette.py`

| Méthode | Route | Body | Description |
|---------|-------|------|-------------|
| `POST`  | `/{year}/risque/recompute` | — | Force recalcul de tous les items (ignore cache) |
| `PATCH` | `/{year}/items/{item_id}/risque` | `RisqueOverrideRequest` | Override manuel |
| `DELETE`| `/{year}/items/{item_id}/risque/override` | — | Repasser en auto |
| `GET`   | `/{year}/risque/top` | `?limit=5` | Top N items triés par niveau desc puis montant desc |

Tous les endpoints `risque` retournent 423 si `status == DECLARE`.

### 5. PDF — `backend/services/plaquette_report_service.py`

**Nouvelle section 7 — Préparation contrôle fiscal** (avant l'annexe juridique qui
devient section 8).

Layout :

```
========================================================================
7. PRÉPARATION CONTRÔLE FISCAL
========================================================================

Score de risque global de l'exercice : 1.8 / 3.0 (Modéré)

Top 5 des risques de l'exercice :

┌──────────────────────────────────────────────────────────────────────┐
│ 🔴 CRITIQUE  | 61210000 — CREDIT-BAIL FORD RANGER                    │
│              | Véhicule                              17 530 € NeuronX │
│ Drivers :    | + Catégorie sensible (véhicule)                       │
│              | + Forfait quote-part appliqué (62 %)                  │
│              | + Montant élevé sur catégorie sensible (>5 k€)        │
│              | − Article 39-4 CGI cité dans commentaire              │
│ Pièces       | 18 justifs sur 24 ops · 75 % · ratio quote-part figé  │
│ disponibles: | dans data/baremes/vehicule_2025.json                  │
│ Action       | Joindre carnet de bord + facture leasing + relevés    │
│ suggérée :   | parcours pro pour défendre la quote-part.             │
└──────────────────────────────────────────────────────────────────────┘

[× 4 autres anomalies]

Note méthodologique
───────────────────
Le score est calculé automatiquement à partir de règles paramétrées dans
plaquette_risque_service.py. Il signale les zones d'exposition typiques
en cas de contrôle d'un médecin BNC SCP (charges mixtes, forfaits, taux
justificatifs, écarts N-1). Il ne préjuge pas de la régularité fiscale
des déductions — il guide la documentation défensive à constituer.

Prescription : 3 ans (droit commun, art. L169 LPF), 6 ans (suspicion
de fraude). Conservation justificatifs : 6 ans (art. L102 B LPF).
```

Implémentation : helper `_render_risque_section(c, doc, top_risques, score_global)`,
réutilisant les styles existants. Couleurs :
- Critique : `#dc2626` (rouge)
- Élevé : `#ea580c` (orange)
- Modéré : `#eab308` (ambre)
- Faible : `#16a34a` (vert) — ne devrait pas apparaître dans le top 5 par définition

### 6. Annexe juridique enrichie

Ajouter à `_BOI_CGI_REFERENCES` 4 nouvelles refs déclenchables par les drivers risque :

```python
"art_L169_LPF": ("Prescription fiscale (droit commun)",
                 "Le droit de reprise de l'administration s'exerce jusqu'à la fin de "
                 "la 3e année qui suit celle au titre de laquelle l'imposition est due.",
                 "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044981842/"),
"art_L102_B_LPF": ("Conservation des pièces (6 ans)", ...),
"art_240_CGI_DAS2": ("DAS-2 honoraires rétrocédés", ...),
"art_39_4_CGI": ("Plafonds véhicule CO2", ...),
```

Détection regex : élargir le pattern existant pour matcher `art\.?\s*(L?\d+(?:\s+\w+)?)` (capture L169, L102 B, 39-4, etc.).

## Frontend

### 1. Types — `frontend/src/types/plaquette.ts`

```typescript
export type RisqueNiveau = 'faible' | 'modere' | 'eleve' | 'critique';

export interface RisqueDriver {
  code: string;
  label: string;
  delta_score: number;
  detail?: string;
}

export interface RisqueFiscalEvaluation {
  niveau: RisqueNiveau;
  score: number;
  drivers: RisqueDriver[];
  pieces_disponibles: string[];
  auto_calcule: boolean;
  overridden_niveau: RisqueNiveau | null;
  overridden_motif: string | null;
  last_evaluated_at: string;
}

export interface PlaquetteItem {
  // existant +
  risque_fiscal: RisqueFiscalEvaluation | null;
}

export interface PlaquetteCheck {
  // existant +
  risque_score_global: number | null;
}
```

### 2. Hooks — `frontend/src/hooks/usePlaquetteCheck.ts`

```typescript
export const useRecomputeRisque = (year: number) => { /* POST /risque/recompute */ };
export const usePatchItemRisque = (year: number) => { /* PATCH /items/{id}/risque */ };
export const useResetItemRisque = (year: number) => { /* DELETE /items/{id}/risque/override */ };
export const useTopRisques = (year: number, limit = 5) => { /* GET /risque/top */ };
```

Invalidations sur succès : `['plaquette-check', year]` + `['plaquette-top-risques', year]`.

### 3. Composants — `frontend/src/components/plaquette/`

**`PlaquetteRisqueChip.tsx`** (NOUVEAU) :
Pastille compacte (28px hauteur) cliquable :
- `critique` : `bg-red-500/15 text-red-400 border-red-500/30`, icône `AlertOctagon`
- `eleve` : `bg-orange-500/15 text-orange-400 border-orange-500/30`, icône `AlertTriangle`
- `modere` : `bg-amber-500/15 text-amber-400 border-amber-500/30`, icône `AlertCircle`
- `faible` : `bg-emerald-500/15 text-emerald-400 border-emerald-500/30`, icône `ShieldCheck`

Badge supplémentaire `M` (Manuel) si `!auto_calcule`. Tooltip riche (radix) montrant
les drivers + pièces disponibles + bouton « Modifier le niveau ».

**`PlaquetteRisqueOverrideModal.tsx`** (NOUVEAU, 540px) :
Édition manuelle d'un niveau. Champs : radio 4 niveaux + textarea motif (obligatoire).
Bouton secondaire « Repasser en automatique » si `!auto_calcule`. Bouton primary
« Enregistrer ». Affiche le score auto en référence (« Calcul auto suggère : Modéré ·
score 2 »).

**`PlaquetteRisqueDrawerSummary.tsx`** (NOUVEAU) :
Petit composant pour l'onglet Comparatif (au-dessus de la table, sous le bandeau BNC) :
score global gros (« 1.8 / 3.0 »), badge niveau dominant, 4 mini-compteurs
(`{n} Critique`, `{n} Élevé`, `{n} Modéré`, `{n} Faible`), bouton outline `Recalculer`
(loader pendant la requête, désactivé si `status==declare`).

**Modifier `PlaquetteCheckDrawer.tsx`** — onglet Comparatif :
- Insérer `PlaquetteRisqueDrawerSummary` entre le bandeau BNC et la table.
- Nouvelle colonne **`Risque`** entre `Statut` et `Commentaire`, contenant
  `PlaquetteRisqueChip` (clic → `PlaquetteRisqueOverrideModal` si éditable).
- Filtres en tête de table : ajouter chip multi-select `Risque` (4 niveaux + « M »).
- Tri par colonne Risque : ordre critique → eleve → modere → faible.

### 4. Onglet Email challenge — enrichissement

Dans la card primaire « Workflow recommandé », sous la liste des items à challenger,
ajouter un bandeau d'alerte si ≥ 1 item `critique` ou `eleve` non résolu :
« ⚠ N item(s) avec risque fiscal élevé/critique. Le rapport PDF inclura une section
Préparation contrôle. »

## Documentation (dans le même commit)

### `CLAUDE.md`
Ajouter sous-section **Risque fiscal** à la rubrique Vérification plaquette : règles de
scoring, drivers, mapping score → niveau, snapshot des évaluations dans le final_snapshot.

### `CHANGELOG.md`
Nouvelle entrée `### Added (YYYY-MM-DD) — Plaquette : évaluation risque fiscal + section préparation contrôle (Session 39 — P2)`.

### `api-reference.md`
Documenter 4 nouveaux endpoints risque.

## Vérification

**Backend** :
- [ ] GET `/{year}` → tous les items ont `risque_fiscal` peuplé (auto).
- [ ] Item Véhicule (catégorie sensible + forfait + montant >5k€) → niveau >= `eleve`.
- [ ] Item « Recettes pro » (catégorie non sensible, justif 100 %) → `faible`.
- [ ] PATCH `.../items/{id}/risque` avec motif → niveau forcé, `auto_calcule=False`.
- [ ] DELETE `.../items/{id}/risque/override` → repasse auto, recalcule.
- [ ] POST `/finalize` (cycle P1) → final_snapshot.json contient `risque_fiscal` figé.
- [ ] PATCH risque sur plaquette `status=declare` → 423.
- [ ] PDF rapport contient section 7 avec top 5 + score global + annexe enrichie.
- [ ] Annexe juridique détecte « art L169 LPF » dans un commentaire.

**Frontend** :
- [ ] Colonne Risque visible dans Comparatif, tri ASC/DESC fonctionne.
- [ ] Chip critique = rouge, eleve = orange, modere = ambre, faible = vert.
- [ ] Tooltip chip montre drivers + pièces disponibles.
- [ ] Override modal : motif obligatoire, badge `M` apparaît après save.
- [ ] Recalcul global : loader visible, summary se met à jour.
- [ ] `tsc --noEmit && npm run lint` clean.

**Smoke test workflow complet** (P1 + P2 enchaînés) :
1. Ouvrir plaquette 2025, vérifier les risques calculés.
2. Override 1 item en `critique` avec motif.
3. Passer status → `validation_finale` → vérifier read-only.
4. Cliquer Finaliser → saisir declaration_ref → confirmer.
5. Ouvrir le PDF final en GED : watermark visible, section 7 présente avec les top 5,
   override custom préservé.
6. Tenter PATCH item → 423.
7. POST journal entry post-declare → 200.
8. Upload attachment sur journal entry post-declare → 200.

**Commit** : `feat(plaquette): évaluation risque fiscal + section préparation contrôle (Session 39 P2)`

---

# Notes transversales (les 2 prompts)

- **Python conventions** : `Python 3.9 + from __future__ import annotations`, `Optional[X]`
  jamais `X | None`.
- **Écriture JSON atomique** : pattern `tempfile.mkstemp + os.replace` déjà standard du projet.
- **TanStack invalidations** : sur toute mutation, invalider `['plaquette-check', year]` +
  `['ged-documents']` + `['ged-tree']`. La finalisation invalide aussi `['livret']`.
- **Dark theme** : variables CSS uniquement, pas de hex en dur — sauf dans le PDF
  (ReportLab) où l'usage de hex est explicite et accepté.
- **Tests manuels avant push** : `npx tsc --noEmit`, `npm run lint`, ouvrir le drawer
  réel sur l'exercice 2025 (déjà seeded).
- **CLAUDE.md** : mettre à jour la rubrique « Vérification plaquette » avec les nouveaux
  workflows. Si le fichier dépasse les 30 k tokens à terme, prévoir un découpage
  (pas dans cette session).
- **Hors scope** :
  - Sidebar entry pour la vérification plaquette (sujet précédent, prompt dédié si besoin).
  - Module séparé `/controle-fiscal` (Niveau 3 différé jusqu'à premier cycle vécu).
  - Recherche cross-année dans les journaux (différé).
  - Migration SQLite (V2).
