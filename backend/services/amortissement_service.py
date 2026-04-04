"""
Service des dotations aux amortissements.
Registre des immobilisations, moteur de calcul, détection candidates.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from backend.core.config import (
    AMORTISSEMENTS_DIR, SEUIL_IMMOBILISATION,
    CATEGORIES_IMMOBILISABLES, SOUS_CATEGORIES_EXCLUES_IMMO,
    DUREES_AMORTISSEMENT_DEFAUT, PLAFONDS_VEHICULE,
    COEFFICIENTS_DEGRESSIF, ensure_directories,
)

logger = logging.getLogger(__name__)

IMMOBILISATIONS_FILE = AMORTISSEMENTS_DIR / "immobilisations.json"
CONFIG_FILE = AMORTISSEMENTS_DIR / "config.json"


# ─── Persistence ───

def _load_immobilisations() -> list[dict]:
    ensure_directories()
    if IMMOBILISATIONS_FILE.exists():
        try:
            with open(IMMOBILISATIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Erreur chargement immobilisations: {e}")
    return []


def _save_immobilisations(data: list[dict]) -> None:
    ensure_directories()
    with open(IMMOBILISATIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def _load_config() -> dict:
    ensure_directories()
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "seuil_immobilisation": SEUIL_IMMOBILISATION,
        "durees_par_defaut": dict(DUREES_AMORTISSEMENT_DEFAUT),
        "methode_par_defaut": "lineaire",
        "categories_immobilisables": list(CATEGORIES_IMMOBILISABLES),
        "sous_categories_exclues": list(SOUS_CATEGORIES_EXCLUES_IMMO),
        "exercice_cloture": "12-31",
    }


def _save_config(data: dict) -> None:
    ensure_directories()
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ─── CRUD ───

def get_all_immobilisations(
    statut: Optional[str] = None,
    poste: Optional[str] = None,
    year: Optional[int] = None,
) -> list[dict]:
    immos = _load_immobilisations()
    if statut:
        immos = [i for i in immos if i.get("statut") == statut]
    if poste:
        immos = [i for i in immos if i.get("poste_comptable") == poste]
    if year:
        immos = [i for i in immos if i.get("date_acquisition", "").startswith(str(year))]

    # Enrich with computed fields
    for i in immos:
        tableau = calc_tableau_amortissement(i)
        cumul = sum(l["dotation_brute"] for l in tableau)
        vo = i.get("valeur_origine", 0)
        i["avancement_pct"] = round(cumul / vo * 100, 1) if vo > 0 else 0
        i["vnc_actuelle"] = round(vo - cumul, 2)

    return immos


def get_immobilisation(immo_id: str) -> Optional[dict]:
    immos = _load_immobilisations()
    for i in immos:
        if i["id"] == immo_id:
            i["tableau"] = calc_tableau_amortissement(i)
            cumul = sum(l["dotation_brute"] for l in i["tableau"])
            vo = i.get("valeur_origine", 0)
            i["avancement_pct"] = round(cumul / vo * 100, 1) if vo > 0 else 0
            i["vnc_actuelle"] = round(vo - cumul, 2)
            return i
    return None


def create_immobilisation(data: dict) -> dict:
    immos = _load_immobilisations()

    immo_id = f"immo_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:4]}"
    immo = {
        "id": immo_id,
        "libelle": data["libelle"],
        "date_acquisition": data["date_acquisition"],
        "valeur_origine": data["valeur_origine"],
        "duree_amortissement": data["duree_amortissement"],
        "methode": data.get("methode", "lineaire"),
        "poste_comptable": data["poste_comptable"],
        "date_mise_en_service": data.get("date_mise_en_service") or data["date_acquisition"],
        "date_sortie": None,
        "motif_sortie": None,
        "prix_cession": None,
        "quote_part_pro": data.get("quote_part_pro", 100),
        "plafond_fiscal": data.get("plafond_fiscal"),
        "co2_classe": data.get("co2_classe"),
        "operation_source": data.get("operation_source"),
        "justificatif_id": data.get("justificatif_id"),
        "ged_doc_id": data.get("ged_doc_id"),
        "created_at": datetime.now().isoformat(),
        "statut": "en_cours",
        "notes": data.get("notes"),
    }

    # Default plafond for vehicles
    if immo["poste_comptable"] == "vehicule" and immo["plafond_fiscal"] is None:
        immo["plafond_fiscal"] = 18300

    immos.append(immo)
    _save_immobilisations(immos)

    immo["tableau"] = calc_tableau_amortissement(immo)
    return immo


def update_immobilisation(immo_id: str, data: dict) -> Optional[dict]:
    immos = _load_immobilisations()
    for i in immos:
        if i["id"] == immo_id:
            for key, val in data.items():
                if val is not None:
                    i[key] = val
            # Auto-update statut
            if i.get("date_sortie"):
                i["statut"] = "sorti"
            tableau = calc_tableau_amortissement(i)
            if tableau and tableau[-1]["vnc"] <= 0:
                if i["statut"] == "en_cours":
                    i["statut"] = "amorti"
            _save_immobilisations(immos)
            i["tableau"] = tableau
            return i
    return None


def delete_immobilisation(immo_id: str) -> bool:
    immos = _load_immobilisations()
    before = len(immos)
    immos = [i for i in immos if i["id"] != immo_id]
    if len(immos) < before:
        _save_immobilisations(immos)
        return True
    return False


# ─── Moteur de calcul ───

def calc_tableau_amortissement(immo: dict) -> list[dict]:
    """Calcule le tableau d'amortissement complet."""
    vo = immo.get("valeur_origine", 0)
    duree = immo.get("duree_amortissement", 5)
    methode = immo.get("methode", "lineaire")
    dms = immo.get("date_mise_en_service") or immo.get("date_acquisition")
    qp = immo.get("quote_part_pro", 100)
    plafond = immo.get("plafond_fiscal")
    date_sortie = immo.get("date_sortie")

    if not dms or vo <= 0 or duree <= 0:
        return []

    base = min(vo, plafond) if plafond else vo

    try:
        dms_date = datetime.strptime(dms, "%Y-%m-%d").date()
    except ValueError:
        return []

    sortie_date = None
    if date_sortie:
        try:
            sortie_date = datetime.strptime(date_sortie, "%Y-%m-%d").date()
        except ValueError:
            pass

    if methode == "degressif":
        return _calc_degressif(base, duree, dms_date, qp, sortie_date)
    else:
        return _calc_lineaire(base, duree, dms_date, qp, sortie_date)


