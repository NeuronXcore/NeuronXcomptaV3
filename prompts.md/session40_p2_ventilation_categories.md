# Session 40 P2 — Ventilation catégories ↔ plaquette PCG

**Date** : 2026-05-18
**Contexte** : audit de la ventilation entre les catégories NeuronX et les 28 postes PCG du template `sygnatures_marenco` (cabinet Sygnatures Marenco), à la demande de l'utilisateur : « savoir comment mon organisation par catégorie est ventilée dans les postes d'affectation ».

## Anomalies identifiées avant fix

3 familles de divergences entre `data/categories.json` (référentiel NeuronX) et `data/plaquette_pcg_mapping.json` (mapping vers les comptes PCG) :

### A. Catégories référencées par le mapping mais absentes du référentiel
- `Transport` (cible du compte `62510000` FRAIS DÉPLACEMENTS)
- `Assurance` (cible du compte `61680000` AUTRES ASSURANCES)
- `Pénalités` (cible du compte `67120000` PÉNALITÉS AMENDES FISCALES)

Conséquence : 3 comptes PCG agrégés à 0 € côté NeuronX, et catégories indisponibles dans les dropdowns Editor/Justificatifs/Alertes.

### B. Sous-catégories orphelines (filtres exclusifs)
- `Remplaçant.Hébergement` exclu par le filtre `sous_categories: ["Honoraires"]` sur `62265000`.
- `Véhicule.Péage` et `Véhicule.Parking` : aucun compte PCG ne les capte (les 4 comptes véhicule existants filtrent sur `Essence/Carburant`, `Loyer/Leasing`, `Entretien`, `Assurance`).

### C. Comptes PCG partagés silencieusement
- `60630000` Petit outillage = `Matériel + Fournitures`
- `61560000` Maintenance info = `Logiciel + Abonnements`
- `61850000` Frais réception = `Formations + Repas pro`
- `63782000` URPS + `62810000` Cotisations diverses = `Ordre des Médecins` (doublon)

Pas un bug, mais à documenter pour éviter les interprétations erronées dans le rapport de challenge.

## Corrections appliquées

### 1. `data/categories.json` — +3 entrées
```json
{ "Catégorie": "Transport",  "Sous-catégorie": null, "Couleur": "#95A5A6" },
{ "Catégorie": "Assurance",  "Sous-catégorie": null, "Couleur": "#e8acad" },
{ "Catégorie": "Pénalités",  "Sous-catégorie": null, "Couleur": "#dc2626" }
```

### 2. `data/plaquette_pcg_mapping.json`

**Filtre élargi sur `62265000`** :
```diff
"62265000": {
  "label": "HONORAIRES RETROCEDES",
  "categories": ["Remplaçant"],
- "sous_categories": ["Honoraires"]
+ "sous_categories": [],
+ "note": "Inclut toutes les sous-cat Remplaçant (Honoraires, Hébergement, vide) — à valider avec le cabinet si compte dédié hébergement existe"
}
```

**Nouveau compte `62510001` pour Véhicule.Péage/Parking** :
```json
"62510001": {
  "label": "FRAIS DEPLACEMENTS VEHICULE",
  "rubrique": "Autres frais de déplacements",
  "categories": ["Véhicule"],
  "sous_categories": ["Péage", "Parking"],
  "apply_quote_part_vehicule": true,
  "note": "Compte virtuel NeuronX — capte Véhicule.Péage/Parking. À mapper au vrai code PCG du cabinet (ex. 62510000 si consolidé) lors de la prochaine validation."
}
```

**4 notes documentaires** sur `60630000`, `61560000`, `61850000`, `63782000`.

### 3. `data/plaquette_check/2025.json`

- Item `62510001` injecté manuellement (le seed_items_from_template ne resync que lors de la création initiale).
- Item `62265000` re-syncé : `sous_categories_neuronx` passé de `["Honoraires"]` à `[]` (snapshot désaligné du mapping après le fix).

## Vérification end-to-end

`GET /api/plaquette/2025` → `_refresh_item_neuronx` recompute auto à chaque appel (pas de cache mapping côté backend, [`plaquette_pcg_mapping_service.load_mapping()`](backend/services/plaquette_pcg_mapping_service.py:24) relit le JSON à chaque appel).

| Compte PCG | Avant | Après |
|---|---|---|
| `62265000` HONORAIRES RÉTROCÉDÉS | 32 293 € / 15 ops | **33 019 € / 22 ops** *(+7 ops Hébergement)* |
| `62510001` FRAIS DÉPLACEMENTS VÉHICULE | n/a | **98,69 € / 37 ops** Véhicule.Péage+Parking |
| `62510000` FRAIS DÉPLACEMENTS | 0 € / 0 ops | 0 € *(7 ops Transport en 2024, hors 2025)* |
| `61680000` AUTRES ASSURANCES | 0 € | 0 € *(catégorie créée, vide en 2025)* |
| `67120000` PÉNALITÉS | 0 € | 0 € *(catégorie créée, vide en 2025)* |

Écart sur item `62265000` réduit de ~−6 500 € à **−5 774 €** (apparition des hébergements remplaçants).

## Sources of truth (pointers code)

- Mapping plaquette : [data/plaquette_pcg_mapping.json](data/plaquette_pcg_mapping.json) (30 comptes maintenant, dont `62510001` ajouté)
- Référentiel catégories : [data/categories.json](data/categories.json) (36 entrées)
- Agrégation : [`_aggregate_neuronx_for_categories`](backend/services/plaquette_service.py:191), [`_refresh_item_neuronx`](backend/services/plaquette_service.py:340)
- Mapping resolver : [`plaquette_pcg_mapping_service.resolve()`](backend/services/plaquette_pcg_mapping_service.py:65)
- API : `GET /api/plaquette/{year}` ([backend/routers/plaquette.py](backend/routers/plaquette.py)) — recompute auto à chaque GET via `get_or_create`

## Notes techniques

- **`_refresh_item_neuronx` ne re-sync PAS `categories_neuronx`/`sous_categories_neuronx`** : il ne resynchronise que les montants (`montant_neuronx`, `nb_ops_neuronx`, `ecart`). La résolution depuis le mapping n'est faite qu'à la création de l'item ou lors d'un PATCH explicite avec `compte_pcg` changé. Conséquence : modifier le mapping ne propage **pas** automatiquement les nouveaux filtres `sous_categories` sur les items déjà persistés — il faut un script de resync (cf. fait ici pour `62265000`).
- **Champ `note`** dans le mapping : libre, ignoré par le moteur d'agrégation (les flags utilisés sont `is_dotation`, `is_bilan`, `is_recettes`, `split_csg_deductible`, `split_urssaf_cotisations`, `apply_quote_part_vehicule` — un champ `note` traverse le dict `flags` sans effet).
- **Le BNC NeuronX réel reste inchangé** : `bnc_service.compute_bnc(2025)` est indépendant du mapping plaquette (charges_pro − recettes_pro − dotations − forfaits). Le fix améliore la **lisibilité** de la réconciliation poste par poste, pas le calcul fiscal sous-jacent.

## À valider avec le cabinet ensuite

- Code PCG réel pour Véhicule.Péage/Parking (probablement consolidé dans `62510000`, ou existence d'un compte séparé chez Sygnatures Marenco).
- Saisir `montant_plaquette` du compte `62510001` dans le drawer Vérification plaquette pour boucler la réconciliation.
- Régénérer le rapport PDF de challenge depuis l'onglet Email (auto-replace via `_delete_previous_reports`).
