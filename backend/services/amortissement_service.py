"""
Service des dotations aux amortissements.
Registre des immobilisations, moteur de calcul, détection candidates.

Convention : `Catégorie == "Matériel"` strict pour la détection des candidates.
Mode `lineaire` only — le dégressif est interdit en BNC régime recettes (la branche
`_compute_tableau_degressif` est conservée pour lecture immos legacy).

Reprise d'exercice antérieur : champs `exercice_entree_neuronx`, `amortissements_anterieurs`,
`vnc_ouverture` sur `Immobilisation`. Le moteur branche sur `_compute_tableau_with_backfill`
quand `exercice_entree_neuronx is not None` — la ligne récap `is_backfill=True` est exclue
du BNC.
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
    SOUS_CATEGORIES_EXCLUES_IMMO,
    DUREES_AMORTISSEMENT_DEFAUT, PLAFONDS_VEHICULE,
    COEFFICIENTS_DEGRESSIF, ensure_directories,
)
from backend.models.amortissement import (
    BackfillComputeRequest,
    BackfillComputeResponse,
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
        "seuil": float(SEUIL_IMMOBILISATION),
        "durees_par_defaut": dict(DUREES_AMORTISSEMENT_DEFAUT),
        "sous_categories_exclues": list(SOUS_CATEGORIES_EXCLUES_IMMO),
        "coefficient_degressif": dict(COEFFICIENTS_DEGRESSIF),
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
        immos = [i for i in immos if i.get("poste") == poste]
    if year:
        immos = [i for i in immos if i.get("date_acquisition", "").startswith(str(year))]

    # Enrich with computed fields
    for i in immos:
        tableau = compute_tableau(i)
        cumul = sum(l["dotation_brute"] for l in tableau if not l.get("is_backfill"))
        base = i.get("base_amortissable", 0)
        # Pour les immos avec reprise : dotations antérieures + dotations NeuronX
        cumul_total = cumul + float(i.get("amortissements_anterieurs", 0) or 0)
        i["avancement_pct"] = round(cumul_total / base * 100, 1) if base > 0 else 0
        i["vnc_actuelle"] = round(base - cumul_total, 2)

    return immos


def get_immobilisation(immo_id: str) -> Optional[dict]:
    immos = _load_immobilisations()
    for i in immos:
        if i["id"] == immo_id:
            i["tableau"] = compute_tableau(i)
            cumul = sum(l["dotation_brute"] for l in i["tableau"] if not l.get("is_backfill"))
            base = i.get("base_amortissable", 0)
            cumul_total = cumul + float(i.get("amortissements_anterieurs", 0) or 0)
            i["avancement_pct"] = round(cumul_total / base * 100, 1) if base > 0 else 0
            i["vnc_actuelle"] = round(base - cumul_total, 2)
            return i
    return None


def list_immobilisations_enriched(year: Optional[int] = None) -> list[dict]:
    """Retourne TOUTES les immos enrichies (`vnc_actuelle`, `avancement_pct`).

    Le paramètre `year` est ignoré pour la liste (le registre couvre l'ensemble des
    immos quel que soit l'exercice de contexte) ; il est conservé dans la signature
    pour la cohérence des templates Rapports V2 (`render_registre(year, ...)`).

    Utilisé par `amortissement_report_service.render_registre()`.
    """
    return get_all_immobilisations(statut=None, poste=None, year=None)


def create_immobilisation(data: dict) -> dict:
    """Création d'immobilisation. Force mode='lineaire' (BNC régime recettes interdit le dégressif).
    Valide la cohérence du backfill : amortissements_anterieurs + vnc_ouverture == base_amortissable
    (tolérance 1 €).
    """
    immos = _load_immobilisations()

    # Force lineaire — le dégressif est interdit en BNC régime recettes
    if data.get("mode") and data["mode"] != "lineaire":
        logger.info(f"create_immobilisation: mode '{data['mode']}' forcé en 'lineaire'")
        data["mode"] = "lineaire"

    # Validation cohérence backfill (double sécurité par-dessus Pydantic)
    base = float(data.get("base_amortissable", 0) or 0)
    exercice_entree = data.get("exercice_entree_neuronx")
    if exercice_entree is not None:
        amort_ant = float(data.get("amortissements_anterieurs", 0) or 0)
        vnc_ouv = data.get("vnc_ouverture")
        if vnc_ouv is None:
            raise ValueError("vnc_ouverture requise en mode reprise")
        vnc_ouv = float(vnc_ouv)
        if amort_ant < 0:
            raise ValueError("amortissements_anterieurs ne peut pas être négatif")
        expected = amort_ant + vnc_ouv
        if abs(expected - base) > 1.0:
            raise ValueError(
                f"Incohérence : amortissements_anterieurs ({amort_ant}) "
                f"+ vnc_ouverture ({vnc_ouv}) = {expected} ≠ "
                f"base_amortissable ({base})"
            )

    immo_id = f"immo_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:4]}"
    immo = {
        "id": immo_id,
        "designation": data["designation"],
        "date_acquisition": data["date_acquisition"],
        "base_amortissable": base,
        "duree": data["duree"],
        "mode": "lineaire",
        "poste": data.get("poste"),
        "date_mise_en_service": data.get("date_mise_en_service") or data["date_acquisition"],
        "date_sortie": None,
        "motif_sortie": None,
        "prix_cession": None,
        "quote_part_pro": float(data.get("quote_part_pro", 100.0)),
        "plafond_fiscal": data.get("plafond_fiscal"),
        "co2_classe": data.get("co2_classe"),
        "exercice_entree_neuronx": exercice_entree,
        "amortissements_anterieurs": float(data.get("amortissements_anterieurs", 0.0) or 0.0),
        "vnc_ouverture": float(data["vnc_ouverture"]) if data.get("vnc_ouverture") is not None else None,
        "operation_source": data.get("operation_source"),
        "justificatif_id": data.get("justificatif_id"),
        "ged_doc_id": data.get("ged_doc_id"),
        "created_at": datetime.now().isoformat(),
        "statut": "en_cours",
        "notes": data.get("notes"),
    }

    # Default plafond for vehicles
    if immo["poste"] == "vehicule" and immo["plafond_fiscal"] is None:
        immo["plafond_fiscal"] = 18300

    immos.append(immo)
    _save_immobilisations(immos)

    immo["tableau"] = compute_tableau(immo)
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
            tableau = compute_tableau(i)
            non_backfill = [l for l in tableau if not l.get("is_backfill")]
            if non_backfill and non_backfill[-1]["vnc"] <= 0:
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

def compute_tableau(immo: dict) -> list[dict]:
    """Tableau d'amortissement complet. Branche sur standard ou backfill.

    Si `exercice_entree_neuronx` défini, retourne :
      - 1 ligne récap `is_backfill=True` (cumul exercices antérieurs, dotation_deductible=0)
      - Les exercices NeuronX calculés à partir de `vnc_ouverture` sur les jours restants
    Sinon, comportement standard depuis `date_acquisition`.
    """
    if immo.get("exercice_entree_neuronx") is None:
        return _compute_tableau_standard(immo)
    return _compute_tableau_with_backfill(immo)


def _compute_tableau_standard(immo: dict) -> list[dict]:
    """Tableau d'amortissement classique depuis la date de mise en service."""
    base_amortissable = immo.get("base_amortissable", 0)
    duree = immo.get("duree", 5)
    mode = immo.get("mode", "lineaire")
    dms = immo.get("date_mise_en_service") or immo.get("date_acquisition")
    qp = float(immo.get("quote_part_pro", 100.0))
    plafond = immo.get("plafond_fiscal")
    date_sortie = immo.get("date_sortie")

    if not dms or base_amortissable <= 0 or duree <= 0:
        return []

    base = min(base_amortissable, plafond) if plafond else base_amortissable

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

    # Mode dégressif conservé pour lecture immos legacy uniquement
    if mode == "degressif":
        return _compute_tableau_degressif(base, duree, dms_date, qp, sortie_date)
    return _compute_tableau_lineaire(base, duree, dms_date, qp, sortie_date)


def _compute_tableau_lineaire(
    base: float, duree: int, dms: date, qp: float, sortie: Optional[date]
) -> list[dict]:
    """Linéaire avec pro-rata année 1 (jours base 360) et complément dernière année."""
    annuite = base / duree
    tableau: list[dict] = []
    cumul = 0.0
    year_start = dms.year

    for i in range(duree + 1):  # +1 for potential partial last year
        exercice = year_start + i

        if sortie and exercice > sortie.year:
            break

        if i == 0:
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
            "vnc_debut": round(base - (cumul - dotation), 2),
            "is_backfill": False,
        })

        if vnc <= 0:
            break

    return tableau