def _calc_lineaire(base: float, duree: int, dms: date, qp: int, sortie: Optional[date]) -> list[dict]:
    annuite = base / duree
    tableau = []
    cumul = 0.0
    year_start = dms.year

    for i in range(duree + 1):  # +1 for potential partial last year
        exercice = year_start + i

        if sortie and exercice > sortie.year:
            break

        if i == 0:
            # Pro rata year 1
            jour_restant = (date(dms.year, 12, 31) - dms).days + 1
            jours = min(jour_restant, 360)
            dotation = round(annuite * jours / 360, 2)
        else:
            jours = 360
            dotation = round(annuite, 2)

        # Last year: complement
        remaining = round(base - cumul, 2)
        if dotation > remaining:
            dotation = remaining
        if dotation <= 0:
            break

        # Sortie pro rata
        if sortie and exercice == sortie.year:
            jour_sortie = (sortie - date(exercice, 1, 1)).days + 1
            dotation = round(dotation * jour_sortie / 360, 2)

        cumul = round(cumul + dotation, 2)
        vnc = round(base - cumul, 2)
        deductible = round(dotation * qp / 100, 2)

        tableau.append({
            "exercice": exercice,
            "jours": jours,
            "base_amortissable": base,
            "dotation_brute": dotation,
            "quote_part_pro": qp,
            "dotation_deductible": deductible,
            "amortissements_cumules": cumul,
            "vnc": max(vnc, 0),
        })

        if vnc <= 0:
            break

    return tableau


