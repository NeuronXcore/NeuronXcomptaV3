# SPEC — Rapprochement Opérations / Justificatifs

> **Fichier de spécification pour Claude Code.**
> Implémenter le moteur de rapprochement et ses 4 points d'entrée UI.
> Lire `CLAUDE.md` en priorité. Ce SPEC est complémentaire à `SPEC_AI_SANDBOX.md`
> (les champs `ollama_suggestion` dans les `.ocr.json` sont produits par ce pipeline).

---

## Contexte

Chaque opération bancaire peut être associée à zéro ou un justificatif PDF.
L'association est stockée dans les fichiers d'opérations JSON via les champs existants
`justificatif` (filename) et `justificatif_status`.

Ce SPEC introduit :
1. Un **moteur de scoring** pour calculer la probabilité de correspondance entre une opération
   et un justificatif
2. Une **association automatique silencieuse** pour les scores ≥ 0.95
3. **4 points d'entrée UI** pour le rapprochement manuel assisté

---

## 1. Modèle de données — extensions

### 1.1 Champs à ajouter dans chaque opération JSON

```json
{
  "justificatif": "justificatif_20250314_facture_dentaire.pdf",
  "justificatif_status": "associe",
  "rapprochement_score": 0.97,
  "rapprochement_mode": "auto",
  "rapprochement_date": "2025-03-20T14:32:00"
}
```

`rapprochement_mode` : `"auto"` | `"manuel"` | `null`

Les opérations existantes sans justificatif ont `justificatif: null`, `rapprochement_score: null`,
`rapprochement_mode: null`. Ne pas modifier les données existantes au démarrage.

### 1.2 Étendre le modèle Pydantic `Operation` (`backend/models/operation.py`)

Ajouter les 3 nouveaux champs optionnels avec valeur par défaut `None`.

---

## 2. Moteur de scoring — `backend/services/rapprochement_service.py`

### 2.1 Algorithme de score

```python
def compute_score(justificatif: JustificatifOCR, operation: Operation) -> MatchScore:
    s_montant    = score_montant(justificatif.montant, operation.montant)
    s_date       = score_date(justificatif.date, operation.date)
    s_fournisseur = score_fournisseur(justificatif.fournisseur_normalise, operation.libelle)

    total = s_montant * 0.45 + s_date * 0.35 + s_fournisseur * 0.20

    return MatchScore(
        total=round(total, 4),
        detail=ScoreDetail(
            montant=s_montant,
            date=s_date,
            fournisseur=s_fournisseur
        ),
        confidence_level=_confidence_level(total)
    )
```

**`score_montant(j_montant, o_montant) -> float`**

```
Nul ou manquant          → 0.0
Égaux (±0.01€)           → 1.0
Écart absolu < 1€        → 0.9
Écart relatif < 2%       → 0.75
Écart relatif < 5%       → 0.5
Écart relatif < 10%      → 0.25
Sinon                    → 0.0
```

Note : comparer `abs(j_montant)` vs `abs(o_montant)` — les débits sont négatifs dans les opérations.

**`score_date(j_date, o_date) -> float`**

```
Nul ou manquant          → 0.0
Même jour                → 1.0
Écart ≤ 3 jours          → 0.8
Écart ≤ 7 jours          → 0.6
Écart ≤ 15 jours         → 0.4
Écart ≤ 30 jours         → 0.2
Sinon                    → 0.0
```

Note : la date facture précède souvent la date débit bancaire de quelques jours — c'est normal.

**`score_fournisseur(j_fournisseur, o_libelle) -> float`**

Normaliser les deux chaînes : minuscules, supprimer stopwords (`du`, `de`, `la`, `le`, `les`,
`sa`, `sarl`, `sas`, `eurl`), supprimer la ponctuation.
Calculer l'intersection des tokens restants divisée par l'union (Jaccard).

```python
def score_fournisseur(a: Optional[str], b: Optional[str]) -> float:
    if not a or not b:
        return 0.0
    tokens_a = normalize_tokens(a)
    tokens_b = normalize_tokens(b)
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)
```

**`_confidence_level(score: float) -> str`**

```
score ≥ 0.95   → "fort"      (auto-association déclenchée)
score ≥ 0.75   → "probable"  (badge vert, suggestion forte)
score ≥ 0.60   → "possible"  (badge orange, à vérifier)
score < 0.60   → "faible"    (pas affiché par défaut)
```

### 2.2 Modèles Pydantic de résultat