def _compute_tableau_degressif(
    base: float, duree: int, dms: date, qp: float, sortie: Optional[date]
) -> list[dict]:
    """Dégressif legacy — conservé pour lecture immos historiques uniquement.

    La création force désormais `mode=lineaire`. Cette branche reste accessible mais
    devient mort-code après migration des immos legacy.
    """
    coeff = COEFFICIENTS_DEGRESSIF.get(duree, 2.25)
    taux = (1 / duree) * coeff
    tableau: list[dict] = []
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

        dot_degressive = round(vnc * taux, 2)
        dot_lineaire = round(vnc / nb_annees_restantes, 2)
        dotation = max(dot_degressive, dot_lineaire)

        if i == 0:
            mois_restants = 12 - dms.month + 1
            dotation = round(dotation * mois_restants / 12, 2)
            jours = mois_restants * 30
        else:
            jours = 360

        if dotation > vnc:
            dotation = round(vnc, 2)

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
            "vnc_debut": round(base - (cumul - dotation), 2),
            "is_backfill": False,
        })

        if vnc <= 0:
            break

    return tableau


def _compute_tableau_with_backfill(immo: dict) -> list[dict]:
    """Tableau reprise : ligne récap antérieur (non déductible) + exercices NeuronX.

    La ligne `is_backfill=True` (exercice = year_entree-1, dotation_deductible=0) figure dans
    le tableau pour traçabilité mais est exclue par `get_dotations()` du BNC.
    Les exercices NeuronX amortissent linéairement depuis `vnc_ouverture` sur les jours
    restants (base 360, convention française).
    """
    date_acq_str = immo.get("date_acquisition", "")
    if not date_acq_str or len(date_acq_str) < 4:
        return []
    try:
        year_acq = int(date_acq_str[:4])
    except ValueError:
        return []

    year_entree = int(immo["exercice_entree_neuronx"])
    base = float(immo.get("base_amortissable", 0))
    duree = int(immo.get("duree", 5))
    qp = float(immo.get("quote_part_pro", 100.0))
    amort_anterieurs = float(immo.get("amortissements_anterieurs", 0) or 0)
    vnc_ouverture = float(immo.get("vnc_ouverture") or 0)

    sortie_date: Optional[date] = None
    if immo.get("date_sortie"):
        try:
            sortie_date = datetime.strptime(immo["date_sortie"], "%Y-%m-%d").date()
        except ValueError:
            pass

    nb_annees_anterieures = year_entree - year_acq

    lignes: list[dict] = []

    # 1. Ligne récap "Exercices antérieurs" — exclue du BNC
    lignes.append({
        "exercice": year_entree - 1,
        "jours": 0,
        "base_amortissable": base,
        "dotation_brute": amort_anterieurs,
        "quote_part_pro": qp,
        "dotation_deductible": 0.0,  # ← exclu du BNC NeuronX
        "amortissements_cumules": amort_anterieurs,
        "vnc": vnc_ouverture,
        "vnc_debut": base,
        "is_backfill": True,
        "libelle": f"Cumul {nb_annees_anterieures} exercice(s) antérieur(s) — hors NeuronX",
    })

    # 2. Exercices NeuronX — amortissement linéaire de vnc_ouverture sur jours restants
    jours_total = duree * 360
    jours_consommes = _jours_depuis_acquisition_jusqu_a_fin_exercice(
        date_acq_str, year_entree - 1
    )
    jours_restants = jours_total - jours_consommes

    if jours_restants <= 0:
        # Edge : immo déjà totalement amortie avant entrée NeuronX
        lignes.append({
            "exercice": year_entree,
            "jours": 0,
            "base_amortissable": base,
            "dotation_brute": 0.0,
            "quote_part_pro": qp,
            "dotation_deductible": 0.0,
            "amortissements_cumules": amort_anterieurs,
            "vnc": vnc_ouverture,
            "vnc_debut": vnc_ouverture,
            "is_backfill": False,
            "libelle": "Immobilisation totalement amortie avant entrée NeuronX",
        })
        return lignes

    taux_quotidien = vnc_ouverture / jours_restants if jours_restants > 0 else 0
    vnc_courante = vnc_ouverture
    exercice_courant = year_entree
    jours_cumules = 0
    cumul_neuronx = 0.0

    while vnc_courante > 0.01 and jours_cumules < jours_restants:
        jours_exercice = min(360, jours_restants - jours_cumules)
        dotation_brute = round(taux_quotidien * jours_exercice, 2)

        # Complément dernière année
        if jours_cumules + jours_exercice >= jours_restants:
            dotation_brute = round(vnc_courante, 2)

        # Sortie pro rata sur l'exercice de cession
        if sortie_date and exercice_courant == sortie_date.year:
            jour_sortie = (sortie_date - date(exercice_courant, 1, 1)).days + 1
            dotation_brute = round(dotation_brute * jour_sortie / 360, 2)

        dotation_deductible = round(dotation_brute * qp / 100, 2)
        vnc_fin = round(vnc_courante - dotation_brute, 2)
        cumul_neuronx = round(cumul_neuronx + dotation_brute, 2)

        lignes.append({
            "exercice": exercice_courant,
            "jours": jours_exercice,
            "base_amortissable": base,
            "dotation_brute": dotation_brute,
            "quote_part_pro": qp,
            "dotation_deductible": dotation_deductible,
            "amortissements_cumules": amort_anterieurs + cumul_neuronx,
            "vnc": max(0.0, vnc_fin),
            "vnc_debut": vnc_courante,
            "is_backfill": False,
            "libelle": f"Exercice {exercice_courant}",
        })

        if sortie_date and exercice_courant >= sortie_date.year:
            break

        vnc_courante = max(0.0, vnc_fin)
        jours_cumules += jours_exercice
        exercice_courant += 1

    return lignes