def _calc_degressif(base: float, duree: int, dms: date, qp: int, sortie: Optional[date]) -> list[dict]:
    coeff = COEFFICIENTS_DEGRESSIF.get(duree, 2.25)
    taux = (1 / duree) * coeff
    tableau = []
    vnc = base
    cumul = 0.0
    year_start = dms.year

    for i in range(duree + 1):
        exercice = year_start + i

        if sortie and exercice > sortie.year:
            break
        if vnc <= 0:
            break

        nb_annees_restantes = duree - i
        if nb_annees_restantes <= 0:
            break

        # Dotation dégressive
        dot_degressive = round(vnc * taux, 2)
        # Dotation linéaire sur le restant
        dot_lineaire = round(vnc / nb_annees_restantes, 2)

        dotation = max(dot_degressive, dot_lineaire)

        if i == 0:
            # Pro rata mois année 1
            mois_restants = 12 - dms.month + 1
            dotation = round(dotation * mois_restants / 12, 2)
            jours = mois_restants * 30
        else:
            jours = 360

        # Cap to remaining
        if dotation > vnc:
            dotation = round(vnc, 2)

        # Sortie pro rata
        if sortie and exercice == sortie.year:
            jour_sortie = (sortie - date(exercice, 1, 1)).days + 1
            dotation = round(dotation * jour_sortie / 360, 2)

        cumul = round(cumul + dotation, 2)
        vnc = round(base - cumul, 2)
        deductible = round(dotation * qp / 100, 2)

        tableau.append({
            "exercice": exercice,
            "jours": jours,
            "base_amortissable": base,
            "dotation_brute": dotation,
            "quote_part_pro": qp,
            "dotation_deductible": deductible,
            "amortissements_cumules": cumul,
            "vnc": max(vnc, 0),
        })

        if vnc <= 0:
            break

    return tableau


# ─── Dotations exercice ───

def get_dotations_exercice(year: int) -> dict:
    immos = _load_immobilisations()
    detail = []
    total_brut = 0.0
    total_deduc = 0.0

    for immo in immos:
        if immo.get("statut") == "sorti":
            continue
        tableau = calc_tableau_amortissement(immo)
        for ligne in tableau:
            if ligne["exercice"] == year:
                detail.append({
                    "immo_id": immo["id"],
                    "libelle": immo["libelle"],
                    "poste_comptable": immo["poste_comptable"],
                    "dotation_brute": ligne["dotation_brute"],
                    "dotation_deductible": ligne["dotation_deductible"],
                    "vnc": ligne["vnc"],
                })
                total_brut += ligne["dotation_brute"]
                total_deduc += ligne["dotation_deductible"]
                break

    return {
        "year": year,
        "total_dotations_brutes": round(total_brut, 2),
        "total_dotations_deductibles": round(total_deduc, 2),
        "detail": detail,
    }


def get_projections(years: int = 5) -> list[dict]:
    current_year = datetime.now().year
    return [get_dotations_exercice(current_year + i) for i in range(years)]


# ─── Candidates ───

def detect_candidates(operations: list[dict], filename: str) -> list[dict]:
    config = _load_config()
    seuil = config.get("seuil_immobilisation", SEUIL_IMMOBILISATION)
    cats = config.get("categories_immobilisables", CATEGORIES_IMMOBILISABLES)
    excl = config.get("sous_categories_exclues", SOUS_CATEGORIES_EXCLUES_IMMO)

    candidates = []
    for idx, op in enumerate(operations):
        debit = op.get("Débit", 0)
        if debit <= seuil:
            continue
        cat = op.get("Catégorie", "")
        if cat not in cats:
            continue
        scat = op.get("Sous-catégorie", "")
        if scat in excl:
            continue
        if op.get("immobilisation_id"):
            continue
        if op.get("immobilisation_ignored"):
            continue

        candidates.append({
            "filename": filename,
            "index": idx,
            "date": op.get("Date", ""),
            "libelle": op.get("Libellé", ""),
            "categorie": cat,
            "sous_categorie": scat,
            "debit": debit,
        })

    return candidates


def get_all_candidates() -> list[dict]:
    from backend.services.operation_service import list_operation_files, load_operations
    files = list_operation_files()
    all_candidates = []
    for f in files:
        try:
            ops = load_operations(f["filename"])
            candidates = detect_candidates(ops, f["filename"])
            all_candidates.extend(candidates)
        except Exception:
            continue
    all_candidates.sort(key=lambda c: c.get("date", ""), reverse=True)
    return all_candidates


