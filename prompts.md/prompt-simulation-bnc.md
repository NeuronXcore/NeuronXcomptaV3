# Prompt Claude Code — Page Simulation BNC (`/simulation`)

## Pré-requis

**Lire `CLAUDE.md` en premier.**

Ce prompt dépend du module Amortissements (`prompt-amortissements.md`) qui doit être implémenté **avant**. Il utilise `GET /api/amortissements/dotations/{year}` pour les dotations existantes.

Ce prompt crée une page dédiée `/simulation` dans le groupe ANALYSE de la sidebar.

---

## ÉTAPE 1 — Barèmes JSON (`data/baremes/`)

Créer le dossier `data/baremes/` et les fichiers versionnés.

Ajouter dans `backend/core/config.py` :

```python
BAREMES_DIR = DATA_DIR / "baremes"
# Dans ensure_directories() :
BAREMES_DIR.mkdir(parents=True, exist_ok=True)
```

### `data/baremes/urssaf_2024.json`

```json
{
  "year": 2024,
  "pass": 46368,
  "maladie": {
    "taux_reduit": 0.0,
    "taux_plein": 0.065,
    "seuil_taux_plein_pct_pass": 0.4,
    "contribution_additionnelle": 0.035,
    "seuil_additionnelle_pct_pass": 5.0
  },
  "allocations_familiales": {
    "taux_reduit": 0.0,
    "taux_plein": 0.031,
    "seuil_bas_pct_pass": 1.1,
    "seuil_haut_pct_pass": 1.4
  },
  "csg_crds": {
    "taux_csg_deductible": 0.068,
    "taux_csg_non_deductible": 0.024,
    "taux_crds": 0.005,
    "abattement_pct": 0.0
  },
  "indemnites_journalieres": {
    "taux": 0.003,
    "plafond_pct_pass": 3.0
  },
  "curps": {
    "taux": 0.001,
    "plafond_pct_pass": 5.0
  }
}
```

### `data/baremes/carmf_2024.json`

```json
{
  "year": 2024,
  "regime_base": {
    "tranche_1_taux": 0.0881,
    "tranche_1_plafond_pct_pass": 1.0,
    "tranche_2_taux": 0.0166,
    "tranche_2_plafond_pct_pass": 5.0
  },
  "complementaire": {
    "classes": {
      "M": 2813,
      "1": 3750,
      "2": 5625,
      "3": 7500,
      "4": 9375,
      "5": 11250,
      "6": 13125,
      "7": 15000,
      "8": 16875,
      "9": 18750,
      "10": 20625
    },
    "classe_defaut": "M"
  },
  "asv": {
    "part_forfaitaire": 5765,
    "part_proportionnelle_taux": 0.04,
    "part_proportionnelle_plafond_pct_pass": 5.0,
    "prise_en_charge_cpam_pct": 66.67
  },
  "invalidite_deces": {
    "classe_a": 631,
    "classe_b": 710,
    "classe_c": 853
  }
}
```

### `data/baremes/ir_2024.json`

```json
{
  "year": 2024,
  "tranches": [
    { "seuil": 0, "taux": 0.0 },
    { "seuil": 11294, "taux": 0.11 },
    { "seuil": 28797, "taux": 0.30 },
    { "seuil": 82341, "taux": 0.41 },
    { "seuil": 177106, "taux": 0.45 }
  ],
  "decote": {
    "seuil_celibataire": 1929,
    "seuil_couple": 3191,
    "coeff": 0.4525
  },
  "plafond_quotient_familial": 1759,
  "per": {
    "plafond_pct_bnc": 0.10,
    "plafond_absolu": 35194,
    "plancher": 4399
  },
  "madelin": {
    "prevoyance_pct_bnc": 0.07,
    "prevoyance_plafond_pct_pass": 0.03,
    "retraite_pct_bnc": 0.10,
    "retraite_plafond_pct_pass": 0.08,
    "mutuelle_pct_bnc": 0.0375,
    "mutuelle_plafond_pct_pass": 0.02
  }
}
```

### `data/baremes/odm_2024.json`

```json
{
  "year": 2024,
  "cotisation_annuelle": 780,
  "type": "fixe"
}
```

---

## ÉTAPE 2 — Modèles Pydantic (`backend/models/simulation.py`)

Créer `backend/models/simulation.py` :

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional

class SimulationLeviers(BaseModel):
    madelin: float = 0
    per: float = 0
    carmf_classe: str = "M"
    investissement: float = 0
    investissement_duree: int = 5
    investissement_prorata_mois: int = 6
    formation_dpc: float = 0
    depense_pro: float = 0

class SimulationRequest(BaseModel):
    bnc_actuel: float
    year: int
    parts: float = 1.0
    leviers: SimulationLeviers
```

---

## ÉTAPE 3 — Service fiscal (`backend/services/fiscal_service.py`)

Créer `backend/services/fiscal_service.py`.

```python
from __future__ import annotations
import json
from pathlib import Path
from typing import Optional
from backend.core.config import BAREMES_DIR, SEUIL_IMMOBILISATION
```

### 3.1 — Chargement des barèmes

```python
def load_bareme(type_bareme: str, year: int) -> dict:
    """Charge un barème JSON. Fallback sur l'année la plus récente si inexistant."""
    path = BAREMES_DIR / f"{type_bareme}_{year}.json"
    if path.exists():
        with open(path, "r") as f:
            return json.load(f)
    files = sorted(BAREMES_DIR.glob(f"{type_bareme}_*.json"), reverse=True)
    if files:
        with open(files[0], "r") as f:
            return json.load(f)
    return {}

def load_all_baremes(year: int) -> dict:
    return {
        "urssaf": load_bareme("urssaf", year),
        "carmf": load_bareme("carmf", year),
        "ir": load_bareme("ir", year),
        "odm": load_bareme("odm", year),
        "year": year
    }

