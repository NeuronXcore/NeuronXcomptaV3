"""
Anticipation des régularisations URSSAF (BNC libéral).

Mécanisme URSSAF en 2 temps :
  - Acomptes versés en année N, calculés sur BNC N-2 (déclaré).
  - Régularisation versée en N+1 (typiquement appel d'octobre/novembre), basée
    sur le BNC réel de N une fois la liasse fiscale déposée.

Si BNC monte fortement, régul positive (à payer en plus).
Si BNC chute, remboursement.

Ce service compose les fonctions existantes (`bnc_service.compute_bnc`,
`fiscal_service.estimate_urssaf` / `forecast_bnc`) sans introduire de modèle
métier nouveau.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _classify_signe(ecart: float, tolerance: float = 100.0) -> str:
    """`regul` (à payer) / `remboursement` / `equilibre`."""
    if abs(ecart) < tolerance:
        return "equilibre"
    return "regul" if ecart > 0 else "remboursement"


def _compute_urssaf_paye_cash(year: int) -> float:
    """Somme des Débits URSSAF effectivement payés en cash sur l'année."""
    from backend.services import operation_service
    from backend.services.fiscal_service import _is_urssaf_op

    files = operation_service.list_operation_files()
    total = 0.0
    for finfo in files:
        if finfo.get("year") != year:
            continue
        try:
            ops = operation_service.load_operations(finfo["filename"])
        except Exception:
            continue
        for op in ops:
            if not _is_urssaf_op(op):
                continue
            d = abs(op.get("Débit", 0) or 0)
            if d > 0:
                total += d
    return total


def compute_urssaf_regul_estimate(year: int) -> dict:
    """Compare l'URSSAF dû sur le BNC réel de N à l'URSSAF effectivement payée
    en cash en N. L'écart correspond à la régularisation (ou remboursement)
    qui sera traitée en N+1 par l'URSSAF.

    Args:
        year: année à analyser.

    Returns:
        dict {year, bnc_n, urssaf_du, urssaf_paye_cash, ecart_regul, signe,
              confiance, taux_couverture}.
        - `confiance: "definitif"` si la liasse SCP de N est saisie, sinon
          `"provisoire"`.
        - `taux_couverture` : urssaf_paye_cash / urssaf_du (0.0 à 1.0+).
    """
    from backend.services import bnc_service, fiscal_service, liasse_scp_service

    bnc_breakdown = bnc_service.compute_bnc(year)
    bnc_n = float(bnc_breakdown.bnc)

    bareme = fiscal_service.load_bareme("urssaf", year)
    urssaf_estimate = fiscal_service.estimate_urssaf(bnc_n, bareme) if bareme else {"total": 0.0}
    urssaf_du = float(urssaf_estimate.get("total", 0.0))

    urssaf_paye_cash = _compute_urssaf_paye_cash(year)
    ecart_regul = round(urssaf_du - urssaf_paye_cash, 2)

    confiance = "definitif" if liasse_scp_service.get_ca_for_bnc(year) is not None else "provisoire"
    taux_couverture = round(urssaf_paye_cash / urssaf_du, 4) if urssaf_du > 0 else 0.0

    return {
        "year": year,
        "bnc_n": round(bnc_n, 2),
        "urssaf_du": round(urssaf_du, 2),
        "urssaf_paye_cash": round(urssaf_paye_cash, 2),
        "ecart_regul": ecart_regul,
        "signe": _classify_signe(ecart_regul),
        "confiance": confiance,
        "taux_couverture": taux_couverture,
        "base_recettes": bnc_breakdown.base_recettes,
    }


def compute_acompte_theorique(year: int) -> dict:
    """Calcule l'acompte URSSAF théorique de l'année N sur la base du BNC N-2.

    URSSAF assoit ses acomptes provisionnels sur le revenu N-2 (le dernier
    déclaré). Cette fonction dit combien l'utilisateur DEVRAIT payer en
    acomptes en N selon ce mécanisme. À comparer aux paiements effectifs
    pour anticiper la régul N+1.

    Returns:
        dict {year, bnc_ref, year_ref, acompte_total, mensuel} ou
        {year, bnc_ref: None, ...} si BNC N-2 indisponible.
    """
    from backend.services import bnc_service, fiscal_service

    year_ref = year - 2
    try:
        bnc_breakdown = bnc_service.compute_bnc(year_ref)
        bnc_ref = float(bnc_breakdown.bnc)
    except Exception as e:
        logger.warning("BNC %s indisponible: %s", year_ref, e)
        return {
            "year": year,
            "year_ref": year_ref,
            "bnc_ref": None,
            "acompte_total": 0.0,
            "mensuel": 0.0,
        }

    bareme = fiscal_service.load_bareme("urssaf", year)
    urssaf_estimate = fiscal_service.estimate_urssaf(bnc_ref, bareme) if bareme else {"total": 0.0}
    acompte_total = float(urssaf_estimate.get("total", 0.0))

    return {
        "year": year,
        "year_ref": year_ref,
        "bnc_ref": round(bnc_ref, 2),
        "acompte_total": round(acompte_total, 2),
        "mensuel": round(acompte_total / 12, 2),
    }