def ignore_candidate(filename: str, index: int) -> dict:
    from backend.services.operation_service import load_operations, save_operations
    ops = load_operations(filename)
    if 0 <= index < len(ops):
        ops[index]["immobilisation_ignored"] = True
        save_operations(ops, filename)
        return ops[index]
    raise ValueError(f"Index {index} invalide pour {filename}")


def link_operation_to_immobilisation(filename: str, index: int, immo_id: str) -> dict:
    from backend.services.operation_service import load_operations, save_operations
    ops = load_operations(filename)
    if 0 <= index < len(ops):
        ops[index]["immobilisation_id"] = immo_id
        ops[index]["immobilisation_candidate"] = False
        # Get immo poste for category
        immo = get_immobilisation(immo_id)
        if immo:
            ops[index]["Catégorie"] = "Immobilisations"
            ops[index]["Sous-catégorie"] = immo.get("poste_comptable", "")
        save_operations(ops, filename)
        return ops[index]
    raise ValueError(f"Index {index} invalide pour {filename}")


# ─── Cession ───

def calculer_cession(immo_id: str, date_sortie_str: str, prix_cession: float) -> dict:
    immo = get_immobilisation(immo_id)
    if not immo:
        raise ValueError(f"Immobilisation non trouvée: {immo_id}")

    # Temporarily set sortie date for calculation
    immo_copy = dict(immo)
    immo_copy["date_sortie"] = date_sortie_str
    tableau = calc_tableau_amortissement(immo_copy)

    vnc_sortie = tableau[-1]["vnc"] if tableau else immo["valeur_origine"]
    pv = prix_cession - vnc_sortie if prix_cession > vnc_sortie else None
    mv = vnc_sortie - prix_cession if vnc_sortie > prix_cession else None

    # Duration
    try:
        d_acq = datetime.strptime(immo["date_acquisition"], "%Y-%m-%d")
        d_sort = datetime.strptime(date_sortie_str, "%Y-%m-%d")
        months = (d_sort.year - d_acq.year) * 12 + (d_sort.month - d_acq.month)
    except ValueError:
        months = 0

    regime = "long_terme" if months >= 24 else "court_terme"

    return {
        "vnc_sortie": round(vnc_sortie, 2),
        "plus_value": round(pv, 2) if pv else None,
        "moins_value": round(mv, 2) if mv else None,
        "duree_detention_mois": months,
        "regime": regime,
    }


# ─── KPIs ───

def get_kpis(year: Optional[int] = None) -> dict:
    if year is None:
        year = datetime.now().year
    immos = _load_immobilisations()

    nb_actives = sum(1 for i in immos if i.get("statut") == "en_cours")
    nb_amorties = sum(1 for i in immos if i.get("statut") == "amorti")
    nb_sorties = sum(1 for i in immos if i.get("statut") == "sorti")

    candidates = get_all_candidates()

    dotations = get_dotations_exercice(year)
    total_vnc = 0.0
    total_vo = 0.0

    postes_map: dict[str, dict] = {}
    for immo in immos:
        if immo.get("statut") != "en_cours":
            continue
        vo = immo.get("valeur_origine", 0)
        total_vo += vo
        tableau = calc_tableau_amortissement(immo)
        cumul = sum(l["dotation_brute"] for l in tableau)
        vnc = vo - cumul
        total_vnc += vnc

        p = immo.get("poste_comptable", "autre")
        if p not in postes_map:
            postes_map[p] = {"poste": p, "nb": 0, "vnc": 0, "dotation": 0}
        postes_map[p]["nb"] += 1
        postes_map[p]["vnc"] += vnc

    # Add dotation per poste
    for d in dotations.get("detail", []):
        p = d.get("poste_comptable", "autre")
        if p in postes_map:
            postes_map[p]["dotation"] += d["dotation_deductible"]

    return {
        "nb_actives": nb_actives,
        "nb_amorties": nb_amorties,
        "nb_sorties": nb_sorties,
        "nb_candidates": len(candidates),
        "dotation_exercice": dotations["total_dotations_deductibles"],
        "total_vnc": round(total_vnc, 2),
        "total_valeur_origine": round(total_vo, 2),
        "postes": sorted(postes_map.values(), key=lambda x: x["vnc"], reverse=True),
    }
