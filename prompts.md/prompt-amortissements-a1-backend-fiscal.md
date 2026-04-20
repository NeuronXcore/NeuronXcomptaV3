# Prompt A1 — Amortissements : backend fiscal (avec reprise d'exercice antérieur)

## Contexte

Le module Amortissements calcule les dotations dans son registre mais ne les répercute pas dans le calcul du BNC. Résultat : l'op bancaire d'achat d'une immo est comptée en charges_pro (alors qu'elle aurait dû être étalée), et les dotations calculées sont invisibles pour le BNC. En plus, le BNC est recalculé de 4 façons différentes dans autant de services → divergence silencieuse.

**Cas supplémentaire couvert** : reprise d'immobilisations acquises **avant** l'utilisation de NeuronXcompta. Exemple : échographe acheté en 2024, durée 5 ans, amortissements 2024/2025 déjà passés par l'ancien comptable. Il faut pouvoir inscrire cette immo dans le registre avec sa VNC d'ouverture 2026, sans régénérer rétroactivement des dotations qui contamineraient les BNC pré-NeuronX.

Ce prompt **backend-only** corrige le cœur fiscal. L'UI frontend (Prompt A2) et les écritures OD (Prompts B1/B2) suivront.

## Dépendances

Aucune — premier prompt de la série.

## Périmètre

- [x] Service unique `bnc_service.compute_bnc(year)` appelé par les 4 services aujourd'hui divergents
- [x] Constante `EXCLUDED_FROM_CHARGES_PRO` dans `analytics_service` (exclut `Immobilisations`, `Dotations aux amortissements`, `Ventilé`)
- [x] Catégorie `Dotations aux amortissements` seedée au boot (idempotent)
- [x] Ligne virtuelle `is_virtual: True` injectée dans `analytics_service.get_dashboard()` quand dotations > 0
- [x] Détection candidates strict `Catégorie == "Matériel"` (suppression `categories_eligibles` du config)
- [x] Forçage `mode = "lineaire"` en création (dégressif interdit en BNC régime recettes)
- [x] **NOUVEAU — Reprise d'exercice antérieur** : champs `exercice_entree_neuronx`, `amortissements_anterieurs`, `vnc_ouverture` sur `Immobilisation`. Moteur adapté pour backfill sans contaminer le BNC pré-NeuronX.
- [x] 2 migrations lifespan idempotentes (config + immos legacy dégressives + enrichissement champs reprise)
- [x] Endpoint `GET /api/amortissements/virtual-detail?year=X`
- [x] Endpoint `GET /api/amortissements/dotation-ref/{year}` (prépare Prompt B)
- [x] **NOUVEAU** — Endpoint `POST /api/amortissements/compute-backfill` — calcule VNC ouverture suggérée

## Fichiers touchés

- **Créer** `backend/services/bnc_service.py`
- `backend/services/analytics_service.py` — constante + filtres + ligne virtuelle
- `backend/services/amortissement_service.py` — `detect_candidates` + `get_virtual_detail` + `find_dotation_operation` + mode linéaire forcé + **backfill**
- `backend/services/simulation_service.py` — utilise `bnc_service`
- `backend/services/export_service.py` — utilise `bnc_service` (si `get_bnc_summary` existe)
- `backend/models/amortissement.py` — retire `categories_eligibles`, ajoute `DotationImmoRow` + `AmortissementVirtualDetail` + **3 champs reprise** + modèles `BackfillCompute*`
- `backend/routers/amortissements.py` — 3 nouveaux endpoints
- `backend/main.py` — seed catégorie + 2 migrations lifespan

---

## Étapes ordonnées

### Étape 1 — Constante `EXCLUDED_FROM_CHARGES_PRO`

**`backend/services/analytics_service.py`** — en tête :

```python
EXCLUDED_FROM_CHARGES_PRO: set[str] = {
    "Immobilisations",
    "Dotations aux amortissements",
    "Ventilé",
}
```

Appliquer dans **tous les points d'agrégation charges_pro** :
- `get_dashboard(year)`
- `get_summary(year)`
- `get_year_overview(year)`
- `get_trends(year)`
- `get_anomalies(year)`
- `get_compare(a, b)` — 2 périodes