def _jours_depuis_acquisition_jusqu_a_fin_exercice(
    date_acquisition: str, exercice_fin: int
) -> int:
    """Jours cumulés base 360 entre date_acquisition (inclus) et 31/12/exercice_fin (inclus)."""
    try:
        d_acq = datetime.strptime(date_acquisition, "%Y-%m-%d").date()
    except ValueError:
        return 0

    if exercice_fin < d_acq.year:
        return 0

    # Année d'acquisition : pro rata du jour d'achat à la fin d'année
    fin_annee_acq = date(d_acq.year, 12, 31)
    jours_an1 = _jours_base_360(d_acq, fin_annee_acq)

    nb_annees_pleines = exercice_fin - d_acq.year
    return jours_an1 + max(0, nb_annees_pleines) * 360


def _jours_base_360(d1: date, d2: date) -> int:
    """Convention comptable française base 360 : (Y2-Y1)*360 + (M2-M1)*30 + (D2-D1)."""
    if d2 < d1:
        return 0
    mois = (d2.year - d1.year) * 12 + (d2.month - d1.month)
    jours_reste = d2.day - d1.day
    return mois * 30 + jours_reste


# ─── Suggestion backfill ───

def compute_backfill_suggestion(req: BackfillComputeRequest) -> BackfillComputeResponse:
    """Suggère amortissements_anterieurs + vnc_ouverture théoriques (linéaire pur,
    pro rata temporis année 1). Éditables côté UI si valeurs réelles différentes.
    """
    immo_temp = {
        "id": "temp",
        "designation": "temp",
        "date_acquisition": req.date_acquisition,
        "base_amortissable": req.base_amortissable,
        "duree": req.duree,
        "mode": "lineaire",
        "quote_part_pro": req.quote_part_pro,
        "date_mise_en_service": req.date_acquisition,
    }

    tableau = _compute_tableau_standard(immo_temp)

    detail_anterieurs: list[dict] = []
    cumul = 0.0
    vnc_finale = req.base_amortissable

    for ligne in tableau:
        if ligne["exercice"] >= req.exercice_entree_neuronx:
            break
        cumul += ligne["dotation_brute"]
        vnc_finale = ligne["vnc"]
        detail_anterieurs.append({
            "exercice": ligne["exercice"],
            "dotation": ligne["dotation_brute"],
            "vnc_fin": ligne["vnc"],
        })

    return BackfillComputeResponse(
        amortissements_anterieurs_theorique=round(cumul, 2),
        vnc_ouverture_theorique=round(vnc_finale, 2),
        detail_exercices_anterieurs=detail_anterieurs,
    )