def save_bareme(type_bareme: str, year: int, data: dict) -> None:
    path = BAREMES_DIR / f"{type_bareme}_{year}.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
```

### 3.2 — Calcul URSSAF

```python
def estimate_urssaf(bnc: float, bareme: dict) -> dict:
    """
    Calcule les cotisations URSSAF sur un BNC donné.
    
    Retourne {
        maladie, allocations_familiales, csg_deductible,
        csg_non_deductible, crds, ij, curps,
        total, total_deductible
    }
    
    Logique :
    - PASS = bareme["pass"]
    - Maladie : si BNC < PASS × seuil_taux_plein_pct_pass → taux_reduit (0%)
      sinon → BNC × taux_plein (6.5%)
      si BNC > PASS × seuil_additionnelle_pct_pass → ajouter (BNC - seuil) × 3.5%
    - Allocations familiales :
      si BNC < PASS × seuil_bas_pct_pass → 0%
      si BNC > PASS × seuil_haut_pct_pass → 3.1%
      entre les deux → taux progressif linéaire de 0% à 3.1%
    - CSG/CRDS : assiette = BNC + cotisations obligatoires (maladie + alloc + ij + curps)
      csg_deductible = assiette × 6.8%
      csg_non_deductible = assiette × 2.4%
      crds = assiette × 0.5%
    - IJ : min(BNC, PASS × plafond_pct_pass) × 0.3%
    - CURPS : min(BNC, PASS × plafond_pct_pass) × 0.1%
    
    total = somme de tout
    total_deductible = maladie + alloc + csg_deductible + ij + curps
    (csg_non_deductible et crds NE réduisent PAS le BNC imposable)
    """
    p = bareme.get("pass", 46368)
    
    # Maladie
    seuil_plein = p * bareme["maladie"]["seuil_taux_plein_pct_pass"]
    if bnc < seuil_plein:
        maladie = bnc * bareme["maladie"]["taux_reduit"]
    else:
        maladie = bnc * bareme["maladie"]["taux_plein"]
    seuil_add = p * bareme["maladie"]["seuil_additionnelle_pct_pass"]
    if bnc > seuil_add:
        maladie += (bnc - seuil_add) * bareme["maladie"]["contribution_additionnelle"]
    
    # Allocations familiales
    seuil_bas = p * bareme["allocations_familiales"]["seuil_bas_pct_pass"]
    seuil_haut = p * bareme["allocations_familiales"]["seuil_haut_pct_pass"]
    taux_af = bareme["allocations_familiales"]["taux_plein"]
    if bnc <= seuil_bas:
        alloc = 0
    elif bnc >= seuil_haut:
        alloc = bnc * taux_af
    else:
        ratio = (bnc - seuil_bas) / (seuil_haut - seuil_bas)
        alloc = bnc * taux_af * ratio
    
    # IJ
    plafond_ij = p * bareme["indemnites_journalieres"]["plafond_pct_pass"]
    ij = min(bnc, plafond_ij) * bareme["indemnites_journalieres"]["taux"]
    
    # CURPS
    plafond_curps = p * bareme["curps"]["plafond_pct_pass"]
    curps = min(bnc, plafond_curps) * bareme["curps"]["taux"]
    
    # CSG/CRDS — assiette = BNC + cotisations obligatoires
    assiette_csg = bnc + maladie + alloc + ij + curps
    csg_ded = assiette_csg * bareme["csg_crds"]["taux_csg_deductible"]
    csg_non_ded = assiette_csg * bareme["csg_crds"]["taux_csg_non_deductible"]
    crds = assiette_csg * bareme["csg_crds"]["taux_crds"]
    
    total = maladie + alloc + csg_ded + csg_non_ded + crds + ij + curps
    total_deductible = maladie + alloc + csg_ded + ij + curps
    
    return {
        "maladie": round(maladie, 2),
        "allocations_familiales": round(alloc, 2),
        "csg_deductible": round(csg_ded, 2),
        "csg_non_deductible": round(csg_non_ded, 2),
        "crds": round(crds, 2),
        "ij": round(ij, 2),
        "curps": round(curps, 2),
        "total": round(total, 2),
        "total_deductible": round(total_deductible, 2),
    }
```

### 3.3 — Calcul CARMF

```python
def estimate_carmf(bnc: float, bareme: dict, classe_complementaire: str = "M") -> dict:
    """
    Retourne {
        regime_base, complementaire, asv_forfaitaire, asv_proportionnel,
        asv_apres_cpam, invalidite_deces, total
    }
    
    - Régime base :
      tranche_1 = min(BNC, PASS × 1.0) × 8.81%
      tranche_2 = max(0, min(BNC, PASS × 5.0) - PASS × 1.0) × 1.66%
      regime_base = tranche_1 + tranche_2
    
    - Complémentaire : montant fixe de la classe choisie
    
    - ASV :
      forfaitaire = bareme["asv"]["part_forfaitaire"]
      proportionnel = min(BNC, PASS × 5.0) × 4%
      total_asv = forfaitaire + proportionnel
      prise_en_charge_cpam = total_asv × 66.67%
      asv_apres_cpam = total_asv - prise_en_charge_cpam
    
    - Invalidité-décès : classe A par défaut = 631€
    
    Tout est déductible.
    """
    p = bareme.get("carmf", bareme).get("regime_base", bareme.get("regime_base", {}))
    # Adapter la lecture selon la structure du barème chargé
    pass_val = 46368  # Utiliser le PASS du barème URSSAF, ou le stocker aussi dans carmf
    
    # ... implémenter la logique complète
    # Retourner tous les champs arrondis à 2 décimales