Pattern de filtre à injecter dans chaque boucle d'ops :

```python
if op.get("Catégorie") in EXCLUDED_FROM_CHARGES_PRO:
    continue
```

Ne pas toucher à `get_category_detail(year, categorie)` (retourne une catégorie spécifique — comportement préservé).

### Étape 2 — Seed catégorie + migrations lifespan

**`backend/main.py`** — dans le lifespan, après `_migrate_repas_to_repas_pro()` :

```python
def _seed_dotations_amortissements_category() -> None:
    """Idempotent : ajoute la catégorie si absente."""
    from backend.services import category_service
    existing = category_service.list_categories()
    names = [c.name for c in existing] if existing else []
    if "Dotations aux amortissements" not in names:
        category_service.create_category(
            name="Dotations aux amortissements",
            color="#3C3489",
            sous_categories=[],
        )
        logger.info("✓ Catégorie 'Dotations aux amortissements' ajoutée")


def _migrate_amortissement_config() -> None:
    """Supprime categories_eligibles du config + force linéaire sur immos + ajoute champs reprise."""
    import json
    from pathlib import Path

    config_path = Path("data/amortissements/config.json")
    if config_path.exists():
        data = json.loads(config_path.read_text())
        if "categories_eligibles" in data:
            del data["categories_eligibles"]
            config_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
            logger.info("✓ config.json : categories_eligibles supprimé")

    immos_path = Path("data/amortissements/immobilisations.json")
    if immos_path.exists():
        data = json.loads(immos_path.read_text())
        migrated_degressif = 0
        migrated_reprise = 0
        for immo in data.get("immobilisations", []):
            if immo.get("mode") == "degressif":
                immo["mode"] = "lineaire"
                migrated_degressif += 1
            # Ajouter champs reprise avec valeurs par défaut si absents
            if "exercice_entree_neuronx" not in immo:
                immo["exercice_entree_neuronx"] = None
                immo["amortissements_anterieurs"] = 0.0
                immo["vnc_ouverture"] = None
                migrated_reprise += 1
        if migrated_degressif or migrated_reprise:
            immos_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
            if migrated_degressif:
                logger.info(f"✓ {migrated_degressif} immo(s) migrée(s) dégressif → linéaire")
            if migrated_reprise:
                logger.info(f"✓ {migrated_reprise} immo(s) enrichie(s) champs reprise (défaut None)")
```

Appeler les deux fonctions dans le lifespan. Adapter `category_service.create_category` aux signatures réelles (inspecter le service).

### Étape 3 — Modèles Pydantic enrichis

**`backend/models/amortissement.py`** :

