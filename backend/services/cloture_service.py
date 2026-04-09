"""
Service pour la clôture comptable.
Vue annuelle mois par mois montrant l'état de complétude.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.core.config import MOIS_FR, ensure_directories
from backend.services import operation_service, justificatif_service

logger = logging.getLogger(__name__)


def get_available_years() -> list[int]:
    """Retourne la liste des années pour lesquelles des opérations existent."""
    ensure_directories()
    files = operation_service.list_operation_files()
    years = set()
    for f in files:
        if f.get("year"):
            years.add(f["year"])
    return sorted(years, reverse=True)


def get_annual_status(year: int) -> list[dict]:
    """Pour chaque mois 1-12, retourne le statut de complétude comptable."""
    ensure_directories()
    files = operation_service.list_operation_files()

    # Grouper les fichiers par mois pour l'année demandée
    files_by_month: dict[int, list[dict]] = {}
    for f in files:
        if f.get("year") == year and f.get("month"):
            month = f["month"]
            if month not in files_by_month:
                files_by_month[month] = []
            files_by_month[month].append(f)

    result = []
    for mois in range(1, 13):
        month_files = files_by_month.get(mois, [])
        has_releve = len(month_files) > 0

        if not has_releve:
            result.append({
                "mois": mois,
                "label": MOIS_FR[mois - 1].capitalize(),
                "has_releve": False,
                "filename": None,
                "nb_operations": 0,
                "nb_lettrees": 0,
                "taux_lettrage": 0.0,
                "nb_justificatifs_total": 0,
                "nb_justificatifs_ok": 0,
                "taux_justificatifs": 0.0,
                "statut": "manquant",
            })
            continue

        # Agréger les opérations de tous les fichiers du mois
        nb_operations = 0
        nb_lettrees = 0
        nb_avec_justif = 0

        primary_filename = month_files[0]["filename"]

        from backend.services.justificatif_exemption_service import is_justificatif_required

        nb_justif_required = 0  # ops qui nécessitent un justificatif

        for mf in month_files:
            try:
                ops = operation_service.load_operations(mf["filename"])
                for op in ops:
                    vlines = op.get("ventilation", [])
                    if vlines:
                        nb_operations += len(vlines)
                        nb_lettrees += sum(1 for vl in vlines if vl.get("lettre", False))
                        for vl in vlines:
                            vl_cat = (vl.get("categorie") or "").strip()
                            vl_sub = (vl.get("sous_categorie") or "").strip()
                            if is_justificatif_required(vl_cat, vl_sub):
                                nb_justif_required += 1
                                if vl.get("justificatif"):
                                    nb_avec_justif += 1
                    else:
                        nb_operations += 1
                        if op.get("lettre", False):
                            nb_lettrees += 1
                        op_cat = (op.get("Catégorie") or "").strip()
                        op_sub = (op.get("Sous-catégorie") or "").strip()
                        if is_justificatif_required(op_cat, op_sub):
                            nb_justif_required += 1
                            if op.get("Justificatif", False):
                                nb_avec_justif += 1
            except Exception as e:
                logger.warning(f"Erreur chargement {mf['filename']}: {e}")

        taux_lettrage = nb_lettrees / nb_operations if nb_operations > 0 else 0.0

        # Justificatifs associés au mois (exclut les ops exemptées)
        nb_justif_total = nb_justif_required
        nb_justif_ok = nb_avec_justif
        taux_justificatifs = nb_justif_ok / nb_justif_total if nb_justif_total > 0 else 1.0

        # Déterminer le statut
        if taux_lettrage >= 1.0 and taux_justificatifs >= 1.0:
            statut = "complet"
        else:
            statut = "partiel"

        result.append({
            "mois": mois,
            "label": MOIS_FR[mois - 1].capitalize(),
            "has_releve": True,
            "filename": primary_filename,
            "nb_operations": nb_operations,
            "nb_lettrees": nb_lettrees,
            "taux_lettrage": round(taux_lettrage, 4),
            "nb_justificatifs_total": nb_justif_total,
            "nb_justificatifs_ok": nb_justif_ok,
            "taux_justificatifs": round(taux_justificatifs, 4),
            "statut": statut,
        })

    return result