```

### 3.4 — Calcul IR

```python
def estimate_ir(revenu_imposable: float, bareme: dict, parts: float = 1.0) -> dict:
    """
    Retourne {
        revenu_par_part, ir_brut, ir_apres_quotient,
        decote, ir_net, taux_moyen, taux_marginal,
        tranche_actuelle, prochaine_tranche
    }
    
    1. revenu_par_part = revenu_imposable / parts
    2. Appliquer le barème progressif sur revenu_par_part :
       pour chaque tranche : impot += (min(revenu, seuil_suivant) - seuil) × taux
    3. ir_brut = impot_par_part × parts
    4. Plafonnement quotient familial (si parts > 1)
    5. Décote : si ir < seuil_decote → ir = ir - (seuil × coeff - ir × coeff)
    6. ir_net = max(0, ir après décote)
    7. taux_moyen = ir_net / revenu_imposable
    8. taux_marginal = taux de la tranche actuelle
    9. Identifier tranche actuelle et distance au prochain seuil
    """
```

### 3.5 — Simulation multi-leviers

```python
def simulate_multi(bnc_actuel: float, year: int, parts: float, leviers: dict) -> dict:
    """
    ORDRE DE CALCUL CRITIQUE :
    
    1. Charger les barèmes
    2. Charger dotations existantes via amortissement_service.get_dotations_exercice(year)
    3. Calculer dotation nouvel investissement :
       si montant <= SEUIL_IMMOBILISATION → charge_immediate = montant
       si montant > SEUIL_IMMOBILISATION → dotation = montant / duree × prorata_mois / 12
    4. BNC social = bnc_actuel - madelin - dotations_existantes - dotation_invest
                    - formation_dpc - depense_pro
       ⚠ PER NON DÉDUIT DU BNC SOCIAL
    5. URSSAF = estimate_urssaf(bnc_social)
    6. CARMF = estimate_carmf(bnc_social, classe)
    7. ODM = fixe
    8. BNC imposable = bnc_social - PER
       ⚠ PER DÉDUIT ICI POUR L'IR
    9. IR = estimate_ir(bnc_imposable, parts)
    10. Calcul identique sur bnc_actuel pour le comparatif "avant"
    11. Revenu net = bnc_social - urssaf.total - carmf.total - odm - ir.ir_net
    
    Retourne la structure SimulationResult complète avec actuel/simulé/delta pour chaque organisme.
    """
    from backend.services.amortissement_service import get_dotations_exercice
    
    baremes = load_all_baremes(year)
    
    # Dotations existantes
    dotations_data = get_dotations_exercice(year)
    dotations_existantes = dotations_data.get("total_dotations_deductibles", 0)
    
    # Dotation nouvel investissement
    invest = leviers.get("investissement", 0)
    invest_duree = leviers.get("investissement_duree", 5)
    invest_prorata = leviers.get("investissement_prorata_mois", 6)
    
    if invest <= SEUIL_IMMOBILISATION:
        dotation_invest = invest
        invest_traitement = "charge_immediate"
    else:
        dotation_invest = round(invest / invest_duree * invest_prorata / 12, 2)
        invest_traitement = "immobilisation"
    
    # BNC social (base URSSAF/CARMF) — PER exclu
    bnc_social = max(0, bnc_actuel
        - leviers.get("madelin", 0)
        - dotations_existantes
        - dotation_invest
        - leviers.get("formation_dpc", 0)
        - leviers.get("depense_pro", 0)
    )
    
    # BNC imposable (base IR) — PER inclus
    bnc_imposable = max(0, bnc_social - leviers.get("per", 0))
    
    # Charges simulées
    urssaf_sim = estimate_urssaf(bnc_social, baremes["urssaf"])
    carmf_sim = estimate_carmf(bnc_social, baremes["carmf"], leviers.get("carmf_classe", "M"))
    odm = baremes["odm"].get("cotisation_annuelle", 780)
    ir_sim = estimate_ir(bnc_imposable, baremes["ir"], parts)
    
    # Charges actuelles (sans leviers)
    urssaf_act = estimate_urssaf(bnc_actuel, baremes["urssaf"])
    carmf_act = estimate_carmf(bnc_actuel, baremes["carmf"], "M")
    ir_act = estimate_ir(bnc_actuel, baremes["ir"], parts)
    
    total_act = urssaf_act["total"] + carmf_act["total"] + odm + ir_act["ir_net"]
    total_sim = urssaf_sim["total"] + carmf_sim["total"] + odm + ir_sim["ir_net"]
    
    revenu_net_act = bnc_actuel - total_act
    revenu_net_sim = bnc_social - total_sim
    
    # Économie sur l'investissement
    eco_charges = total_act - total_sim
    cout_reel_invest = invest - eco_charges if invest > 0 else 0
    
    return {
        "bnc_actuel": bnc_actuel,
        "bnc_social": round(bnc_social, 2),
        "bnc_imposable": round(bnc_imposable, 2),
        "dotations_existantes": dotations_existantes,
        "dotation_nouvel_invest": dotation_invest,
        "investissement_traitement": invest_traitement,
        "urssaf_actuel": urssaf_act["total"],
        "urssaf_simule": urssaf_sim["total"],
        "urssaf_delta": round(urssaf_sim["total"] - urssaf_act["total"], 2),
        "carmf_actuel": carmf_act["total"],
        "carmf_simule": carmf_sim["total"],
        "carmf_delta": round(carmf_sim["total"] - carmf_act["total"], 2),
        "odm": odm,
        "ir_actuel": ir_act["ir_net"],
        "ir_simule": ir_sim["ir_net"],
        "ir_delta": round(ir_sim["ir_net"] - ir_act["ir_net"], 2),
        "total_actuel": round(total_act, 2),
        "total_simule": round(total_sim, 2),
        "total_delta": round(total_sim - total_act, 2),
        "revenu_net_actuel": round(revenu_net_act, 2),
        "revenu_net_simule": round(revenu_net_sim, 2),
        "revenu_net_delta": round(revenu_net_sim - revenu_net_act, 2),
        "invest_montant": invest,
        "invest_deduction_an1": dotation_invest,
        "invest_cout_reel_an1": round(max(0, cout_reel_invest), 2),
    }