```python
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class AmortissementConfig(BaseModel):
    seuil: float = 500.0
    # categories_eligibles: SUPPRIMÉ — toujours restreint à "Matériel"
    sous_categories_exclues: list[str] = []
    durees_par_defaut: dict[str, int] = {}  # indexé par sous-catégorie
    coefficient_degressif: dict[int, float] = {}  # garder pour lecture immos legacy


class Immobilisation(BaseModel):
    id: str
    designation: str
    date_acquisition: str
    base_amortissable: float
    duree: int
    mode: str = "lineaire"
    quote_part_pro: float = 100.0
    poste: str | None = None
    statut: str = "en_cours"  # en_cours | amorti | sorti

    # Champs cession existants
    date_sortie: str | None = None
    prix_cession: float | None = None
    motif_sortie: str | None = None

    # NOUVEAUX — Reprise d'exercice antérieur
    exercice_entree_neuronx: int | None = None
    amortissements_anterieurs: float = 0.0
    vnc_ouverture: float | None = None

    # Tracking
    operation_source: dict | None = None
    created_at: str | None = None

    @field_validator("exercice_entree_neuronx")
    @classmethod
    def validate_exercice_entree(cls, v, info):
        if v is None:
            return v
        date_acq = info.data.get("date_acquisition", "")
        if date_acq and len(date_acq) >= 4:
            year_acq = int(date_acq[:4])
            if v <= year_acq:
                raise ValueError(
                    f"exercice_entree_neuronx ({v}) doit être > année acquisition ({year_acq})"
                )
        return v

    @field_validator("vnc_ouverture")
    @classmethod
    def validate_vnc_ouverture(cls, v, info):
        if info.data.get("exercice_entree_neuronx") is not None and v is None:
            raise ValueError("vnc_ouverture requise quand exercice_entree_neuronx est défini")
        if v is not None and v < 0:
            raise ValueError("vnc_ouverture ne peut pas être négative")
        return v


class ImmobilisationCreate(BaseModel):
    """Payload de création — sans id / created_at / statut."""
    designation: str
    date_acquisition: str
    base_amortissable: float
    duree: int
    mode: str = "lineaire"
    quote_part_pro: float = 100.0
    poste: str | None = None
    exercice_entree_neuronx: int | None = None
    amortissements_anterieurs: float = 0.0
    vnc_ouverture: float | None = None
    operation_source: dict | None = None

    @field_validator("exercice_entree_neuronx")
    @classmethod
    def validate_exercice(cls, v, info):
        if v is None:
            return v
        date_acq = info.data.get("date_acquisition", "")
        if date_acq and len(date_acq) >= 4:
            year_acq = int(date_acq[:4])
            if v <= year_acq:
                raise ValueError(
                    f"exercice_entree_neuronx ({v}) doit être > année acquisition ({year_acq})"
                )
        return v


class BackfillComputeRequest(BaseModel):
    date_acquisition: str
    base_amortissable: float
    duree: int
    exercice_entree_neuronx: int
    quote_part_pro: float = 100.0


class BackfillComputeResponse(BaseModel):
    amortissements_anterieurs_theorique: float
    vnc_ouverture_theorique: float
    detail_exercices_anterieurs: list[dict]  # [{exercice, dotation, vnc_fin}]


class DotationImmoRow(BaseModel):
    immobilisation_id: str
    designation: str
    date_acquisition: str
    mode: str
    duree: int
    base_amortissable: float
    vnc_debut: float
    dotation_brute: float
    quote_part_pro: float
    dotation_deductible: float
    vnc_fin: float
    statut: str  # en_cours | complement | derniere | cedee
    poste: str | None = None
    is_reprise: bool = False
    exercice_entree_neuronx: int | None = None


class AmortissementVirtualDetail(BaseModel):
    year: int
    total_brute: float
    total_deductible: float
    nb_immos_actives: int
    immos: list[DotationImmoRow]
```

Ajouter également un champ `is_backfill: bool = False` sur le modèle `LigneAmortissement` existant (si pas déjà présent).

### Étape 4 — Moteur de calcul : branche backfill

**`backend/services/amortissement_service.py`** :