# ─── Dotations exercice ───

def get_dotations(year: int) -> dict:
    """Dotations annuelles pour un exercice. Filtre les lignes is_backfill (non déductibles).

    Retourne `total_brute`, `total_deductible`, `details` — strictement les exercices NeuronX.
    """
    immos = _load_immobilisations()
    detail: list[dict] = []
    total_brut = 0.0
    total_deduc = 0.0

    for immo in immos:
        if immo.get("statut") == "sorti":
            # On agrège quand même la dotation de l'année si la cession est postérieure ou égale
            sortie_str = immo.get("date_sortie", "")
            if sortie_str and sortie_str[:4] < str(year):
                continue
        tableau = compute_tableau(immo)
        for ligne in tableau:
            if ligne.get("is_backfill"):
                continue  # exclu du BNC
            if ligne["exercice"] == year:
                detail.append({
                    "immo_id": immo["id"],
                    "immobilisation_id": immo["id"],
                    "designation": immo.get("designation", ""),
                    "libelle": immo.get("designation", ""),  # alias compat frontend
                    "poste": immo.get("poste", ""),
                    "poste_comptable": immo.get("poste", ""),  # alias compat frontend
                    "dotation_brute": ligne["dotation_brute"],
                    "dotation_deductible": ligne["dotation_deductible"],
                    "vnc": ligne["vnc"],
                })
                total_brut += ligne["dotation_brute"]
                total_deduc += ligne["dotation_deductible"]
                break

    return {
        "year": year,
        "total_brute": round(total_brut, 2),
        "total_deductible": round(total_deduc, 2),
        # Aliases pour compatibilité frontend existant
        "total_dotations_brutes": round(total_brut, 2),
        "total_dotations_deductibles": round(total_deduc, 2),
        "detail": detail,
    }


# Alias historique pour rétrocompat (router/services existants)
def get_dotations_exercice(year: int) -> dict:
    return get_dotations(year)


def get_projections(years: int = 5) -> list[dict]:
    current_year = datetime.now().year
    return [get_dotations(current_year + i) for i in range(years)]


# ─── Détail virtuel + référence OD ───