```

### 3.6 — Taux marginal et seuils critiques

```python
def calculate_taux_marginal(bnc: float, year: int, parts: float = 1.0) -> dict:
    """
    Calcule le taux marginal RÉEL combiné.
    
    Pour un euro supplémentaire de BNC :
    - Calcule estimate_urssaf(bnc) et estimate_urssaf(bnc + 1)
    - Calcule estimate_carmf(bnc) et estimate_carmf(bnc + 1)
    - Calcule estimate_ir(bnc) et estimate_ir(bnc + 1)
    - Delta de chaque = taux marginal de cet organisme
    
    Retourne {
        ir, urssaf, carmf, csg, total,
        prochaine_tranche: { taux, seuil, label, distance }
    }
    """

def find_seuils_critiques(year: int, parts: float = 1.0) -> list:
    """
    Identifie les seuils où le taux marginal saute.
    
    Seuils à détecter :
    - Tranches IR : 11 294€ (11%), 28 797€ (30%), 82 341€ (41%), 177 106€ (45%)
    - Maladie URSSAF : 40% PASS (passage taux plein)
    - Alloc. familiales : 110% PASS (début progressif), 140% PASS (taux plein)
    - Contribution additionnelle : 5× PASS
    
    Pour chaque seuil, calculer le taux marginal total juste avant et juste après.
    
    Retourne liste triée par montant :
    [{ seuil, label, type, taux_avant, taux_apres, delta }]
    """
```

### 3.7 — Historique et prévisions

```python
def get_historical_bnc(years: Optional[list] = None) -> dict:
    """
    Calcule le BNC historique depuis les fichiers d'opérations.
    
    Pour chaque fichier d'opérations (via operation_service.list_files()) :
    - Identifier year/month du fichier
    - recettes = somme des credits
    - depenses = somme des debits (exclure catégorie "Immobilisations")
    - bnc = recettes - depenses
    
    Profil saisonnier :
    - Pour chaque mois 1-12, calculer le coefficient = moyenne du mois / moyenne globale
    - Ex: si janvier moyen = 10 000€ et moyenne globale = 12 000€ → coeff = 0.833
    
    Retourne {
        years, monthly: [{year, month, recettes, depenses, bnc}],
        annual: [{year, recettes, depenses, bnc, nb_mois}],
        profil_saisonnier: [{month, coeff}]
    }
    """
    from backend.services import operation_service
    # Charger tous les fichiers, agréger par mois
    # ... implémenter

def forecast_bnc(horizon_mois: int = 12, methode: str = "saisonnier") -> dict:
    """
    Projette les revenus futurs.
    
    Méthode "saisonnier" :
    1. Charger historique
    2. Calculer moyenne mensuelle glissante (12 derniers mois complets)
    3. Calculer tendance = (bnc_annee_N - bnc_annee_N-1) / bnc_annee_N-1
    4. Pour chaque mois futur :
       prevu = moyenne_mensuelle × coeff_saisonnier × (1 + tendance × mois/12)
    5. Confiance = "haute" si 36+ mois historique, "moyenne" si 12-36, "basse" si < 12
    
    Méthode "simple" :
    1. Moyenne mensuelle des 12 derniers mois × horizon
    
    Retourne {
        methode, previsions: [{year, month, recettes_prevues, depenses_prevues, bnc_prevu, confiance}],
        bnc_annuel_prevu, tendance_annuelle_pct, nb_mois_historique, avertissement
    }
    """
```

---

## ÉTAPE 4 — Router (`backend/routers/simulation.py`)

Créer `backend/routers/simulation.py` avec prefix `/api/simulation`.

```python
from __future__ import annotations
from fastapi import APIRouter, Query
from typing import Optional
from backend.models.simulation import SimulationRequest
from backend.services import fiscal_service

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

@router.get("/baremes")
async def get_baremes(year: int = Query(2024)):
    return fiscal_service.load_all_baremes(year)

@router.get("/baremes/{type_bareme}")
async def get_bareme(type_bareme: str, year: int = Query(2024)):
    return fiscal_service.load_bareme(type_bareme, year)

@router.put("/baremes/{type_bareme}")
async def update_bareme(type_bareme: str, data: dict, year: int = Query(2024)):
    fiscal_service.save_bareme(type_bareme, year, data)
    return {"status": "saved"}

@router.post("/calculate")
async def calculate(req: SimulationRequest):
    return fiscal_service.simulate_multi(
        req.bnc_actuel, req.year, req.parts, req.leviers.dict()
    )

@router.get("/taux-marginal")
async def taux_marginal(bnc: float, year: int = 2024, parts: float = 1.0):
    return fiscal_service.calculate_taux_marginal(bnc, year, parts)

@router.get("/seuils")
async def seuils(year: int = 2024, parts: float = 1.0):
    return fiscal_service.find_seuils_critiques(year, parts)

@router.get("/historique")
async def historique(years: Optional[str] = None):
    year_list = [int(y) for y in years.split(",")] if years else None
    return fiscal_service.get_historical_bnc(year_list)

@router.get("/previsions")
async def previsions(horizon: int = 12, methode: str = "saisonnier"):
    return fiscal_service.forecast_bnc(horizon, methode)