```python
def compute_tableau(immo: Immobilisation) -> list[LigneAmortissement]:
    """Tableau d'amortissement complet. Branche sur standard ou backfill."""
    if immo.exercice_entree_neuronx is None:
        return _compute_tableau_standard(immo)
    return _compute_tableau_with_backfill(immo)


def _compute_tableau_standard(immo: Immobilisation) -> list[LigneAmortissement]:
    """Comportement existant — tableau depuis date_acquisition. Pas de modif."""
    # Code actuel — préserver tel quel
    ...


def _compute_tableau_with_backfill(immo: Immobilisation) -> list[LigneAmortissement]:
    """Tableau reprise : ligne récap antérieur (non déductible) + exercices NeuronX."""
    year_acq = int(immo.date_acquisition[:4])
    year_entree = immo.exercice_entree_neuronx
    nb_annees_anterieures = year_entree - year_acq

    lignes: list[LigneAmortissement] = []

    # 1. Ligne récap "Exercices antérieurs"
    lignes.append(LigneAmortissement(
        exercice=year_entree - 1,
        libelle=f"Cumul {nb_annees_anterieures} exercice(s) antérieur(s) — hors NeuronX",
        vnc_debut=immo.base_amortissable,
        dotation_brute=immo.amortissements_anterieurs,
        dotation_deductible=0.0,  # ← non agrégé dans BNC NeuronX
        vnc_fin=immo.vnc_ouverture,
        is_backfill=True,
    ))

    # 2. Exercices NeuronX — amortissement linéaire de vnc_ouverture sur jours restants
    jours_total = immo.duree * 360
    jours_consommes = _jours_depuis_acquisition_jusqu_a_fin_exercice(
        immo.date_acquisition, year_entree - 1,
    )
    jours_restants = jours_total - jours_consommes

    if jours_restants <= 0:
        # Edge : immo déjà totalement amortie avant entrée NeuronX
        lignes.append(LigneAmortissement(
            exercice=year_entree,
            libelle="Immobilisation totalement amortie avant entrée NeuronX",
            vnc_debut=immo.vnc_ouverture,
            dotation_brute=0.0,
            dotation_deductible=0.0,
            vnc_fin=immo.vnc_ouverture,
        ))
        return lignes

    taux_quotidien = immo.vnc_ouverture / jours_restants
    vnc_courante = immo.vnc_ouverture
    exercice_courant = year_entree
    jours_cumules = 0

    while vnc_courante > 0.01 and jours_cumules < jours_restants:
        jours_exercice = min(360, jours_restants - jours_cumules)
        dotation_brute = round(taux_quotidien * jours_exercice, 2)

        # Complément dernière année
        if jours_cumules + jours_exercice >= jours_restants:
            dotation_brute = round(vnc_courante, 2)

        dotation_deductible = round(dotation_brute * immo.quote_part_pro / 100, 2)
        vnc_fin = round(vnc_courante - dotation_brute, 2)

        lignes.append(LigneAmortissement(
            exercice=exercice_courant,
            libelle=f"Exercice {exercice_courant}",
            vnc_debut=vnc_courante,
            dotation_brute=dotation_brute,
            dotation_deductible=dotation_deductible,
            vnc_fin=max(0.0, vnc_fin),
            is_backfill=False,
        ))

        vnc_courante = vnc_fin
        jours_cumules += jours_exercice
        exercice_courant += 1

    return lignes


def _jours_depuis_acquisition_jusqu_a_fin_exercice(date_acquisition: str, exercice_fin: int) -> int:
    """Jours cumulés base 360 entre date_acquisition et 31/12/exercice_fin."""
    from datetime import date

    d_acq = date.fromisoformat(date_acquisition)
    d_fin = date(exercice_fin, 12, 31)

    # Année d'acquisition : pro rata (d_acq → 31/12 de l'année d'acq)
    fin_annee_acq = date(d_acq.year, 12, 31)
    jours_an1 = _jours_base_360(d_acq, fin_annee_acq)

    # Années pleines suivantes
    nb_annees_pleines = exercice_fin - d_acq.year
    return jours_an1 + max(0, nb_annees_pleines) * 360


def _jours_base_360(d1, d2) -> int:
    """Convention comptable française base 360."""
    if d2 < d1:
        return 0
    mois = (d2.year - d1.year) * 12 + (d2.month - d1.month)
    jours_reste = d2.day - d1.day
    return mois * 30 + jours_reste
```

### Étape 5 — `detect_candidates` strict Matériel + mode linéaire forcé

**`backend/services/amortissement_service.py`** :

```python
def detect_candidates() -> list[CandidateOp]:
    """Strict : uniquement Catégorie == 'Matériel'."""
    config = load_config()
    candidates = []
    for filename, ops in _iter_all_operations():
        for idx, op in enumerate(ops):
            if op.get("Catégorie") != "Matériel":
                continue
            if op.get("Sous-catégorie") in config.sous_categories_exclues:
                continue
            montant = abs(op.get("Débit", 0) or 0)
            if montant < config.seuil:
                continue
            if op.get("immobilisation_id") or op.get("immobilisation_ignored"):
                continue
            candidates.append(_build_candidate(filename, idx, op))
    return candidates


def create_immobilisation(payload: ImmobilisationCreate) -> Immobilisation:
    # Dégressif interdit en BNC régime recettes
    if payload.mode != "lineaire":
        payload.mode = "lineaire"

    # Validation cohérence backfill (double sécurité par-dessus Pydantic)
    if payload.exercice_entree_neuronx is not None:
        if payload.vnc_ouverture is None:
            raise ValueError("vnc_ouverture requise en mode reprise")
        if payload.amortissements_anterieurs < 0:
            raise ValueError("amortissements_anterieurs ne peut pas être négatif")
        expected = payload.amortissements_anterieurs + payload.vnc_ouverture
        if abs(expected - payload.base_amortissable) > 1.0:
            raise ValueError(
                f"Incohérence : amortissements_anterieurs ({payload.amortissements_anterieurs}) "
                f"+ vnc_ouverture ({payload.vnc_ouverture}) = {expected} ≠ "
                f"base_amortissable ({payload.base_amortissable})"
            )

    # ... reste de la logique existante (id, created_at, save)
```