```python
class ScoreDetail(BaseModel):
    montant: float
    date: float
    fournisseur: float

class MatchScore(BaseModel):
    total: float
    detail: ScoreDetail
    confidence_level: str     # "fort" | "probable" | "possible" | "faible"

class RapprochementSuggestion(BaseModel):
    justificatif_filename: str
    operation_file: str
    operation_index: int
    operation_libelle: str
    operation_date: str
    operation_montant: float
    score: MatchScore
```

### 2.3 Méthodes publiques du service

**`get_suggestions_for_operation(operation_file, operation_index) -> list[RapprochementSuggestion]`**

Pour une opération donnée, scorer tous les justificatifs de `en_attente/`.
Retourner uniquement les suggestions avec `confidence_level != "faible"`, triées par score décroissant.
Limiter à 5 suggestions maximum.

**`get_suggestions_for_justificatif(justificatif_filename) -> list[RapprochementSuggestion]`**

Pour un justificatif donné, scorer toutes les opérations sans justificatif dans tous les fichiers
d'import. Retourner les suggestions `confidence_level != "faible"`, triées par score décroissant.
Limiter à 5 suggestions maximum.

**`run_auto_rapprochement() -> AutoRapprochementReport`**

Parcourir tous les justificatifs de `en_attente/`.
Pour chacun, calculer les scores contre toutes les opérations sans justificatif.
Si le meilleur score est ≥ 0.95 **et** qu'il est unique (pas d'ex-aequo à ±0.02) :
  - Appeler `justificatif_service.associate()` avec `rapprochement_mode="auto"`
  - Logger l'association dans `data/logs/auto_rapprochement.jsonl`

```python
class AutoRapprochementReport(BaseModel):
    total_justificatifs_traites: int
    associations_auto: int
    suggestions_fortes: int      # score ≥ 0.75, non auto
    sans_correspondance: int
    ran_at: str
```

**`get_unmatched_summary() -> UnmatchedSummary`**

Retourner les compteurs : opérations sans justificatif / justificatifs non associés.
Utilisé par les dashboards.

---

## 3. Nouveaux endpoints — `backend/routers/rapprochement.py`

Prefix : `/api/rapprochement`

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/suggestions/operation/{file}/{index}` | Suggestions pour une opération |
| `GET` | `/suggestions/justificatif/{filename}` | Suggestions pour un justificatif |
| `POST` | `/run-auto` | Déclenche `run_auto_rapprochement()` — retourne le rapport |
| `GET` | `/unmatched` | Compteurs opérations/justificatifs non rapprochés |
| `GET` | `/log` | 20 dernières associations automatiques depuis `auto_rapprochement.jsonl` |

Enregistrer ce router dans `backend/main.py`.

---

## 4. Déclenchement automatique

### 4.1 Après chaque batch sandbox

Dans `sandbox_service.process_batch()`, à la fin du traitement, appeler
`rapprochement_service.run_auto_rapprochement()` en background.
Ne pas attendre le résultat pour retourner le `BatchReport`.

### 4.2 Après chaque import de relevé PDF

Dans `backend/routers/operations.py`, endpoint `POST /import` :
après la sauvegarde du fichier JSON, déclencher `run_auto_rapprochement()` en `BackgroundTasks`.

### 4.3 Jamais bloquant

`run_auto_rapprochement()` est toujours appelé via `BackgroundTasks` FastAPI ou dans un thread.
Il ne doit jamais allonger le temps de réponse d'une requête principale.

---

## 5. Frontend — 4 points d'entrée UI

### 5.1 Types TypeScript — `src/types/index.ts`

Ajouter : `ScoreDetail`, `MatchScore`, `RapprochementSuggestion`, `AutoRapprochementReport`,
`UnmatchedSummary`.

Étendre `Operation` :
```typescript
rapprochement_score?: number
rapprochement_mode?: "auto" | "manuel" | null
rapprochement_date?: string
```

### 5.2 Hook — `src/hooks/useRapprochement.ts`

```typescript
// Queries
useOperationSuggestions(file, index)      // GET suggestions/operation/:file/:index
useJustificatifSuggestions(filename)      // GET suggestions/justificatif/:filename
useUnmatched()                            // GET /unmatched — polling 60s

// Mutations
useRunAutoRapprochement()                 // POST /run-auto
useManualAssociate()                      // POST /api/justificatifs/associate
                                          // avec rapprochement_mode="manuel"