def find_dotation_operation(year: int) -> Optional[dict]:
    """Scanne les ops pour trouver l'OD dotation `year` (Prompt B).

    Match strict : `op.source == "amortissement"` ET `op.Date.startswith(f"{year}-12-")`.
    Scanne tous les fichiers JSON (pas de filtre par filename) pour gérer le cas
    des fichiers merged/split contenant des dates multi-années.

    Retourne `{filename, index, year}` ou `None`.
    """
    from backend.core.config import IMPORTS_OPERATIONS_DIR
    ops_dir = Path(IMPORTS_OPERATIONS_DIR)
    if not ops_dir.exists():
        return None

    date_prefix = f"{year}-12-"
    for path in ops_dir.glob("operations_*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        for idx, op in enumerate(data):
            if not isinstance(op, dict):
                continue
            if op.get("source") != "amortissement":
                continue
            date_op = op.get("Date", "") or ""
            if isinstance(date_op, str) and date_op.startswith(date_prefix):
                return {"filename": path.name, "index": idx, "year": year}
    return None


def _compute_statut(immo: dict, ligne: dict, tableau: list[dict]) -> str:
    """Statut d'une ligne pour un exercice : en_cours | complement | derniere | cedee."""
    if immo.get("statut") == "sorti":
        return "cedee"
    if ligne.get("vnc", 0) <= 0.01:
        return "derniere"
    lignes_actives = [l for l in tableau if not l.get("is_backfill")]
    duree = int(immo.get("duree", 5))
    if lignes_actives and ligne == lignes_actives[-1] and len(lignes_actives) > duree:
        return "complement"
    return "en_cours"


def get_virtual_detail(year: int):
    """Détail virtuel des dotations annuelles : liste triée par dotation_deductible desc.

    Retourne un `AmortissementVirtualDetail` (modèle Pydantic).
    """
    from backend.models.amortissement import (
        AmortissementVirtualDetail,
        DotationImmoRow,
    )

    dotations = get_dotations(year)
    rows: list[DotationImmoRow] = []

    for det in dotations["detail"]:
        immo = get_immobilisation(det["immobilisation_id"])
        if not immo:
            continue
        tableau = compute_tableau(immo)
        ligne = next(
            (
                l for l in tableau
                if l["exercice"] == year and not l.get("is_backfill")
            ),
            None,
        )
        if not ligne:
            continue
        rows.append(DotationImmoRow(
            immobilisation_id=immo["id"],
            designation=immo.get("designation", ""),
            date_acquisition=immo.get("date_acquisition", ""),
            mode=immo.get("mode", "lineaire"),
            duree=int(immo.get("duree", 5)),
            base_amortissable=float(immo.get("base_amortissable", 0)),
            vnc_debut=float(ligne.get("vnc_debut") or ligne.get("base_amortissable", 0)),
            dotation_brute=float(ligne.get("dotation_brute", 0)),
            quote_part_pro=float(immo.get("quote_part_pro", 100.0)),
            dotation_deductible=float(ligne.get("dotation_deductible", 0)),
            vnc_fin=float(ligne.get("vnc", 0)),
            statut=_compute_statut(immo, ligne, tableau),
            poste=immo.get("poste"),
            is_reprise=immo.get("exercice_entree_neuronx") is not None,
            exercice_entree_neuronx=immo.get("exercice_entree_neuronx"),
        ))

    rows.sort(key=lambda r: -r.dotation_deductible)
    return AmortissementVirtualDetail(
        year=year,
        total_brute=float(dotations["total_brute"]),
        total_deductible=float(dotations["total_deductible"]),
        nb_immos_actives=len(rows),
        immos=rows,
    )


# ─── Candidates ───

def detect_candidates(operations: list[dict], filename: str) -> list[dict]:
    """Détection candidates : strict `Catégorie == "Matériel"`.

    Le seuil et les sous-catégories exclues restent configurables.
    """
    config = _load_config()
    seuil = float(config.get("seuil", SEUIL_IMMOBILISATION))
    excl = config.get("sous_categories_exclues", SOUS_CATEGORIES_EXCLUES_IMMO)

    candidates: list[dict] = []
    for idx, op in enumerate(operations):
        # Strict : uniquement Matériel
        if op.get("Catégorie") != "Matériel":
            continue
        scat = op.get("Sous-catégorie", "")
        if scat in excl:
            continue
        debit = op.get("Débit", 0) or 0
        try:
            debit_f = abs(float(debit))
        except (ValueError, TypeError):
            debit_f = 0.0
        if debit_f < seuil:
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
            "categorie": op.get("Catégorie", ""),
            "sous_categorie": scat,
            "debit": debit_f,
        })

    return candidates


def get_all_candidates() -> list[dict]:
    from backend.services.operation_service import list_operation_files, load_operations
    files = list_operation_files()
    all_candidates: list[dict] = []
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
        # Catégorie "Immobilisations" exclue de charges_pro via EXCLUDED_FROM_CHARGES_PRO
        immo = get_immobilisation(immo_id)
        if immo:
            ops[index]["Catégorie"] = "Immobilisations"
            ops[index]["Sous-catégorie"] = immo.get("poste", "")
        save_operations(ops, filename)
        return ops[index]
    raise ValueError(f"Index {index} invalide pour {filename}")


# ─── Cession ───

def calculer_cession(immo_id: str, date_sortie_str: str, prix_cession: float) -> dict:
    immo = get_immobilisation(immo_id)
    if not immo:
        raise ValueError(f"Immobilisation non trouvée: {immo_id}")

    immo_copy = dict(immo)
    immo_copy["date_sortie"] = date_sortie_str
    tableau = compute_tableau(immo_copy)

    # Dernière ligne non-backfill = état au moment de la cession
    non_backfill = [l for l in tableau if not l.get("is_backfill")]
    if non_backfill:
        vnc_sortie = non_backfill[-1]["vnc"]
    else:
        vnc_sortie = float(immo.get("base_amortissable", 0))

    pv = prix_cession - vnc_sortie if prix_cession > vnc_sortie else None
    mv = vnc_sortie - prix_cession if vnc_sortie > prix_cession else None

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

    dotations = get_dotations(year)
    total_vnc = 0.0
    total_base = 0.0

    postes_map: dict[str, dict] = {}
    for immo in immos:
        if immo.get("statut") != "en_cours":
            continue
        base = float(immo.get("base_amortissable", 0))
        total_base += base
        tableau = compute_tableau(immo)
        cumul = sum(l["dotation_brute"] for l in tableau if not l.get("is_backfill"))
        cumul_total = cumul + float(immo.get("amortissements_anterieurs", 0) or 0)
        vnc = base - cumul_total
        total_vnc += vnc

        p = immo.get("poste", "autre")
        if p not in postes_map:
            postes_map[p] = {"poste": p, "nb": 0, "vnc": 0.0, "dotation": 0.0}
        postes_map[p]["nb"] += 1
        postes_map[p]["vnc"] += vnc

    for d in dotations.get("detail", []):
        p = d.get("poste", "autre")
        if p in postes_map:
            postes_map[p]["dotation"] += d["dotation_deductible"]

    return {
        "nb_actives": nb_actives,
        "nb_amorties": nb_amorties,
        "nb_sorties": nb_sorties,
        "nb_candidates": len(candidates),
        "dotation_exercice": dotations["total_deductible"],
        "total_vnc": round(total_vnc, 2),
        "total_valeur_origine": round(total_base, 2),
        "total_base_amortissable": round(total_base, 2),
        "postes": sorted(postes_map.values(), key=lambda x: x["vnc"], reverse=True),
    }