### Étape 6 — Helper `compute_backfill_suggestion`

**`backend/services/amortissement_service.py`** :

```python
def compute_backfill_suggestion(req: BackfillComputeRequest) -> BackfillComputeResponse:
    """Suggère amortissements_anterieurs + vnc_ouverture théoriques (linéaire pur,
    pro rata temporis année 1). Éditables côté UI si valeurs réelles différentes."""

    immo_temp = Immobilisation(
        id="temp",
        designation="temp",
        date_acquisition=req.date_acquisition,
        base_amortissable=req.base_amortissable,
        duree=req.duree,
        mode="lineaire",
        quote_part_pro=req.quote_part_pro,
    )

    tableau = _compute_tableau_standard(immo_temp)

    detail_anterieurs = []
    cumul = 0.0
    vnc_finale = req.base_amortissable

    for ligne in tableau:
        if ligne.exercice >= req.exercice_entree_neuronx:
            break
        cumul += ligne.dotation_brute
        vnc_finale = ligne.vnc_fin
        detail_anterieurs.append({
            "exercice": ligne.exercice,
            "dotation": ligne.dotation_brute,
            "vnc_fin": ligne.vnc_fin,
        })

    return BackfillComputeResponse(
        amortissements_anterieurs_theorique=round(cumul, 2),
        vnc_ouverture_theorique=round(vnc_finale, 2),
        detail_exercices_anterieurs=detail_anterieurs,
    )
```

### Étape 7 — `bnc_service` centralisé

**Créer** `backend/services/bnc_service.py` :

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BncBreakdown:
    year: int
    recettes_pro: float
    charges_pro: float           # hors EXCLUDED_FROM_CHARGES_PRO
    dotations_amortissements: float
    forfaits_total: float
    bnc: float


def compute_bnc(year: int) -> BncBreakdown:
    """Source unique du calcul BNC.
    Formule : recettes − charges (hors immos/dotations/ventilé) − dotations − forfaits.
    PVCT/MVCT pas encore inclus (Prompt C)."""
    from backend.services import (
        amortissement_service,
        analytics_service,
        charges_forfaitaires_service,
    )

    recettes = analytics_service.get_recettes_pro_total(year)
    charges = analytics_service.get_charges_pro_total(year)
    dotations = amortissement_service.get_dotations(year).total_deductible
    forfaits = charges_forfaitaires_service.get_total_deductible_year(year)

    bnc = recettes - charges - dotations - forfaits

    return BncBreakdown(
        year=year,
        recettes_pro=recettes,
        charges_pro=charges,
        dotations_amortissements=dotations,
        forfaits_total=forfaits,
        bnc=bnc,
    )
```

**Important** : imports locaux dans la fonction (évite cycle). Si les helpers `get_recettes_pro_total` / `get_charges_pro_total` n'existent pas isolément, les créer (extraits du dashboard). Si `charges_forfaitaires_service.get_total_deductible_year` n'existe pas, l'ajouter (somme blanchissage + repas + quote-part véhicule déductible).

### Étape 8 — Refactor des 4 appelants BNC

Remplacer le calcul local par `bnc_service.compute_bnc(year)` dans :
- `analytics_service.get_dashboard()`
- `analytics_service.get_year_overview()`
- `simulation_service.simulate_all()` — base BNC du simulateur
- `export_service.get_bnc_summary()` si existe

Import local dans chaque fonction pour éviter les cycles.

### Étape 9 — Ligne virtuelle dotations dans `get_dashboard`

Dans `analytics_service.get_dashboard(year)`, après la boucle d'agrégation standard :

```python
from backend.services import amortissement_service