def project_cotisations_multi_years(start_year: int, horizon: int = 5) -> list[dict]:
    """Projette les cotisations URSSAF sur `horizon` années à partir de
    `start_year`.

    Pour chaque année :
      - BNC réel si disponible (passé / courant), sinon forecast linéaire.
      - URSSAF dû calculé via `estimate_urssaf` sur ce BNC.
      - Acompte théorique calculé sur BNC N-2 (réel ou forecast).
      - Régul = URSSAF dû − acompte théorique.

    Returns:
        list[{year, statut: "passe"|"courant"|"futur", bnc, bnc_origine,
              urssaf_du, acompte_theorique, regul_estimee, signe}]
    """
    from datetime import datetime

    from backend.services import bnc_service, fiscal_service

    current_year = datetime.now().year

    historique = fiscal_service.get_historical_bnc()
    annual_bncs = {a["year"]: a["bnc"] for a in historique.get("annual", [])}

    forecast = fiscal_service.forecast_bnc(horizon_mois=horizon * 12, methode="saisonnier")
    forecast_by_year: dict[int, float] = {}
    for prev in forecast.get("previsions", []):
        y = prev.get("year")
        if y is None:
            continue
        forecast_by_year[y] = forecast_by_year.get(y, 0.0) + float(prev.get("bnc_prevu", 0.0))

    def _bnc_for(year: int) -> tuple[Optional[float], str]:
        """(bnc, origine) où origine ∈ {real, forecast, unknown}."""
        if year in annual_bncs:
            return float(annual_bncs[year]), "real"
        if year in forecast_by_year:
            return float(forecast_by_year[year]), "forecast"
        return None, "unknown"

    results: list[dict] = []
    for offset in range(horizon):
        y = start_year + offset
        bnc, origine = _bnc_for(y)
        bnc_n_moins_2, _ = _bnc_for(y - 2)

        bareme = fiscal_service.load_bareme("urssaf", y)
        urssaf_du = 0.0
        if bnc is not None and bareme:
            urssaf_du = float(fiscal_service.estimate_urssaf(bnc, bareme).get("total", 0.0))

        acompte_theo = 0.0
        if bnc_n_moins_2 is not None and bareme:
            acompte_theo = float(fiscal_service.estimate_urssaf(bnc_n_moins_2, bareme).get("total", 0.0))

        regul = round(urssaf_du - acompte_theo, 2)

        if y < current_year:
            statut = "passe"
        elif y == current_year:
            statut = "courant"
        else:
            statut = "futur"

        results.append({
            "year": y,
            "statut": statut,
            "bnc": round(bnc, 2) if bnc is not None else None,
            "bnc_origine": origine,
            "bnc_n_moins_2": round(bnc_n_moins_2, 2) if bnc_n_moins_2 is not None else None,
            "urssaf_du": round(urssaf_du, 2),
            "acompte_theorique": round(acompte_theo, 2),
            "regul_estimee": regul,
            "signe": _classify_signe(regul),
        })

    return results


def compute_bnc_delta_pct(year: int) -> Optional[float]:
    """Écart relatif BNC N vs BNC N-2 en pourcentage. None si N-2 indisponible.

    Utilisé par l'auto-task `urssaf_regul_alert` pour détecter une volatilité
    du revenu suffisante pour générer une régul significative.
    """
    from backend.services import bnc_service

    try:
        bnc_n = float(bnc_service.compute_bnc(year).bnc)
        bnc_n_moins_2 = float(bnc_service.compute_bnc(year - 2).bnc)
    except Exception:
        return None
    if bnc_n_moins_2 == 0:
        return None
    return round((bnc_n - bnc_n_moins_2) / abs(bnc_n_moins_2) * 100, 2)