```

Dans `backend/main.py` :
```python
from backend.routers import simulation
app.include_router(simulation.router)
```

---

## ÉTAPE 5 — Types TypeScript (`frontend/src/types/index.ts`)

Ajouter à la fin :

```typescript
// ============================================================
// Simulation BNC
// ============================================================

export interface SimulationLeviers {
  madelin: number
  per: number
  carmf_classe: string
  investissement: number
  investissement_duree: number
  investissement_prorata_mois: number
  formation_dpc: number
  depense_pro: number
}

export interface SimulationResult {
  bnc_actuel: number
  bnc_social: number
  bnc_imposable: number
  dotations_existantes: number
  dotation_nouvel_invest: number
  investissement_traitement: 'charge_immediate' | 'immobilisation'
  urssaf_actuel: number; urssaf_simule: number; urssaf_delta: number
  carmf_actuel: number; carmf_simule: number; carmf_delta: number
  odm: number
  ir_actuel: number; ir_simule: number; ir_delta: number
  total_actuel: number; total_simule: number; total_delta: number
  revenu_net_actuel: number; revenu_net_simule: number; revenu_net_delta: number
  invest_montant: number
  invest_deduction_an1: number
  invest_cout_reel_an1: number
}

export interface TauxMarginal {
  ir: number; urssaf: number; carmf: number; csg: number; total: number
  prochaine_tranche: {
    taux: number; seuil: number; label: string; distance: number
  } | null
}

export interface SeuilCritique {
  seuil: number; label: string; type: 'ir' | 'urssaf' | 'carmf'
  taux_avant: number; taux_apres: number; delta: number
}

export interface HistoriqueBNC {
  years: number[]
  monthly: Array<{ year: number; month: number; recettes: number; depenses: number; bnc: number }>
  annual: Array<{ year: number; recettes: number; depenses: number; bnc: number; nb_mois: number }>
  profil_saisonnier: Array<{ month: number; coeff: number }>
}

export interface PrevisionBNC {
  methode: string
  previsions: Array<{
    year: number; month: number; recettes_prevues: number
    depenses_prevues: number; bnc_prevu: number
    confiance: 'haute' | 'moyenne' | 'basse'
  }>
  bnc_annuel_prevu: number
  tendance_annuelle_pct: number
  nb_mois_historique: number
  avertissement: string | null
}

export interface AllBaremes {
  urssaf: any  // URSSAFBareme (structure du JSON)
  carmf: any   // CARMFBareme
  ir: any      // IRBareme
  odm: { year: number; cotisation_annuelle: number; type: string }
  year: number
}
```

---

## ÉTAPE 6 — Moteur fiscal TypeScript (`frontend/src/lib/fiscal-engine.ts`)

Créer ce fichier. Il **duplique exactement** la logique Python de l'étape 3 pour le calcul temps réel côté client.

### Fonctions à implémenter

```typescript
export function estimateURSSAF(bnc: number, bareme: any): {
  maladie: number; allocations_familiales: number
  csg_deductible: number; csg_non_deductible: number; crds: number
  ij: number; curps: number; total: number; total_deductible: number
}
// Même logique que Python 3.2 — copier les formules

export function estimateCARMF(bnc: number, bareme: any, classe: string): {
  regime_base: number; complementaire: number
  asv_apres_cpam: number; invalidite_deces: number; total: number
}
// Même logique que Python 3.3

export function estimateIR(revenuImposable: number, bareme: any, parts: number): {
  ir_net: number; taux_moyen: number; taux_marginal: number
  tranche_actuelle: { taux: number; seuil: number }
  prochaine_tranche: { taux: number; seuil: number; distance: number } | null
}
// Même logique que Python 3.4

export function calculateTauxMarginalReel(
  bnc: number, baremes: AllBaremes, parts: number
): { ir: number; urssaf: number; carmf: number; total: number }
// Calcul par delta : f(bnc+1) - f(bnc) pour chaque organisme

export function getMadelinPlafonds(bnc: number, bareme: any, pass_val: number): {
  prevoyance: number; retraite: number; mutuelle: number; total: number
}

export function getPERPlafond(bnc: number, bareme: any): number
```

### Fonction centrale `simulateAll`

```typescript
export function simulateAll(
  bncActuel: number,
  leviers: SimulationLeviers,
  baremes: AllBaremes,
  parts: number,
  dotationsExistantes: number,
  seuil: number = 500
): SimulationResult {
  // 1. Dotation nouvel investissement
  let dotation_invest: number
  let traitement: 'charge_immediate' | 'immobilisation'
  if (leviers.investissement <= seuil) {
    dotation_invest = leviers.investissement
    traitement = 'charge_immediate'
  } else {
    dotation_invest = Math.round(
      leviers.investissement / leviers.investissement_duree
      * leviers.investissement_prorata_mois / 12 * 100
    ) / 100
    traitement = 'immobilisation'
  }

  // 2. BNC social — PER EXCLU
  const bnc_social = Math.max(0, bncActuel
    - leviers.madelin
    - dotationsExistantes
    - dotation_invest
    - leviers.formation_dpc
    - leviers.depense_pro
  )

  // 3. BNC imposable — PER INCLUS
  const bnc_imposable = Math.max(0, bnc_social - leviers.per)

  // 4. Calcul charges simulées
  const urssaf_sim = estimateURSSAF(bnc_social, baremes.urssaf)
  const carmf_sim = estimateCARMF(bnc_social, baremes.carmf, leviers.carmf_classe)
  const odm = baremes.odm.cotisation_annuelle
  const ir_sim = estimateIR(bnc_imposable, baremes.ir, parts)

  // 5. Calcul charges actuelles
  const urssaf_act = estimateURSSAF(bncActuel, baremes.urssaf)
  const carmf_act = estimateCARMF(bncActuel, baremes.carmf, 'M')
  const ir_act = estimateIR(bncActuel, baremes.ir, parts)

  // 6. Totaux
  const total_act = urssaf_act.total + carmf_act.total + odm + ir_act.ir_net
  const total_sim = urssaf_sim.total + carmf_sim.total + odm + ir_sim.ir_net

  // ... assembler et retourner SimulationResult
  // Arrondir TOUS les montants à 2 décimales
}
```

**Tous les montants doivent être arrondis** via `Math.round(x * 100) / 100`.

---

## ÉTAPE 7 — Hook (`frontend/src/hooks/useSimulation.ts`)

```typescript
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../api/client'