dotations = amortissement_service.get_dotations(year)
if dotations.total_deductible > 0:
    result["categories"].append({
        "categorie": "Dotations aux amortissements",
        "total_debit": dotations.total_deductible,
        "total_credit": 0.0,
        "nb_ops": len(dotations.details),
        "is_virtual": True,
        "source": "amortissement",
    })
```

**Critique** : adapter `get_dotations(year)` pour **filtrer les lignes `is_backfill=True`**. Les lignes backfill ont `dotation_deductible=0` donc pas de contamination arithmétique, mais il faut s'assurer qu'elles ne polluent pas la `len(details)` ni ne sont comptées comme `immos contributives` de l'année antérieure.

### Étape 10 — `get_virtual_detail` + `find_dotation_operation`

**`backend/services/amortissement_service.py`** :

```python
def find_dotation_operation(year: int) -> dict | None:
    """Scanne les ops du mois 12 pour trouver l'OD dotation (Prompt B)."""
    from pathlib import Path
    import json

    ops_dir = Path("data/imports/operations")
    for path in ops_dir.glob(f"operations_*{year}12*.json"):
        data = json.loads(path.read_text())
        for idx, op in enumerate(data.get("operations", [])):
            if op.get("source") == "amortissement":
                return {"filename": path.name, "index": idx, "year": year}
    return None


def get_virtual_detail(year: int) -> AmortissementVirtualDetail:
    dotations = get_dotations(year)
    rows: list[DotationImmoRow] = []

    for detail in dotations.details:
        immo = get_immobilisation(detail.immobilisation_id)
        if not immo:
            continue
        tableau = compute_tableau(immo)
        # Ligne de l'exercice courant, hors backfill
        ligne = next(
            (l for l in tableau if l.exercice == year and not getattr(l, 'is_backfill', False)),
            None,
        )
        if not ligne:
            continue
        rows.append(DotationImmoRow(
            immobilisation_id=immo.id,
            designation=immo.designation,
            date_acquisition=immo.date_acquisition,
            mode=immo.mode,
            duree=immo.duree,
            base_amortissable=immo.base_amortissable,
            vnc_debut=ligne.vnc_debut,
            dotation_brute=ligne.dotation_brute,
            quote_part_pro=immo.quote_part_pro,
            dotation_deductible=ligne.dotation_deductible,
            vnc_fin=ligne.vnc_fin,
            statut=_compute_statut(immo, ligne, tableau),
            poste=immo.poste,
            is_reprise=immo.exercice_entree_neuronx is not None,
            exercice_entree_neuronx=immo.exercice_entree_neuronx,
        ))

    rows.sort(key=lambda r: -r.dotation_deductible)
    return AmortissementVirtualDetail(
        year=year,
        total_brute=dotations.total_brute,
        total_deductible=dotations.total_deductible,
        nb_immos_actives=len(rows),
        immos=rows,
    )


def _compute_statut(immo, ligne, tableau) -> str:
    if immo.statut == "sorti":
        return "cedee"
    if ligne.vnc_fin == 0:
        return "derniere"
    lignes_actives = [l for l in tableau if not getattr(l, 'is_backfill', False)]
    if lignes_actives and ligne == lignes_actives[-1] and len(lignes_actives) > immo.duree:
        return "complement"
    return "en_cours"
```

### Étape 11 — Endpoints

**`backend/routers/amortissements.py`** :

```python
from fastapi import Query
from backend.models.amortissement import (
    AmortissementVirtualDetail,
    BackfillComputeRequest,
    BackfillComputeResponse,
)


@router.get("/virtual-detail", response_model=AmortissementVirtualDetail)
def get_virtual_detail(year: int = Query(...)):
    return amortissement_service.get_virtual_detail(year)