# Alias rétrocompat — l'ancien nom était utilisé par le router
def calc_tableau_amortissement(immo: dict) -> list[dict]:
    return compute_tableau(immo)


# ─── OD dotation 31/12 (Prompt B1) ───

def _find_or_create_december_file(year: int) -> str:
    """Trouve un fichier d'opérations contenant des dates de décembre `year`,
    sinon crée un fichier vide via `operation_service.create_empty_file(year, 12)`.

    Pattern miroir de `charges_forfaitaires_service._find_or_create_december_file`.
    Scanne le mois dominant (pas le filename) car les fichiers d'imports portent
    un timestamp et pas YYYYMM.
    """
    from backend.core.config import IMPORTS_OPERATIONS_DIR
    from backend.services import operation_service

    best_file: Optional[str] = None
    for f in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
        try:
            ops = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(ops, list) or not ops:
            continue
        months: dict[int, int] = {}
        for op in ops:
            date_str = (op or {}).get("Date", "")
            if isinstance(date_str, str) and date_str.startswith(f"{year}-"):
                try:
                    month = int(date_str.split("-")[1])
                    months[month] = months.get(month, 0) + 1
                except (ValueError, IndexError):
                    continue
        if months:
            dominant = max(months, key=lambda m: months[m])
            if dominant == 12:
                return f.name
            best_file = f.name  # fallback : dernier fichier de l'année

    if best_file:
        return best_file

    # Aucun fichier existant : on crée un fichier mensuel vide
    return operation_service.create_empty_file(year, 12)


def generer_dotation_ecriture(year: int) -> dict:
    """Génère l'OD dotation 31/12 + PDF + GED. Idempotent (regénère si existe).

    Prompt B3 : le PDF est désormais produit par le template Rapports V2
    `amortissements_dotations` via `report_service.get_or_generate(...)`. Cela
    unifie la source du rapport entre l'OD, l'export ZIP, et l'UI Rapports V2.
    Le `_register_dotation_ged_entry()` est rappelé après pour enrichir l'entrée
    GED avec `operation_ref` + `source_module: "amortissements"` (le
    `register_rapport` standard est plus générique).
    """
    from backend.services import operation_service, report_service

    detail = get_virtual_detail(year)
    if detail.nb_immos_actives == 0:
        raise ValueError(f"Aucune immobilisation active pour l'exercice {year}")

    # 1. Si OD existante → supprimer avant de recréer (dédup côté OD).
    #    Le PDF est conservé : le template gère son propre cycle de vie via
    #    dedup_key et écrasera le fichier si les filtres sont identiques.
    existing_ref = find_dotation_operation(year)
    if existing_ref:
        ops_existing = operation_service.load_operations(existing_ref["filename"])
        if 0 <= existing_ref["index"] < len(ops_existing):
            del ops_existing[existing_ref["index"]]
            operation_service.save_operations(ops_existing, filename=existing_ref["filename"])

    # 2. Localiser ou créer le fichier décembre de l'année (après suppression de l'OD,
    #    pour rester aligné si l'ancienne OD était dans un autre fichier)
    december_file = _find_or_create_december_file(year)

    # 3. Génération (ou récupération via dédup) du rapport via le template
    report = report_service.get_or_generate(
        template_id="amortissements_dotations",
        filters={"year": year, "poste": "all"},
        format="pdf",
    )
    pdf_filename = report["filename"]

    # 4. Construire l'OD pointant vers ce rapport
    od = {
        "Date": f"{year}-12-31",
        "Libellé": f"Dotation aux amortissements {year}",
        "Débit": round(detail.total_deductible, 2),
        "Crédit": 0.0,
        "Catégorie": "Dotations aux amortissements",
        "Sous-catégorie": "",
        "Justificatif": True,
        "Lien justificatif": f"reports/{pdf_filename}",
        "Important": False,
        "A_revoir": False,
        "Commentaire": (
            f"Dotation amortissements exercice {year} — "
            f"{detail.nb_immos_actives} immo(s) — "
            f"art. 39-1-2° CGI"
        ),
        "lettre": True,
        "locked": True,
        "locked_at": datetime.now().isoformat(),
        "source": "amortissement",
        "type_operation": "OD",
    }
    ops = operation_service.load_operations(december_file)
    ops.append(od)
    op_index = len(ops) - 1
    operation_service.save_operations(ops, filename=december_file)

    # 5. Enrichir l'entrée GED du rapport avec operation_ref + source_module
    #    (overwrite la metadata générique de register_rapport par la version riche
    #    qui permet la navigation retour vers /amortissements depuis la GED)
    ged_doc_id = _register_dotation_ged_entry(
        pdf_filename=pdf_filename,
        year=year,
        montant_deductible=detail.total_deductible,
        nb_immos=detail.nb_immos_actives,
        op_file=december_file,
        op_index=op_index,
    )

    return {
        "status": "generated",
        "year": year,
        "filename": december_file,
        "index": op_index,
        "pdf_filename": pdf_filename,
        "ged_doc_id": ged_doc_id,
        "montant_deductible": detail.total_deductible,
        "nb_immos": detail.nb_immos_actives,
        "from_cache": report.get("from_cache", False),
    }