export function useBaremes(year: number) {
  return useQuery({
    queryKey: ['baremes', year],
    queryFn: () => api.get(`/simulation/baremes?year=${year}`),
    staleTime: 5 * 60 * 1000,  // 5 min — les barèmes changent rarement
  })
}

export function useTauxMarginal(bnc: number, year: number, parts: number = 1) {
  return useQuery({
    queryKey: ['taux-marginal', bnc, year, parts],
    queryFn: () => api.get(`/simulation/taux-marginal?bnc=${bnc}&year=${year}&parts=${parts}`),
    enabled: bnc > 0,
  })
}

export function useSeuilsCritiques(year: number, parts: number = 1) {
  return useQuery({
    queryKey: ['seuils-critiques', year, parts],
    queryFn: () => api.get(`/simulation/seuils?year=${year}&parts=${parts}`),
  })
}

export function useHistoriqueBNC(years?: number[]) {
  const params = years ? `?years=${years.join(',')}` : ''
  return useQuery({
    queryKey: ['historique-bnc', years],
    queryFn: () => api.get(`/simulation/historique${params}`),
  })
}

export function usePrevisionsBNC(horizon: number = 12, methode: string = 'saisonnier') {
  return useQuery({
    queryKey: ['previsions-bnc', horizon, methode],
    queryFn: () => api.get(`/simulation/previsions?horizon=${horizon}&methode=${methode}`),
  })
}

export function useSimulateServer() {
  return useMutation({
    mutationFn: (data: any) => api.post('/simulation/calculate', data),
  })
}