@router.get("/dotation-ref/{year}")
def get_dotation_ref(year: int) -> dict | None:
    return amortissement_service.find_dotation_operation(year)


@router.post("/compute-backfill", response_model=BackfillComputeResponse)
def compute_backfill(req: BackfillComputeRequest):
    """Calcule amortissements antérieurs théoriques + VNC ouverture suggérée.
    Résultat éditable côté UI si valeurs réelles différentes."""
    return amortissement_service.compute_backfill_suggestion(req)
```

---

## Tests manuels

1. **Pas de double-comptage** : importer une op bancaire 4 500 € catégorisée `Immobilisations` + créer l'immo correspondante (5 ans). Vérifier que `charges_pro` n'inclut pas 4 500 €. Vérifier que ≈900 €/an apparaît comme dotation dans `/virtual-detail`.
2. **BNC cohérent** : sur une année avec immos et dotation > 0, vérifier que `/analytics/dashboard` et `/simulation/calculate` retournent le même `bnc`.
3. **Ligne virtuelle** : `/analytics/dashboard` retourne une catégorie `Dotations aux amortissements` avec `is_virtual: true` quand dotation > 0.
4. **Candidates strict** : importer 3 ops > 500 € dans `Matériel`, `Véhicule`, `Fournitures`. Seule celle de `Matériel` dans `/candidates`.
5. **Migration idempotente** : lancer l'app 2× → logs n'apparaissent qu'à la 1ʳᵉ.
6. **Mode dégressif legacy** : si immo dégressive existait, migrée en linéaire au boot.
7. **Champs reprise initialisés** : au boot les immos existantes ont `exercice_entree_neuronx: null` (mode standard, pas de régression).
8. **Endpoints base** : `GET /virtual-detail?year=2026` retourne la liste triée, `GET /dotation-ref/2026` retourne `null`.
9. **Reprise — calcul suggestion** : `POST /compute-backfill` avec `{date_acquisition: "2024-03-15", base_amortissable: 4500, duree: 5, exercice_entree_neuronx: 2026}` → `amortissements_anterieurs_theorique ≈ 1662.50` (pro rata 2024 + plein 2025) et `vnc_ouverture_theorique ≈ 2837.50`. Détail contient 2 lignes (2024, 2025).
10. **Reprise — création immo** : créer immo avec `exercice_entree_neuronx: 2026, amortissements_anterieurs: 1800, vnc_ouverture: 2700, base_amortissable: 4500` → validation passe (1800 + 2700 = 4500).
11. **Reprise — incohérence refusée** : même payload avec `vnc_ouverture: 2000` → 400 "Incohérence : 1800 + 2000 = 3800 ≠ 4500".
12. **Reprise — BNC 2024 vierge** : créer immo reprise avec acquisition 2024 + entrée 2026 → `/analytics/dashboard?year=2024` ne contient pas la dotation (ligne backfill non déductible). `/analytics/dashboard?year=2026` contient la première dotation NeuronX.
13. **Reprise — tableau calculé** : `compute_tableau(immo_reprise)` retourne 1 ligne récap `is_backfill=True` (exercice = year_entree - 1, dotation_deductible = 0) puis les exercices NeuronX. Somme dotations NeuronX ≈ `vnc_ouverture`.
14. **Reprise — virtual-detail** : `/virtual-detail?year=2026` inclut l'immo reprise avec `is_reprise: true`, `exercice_entree_neuronx: 2026`, `vnc_debut ≈ vnc_ouverture`.
15. **Reprise exercice = acquisition interdit** : création avec `exercice_entree_neuronx = year_acquisition` → 422 validation Pydantic.
16. **Edge case — immo déjà totalement amortie** : acquisition 2020, durée 3 ans, entrée NeuronX 2026 → ligne "Immobilisation totalement amortie avant entrée NeuronX", aucune dotation dans les exercices NeuronX.

## CLAUDE.md — à ajouter

```markdown
- **BNC centralisé** : `bnc_service.compute_bnc(year)` est la source unique.
  Appelé par `analytics_service`, `simulation_service`, `export_service`.
  Formule : recettes − charges (hors EXCLUDED_FROM_CHARGES_PRO) − dotations
  déductibles − forfaits. Imports locaux dans chaque fonction appelante pour
  éviter cycle avec analytics_service.