def supprimer_dotation_ecriture(year: int) -> dict:
    """Supprime l'OD mais PRÉSERVE le PDF du rapport (Prompt B3).

    Le rapport vit désormais dans Rapports V2 (template `amortissements_dotations`)
    et peut être consulté indépendamment de l'OD via `/ged?type=rapport`. Sa
    suppression est réservée à l'utilisateur via la GED ou via la régénération
    par le template (dédup côté `dedup_key`).

    Retourne `{status: deleted|not_found, year, filename?, index?, pdf_preserved}`.
    """
    from backend.services import operation_service

    ref = find_dotation_operation(year)
    if not ref:
        return {"status": "not_found", "year": year}

    ops = operation_service.load_operations(ref["filename"])
    if not (0 <= ref["index"] < len(ops)):
        return {"status": "not_found", "year": year}

    del ops[ref["index"]]
    operation_service.save_operations(ops, filename=ref["filename"])

    return {
        "status": "deleted",
        "year": year,
        "filename": ref["filename"],
        "index": ref["index"],
        "pdf_preserved": True,
    }


def regenerer_pdf_dotation(year: int) -> dict:
    """Regénère uniquement le PDF via le template (l'OD reste en place).

    Prompt B3 : passe par `report_service.get_or_generate` qui gère la dédup —
    si les filtres sont identiques, le fichier existant est écrasé in situ.
    Le `Lien justificatif` de l'OD reste valide tant que le rapport conserve
    son filename (via le `dedup_key`, le filename ne change que si on archive).
    """
    from backend.services import operation_service, report_service

    ref = find_dotation_operation(year)
    if not ref:
        raise ValueError(f"OD dotation {year} introuvable — générer d'abord")

    ops = operation_service.load_operations(ref["filename"])
    if not (0 <= ref["index"] < len(ops)):
        raise ValueError(f"OD dotation {year} index hors limites")

    op = ops[ref["index"]]
    pdf_lien = op.get("Lien justificatif")
    old_pdf_basename = Path(pdf_lien).name if pdf_lien else None

    # Force-régen via dédup : on écrase l'entrée d'index existante en supprimant
    # le fichier disque (l'archive est créée par get_or_generate).
    from backend.core.config import REPORTS_DIR
    if old_pdf_basename:
        old_path = REPORTS_DIR / old_pdf_basename
        if old_path.exists():
            old_path.unlink()

    report = report_service.get_or_generate(
        template_id="amortissements_dotations",
        filters={"year": year, "poste": "all"},
        format="pdf",
    )
    pdf_filename = report["filename"]

    # Mettre à jour le Lien justificatif si le filename a changé (timestamp)
    if pdf_filename != old_pdf_basename:
        op["Lien justificatif"] = f"reports/{pdf_filename}"
        operation_service.save_operations(ops, filename=ref["filename"])

    # Re-enrichir la metadata GED avec operation_ref
    detail = get_virtual_detail(year)
    _register_dotation_ged_entry(
        pdf_filename=pdf_filename,
        year=year,
        montant_deductible=detail.total_deductible,
        nb_immos=detail.nb_immos_actives,
        op_file=ref["filename"],
        op_index=ref["index"],
    )

    # Invalide la thumbnail GED (PDF a changé sur disque)
    try:
        from backend.services import ged_service
        doc_id = f"data/reports/{pdf_filename}"
        ged_service.delete_thumbnail_for_doc_id(doc_id)
    except Exception as e:
        logger.warning("Invalidation thumbnail dotation %s échouée: %s", pdf_filename, e)

    return {
        "status": "regenerated",
        "year": year,
        "pdf_filename": pdf_filename,
        "filename": ref["filename"],
        "index": ref["index"],
    }