export function useSaveBareme() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ type, year, data }: { type: string; year: number; data: any }) =>
      api.put(`/simulation/baremes/${type}?year=${year}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baremes'] })
    },
  })
}
```

---

## ÉTAPE 8 — Composants frontend

### 8.1 — Page principale (`frontend/src/components/simulation/SimulationPage.tsx`)

Structure :

```tsx
<PageHeader
  title="Simulation BNC"
  description={`Exercice ${year} — Optimisation fiscale et prévisions d'honoraires`}
  actions={
    <>
      <select value={year} onChange={...}>
        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </>
  }
/>

{/* 2 onglets */}
<div className="tabs">
  <button className={activeTab === 'optimisation' ? 'active' : ''}>Optimisation</button>
  <button className={activeTab === 'previsions' ? 'active' : ''}>Prévisions</button>
</div>

{activeTab === 'optimisation' && <SimulationOptimisationSection year={year} />}
{activeTab === 'previsions' && <SimulationPrevisionsSection year={year} />}
```

### 8.2 — Section Optimisation (`SimulationOptimisationSection.tsx`)

C'est le composant le plus complexe. Voici la logique état :

```tsx
// État local des leviers
const [leviers, setLeviers] = useState<SimulationLeviers>({
  madelin: 0, per: 0, carmf_classe: 'M',
  investissement: 0, investissement_duree: 5,
  investissement_prorata_mois: 6,
  formation_dpc: 0, depense_pro: 0,
})

// Données chargées
const { data: baremes } = useBaremes(year)
const { data: dotations } = useDotationsExercice(year)  // hook amortissements
const { data: dashboard } = useDashboard()  // pour BNC actuel estimé

// BNC actuel = recettes - dépenses de l'exercice
const bncActuel = useMemo(() => {
  if (!dashboard) return 0
  return dashboard.total_credit - dashboard.total_debit
}, [dashboard])

// Dotations existantes
const dotationsExistantes = dotations?.total_dotations_deductibles ?? 0

// Calcul temps réel — se recalcule à chaque mouvement de slider
const result = useMemo(() => {
  if (!baremes || bncActuel <= 0) return null
  return simulateAll(bncActuel, leviers, baremes, 1, dotationsExistantes)
}, [bncActuel, leviers, baremes, dotationsExistantes])

// Taux marginal
const tauxMarginal = useMemo(() => {
  if (!baremes || !result) return null
  return calculateTauxMarginalReel(result.bnc_social, baremes, 1)
}, [baremes, result])

// Plafonds dynamiques
const madelinPlafonds = useMemo(() => {
  if (!baremes || !result) return null
  return getMadelinPlafonds(result.bnc_social, baremes.ir, baremes.urssaf.pass)
}, [baremes, result])

const perPlafond = useMemo(() => {
  if (!baremes || !result) return null
  return getPERPlafond(result.bnc_social, baremes.ir)
}, [baremes, result])
```

**Layout : 2 colonnes (`grid grid-cols-2 gap-6`)**

**Colonne gauche — Panel "Leviers de déduction"** :

1. **Bloc gris "Dotations existantes (registre)"** — non modifiable
   - Afficher `dotationsExistantes` en vert bold
   - Tags/pills pour chaque immobilisation (depuis `dotations.detail`)
   - Note : "Calculé automatiquement depuis le registre des immobilisations"

2. **Slider "Nouvel investissement matériel"** — range 0-50000 step 500
   - Afficher la valeur formatée en monnaie
   - Sous-bloc conditionnel `immo-detail` :
     - Montant, Traitement (charge_immediate/immobilisation), Durée estimée, Dotation an 1, Déduction BNC
     - Warning ambré si immobilisation : "Vous investissez X € mais seuls Y € sont déductibles cette année"
   - Recalcul à chaque changement via le `simulateAll` dans le `useMemo`

3. **Séparateur** `<div className="border-t border-border my-4" />`

4. **Slider "Madelin"** — range 0 → `madelinPlafonds.total`
   - Note : "Plafond Madelin disponible : {plafond} €"

5. **Slider "PER"** — range 0 → `perPlafond`
   - Note **warning ambrée** : "Réduit l'IR uniquement — pas les cotisations sociales (URSSAF/CARMF inchangés)"

6. **Select "Classe CARMF complémentaire"** — options M, 1-10 avec montants
   - Note : "Monter de classe augmente les droits retraite"

7. **Slider "Formation DPC"** — range 0-5000 step 100
8. **Slider "Autre dépense professionnelle"** — range 0-20000 step 500

**Colonne droite — Panel "Impact sur les charges"** :

1. **Lignes de charges** : pour chaque organisme (URSSAF, CARMF, ODM, IR) :
   ```tsx
   <div className="flex justify-between items-center py-2 border-b border-border">
     <div className="flex items-center gap-2">
       <span className="w-2 h-2 rounded-full" style={{background: color}} />
       <span>{label}</span>
     </div>
     <div className="flex items-center gap-3">
       <span className="line-through text-text-muted text-sm font-mono">{formatCurrency(actuel)}</span>
       <span className="font-mono font-medium">{formatCurrency(simule)}</span>
       {delta !== 0 && (
         <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-600">
           {formatCurrency(delta)}
         </span>
       )}
     </div>
   </div>
   ```

2. **Total** avec bordure double et badge économie total

3. **Séparateur**

4. **Taux marginal réel** :
   - Valeur en gros (ex: "52.1%")
   - Barre segmentée colorée (div avec widths proportionnelles)
   - Légende (IR / URSSAF / CARMF / CSG)
   - Note prochain seuil

5. **Bloc "Charge immédiate vs Immobilisation"** (conditionnel : visible si `leviers.investissement > 0`)
   - Grid 3 colonnes : charge immédiate | "vs" | immobilisation
   - Montant déductible an 1, économie charges estimée, coût réel
   - Tip explicatif

**Au-dessus des 2 colonnes — BNC Hero** (3 MetricCard en grid-cols-3) :
- BNC actuel (neutre)
- BNC simulé (vert + delta)
- Revenu net réel (vert + delta vs actuel)

**En dessous des 2 colonnes — Graphique projection** :
- `BarChart` Recharts stacked (dotations existantes + nouvel investissement) sur 5 ans
- Utiliser `useProjections()` du hook amortissements
- Légende custom

**En bas — Disclaimer** :
- `div` background warning, `AlertTriangle` icon, texte disclaimer

### 8.3 — Section Prévisions (`SimulationPrevisionsSection.tsx`)

Utilise `useHistoriqueBNC()` et `usePrevisionsBNC()`.

1. **4 MetricCard** :
   - BNC estimé {year en cours}
   - BNC projeté {year+1}
   - Tendance annuelle (% avec TrendingUp/TrendingDown icon)
   - Confiance (badge haute=vert / moyenne=ambré / basse=rouge)

2. **Graphique principal** : `ComposedChart` Recharts
   - Axe X : mois (format "Jan 24", "Fév 24"...)
   - `Line` BNC réel (trait plein, couleur primary)
   - `Line` BNC projeté (trait pointillé, couleur primary/50%)
   - `Area` zone de confiance (fill léger)
   - Séparer visuellement passé / futur avec une ligne verticale `ReferenceLine`

3. **Profil saisonnier** : petit `BarChart` horizontal 12 barres (1 par mois)
   - Coefficients saisonniers (ex: juillet = 0.60, septembre = 1.15)
   - Couleur rouge si < 0.8, vert si > 1.1, neutre sinon

4. **Tableau historique annuel** :
   - Colonnes : Année | Recettes | Dépenses | BNC | Évolution
   - Évolution = delta % vs année précédente, badge vert/rouge

5. **Warning si données insuffisantes** : si `nb_mois_historique < 12`, afficher un encadré ambré "Moins de 12 mois d'historique — les prévisions sont peu fiables"

---

## ÉTAPE 9 — Routing & Sidebar

### App.tsx

```tsx
import SimulationPage from './components/simulation/SimulationPage'

// Ajouter la route :
<Route path="/simulation" element={<SimulationPage />} />
```

### Sidebar.tsx

Dans `NAV_SECTIONS`, ajouter dans le groupe **ANALYSE** :

```tsx
{
  path: '/simulation',
  label: 'Simulation BNC',
  icon: Calculator,  // import { Calculator } from 'lucide-react'
}
```

Ordre dans ANALYSE : Tableau de bord, Compta Analytique, Rapports, **Simulation BNC**.

---

## ÉTAPE 10 — Mise à jour CLAUDE.md

Ajouter dans Architecture :
```
- **Simulation BNC**: Moteur fiscal complet (URSSAF, CARMF, ODM, IR) avec barèmes JSON versionnés dans `data/baremes/`. 
  Calcul temps réel côté client via `fiscal-engine.ts` (duplique la logique Python). 
  Distinction critique PER (IR seul) vs Madelin (BNC + social). Prévisions d'honoraires par analyse saisonnière.
```

Ajouter dans Project Structure :
```
├── data/
│   ├── baremes/
│   │   ├── urssaf_2024.json
│   │   ├── carmf_2024.json
│   │   ├── ir_2024.json
│   │   └── odm_2024.json
```

Ajouter dans Frontend Routes :
```
| `/simulation` | SimulationPage | Simulateur BNC (leviers Madelin/PER/CARMF/investissement, taux marginal, charge vs immobilisation) + prévisions d'honoraires (historique, saisonnalité, projections) |
```

Ajouter dans Backend API Endpoints :
```
| simulation | `/api/simulation` | GET /baremes, PUT /baremes/{type}, POST /calculate, GET /taux-marginal, GET /seuils, GET /historique, GET /previsions |
```

Ajouter dans Sidebar Navigation — mettre à jour le groupe ANALYSE :
```
| **ANALYSE** | Tableau de bord, Compta Analytique, Rapports, Simulation BNC |
```

Ajouter dans Patterns to Follow :
```
- **Fiscal engine dual**: Moteur fiscal dupliqué Python (`fiscal_service.py`) et TypeScript (`fiscal-engine.ts`). Résultats identiques à l'arrondi près. Barèmes chargés une seule fois via `useBaremes()`, calcul côté client pour la réactivité des sliders.
- **PER vs Madelin**: PER déduit du revenu imposable (IR) UNIQUEMENT. Madelin déduit du BNC social ET imposable. Cette distinction est critique dans `simulateAll()`.
- **Barèmes versionnés**: Fichiers JSON dans `data/baremes/{type}_{year}.json`. Fallback sur l'année la plus récente. Modifiables via `PUT /api/simulation/baremes/{type}`.
```

Ajouter dans Key Components :
```
- `SimulationOptimisationSection` — leviers interactifs (sliders), calcul temps réel, impact charges, taux marginal, comparatif charge/immobilisation
- `SimulationPrevisionsSection` — historique BNC, projections saisonnières, profil mensuel, tableau annuel
```

---

## Vérification

- [ ] `data/baremes/` contient les 4 fichiers JSON (urssaf, carmf, ir, odm)
- [ ] `GET /api/simulation/baremes?year=2024` retourne les 4 barèmes
- [ ] `POST /api/simulation/calculate` avec un BNC de 125 000€ et leviers à 0 retourne des charges cohérentes
- [ ] URSSAF total pour BNC 125 000€ ≈ 25 000-30 000€ (vérifier ordre de grandeur)
- [ ] CARMF total pour BNC 125 000€ ≈ 15 000-20 000€
- [ ] IR pour BNC 125 000€ (1 part) ≈ 20 000-25 000€
- [ ] Le PER réduit l'IR mais PAS l'URSSAF ni la CARMF (vérifier en comparant 2 simulations)
- [ ] Le Madelin réduit l'URSSAF ET la CARMF ET l'IR
- [ ] Un investissement de 6 000€ sur 5 ans pro rata 6 mois = dotation ~600€ (pas 6 000€)
- [ ] Un investissement de 400€ = charge immédiate 400€
- [ ] `GET /api/simulation/taux-marginal` retourne un total entre 40% et 65% pour un BNC typique
- [ ] `GET /api/simulation/seuils` retourne au moins les seuils IR + les seuils URSSAF principaux
- [ ] `GET /api/simulation/historique` retourne les données mensuelles depuis les fichiers d'opérations
- [ ] `GET /api/simulation/previsions` retourne des projections avec confiance
- [ ] Le moteur TypeScript `simulateAll()` produit les mêmes résultats que `POST /calculate`
- [ ] Les sliders recalculent en temps réel sans appel API (vérifier dans le navigateur : pas de requêtes réseau au mouvement)
- [ ] Les plafonds Madelin et PER se mettent à jour quand le BNC simulé change
- [ ] La page `/simulation` affiche 2 onglets (Optimisation, Prévisions)
- [ ] La sidebar affiche "Simulation BNC" dans le groupe ANALYSE avec l'icône Calculator
- [ ] `cd frontend && npx tsc --noEmit` passe sans erreur
- [ ] CLAUDE.md est à jour

---

## Ordre d'implémentation

1. Barèmes JSON dans `data/baremes/`
2. Config (`config.py` — `BAREMES_DIR`)
3. Modèles Pydantic (`models/simulation.py`)
4. Service fiscal complet (`services/fiscal_service.py`)
5. Router (`routers/simulation.py`) + registration `main.py`
6. Types TypeScript (`types/index.ts`)
7. Moteur fiscal TS (`lib/fiscal-engine.ts`)
8. Hook (`hooks/useSimulation.ts`)
9. Composants : `SimulationPage`, `SimulationOptimisationSection`, `SimulationPrevisionsSection`
10. Route (`App.tsx`) + sidebar (`Sidebar.tsx`)
11. CLAUDE.md

---

## Notes importantes

- Les **barèmes sont approximatifs** et doivent être vérifiables/corrigeables par l'utilisateur via `PUT /baremes/{type}`.
- Le **PASS** (Plafond Annuel de la Sécurité Sociale) est stocké dans le barème URSSAF. Il est référencé par les calculs CARMF aussi — le passer en paramètre aux fonctions CARMF.
- La **CSG/CRDS** a une assiette = BNC + cotisations obligatoires. C'est un calcul circulaire en théorie (les cotisations dépendent du BNC, et la CSG dépend des cotisations). En pratique, on utilise une approximation en une passe (calculer cotisations hors CSG, puis CSG sur BNC + cotisations). C'est suffisamment précis pour une simulation.
- Les cotisations URSSAF/CARMF sont en réalité calculées sur le **BNC N-2** avec régularisation sur N. Le simulateur simplifie en calculant sur le BNC courant — mentionner cette approximation dans le disclaimer.
- Le `fiscal-engine.ts` doit produire des résultats **identiques** au Python. Écrire un test de non-régression : appeler `POST /calculate` et comparer avec `simulateAll()` pour le même input.