```

Invalider `['justificatifs']`, `['operations']`, `['rapprochement-unmatched']`
après toute association.

---

### 5.3 Point d'entrée 1 — Éditeur d'opérations (`EditorPage.tsx`)

**Icône trombone** dans chaque ligne du tableau des opérations :
- Grisée + tooltip "Aucun justificatif" si `justificatif === null`
- Verte + filename si déjà associé (clic → preview PDF)
- Badge orange animé si une suggestion forte existe (score ≥ 0.75, calculé au chargement)

**Au clic sur l'icône trombone (opération sans justificatif)** :
Ouvrir un drawer latéral `RapprochementDrawer` (600px, pattern existant translateX).

Contenu du drawer :
- Header : libellé + montant + date de l'opération
- Section "Suggestions" : liste des `RapprochementSuggestion` retournées
  - Pour chaque suggestion : miniature nom fichier / score visuel (barre colorée) /
    détail score montant + date + fournisseur en sous-texte / bouton "Associer"
  - Badge couleur selon `confidence_level` : vert (fort/probable), orange (possible)
- Section "Associer manuellement" : liste déroulante de tous les justificatifs `en_attente/`
  non encore associés, avec bouton "Confirmer"
- Bouton "Annuler" ferme le drawer sans action

---

### 5.4 Point d'entrée 2 — Vue rapprochement dédiée

**Nouvelle route** `/rapprochement` — nouveau composant `RapprochementPage.tsx`.
Ajouter l'entrée dans `App.tsx` et dans la navigation latérale existante.

**Layout deux colonnes** :

```
┌─────────────────────────────────────────────────────────┐
│  Header : UnmatchedSummary (2 MetricCard)               │
│  "X opérations sans justificatif"  "Y justificatifs     │
│                                      non associés"      │
│  [Lancer rapprochement auto]  [Voir le log auto]        │
├──────────────────────┬──────────────────────────────────┤
│  OPÉRATIONS          │  JUSTIFICATIFS                   │
│  Sans justificatif   │  En attente d'association        │
│                      │                                  │
│  Filtres : mois,     │  Filtres : date, fournisseur     │
│  catégorie           │                                  │
│                      │                                  │
│  [ligne sélectionnée │  [suggestion mise en surbrillance│
│   en surbrillance]   │   automatiquement]               │
│                      │                                  │
│  Score affiché en    │  Badge confidence_level          │
│  face de chaque      │                                  │
│  justificatif        │                                  │
│  suggéré             │                                  │
└──────────────────────┴──────────────────────────────────┘
```

**Interaction** :
- Clic sur une opération → colonne droite se met à jour avec les suggestions triées,
  le justificatif le mieux scoré est mis en surbrillance
- Clic sur un justificatif dans la colonne droite → bouton "Associer cette paire" apparaît
- Bouton "Lancer rapprochement auto" → mutation `useRunAutoRapprochement` → afficher
  l'`AutoRapprochementReport` dans une modale (X associations auto, Y suggestions fortes)
- Lien "Voir le log auto" → drawer avec les 20 dernières associations automatiques
  (date, opération, justificatif, score)

---

### 5.5 Point d'entrée 3 — Validation batch depuis sandbox (dans `JustificatifsPage.tsx`)

Dans l'onglet Sandbox (décrit dans `SPEC_AI_SANDBOX.md`), après affichage du `BatchReport` :

Ajouter une colonne **"Correspondance"** dans le tableau des résultats :
- Score le plus élevé trouvé pour ce justificatif
- Badge `confidence_level`
- Si `confidence_level === "fort"` : libellé opération suggérée + montant + "(auto-associé)"
- Si `confidence_level === "probable"` : libellé opération suggérée + bouton "Valider"
- Si `confidence_level === "possible"` : "Vérifier manuellement" + icône lien vers la vue dédiée
- Sinon : "Aucune correspondance"

Bouton global **"Valider toutes les suggestions probables"** : associe en masse tous les
justificatifs du batch dont `confidence_level === "probable"`, avec `rapprochement_mode="manuel"`.
Demander confirmation via une modale avant exécution.

---

### 5.6 Point d'entrée 4 — Galerie justificatifs existante (`JustificatifsPage.tsx`)

Dans l'onglet galerie (existant) :

**Sur chaque card justificatif non associé** :
- Afficher le meilleur score de correspondance (requête lazy au survol pour ne pas surcharger
  au chargement initial)
- Badge `confidence_level` si score ≥ 0.60
- Bouton "Voir les correspondances" → ouvre le `RapprochementDrawer` en mode justificatif
  (colonne suggestion = liste d'opérations suggérées, pas de justificatifs)

**Filtre additionnel dans la barre de filtres existante** :
```
[Tous] [En attente] [Traités] [Sans correspondance] [Correspondance forte]
```

---

## 6. Annulation d'une association automatique

Une association auto peut être annulée depuis deux endroits :

**Dans l'éditeur** : clic sur l'icône trombone verte d'une opération auto-associée →
drawer avec badge "Associé automatiquement (score: 0.97)" + bouton "Dissocier".
Appeler `POST /api/justificatifs/dissociate`. Logger la dissociation dans
`data/logs/auto_rapprochement.jsonl` avec `action: "annulé"`.

**Dans le log auto** (accessible depuis la vue rapprochement) :
Bouton "Annuler" sur chaque ligne du log → même appel dissociate.

---

## 7. Tableau de bord — intégration

Dans `DashboardPage.tsx` (existant), ajouter dans les KPIs :

```
[ Opérations sans justificatif : 12 ]  [ Justificatifs en attente : 5 ]
```

Ces deux métriques viennent de `GET /api/rapprochement/unmatched` avec polling 60s.
Clic sur chaque métrique → navigation vers `/rapprochement`.

---

## 8. Ordre d'implémentation recommandé

```
1. models/operation.py         → étendre avec les 3 nouveaux champs
2. rapprochement_service.py    → moteur de scoring complet
3. routers/rapprochement.py    → 5 endpoints
4. main.py                     → enregistrer le router
5. operations.py (existant)    → déclencher run_auto après import
6. sandbox_service.py          → déclencher run_auto après batch (si SPEC_AI_SANDBOX implémenté)
7. src/types/index.ts          → nouveaux types TS
8. useRapprochement.ts         → hook
9. RapprochementDrawer.tsx     → composant drawer partagé (réutilisé dans points 1, 4)
10. EditorPage.tsx             → icône trombone + drawer (point 1)
11. RapprochementPage.tsx      → vue dédiée (point 2) + route App.tsx + nav
12. JustificatifsPage.tsx      → colonne batch (point 3) + galerie (point 4)
13. DashboardPage.tsx          → 2 nouvelles métriques
```

---

## 9. Contraintes techniques

- **Python 3.9** : `from __future__ import annotations` dans `rapprochement_service.py`
  et `routers/rapprochement.py`.
- **Performance** : `run_auto_rapprochement()` charge tous les fichiers d'opérations JSON.
  Utiliser un cache en mémoire (dict) sur la durée du batch, pas de rechargement fichier
  à chaque comparaison.
- **Unicité du match auto** : ne jamais auto-associer si deux opérations ont un score > 0.93
  pour le même justificatif — laisser l'humain choisir.
- **Idempotence** : `run_auto_rapprochement()` ne doit pas re-traiter les justificatifs
  déjà associés (`status === "traite"`).
- **Lazy loading scores** dans la galerie : ne pas calculer les scores de tous les justificatifs
  au chargement de la page. Utiliser `useQuery` avec `enabled: false` + déclenchement au survol.
- **Dark theme** : tous les badges `confidence_level` utilisent des variables CSS existantes.
  Proposer : `text-emerald-400` (fort), `text-amber-400` (probable), `text-orange-400` (possible).
- **`RapprochementDrawer`** est un composant partagé instancié depuis l'éditeur ET la galerie.
  Accepter une prop `mode: "operation" | "justificatif"` pour adapter l'affichage.

---

## 10. Tests à effectuer après implémentation

- [ ] Import d'un relevé → `run_auto_rapprochement()` se déclenche en background, log créé
- [ ] Justificatif dont le montant et la date correspondent exactement → score ≥ 0.95, auto-associé
- [ ] Deux opérations quasi-identiques → pas d'auto-association (unicité non garantie)
- [ ] Dissociation d'une association auto depuis l'éditeur → log mis à jour, justificatif retourne en `en_attente/`
- [ ] Vue rapprochement : sélection d'une opération → colonne droite se met à jour
- [ ] Galerie : filtre "Correspondance forte" → affiche uniquement les justificatifs concernés
- [ ] Dashboard : métriques reflètent l'état réel après associations
- [ ] Score fournisseur : "SELARL DENTAIRE DU MIDI" vs "SELARL Dentaire Midi" → score > 0
- [ ] Score montant : -450.00 (débit) vs 450.00 (facture) → score 1.0 (valeur absolue)

---

*Ce SPEC est conçu pour fonctionner indépendamment de `SPEC_AI_SANDBOX.md`.
Si le pipeline sandbox est implémenté, le champ `ollama_suggestion.fournisseur_normalise`
enrichit le `score_fournisseur`. Si non, le scoring fonctionne avec les données OCR brutes existantes.*