- **EXCLUDED_FROM_CHARGES_PRO** : set dans `analytics_service` contenant
  `Immobilisations`, `Dotations aux amortissements`, `Ventilé`. Appliqué dans
  toutes les boucles d'agrégation charges_pro. Évite double-comptage avec
  dotations calculées.

- **Ligne virtuelle dotation** : `analytics_service.get_dashboard()` injecte
  `{categorie: "Dotations aux amortissements", is_virtual: true}` quand
  `amortissement_service.get_dotations(year).total_deductible > 0`. Le
  frontend branche dessus (Prompt A2).

- **Amortissement linéaire only** : BNC régime recettes interdit le dégressif.
  `create_immobilisation` force `mode = "lineaire"`. Migration lifespan
  `_migrate_amortissement_config()` nettoie config + immos legacy + ajoute
  champs reprise (exercice_entree_neuronx, amortissements_anterieurs,
  vnc_ouverture) avec valeurs par défaut None.

- **Detect candidates strict Matériel** : `detect_candidates()` filtre
  exclusivement `Catégorie == "Matériel"`. `categories_eligibles` supprimé
  du `AmortissementConfig`. Création manuelle possible depuis n'importe
  quelle catégorie via `ImmobilisationDrawer`.

- **Reprise d'exercice antérieur (backfill)** : 3 champs optionnels sur
  `Immobilisation` pour gérer les immos acquises avant utilisation de
  NeuronXcompta :
  - `exercice_entree_neuronx: int | None` — année à partir de laquelle
    NeuronX gère l'immo (doit être > année acquisition)
  - `amortissements_anterieurs: float` — cumul dotations passées par
    l'ancien comptable (non déductible côté NeuronX)
  - `vnc_ouverture: float | None` — VNC au début de `exercice_entree_neuronx`

  Validation Pydantic : `exercice_entree_neuronx > année(date_acquisition)`,
  `vnc_ouverture >= 0`, cohérence `amortissements_anterieurs + vnc_ouverture
  == base_amortissable` (tolérance 1 €).

  Le moteur branche sur `_compute_tableau_with_backfill()` qui injecte une
  ligne récap `is_backfill=True` (exercice = year_entree - 1,
  `dotation_deductible = 0.0` donc exclue du BNC) puis calcule les exercices
  NeuronX à partir de `vnc_ouverture` avec taux quotidien sur jours restants
  (base 360, convention comptable française).

  `get_dotations(year)` filtre les lignes backfill → pas de contamination
  BNC pré-NeuronX.

  Endpoint `POST /compute-backfill` calcule `amortissements_anterieurs`
  théoriques + `vnc_ouverture` suggérée (linéaire pur), éditables côté UI
  si valeurs réelles différentes.

- **Endpoints nouveaux** :
  - `GET /api/amortissements/virtual-detail?year=X` — alimente le
    `DotationsVirtualDrawer` (Prompt A2).
  - `GET /api/amortissements/dotation-ref/{year}` — trouve l'OD dotation
    (Prompt B) ou `null`.
  - `POST /api/amortissements/compute-backfill` — calcule VNC ouverture
    suggérée pour reprise d'immo.
```

## Commits suggérés

1. `feat(backend): modèle Immobilisation enrichi (reprise exercice antérieur)`
2. `feat(backend): EXCLUDED_FROM_CHARGES_PRO + seed catégorie Dotations`
3. `feat(backend): bnc_service centralisé`
4. `refactor(backend): analytics/simulation/export utilisent bnc_service`
5. `feat(backend): ligne virtuelle dotation dans dashboard`
6. `feat(backend): detect_candidates strict Matériel + mode linéaire + migrations`
7. `feat(backend): moteur _compute_tableau_with_backfill (reprise immo)`
8. `feat(backend): endpoints virtual-detail + dotation-ref + compute-backfill`
9. `docs: CLAUDE.md — backend fiscal amortissements + reprise`