def get_candidate_detail(filename: str, index: int) -> dict:
    """Retourne `op + justificatif + ocr_prefill` pour `ImmobilisationDrawer` (Prompt B2).

    Préfill OCR prioritaire (supplier+date+best_amount), fallback sur les valeurs
    de l'op bancaire si OCR absent ou incomplet.
    """
    from backend.services import (
        justificatif_service,
        ocr_service,
        operation_service,
    )

    ops = operation_service.load_operations(filename)
    if not (0 <= index < len(ops)):
        raise ValueError(f"Index {index} hors limites pour {filename}")

    op = ops[index]
    lien = op.get("Lien justificatif", "") or ""
    justif_filename = Path(lien).name if lien else None

    # Préfill défaut depuis l'op
    debit_val = op.get("Débit") or 0
    try:
        debit_abs = abs(float(debit_val))
    except (ValueError, TypeError):
        debit_abs = 0.0
    ocr_prefill: dict = {
        "designation": op.get("Libellé", "") or "",
        "date_acquisition": op.get("Date", "") or "",
        "base_amortissable": debit_abs,
    }

    justificatif = None
    if justif_filename:
        justif_path = justificatif_service.get_justificatif_path(justif_filename)
        if justif_path:
            ocr_data: dict = {}
            cache_path = ocr_service._find_ocr_cache_file(justif_filename)
            if cache_path and cache_path.exists():
                try:
                    ocr_data = json.loads(cache_path.read_text(encoding="utf-8"))
                except Exception:
                    ocr_data = {}

            justificatif = {
                "filename": justif_filename,
                "ocr_data": ocr_data,
            }

            # Préfill prioritaire depuis OCR (top-level OU extracted_data selon shape)
            extracted = ocr_data.get("extracted_data") or {}
            supplier = ocr_data.get("supplier") or extracted.get("supplier")
            best_date = ocr_data.get("best_date") or extracted.get("best_date")
            best_amount = ocr_data.get("best_amount") or extracted.get("best_amount")

            if supplier:
                libelle = op.get("Libellé", "") or ""
                ocr_prefill["designation"] = (
                    f"{supplier} — {libelle}" if libelle else supplier
                )
            if best_date:
                ocr_prefill["date_acquisition"] = best_date
            if best_amount:
                try:
                    ocr_prefill["base_amortissable"] = float(best_amount)
                except (ValueError, TypeError):
                    pass

    return {
        "operation": op,
        "filename": filename,
        "index": index,
        "justificatif": justificatif,
        "ocr_prefill": ocr_prefill,
    }


# ─── Helpers GED dotation (pattern direct metadata, miroir charges_forfaitaires) ───

def _register_dotation_ged_entry(
    pdf_filename: str,
    year: int,
    montant_deductible: float,
    nb_immos: int,
    op_file: str,
    op_index: int,
) -> str:
    """Enregistre le PDF dotation dans la GED comme `type: "rapport"`.

    `report_type: "amortissement"` (pour filtrage GED `?type=rapport&report_type=amortissement`)
    et `source_module: "amortissements"` (pour navigation retour vers `/amortissements`).
    """
    from backend.core.config import BASE_DIR, REPORTS_DIR
    from backend.services.ged_service import load_metadata, save_metadata

    src_path = REPORTS_DIR / pdf_filename
    try:
        doc_id = str(src_path.relative_to(BASE_DIR))
    except ValueError:
        doc_id = str(src_path)

    metadata = load_metadata()
    docs = metadata.get("documents", {})
    now = datetime.now().isoformat()

    docs[doc_id] = {
        "doc_id": doc_id,
        "type": "rapport",
        "filename": pdf_filename,
        "year": year,
        "month": 12,
        "poste_comptable": None,
        "categorie": "Dotations aux amortissements",
        "sous_categorie": None,
        "montant_brut": None,
        "deductible_pct_override": None,
        "tags": [],
        "notes": "",
        "added_at": now,
        "original_name": pdf_filename,
        "ocr_file": None,
        "fournisseur": None,
        "date_document": f"{year}-12-31",
        "date_operation": f"{year}-12-31",
        "period": {"year": year, "month": 12, "quarter": 4},
        "montant": montant_deductible,
        "ventilation_index": None,
        "is_reconstitue": False,
        "operation_ref": f"{op_file}:{op_index}",
        "source_module": "amortissements",
        "rapport_meta": {
            "template_id": None,
            "report_type": "amortissement",
            "title": f"État des amortissements {year}",
            "description": (
                f"Dotation déductible {montant_deductible:.2f} € — "
                f"{nb_immos} immo(s) active(s) — art. 39-1-2° CGI"
            ),
            "filters": {
                "year": year,
                "month": 12,
                "report_type": "amortissement",
            },
            "format": "pdf",
            "favorite": False,
            "generated_at": now,
            "can_regenerate": True,
            "can_compare": False,
        },
    }

    metadata["documents"] = docs
    save_metadata(metadata)
    logger.info("GED dotation amortissement enregistré: %s", doc_id)
    return doc_id


def _remove_dotation_ged_entry(pdf_filename: str) -> None:
    """Supprime du metadata GED toutes les entrées matchant `pdf_filename`.

    Best-effort : log un warning sans lever en cas d'échec (la suppression du PDF
    disque reste faite indépendamment).
    """
    from backend.services.ged_service import load_metadata, save_metadata

    try:
        metadata = load_metadata()
        docs = metadata.get("documents", {})
        to_remove = [
            doc_id for doc_id, doc in docs.items()
            if doc.get("filename") == pdf_filename
            or doc.get("original_name") == pdf_filename
            or Path(doc_id).name == pdf_filename
        ]
        for doc_id in to_remove:
            docs.pop(doc_id, None)
            logger.info("GED dotation supprimée: %s", doc_id)
        if to_remove:
            metadata["documents"] = docs
            save_metadata(metadata)
    except Exception as e:
        logger.warning("Suppression GED dotation %s échouée: %s", pdf_filename, e)
