"""
ProjectionService — projection de fin d'année (recettes / charges / BNC).

V1 = adaptateur sur `previsionnel_service.get_timeline(year)` qui projette déjà
via régression linéaire saisonnière + providers récurrents. Si le Prévisionnel
n'a pas de données exploitables, retombe sur un Fallback YTD × (12/n).

Interface stable (Protocol IProjectionProvider) : permet une V2 future
(ML, Monte-Carlo, etc.) sans toucher au LivretService consommateur.

Cf. prompt-livret-comptable-phase1.md §4.2.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional, Protocol

from backend.models.livret import ProjectionResult

logger = logging.getLogger(__name__)


# ─── Interface ─────────────────────────────────────────────────────

class IProjectionProvider(Protocol):
    def project(self, year: int, as_of_date: date) -> ProjectionResult: ...


# ─── Helpers ──────────────────────────────────────────────────────

def _months_elapsed(year: int, as_of: date) -> int:
    """Nombre de mois écoulés (clos) dans `year` au regard de `as_of`.

    - Année passée close : 12
    - Année future : 0
    - Année courante : as_of.month - 1 (mois courant en cours = pas encore clos)
    """
    if as_of.year > year:
        return 12
    if as_of.year < year:
        return 0
    # Année courante : on compte les mois clos uniquement (jan..mois-1)
    return max(0, as_of.month - 1)


def _is_past_month(year: int, month: int, as_of: date) -> bool:
    """True si le mois est entièrement clos par rapport à as_of."""
    if as_of.year > year:
        return True
    if as_of.year < year:
        return False
    return month < as_of.month


def _is_current_month(year: int, month: int, as_of: date) -> bool:
    """True si le mois est en cours par rapport à as_of."""
    return as_of.year == year and month == as_of.month


def _ytd_from_overview(year: int, as_of: date) -> tuple[dict[int, float], dict[int, float], dict[int, float], dict[int, float]]:
    """Récupère les valeurs réelles mensuelles depuis analytics_service.get_year_overview.

    Retourne (recettes_past, charges_past, recettes_current_partial, charges_current_partial).
    Les mois passés ET le mois courant (partiel) sont en clé. Mois futurs absents.
    """
    from backend.services import analytics_service

    overview = analytics_service.get_year_overview(year)
    # analytics_service expose la liste mensuelle sous la clé "mois" (fallback "mois_data" par compat).
    mois_data = overview.get("mois") or overview.get("mois_data") or []

    recettes_past: dict[int, float] = {}
    charges_past: dict[int, float] = {}
    recettes_current: dict[int, float] = {}
    charges_current: dict[int, float] = {}

    for m_data in mois_data:
        m = int(m_data.get("mois", 0))
        if m < 1 or m > 12:
            continue
        recettes = float(m_data.get("bnc_recettes_pro", 0.0) or 0.0)
        charges = float(m_data.get("bnc_charges_pro", 0.0) or 0.0)
        if _is_past_month(year, m, as_of):
            recettes_past[m] = recettes
            charges_past[m] = charges
        elif _is_current_month(year, m, as_of):
            recettes_current[m] = recettes
            charges_current[m] = charges
        # Mois futurs : valeurs réelles ignorées (peuvent contenir 0)

    return recettes_past, charges_past, recettes_current, charges_current


# ─── Provider Prévisionnel (V1) ───────────────────────────────────

class PrevisionnelProjectionProvider:
    """Adapte `previsionnel_service.get_timeline(year)` au format ProjectionResult.

    Pour chaque mois > as_of.month : utilise mois.charges_total / mois.recettes_total
    (le Prévisionnel projette déjà via régression saisonnière + providers récurrents).
    Pour les mois ≤ as_of.month : utilise les données réelles depuis analytics_service.
    """

    def project(self, year: int, as_of_date: date) -> ProjectionResult:
        from backend.services import (
            amortissement_service,
            charges_forfaitaires_service,
            previsionnel_service,
        )

        recettes_past, charges_past, recettes_current, charges_current = _ytd_from_overview(year, as_of_date)

        # Fetch timeline (peut lever en cas d'erreur backend → caller gère le fallback)
        timeline = previsionnel_service.get_timeline(year)

        # Détection "vide" : ni charges ni recettes annuelles → fallback côté caller
        annual_charges_prev = float(getattr(timeline, "charges_annuelles", 0.0) or 0.0)
        annual_recettes_prev = float(getattr(timeline, "recettes_annuelles", 0.0) or 0.0)
        if annual_charges_prev <= 0.0 and annual_recettes_prev <= 0.0:
            raise _EmptyTimeline()

        monthly_recettes: dict[int, float] = {}
        monthly_charges: dict[int, float] = {}

        # Prévisionnel par mois — index par numéro de mois
        prev_by_month: dict[int, dict] = {}
        for tm in getattr(timeline, "mois", []) or []:
            m = int(getattr(tm, "mois", 0) or 0)
            if 1 <= m <= 12:
                prev_by_month[m] = {
                    "charges_total": float(getattr(tm, "charges_total", 0.0) or 0.0),
                    "recettes_total": float(getattr(tm, "recettes_total", 0.0) or 0.0),
                }

        for m in range(1, 13):
            if m in recettes_past:
                # Mois clos — données réelles
                monthly_recettes[m] = recettes_past[m]
                monthly_charges[m] = charges_past[m]
            elif m in recettes_current:
                # Mois courant partiel — réel partiel + complément projection sur jours restants
                # Phase 1 : on garde la valeur réelle telle quelle (partielle).
                # Le Prévisionnel pourrait fournir un complément, mais c'est déjà ce qu'il fait
                # globalement — on évite un double-comptage.
                monthly_recettes[m] = recettes_current[m]
                monthly_charges[m] = charges_current[m]
            else:
                # Mois futur — projection Prévisionnel
                prev = prev_by_month.get(m, {"charges_total": 0.0, "recettes_total": 0.0})
                monthly_recettes[m] = prev["recettes_total"]
                monthly_charges[m] = prev["charges_total"]

        annual_recettes = round(sum(monthly_recettes.values()), 2)
        annual_charges = round(sum(monthly_charges.values()), 2)

        # Dotations + forfaits annuels (pour BNC projeté)
        try:
            dotations = float(amortissement_service.get_dotations(year).get("total_deductible", 0.0) or 0.0)
        except Exception as e:
            logger.warning("get_dotations(%s) failed: %s", year, e)
            dotations = 0.0
        try:
            forfaits = float(charges_forfaitaires_service.get_total_deductible_year(year) or 0.0)
        except Exception as e:
            logger.warning("get_total_deductible_year(%s) failed: %s", year, e)
            forfaits = 0.0

        bnc_projected = round(annual_recettes - annual_charges - dotations - forfaits, 2)

        # Confiance : haute si on a des données passées + futur projeté, moyenne sinon
        n_past = len(recettes_past)
        if n_past >= 6:
            confidence = "high"
        elif n_past >= 2:
            confidence = "medium"
        else:
            confidence = "low"

        return ProjectionResult(
            year=year,
            as_of_date=as_of_date.isoformat(),
            monthly_recettes={m: round(v, 2) for m, v in monthly_recettes.items()},
            monthly_charges={m: round(v, 2) for m, v in monthly_charges.items()},
            annual_recettes_projected=annual_recettes,
            annual_charges_projected=annual_charges,
            bnc_projected_annual=bnc_projected,
            source="previsionnel",
            confidence=confidence,
        )


class _EmptyTimeline(Exception):
    """Signal interne : timeline Prévisionnel sans donnée exploitable."""


# ─── Fallback YTD × 12/n ──────────────────────────────────────────

class FallbackProjectionProvider:
    """Extrapolation linéaire moyenne YTD : monthly_future = ytd_total / months_elapsed."""

    def project(self, year: int, as_of_date: date) -> ProjectionResult:
        from backend.services import amortissement_service, charges_forfaitaires_service

        recettes_past, charges_past, recettes_current, charges_current = _ytd_from_overview(year, as_of_date)
        n_past = len(recettes_past)

        # Moyenne mensuelle des mois clos
        if n_past > 0:
            avg_recettes = sum(recettes_past.values()) / n_past
            avg_charges = sum(charges_past.values()) / n_past
        else:
            avg_recettes = 0.0
            avg_charges = 0.0

        monthly_recettes: dict[int, float] = {}
        monthly_charges: dict[int, float] = {}

        for m in range(1, 13):
            if m in recettes_past:
                monthly_recettes[m] = recettes_past[m]
                monthly_charges[m] = charges_past[m]
            elif m in recettes_current:
                monthly_recettes[m] = recettes_current[m]
                monthly_charges[m] = charges_current[m]
            else:
                # Mois futur — extrapolation moyenne
                monthly_recettes[m] = avg_recettes
                monthly_charges[m] = avg_charges

        annual_recettes = round(sum(monthly_recettes.values()), 2)
        annual_charges = round(sum(monthly_charges.values()), 2)

        try:
            dotations = float(amortissement_service.get_dotations(year).get("total_deductible", 0.0) or 0.0)
        except Exception:
            dotations = 0.0
        try:
            forfaits = float(charges_forfaitaires_service.get_total_deductible_year(year) or 0.0)
        except Exception:
            forfaits = 0.0

        bnc_projected = round(annual_recettes - annual_charges - dotations - forfaits, 2)

        # Si rien du tout (année future sans données) → source 'empty'
        source: str = "empty" if (n_past == 0 and not recettes_current) else "fallback_ytd_extrapolation"

        return ProjectionResult(
            year=year,
            as_of_date=as_of_date.isoformat(),
            monthly_recettes={m: round(v, 2) for m, v in monthly_recettes.items()},
            monthly_charges={m: round(v, 2) for m, v in monthly_charges.items()},
            annual_recettes_projected=annual_recettes,
            annual_charges_projected=annual_charges,
            bnc_projected_annual=bnc_projected,
            source=source,  # type: ignore[arg-type]
            confidence="low",
        )


# ─── API publique ─────────────────────────────────────────────────

def project(year: int, as_of_date: Optional[date] = None) -> ProjectionResult:
    """Tente PrevisionnelProjectionProvider, retombe sur Fallback si la timeline est vide.

    `as_of_date` par défaut = aujourd'hui (mode live). Pour année passée close, pensez à
    clamper côté caller au 31/12 de l'année.
    """
    if as_of_date is None:
        as_of_date = date.today()

    primary = PrevisionnelProjectionProvider()
    try:
        return primary.project(year, as_of_date)
    except _EmptyTimeline:
        logger.info("Projection: timeline Prévisionnel vide pour %s, fallback YTD × 12/n", year)
    except Exception as e:
        logger.warning("Projection: PrevisionnelProvider a échoué pour %s (%s), fallback YTD", year, e)

    fallback = FallbackProjectionProvider()
    return fallback.project(year, as_of_date)
