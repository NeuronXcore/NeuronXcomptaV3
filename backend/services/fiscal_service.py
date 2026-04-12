from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import BAREMES_DIR, SEUIL_IMMOBILISATION, ensure_directories

logger = logging.getLogger(__name__)


# ─── Chargement / sauvegarde des barèmes ───


def load_bareme(type_bareme: str, year: int) -> dict:
    """Charge un barème JSON. Fallback sur l'année la plus récente si inexistant."""
    ensure_directories()
    path = BAREMES_DIR / f"{type_bareme}_{year}.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    files = sorted(BAREMES_DIR.glob(f"{type_bareme}_*.json"), reverse=True)
    if files:
        with open(files[0], "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def load_all_baremes(year: int) -> dict:
    return {
        "urssaf": load_bareme("urssaf", year),
        "carmf": load_bareme("carmf", year),
        "ir": load_bareme("ir", year),
        "odm": load_bareme("odm", year),
        "year": year,
    }


def save_bareme(type_bareme: str, year: int, data: dict) -> None:
    ensure_directories()
    path = BAREMES_DIR / f"{type_bareme}_{year}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ─── Calcul URSSAF ───


def estimate_urssaf(bnc: float, bareme: dict) -> dict:
    """Calcule les cotisations URSSAF sur un BNC donné."""
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
        alloc = 0.0
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


def compute_urssaf_deductible(
    montant_brut: float,
    bnc_estime: float,
    year: int,
    cotisations_sociales_estime: Optional[float] = None,
) -> dict:
    """
    Calcule la part déductible et non déductible d'une cotisation URSSAF brute.

    La seule part non déductible est la CSG non déductible (2,4%) + CRDS (0,5%) = 2,9%
    appliquée à l'assiette CSG/CRDS (dépend de l'année).

    Args:
        montant_brut: cotisation URSSAF totale payée (€)
        bnc_estime: BNC prévisionnel de l'année (€)
        year: année fiscale
        cotisations_sociales_estime: total cotisations sociales obligatoires estimées
            (URSSAF + CARMF + ODM). Si None, utilise bnc_estime × 0.25 comme fallback.

    Returns:
        dict avec: montant_brut, assiette_csg_crds, part_non_deductible,
                   part_deductible, ratio_non_deductible, assiette_mode, year
    """
    bareme = load_bareme("urssaf", year)
    csg = bareme.get("csg_crds", {
        "taux_non_deductible": 0.029,
        "assiette_mode": "bnc_plus_cotisations",
        "assiette_abattement": None,
    })

    taux_nd = csg.get("taux_non_deductible", 0.029)
    mode = csg.get("assiette_mode", "bnc_plus_cotisations")

    if mode == "bnc_abattu":
        abattement = csg.get("assiette_abattement", 0.26)
        assiette = bnc_estime * (1.0 - abattement)
    else:
        cotis = cotisations_sociales_estime if cotisations_sociales_estime is not None else bnc_estime * 0.25
        assiette = bnc_estime + cotis

    non_deductible = round(assiette * taux_nd, 2)
    non_deductible = min(non_deductible, montant_brut)
    deductible = round(montant_brut - non_deductible, 2)

    return {
        "year": year,
        "montant_brut": montant_brut,
        "assiette_csg_crds": round(assiette, 2),
        "assiette_mode": mode,
        "taux_non_deductible": taux_nd,
        "part_non_deductible": non_deductible,
        "part_deductible": deductible,
        "ratio_non_deductible": round(non_deductible / montant_brut, 4) if montant_brut else 0.0,
        "bnc_estime_utilise": bnc_estime,
        "cotisations_sociales_utilisees": cotisations_sociales_estime,
    }


# ─── Calcul CARMF ───


def estimate_carmf(bnc: float, bareme: dict, classe_complementaire: str = "M") -> dict:
    """Calcule les cotisations CARMF."""
    # Le PASS est dans le barème URSSAF, on le passe ou on utilise la valeur par défaut
    pass_val = 46368

    rb = bareme.get("regime_base", {})
    # Tranche 1
    plafond_t1 = pass_val * rb.get("tranche_1_plafond_pct_pass", 1.0)
    tranche_1 = min(bnc, plafond_t1) * rb.get("tranche_1_taux", 0.0881)
    # Tranche 2
    plafond_t2 = pass_val * rb.get("tranche_2_plafond_pct_pass", 5.0)
    tranche_2 = max(0, min(bnc, plafond_t2) - plafond_t1) * rb.get("tranche_2_taux", 0.0166)
    regime_base = tranche_1 + tranche_2

    # Complémentaire
    classes = bareme.get("complementaire", {}).get("classes", {})
    complementaire = classes.get(
        classe_complementaire,
        classes.get(bareme.get("complementaire", {}).get("classe_defaut", "M"), 2813),
    )

    # ASV
    asv_cfg = bareme.get("asv", {})
    forfaitaire = asv_cfg.get("part_forfaitaire", 5765)
    plafond_asv = pass_val * asv_cfg.get("part_proportionnelle_plafond_pct_pass", 5.0)
    proportionnel = min(bnc, plafond_asv) * asv_cfg.get("part_proportionnelle_taux", 0.04)
    total_asv = forfaitaire + proportionnel
    prise_en_charge = total_asv * asv_cfg.get("prise_en_charge_cpam_pct", 66.67) / 100
    asv_apres_cpam = total_asv - prise_en_charge

    # Invalidité-décès (classe A par défaut)
    invalidite = bareme.get("invalidite_deces", {}).get("classe_a", 631)

    total = regime_base + complementaire + asv_apres_cpam + invalidite

    return {
        "regime_base": round(regime_base, 2),
        "complementaire": round(complementaire, 2),
        "asv_forfaitaire": round(forfaitaire, 2),
        "asv_proportionnel": round(proportionnel, 2),
        "asv_apres_cpam": round(asv_apres_cpam, 2),
        "invalidite_deces": round(invalidite, 2),
        "total": round(total, 2),
    }


# ─── Calcul IR ───


def estimate_ir(revenu_imposable: float, bareme: dict, parts: float = 1.0) -> dict:
    """Calcule l'impôt sur le revenu avec barème progressif, quotient familial et décote."""
    if revenu_imposable <= 0:
        return {
            "revenu_par_part": 0, "ir_brut": 0, "ir_apres_quotient": 0,
            "decote": 0, "ir_net": 0, "taux_moyen": 0, "taux_marginal": 0,
            "tranche_actuelle": {"taux": 0, "seuil": 0},
            "prochaine_tranche": None,
        }

    tranches = bareme.get("tranches", [])
    revenu_par_part = revenu_imposable / parts

    # Calcul progressif
    impot_par_part = 0.0
    taux_marginal = 0.0
    tranche_actuelle_idx = 0
    for i, tr in enumerate(tranches):
        seuil = tr["seuil"]
        taux = tr["taux"]
        seuil_suivant = tranches[i + 1]["seuil"] if i + 1 < len(tranches) else float("inf")
        if revenu_par_part > seuil:
            montant_dans_tranche = min(revenu_par_part, seuil_suivant) - seuil
            impot_par_part += montant_dans_tranche * taux
            taux_marginal = taux
            tranche_actuelle_idx = i

    ir_brut = impot_par_part * parts

    # Plafonnement quotient familial (si parts > 1)
    ir_apres_quotient = ir_brut
    if parts > 1:
        # Calcul IR pour 1 part
        impot_1_part = 0.0
        for i, tr in enumerate(tranches):
            seuil = tr["seuil"]
            taux = tr["taux"]
            seuil_suivant = tranches[i + 1]["seuil"] if i + 1 < len(tranches) else float("inf")
            if revenu_imposable > seuil:
                montant = min(revenu_imposable, seuil_suivant) - seuil
                impot_1_part += montant * taux

        plafond_qf = bareme.get("plafond_quotient_familial", 1759)
        avantage_max = (parts - 1) * plafond_qf * 2
        avantage_reel = impot_1_part - ir_brut
        if avantage_reel > avantage_max:
            ir_apres_quotient = impot_1_part - avantage_max

    # Décote
    decote_cfg = bareme.get("decote", {})
    seuil_decote = decote_cfg.get("seuil_celibataire", 1929) if parts <= 1 else decote_cfg.get("seuil_couple", 3191)
    coeff_decote = decote_cfg.get("coeff", 0.4525)
    decote = 0.0
    if ir_apres_quotient > 0 and ir_apres_quotient < seuil_decote:
        decote = seuil_decote * coeff_decote - ir_apres_quotient * coeff_decote
        decote = max(0, decote)

    ir_net = max(0, ir_apres_quotient - decote)
    taux_moyen = ir_net / revenu_imposable if revenu_imposable > 0 else 0

    # Tranche actuelle et prochaine
    tranche_act = tranches[tranche_actuelle_idx] if tranches else {"taux": 0, "seuil": 0}
    prochaine_tranche = None
    if tranche_actuelle_idx + 1 < len(tranches):
        next_tr = tranches[tranche_actuelle_idx + 1]
        prochaine_tranche = {
            "taux": next_tr["taux"],
            "seuil": next_tr["seuil"],
            "label": f"Tranche à {int(next_tr['taux'] * 100)}%",
            "distance": round(next_tr["seuil"] * parts - revenu_imposable, 2),
        }

    return {
        "revenu_par_part": round(revenu_par_part, 2),
        "ir_brut": round(ir_brut, 2),
        "ir_apres_quotient": round(ir_apres_quotient, 2),
        "decote": round(decote, 2),
        "ir_net": round(ir_net, 2),
        "taux_moyen": round(taux_moyen, 4),
        "taux_marginal": taux_marginal,
        "tranche_actuelle": {"taux": tranche_act["taux"], "seuil": tranche_act["seuil"]},
        "prochaine_tranche": prochaine_tranche,
    }


# ─── Simulation multi-leviers ───


def simulate_multi(bnc_actuel: float, year: int, parts: float, leviers: dict) -> dict:
    """
    Simulation complète avec distinction PER vs Madelin.
    PER déduit de l'IR uniquement. Madelin déduit du BNC social ET imposable.
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

    # Total dépenses détaillées
    depenses_detail = leviers.get("depenses_detail") or {}
    total_depenses_detail = sum(depenses_detail.values()) if depenses_detail else 0

    # BNC social (base URSSAF/CARMF) — PER exclu
    bnc_social = max(0, bnc_actuel
        - leviers.get("madelin", 0)
        - dotations_existantes
        - dotation_invest
        - leviers.get("formation_dpc", 0)
        - leviers.get("remplacement", 0)
        - leviers.get("depense_pro", 0)
        - total_depenses_detail
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
        "urssaf_detail": urssaf_sim,
        "carmf_actuel": carmf_act["total"],
        "carmf_simule": carmf_sim["total"],
        "carmf_delta": round(carmf_sim["total"] - carmf_act["total"], 2),
        "carmf_detail": carmf_sim,
        "odm": odm,
        "ir_actuel": ir_act["ir_net"],
        "ir_simule": ir_sim["ir_net"],
        "ir_delta": round(ir_sim["ir_net"] - ir_act["ir_net"], 2),
        "ir_detail": ir_sim,
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


# ─── Taux marginal et seuils critiques ───


def calculate_taux_marginal(bnc: float, year: int, parts: float = 1.0) -> dict:
    """Calcule le taux marginal réel combiné par delta +1€."""
    baremes = load_all_baremes(year)

    urssaf_0 = estimate_urssaf(bnc, baremes["urssaf"])
    urssaf_1 = estimate_urssaf(bnc + 1, baremes["urssaf"])
    carmf_0 = estimate_carmf(bnc, baremes["carmf"])
    carmf_1 = estimate_carmf(bnc + 1, baremes["carmf"])
    ir_0 = estimate_ir(bnc, baremes["ir"], parts)
    ir_1 = estimate_ir(bnc + 1, baremes["ir"], parts)

    delta_urssaf = urssaf_1["total"] - urssaf_0["total"]
    delta_carmf = carmf_1["total"] - carmf_0["total"]
    delta_ir = ir_1["ir_net"] - ir_0["ir_net"]
    delta_csg = (urssaf_1["csg_deductible"] + urssaf_1["csg_non_deductible"] + urssaf_1["crds"]) - \
                (urssaf_0["csg_deductible"] + urssaf_0["csg_non_deductible"] + urssaf_0["crds"])

    total = delta_urssaf + delta_carmf + delta_ir

    return {
        "ir": round(delta_ir, 4),
        "urssaf": round(delta_urssaf, 4),
        "carmf": round(delta_carmf, 4),
        "csg": round(delta_csg, 4),
        "total": round(total, 4),
        "prochaine_tranche": ir_0.get("prochaine_tranche"),
    }


def find_seuils_critiques(year: int, parts: float = 1.0) -> list:
    """Identifie les seuils où le taux marginal saute."""
    baremes = load_all_baremes(year)
    pass_val = baremes["urssaf"].get("pass", 46368)
    seuils = []

    # Tranches IR
    for tr in baremes["ir"].get("tranches", [])[1:]:
        seuil = tr["seuil"] * parts
        seuils.append({
            "seuil": round(seuil, 0),
            "label": f"IR {int(tr['taux'] * 100)}%",
            "type": "ir",
        })

    # URSSAF maladie taux plein
    seuil_maladie = pass_val * baremes["urssaf"]["maladie"]["seuil_taux_plein_pct_pass"]
    seuils.append({
        "seuil": round(seuil_maladie, 0),
        "label": "Maladie taux plein (6.5%)",
        "type": "urssaf",
    })

    # Allocations familiales
    seuil_af_bas = pass_val * baremes["urssaf"]["allocations_familiales"]["seuil_bas_pct_pass"]
    seuil_af_haut = pass_val * baremes["urssaf"]["allocations_familiales"]["seuil_haut_pct_pass"]
    seuils.append({
        "seuil": round(seuil_af_bas, 0),
        "label": "Alloc. familiales (début progressif)",
        "type": "urssaf",
    })
    seuils.append({
        "seuil": round(seuil_af_haut, 0),
        "label": "Alloc. familiales (taux plein 3.1%)",
        "type": "urssaf",
    })

    # Contribution additionnelle maladie
    seuil_add = pass_val * baremes["urssaf"]["maladie"]["seuil_additionnelle_pct_pass"]
    seuils.append({
        "seuil": round(seuil_add, 0),
        "label": "Contrib. additionnelle maladie (+3.5%)",
        "type": "urssaf",
    })

    # Calculer taux avant/après pour chaque seuil
    for s in seuils:
        sv = s["seuil"]
        tm_avant = calculate_taux_marginal(sv - 1, year, parts)
        tm_apres = calculate_taux_marginal(sv + 1, year, parts)
        s["taux_avant"] = round(tm_avant["total"], 4)
        s["taux_apres"] = round(tm_apres["total"], 4)
        s["delta"] = round(tm_apres["total"] - tm_avant["total"], 4)

    seuils.sort(key=lambda x: x["seuil"])
    return seuils


# ─── Historique et prévisions ───


def get_historical_bnc(years: Optional[list] = None) -> dict:
    """Calcule le BNC historique depuis les fichiers d'opérations."""
    from backend.services import operation_service

    files = operation_service.list_operation_files()
    monthly = []
    for f in files:
        y = f.get("year")
        m = f.get("month")
        if y is None or m is None:
            continue
        if years and y not in years:
            continue
        recettes = f.get("total_credit", 0)
        depenses = f.get("total_debit", 0)
        monthly.append({
            "year": y, "month": m,
            "recettes": round(recettes, 2),
            "depenses": round(depenses, 2),
            "bnc": round(recettes - depenses, 2),
        })

    monthly.sort(key=lambda x: (x["year"], x["month"]))

    # Agréger par année
    annual_map: dict[int, dict] = {}
    for m in monthly:
        y = m["year"]
        if y not in annual_map:
            annual_map[y] = {"year": y, "recettes": 0, "depenses": 0, "bnc": 0, "nb_mois": 0}
        annual_map[y]["recettes"] += m["recettes"]
        annual_map[y]["depenses"] += m["depenses"]
        annual_map[y]["bnc"] += m["bnc"]
        annual_map[y]["nb_mois"] += 1
    annual = sorted(annual_map.values(), key=lambda x: x["year"])
    for a in annual:
        a["recettes"] = round(a["recettes"], 2)
        a["depenses"] = round(a["depenses"], 2)
        a["bnc"] = round(a["bnc"], 2)

    all_years = sorted(set(m["year"] for m in monthly))

    # Profil saisonnier
    profil = []
    if monthly:
        month_totals: dict[int, list] = {i: [] for i in range(1, 13)}
        for m in monthly:
            month_totals[m["month"]].append(m["bnc"])

        global_avg = sum(m["bnc"] for m in monthly) / len(monthly) if monthly else 1
        for mo in range(1, 13):
            vals = month_totals[mo]
            avg = sum(vals) / len(vals) if vals else 0
            coeff = avg / global_avg if global_avg != 0 else 1
            profil.append({"month": mo, "coeff": round(coeff, 3)})

    return {
        "years": all_years,
        "monthly": monthly,
        "annual": annual,
        "profil_saisonnier": profil,
    }


def forecast_bnc(horizon_mois: int = 12, methode: str = "saisonnier") -> dict:
    """Projette les revenus futurs."""
    historique = get_historical_bnc()
    monthly = historique["monthly"]
    annual = historique["annual"]
    profil = historique["profil_saisonnier"]

    nb_mois_historique = len(monthly)
    if nb_mois_historique == 0:
        return {
            "methode": methode,
            "previsions": [],
            "bnc_annuel_prevu": 0,
            "tendance_annuelle_pct": 0,
            "nb_mois_historique": 0,
            "avertissement": "Aucune donnée historique disponible",
        }

    # Moyenne mensuelle (12 derniers mois ou tout)
    recent = monthly[-12:] if len(monthly) >= 12 else monthly
    moyenne_mensuelle = sum(m["bnc"] for m in recent) / len(recent)

    # Tendance annuelle
    tendance = 0.0
    if len(annual) >= 2:
        last = annual[-1]["bnc"]
        prev = annual[-2]["bnc"]
        if prev != 0:
            tendance = (last - prev) / abs(prev)

    # Confiance
    if nb_mois_historique >= 36:
        confiance = "haute"
    elif nb_mois_historique >= 12:
        confiance = "moyenne"
    else:
        confiance = "basse"

    now = datetime.now()
    previsions = []
    total_prevu = 0

    for i in range(1, horizon_mois + 1):
        future_month = ((now.month - 1 + i) % 12) + 1
        future_year = now.year + ((now.month - 1 + i) // 12)

        if methode == "saisonnier" and profil:
            coeff = next((p["coeff"] for p in profil if p["month"] == future_month), 1.0)
            prevu = moyenne_mensuelle * coeff * (1 + tendance * i / 12)
        else:
            prevu = moyenne_mensuelle

        # Estimation recettes/dépenses proportionnelles
        ratio_recettes = sum(m["recettes"] for m in recent) / sum(m["bnc"] for m in recent) if sum(m["bnc"] for m in recent) != 0 else 2
        ratio_depenses = ratio_recettes - 1

        previsions.append({
            "year": future_year,
            "month": future_month,
            "recettes_prevues": round(prevu * ratio_recettes, 2) if ratio_recettes > 0 else round(prevu, 2),
            "depenses_prevues": round(prevu * ratio_depenses, 2) if ratio_depenses > 0 else 0,
            "bnc_prevu": round(prevu, 2),
            "confiance": confiance,
        })
        total_prevu += prevu

    avertissement = None
    if nb_mois_historique < 12:
        avertissement = f"Moins de 12 mois d'historique ({nb_mois_historique} mois) — les prévisions sont peu fiables"

    return {
        "methode": methode,
        "previsions": previsions,
        "bnc_annuel_prevu": round(total_prevu * 12 / horizon_mois, 2),
        "tendance_annuelle_pct": round(tendance * 100, 1),
        "nb_mois_historique": nb_mois_historique,
        "avertissement": avertissement,
    }
