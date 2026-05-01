"""
LivretService — agrégateur du Livret comptable vivant.

Phase 1 — Compose 3 chapitres pilotes (01 Synthèse, 02 Recettes, 03 Charges pro)
à partir des services métier existants :
  - analytics_service.get_year_overview(year)       → KPIs mensuels
  - bnc_service.compute_bnc(year)                    → BNC fiscal source unique
  - liasse_scp_service.get_ca_for_bnc(year)          → CA déclaré (si saisi)
  - amortissement_service.get_dotations(year)        → dotations annuelles
  - charges_forfaitaires_service.get_total_deductible_year(year) → forfaits
  - projection_service.project(year, as_of)          → projection fin d'année

Pattern fondamental : ce service ne touche jamais directement aux fichiers JSON
d'opérations. Il consomme uniquement les services métier existants (cf. CLAUDE.md).

Cf. prompt-livret-comptable-phase1.md §4.3.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime
from typing import Optional

from backend.models.livret import (
    CompareMode,
    Livret,
    LivretAmortissementImmo,
    LivretAmortissementsChapter,
    LivretAnnexeBareme,
    LivretAnnexeChapter,
    LivretAnnexeJustifEntry,
    LivretBncChapter,
    LivretBncFormulaLine,
    LivretBncProjection,
    LivretChapter,
    LivretDelta,
    LivretFlag,
    LivretForfaitDecomposition,
    LivretForfaitairesChapter,
    LivretMetadata,
    LivretMetric,
    LivretMonthPoint,
    LivretOperation,
    LivretProvisionGauge,
    LivretProvisionsChapter,
    LivretSubcategory,
    LivretSynthese,
    LivretSyntheseChapter,
    TocEntry,
)

logger = logging.getLogger(__name__)


# ─── Constantes ────────────────────────────────────────────────────

# Catégories à exclure du chapitre 03 (Charges pro). Phase 1 :
# - Forfaits (déjà dans des chapitres dédiés en Phase 2)
# - Immobilisations / Dotations / Ventilé (cf. analytics_service.EXCLUDED_FROM_CHARGES_PRO)
#
# Les forfaits véhicule sont catégorisés "Véhicule / Quote-part professionnelle" et
# leurs dépenses bancaires régulières (carburant, péage…) sont en "Véhicule" — ces
# dernières apparaissent en chapitre 03. Seules les OD signalétiques véhicule
# (op avec source="vehicule" ET montant=0) sont à exclure pour éviter le bruit visuel.
EXCLUDED_FROM_CHARGES_PRO_CHAPTER: set[str] = {
    "Immobilisations",
    "Dotations aux amortissements",
    "Ventilé",  # parente — les sous-lignes sont éclatées
}

EXCLUDED_SOURCES_FROM_CHARGES_PRO: set[str] = {
    "amortissement",  # OD dotation 31/12 — vit dans son propre chapitre
    "blanchissage",   # OD forfait — vit dans son propre chapitre (Phase 2)
    "repas",          # OD forfait
    "vehicule",       # OD signalétique
}

# Catégories des recettes pro (chapitre 02) — utilisé en filtre source.
# Heuristique simple Phase 1 : op pro avec Crédit > 0.
MOIS_FR_SHORT = ["jan", "fév", "mar", "avr", "mai", "jun", "jui", "aoû", "sep", "oct", "nov", "déc"]


# ─── Helpers ───────────────────────────────────────────────────────

def _today_clamped(year: int, as_of_date: Optional[date]) -> date:
    """Clamp as_of à 31/12/year pour exercice clôturé, today() par défaut, 01/01/year pour année future."""
    if as_of_date is None:
        as_of_date = date.today()
    today = date.today()

    if year < today.year:
        # Exercice clos — clamp au 31/12/year
        return date(year, 12, 31)
    if year > today.year:
        # Année future — clamp au 01/01/year (months_elapsed=0)
        return date(year, 1, 1)
    return as_of_date


def _months_elapsed_remaining(year: int, as_of: date) -> tuple[int, int]:
    """Mois écoulés (clos) / restants pour un exercice donné.

    - Année passée (today.year > year) : 12 / 0 (peu importe as_of, l'exercice est clos).
    - Année future (today.year < year) : 0 / 12.
    - Année courante : (mois courant - 1) / (12 - mois courant + 1).
      Le mois en cours est compté dans les "restants" car non clos.
    """
    today = date.today()
    if today.year > year:
        return 12, 0
    if today.year < year:
        return 0, 12
    elapsed = max(0, today.month - 1)
    return elapsed, 12 - elapsed


def _format_short_date_fr(d: date) -> str:
    return f"{d.day} {MOIS_FR_SHORT[d.month - 1]}. {d.year}"


def _detect_data_sources(year: int) -> dict[str, bool]:
    """Indique quelles sources de données alimentent ce livret."""
    sources: dict[str, bool] = {}

    try:
        from backend.services import liasse_scp_service
        sources["liasse_scp"] = liasse_scp_service.get_ca_for_bnc(year) is not None
    except Exception:
        sources["liasse_scp"] = False

    try:
        from backend.services import previsionnel_service
        timeline = previsionnel_service.get_timeline(year)
        sources["previsionnel"] = (
            float(getattr(timeline, "charges_annuelles", 0) or 0) > 0
            or float(getattr(timeline, "recettes_annuelles", 0) or 0) > 0
        )
    except Exception:
        sources["previsionnel"] = False

    try:
        from backend.services import amortissement_service
        dotations = amortissement_service.get_dotations(year)
        sources["amortissements"] = float(dotations.get("total_deductible", 0) or 0) > 0
    except Exception:
        sources["amortissements"] = False

    try:
        from backend.services import charges_forfaitaires_service
        forfaits = charges_forfaitaires_service.get_total_deductible_year(year)
        sources["forfaits"] = float(forfaits or 0) > 0
    except Exception:
        sources["forfaits"] = False

    return sources


def _load_year_operations_with_meta(year: int) -> list[tuple[str, int, dict]]:
    """Charge toutes les opérations d'une année avec leur (filename, index_in_file).

    Retour : liste de tuples (filename, op_index, op_dict). Ne touche JAMAIS aux JSON
    directement — délègue à operation_service. Filtre sur l'année via la `Date` réelle
    de l'op (les filenames merged peuvent contenir plusieurs mois).
    """
    from backend.services import operation_service

    out: list[tuple[str, int, dict]] = []
    files = operation_service.list_operation_files()
    for meta in files:
        if meta.get("year") != year:
            continue
        try:
            ops = operation_service.load_operations(meta["filename"])
        except Exception as e:
            logger.warning("load_operations(%s) failed: %s", meta.get("filename"), e)
            continue
        for idx, op in enumerate(ops):
            d = op.get("Date") or ""
            if isinstance(d, str) and d.startswith(f"{year}-"):
                out.append((meta["filename"], idx, op))
    return out


# ─── Mapping postes (taux pro résolu via ged_service) ──────────────

def _build_postes_index() -> dict[str, dict]:
    """Index `categorie → poste` (premier match). Lève silencieusement → dict vide."""
    try:
        from backend.services import ged_service
        postes_data = ged_service.load_postes()
        index: dict[str, dict] = {}
        for poste in postes_data.get("postes", []):
            for cat in poste.get("categories_associees", []) or []:
                if cat and cat not in index:
                    index[cat] = poste
        return index
    except Exception as e:
        logger.warning("Failed to build postes index: %s", e)
        return {}


def _resolve_taux_pro(categorie: str, postes_index: dict[str, dict]) -> Optional[float]:
    """Résout le `deductible_pct` du poste comptable de la catégorie. None si inconnu."""
    if not categorie:
        return None
    poste = postes_index.get(categorie)
    if not poste:
        return None
    pct = poste.get("deductible_pct")
    if pct is None:
        return None
    try:
        return float(pct)
    except Exception:
        return None


# ─── Construction des LivretFlag / LivretOperation ────────────────

def _flags_from_op(op: dict, taux_pro: Optional[float] = None) -> LivretFlag:
    """Calcule les flags affichables d'une opération."""
    has_justif = bool(op.get("Justificatif")) or bool(op.get("Lien justificatif"))
    return LivretFlag(
        a_revoir=bool(op.get("A_revoir") or op.get("À_revoir") or op.get("a_revoir")),
        important=bool(op.get("Important")),
        justificatif_manquant=not has_justif and op.get("source") not in EXCLUDED_SOURCES_FROM_CHARGES_PRO,
        locked=bool(op.get("locked")),
        lettre=bool(op.get("lettre")),
        is_mixte=(taux_pro is not None and 0 < taux_pro < 100),
    )


def _vlflags_from_vline(vl: dict, parent_op: dict) -> LivretFlag:
    """Flags pour une sous-ligne de ventilation (hérite quelques flags du parent)."""
    has_justif = bool(vl.get("justificatif"))
    return LivretFlag(
        a_revoir=bool(parent_op.get("A_revoir") or parent_op.get("À_revoir")),
        important=bool(parent_op.get("Important")),
        justificatif_manquant=not has_justif,
        locked=bool(parent_op.get("locked")),
        lettre=bool(vl.get("lettre")),
        is_mixte=False,
    )


# ─── Chapitre 01 — Synthèse exécutive ─────────────────────────────

def _build_synthese_chapter(
    year: int,
    as_of: date,
    bnc_breakdown,
    overview: dict,
    projection,
) -> LivretSynthese:
    """Compose le chapitre 01 (4 metrics + cadence mensuelle 12 points)."""
    months_elapsed, _ = _months_elapsed_remaining(year, as_of)

    # 4 metrics
    metrics = [
        LivretMetric(
            label="Recettes pro YTD",
            value=round(bnc_breakdown.recettes_pro_bancaires, 2),
            unit="EUR",
            is_projection=False,
        ),
        LivretMetric(
            label="Charges pro YTD",
            value=round(bnc_breakdown.charges_pro, 2),
            unit="EUR",
            is_projection=False,
        ),
        LivretMetric(
            label="BNC YTD",
            value=round(
                bnc_breakdown.recettes_pro - bnc_breakdown.charges_pro
                - bnc_breakdown.dotations_amortissements - bnc_breakdown.forfaits_total,
                2,
            ),
            unit="EUR",
            is_projection=False,
        ),
        LivretMetric(
            label="BNC projeté annuel",
            value=round(projection.bnc_projected_annual, 2),
            unit="EUR",
            is_projection=True,
        ),
    ]

    # Cadence mensuelle 12 points — état (passé/courant/futur) calculé par rapport
    # à la date du jour réelle (et non as_of qui peut être clampée pour exercice clos).
    today = date.today()
    # Note : analytics_service.get_year_overview retourne la liste mensuelle sous la
    # clé "mois" (et non "mois_data" — fallback de compat pour robustesse).
    mois_data = {
        int(m.get("mois", 0)): m
        for m in overview.get("mois") or overview.get("mois_data") or []
    }
    cadence: list[LivretMonthPoint] = []
    for m in range(1, 13):
        m_data = mois_data.get(m, {})
        if today.year > year:
            is_past = True
            is_current = False
            is_proj = False
        elif today.year < year:
            is_past = False
            is_current = False
            is_proj = True
        else:
            is_past = m < today.month
            is_current = m == today.month
            is_proj = m > today.month

        if is_proj:
            recettes = float(projection.monthly_recettes.get(m, 0.0))
            charges = float(projection.monthly_charges.get(m, 0.0))
        else:
            # Passé ou courant : utiliser réel mensuel
            recettes = float(m_data.get("bnc_recettes_pro", 0.0) or 0.0)
            charges = float(m_data.get("bnc_charges_pro", 0.0) or 0.0)

        cadence.append(LivretMonthPoint(
            month=m,
            label=MOIS_FR_SHORT[m - 1],
            recettes=round(recettes, 2),
            charges=round(charges, 2),
            is_past=is_past,
            is_current=is_current,
            is_projection=is_proj,
        ))

    synthese = LivretSyntheseChapter(metrics=metrics, cadence_mensuelle=cadence)

    today = date.today()
    if today.year > year:
        tag = "Exercice clôturé · 12 mois clos"
    elif today.year < year:
        tag = "Exercice à venir"
    else:
        tag = f"YTD au {_format_short_date_fr(as_of)} · {months_elapsed} mois clos"

    chap_01 = LivretSynthese(
        number="01",
        title="Synthèse exécutive",
        tag=tag,
        ventilation_mode="none",
        total_ytd=metrics[2].value,  # BNC YTD comme proxy
        total_projected_annual=projection.bnc_projected_annual,
        subcategories=[],
        synthese=synthese,
    )

    # Phase 5 — chart cadence mensuelle (migration progressive depuis _render_cadence_svg).
    try:
        from backend.services import livret_charts_service
        cadence_chart = livret_charts_service.build_cadence_chart(synthese)
        if cadence_chart is not None:
            chap_01.charts = [cadence_chart]
    except Exception as e:
        logger.warning("build_cadence_chart failed: %s", e)

    return chap_01


# ─── Chapitre 02 — Recettes (mode groupé) ─────────────────────────

def _build_recettes_chapter(
    year: int,
    as_of: date,
    ops_with_meta: list[tuple[str, int, dict]],
    annual_recettes_projected: float,
) -> LivretChapter:
    """Compose le chapitre 02 — Recettes, mode groupé (op mère + sous-lignes en arborescence)."""
    # Filtre : ops pro avec Crédit > 0 (recettes)
    sub_groups: dict[str, list[LivretOperation]] = defaultdict(list)
    sub_totals: dict[str, float] = defaultdict(float)
    sub_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"a_revoir": 0, "justif_manquant": 0, "mixte": 0})

    total_ytd = 0.0

    for filename, idx, op in ops_with_meta:
        cat = (op.get("Catégorie") or "").strip()
        cat_lower = cat.lower()
        credit = float(op.get("Crédit") or 0)
        debit = float(op.get("Débit") or 0)

        if credit <= 0:
            continue
        if cat_lower == "perso" or cat == "" or cat_lower == "autres":
            continue
        # Catégorie de classement = la sous-cat de l'op (Quote-part SCP, Honoraires propres, …)
        sub_name = (op.get("Sous-catégorie") or "Non classé").strip() or "Non classé"

        # Mode groupé : op mère = LivretOperation, sub_lines = ventilations si présentes
        ventilation = op.get("ventilation") or []
        sub_lines: Optional[list[LivretOperation]] = None
        if ventilation:
            sub_lines = []
            for vl_idx, vl in enumerate(ventilation):
                sub_lines.append(LivretOperation(
                    operation_file=filename,
                    operation_index=idx,
                    ventilation_index=vl_idx,
                    date=op.get("Date", ""),
                    libelle=vl.get("libelle") or op.get("Libellé", ""),
                    libelle_meta=f"{vl.get('categorie', '')} / {vl.get('sous_categorie', '')}".strip(" /") or None,
                    montant=float(vl.get("montant") or 0),
                    flags=_vlflags_from_vline(vl, op),
                ))

        livret_op = LivretOperation(
            operation_file=filename,
            operation_index=idx,
            ventilation_index=None,
            date=op.get("Date", ""),
            libelle=op.get("Libellé", ""),
            libelle_meta=None,
            montant=credit,
            flags=_flags_from_op(op),
            sub_lines=sub_lines,
        )

        sub_groups[sub_name].append(livret_op)
        sub_totals[sub_name] += credit
        if livret_op.flags.a_revoir:
            sub_counts[sub_name]["a_revoir"] += 1
        if livret_op.flags.justificatif_manquant:
            sub_counts[sub_name]["justif_manquant"] += 1
        # Pas de mixte sur les recettes (heuristique Phase 1)

        total_ytd += credit

    # Tri sous-catégories par total décroissant
    subcategories = []
    for sub_name in sorted(sub_groups.keys(), key=lambda s: sub_totals.get(s, 0), reverse=True):
        ops = sub_groups[sub_name]
        # Tri ops par date décroissante
        ops_sorted = sorted(ops, key=lambda o: o.date or "", reverse=True)
        subcategories.append(LivretSubcategory(
            name=sub_name,
            total_ytd=round(sub_totals[sub_name], 2),
            total_projected_annual=None,  # le projeté annuel reste au niveau chapitre
            nb_operations=len(ops),
            nb_a_revoir=sub_counts[sub_name]["a_revoir"],
            nb_justif_manquant=sub_counts[sub_name]["justif_manquant"],
            nb_mixte=sub_counts[sub_name]["mixte"],
            operations=ops_sorted,
        ))

    return LivretChapter(
        number="02",
        title="Recettes professionnelles",
        tag="Ventilation groupée",
        ventilation_mode="groupe",
        total_ytd=round(total_ytd, 2),
        total_projected_annual=round(float(annual_recettes_projected), 2),
        subcategories=subcategories,
    )


# ─── Chapitre 03 — Charges professionnelles (mode éclaté) ─────────

def _build_charges_pro_chapter(
    year: int,
    as_of: date,
    ops_with_meta: list[tuple[str, int, dict]],
    annual_charges_projected: float,
    postes_index: dict[str, dict],
) -> LivretChapter:
    """Compose le chapitre 03 — Charges pro, mode éclaté.

    Les ventilations sont éclatées en sous-lignes individuelles, chacune dans
    sa vraie sous-catégorie (et non sous "Ventilé"). La part perso est exclue.
    Les forfaits / dotations / immobilisations sont également exclus.
    """
    sub_groups: dict[str, list[LivretOperation]] = defaultdict(list)
    sub_totals: dict[str, float] = defaultdict(float)
    sub_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"a_revoir": 0, "justif_manquant": 0, "mixte": 0})

    total_ytd = 0.0

    for filename, idx, op in ops_with_meta:
        cat = (op.get("Catégorie") or "").strip()
        cat_lower = cat.lower()
        debit = float(op.get("Débit") or 0)
        credit = float(op.get("Crédit") or 0)
        source = op.get("source")

        # Filtre charges (débits) — ignore recettes pures
        if debit <= 0 and credit > 0:
            continue
        # Exclusions strictes
        if cat_lower == "perso":
            continue
        if cat in EXCLUDED_FROM_CHARGES_PRO_CHAPTER and not (op.get("ventilation") or []):
            # "Ventilé" est exclu en tant que parent — les sous-lignes sont injectées séparément
            if cat == "Ventilé":
                pass  # on tombe dans le bloc ventilation ci-dessous
            else:
                continue
        if source in EXCLUDED_SOURCES_FROM_CHARGES_PRO:
            continue

        ventilation = op.get("ventilation") or []
        if ventilation:
            # Mode éclaté : chaque sous-ligne devient une LivretOperation distincte
            for vl_idx, vl in enumerate(ventilation):
                vl_cat = (vl.get("categorie") or "").strip()
                vl_cat_lower = vl_cat.lower()
                vl_sub = (vl.get("sous_categorie") or "Non classé").strip() or "Non classé"
                vl_montant = float(vl.get("montant") or 0)

                if vl_cat_lower == "perso" or vl_montant <= 0:
                    continue
                if vl_cat in EXCLUDED_FROM_CHARGES_PRO_CHAPTER:
                    continue

                taux_pro = _resolve_taux_pro(vl_cat, postes_index)
                effective_montant = vl_montant
                montant_brut: Optional[float] = None
                libelle_meta = None

                if taux_pro is not None and taux_pro < 100:
                    # En mode éclaté, on conserve `montant` = montant ventilation (ce
                    # que l'utilisateur a saisi). Si taux pro < 100, on l'indique en méta.
                    libelle_meta = f"mixte {int(taux_pro)}%"
                    montant_brut = vl_montant

                key = f"{vl_cat} / {vl_sub}" if vl_sub else vl_cat
                livret_op = LivretOperation(
                    operation_file=filename,
                    operation_index=idx,
                    ventilation_index=vl_idx,
                    date=op.get("Date", ""),
                    libelle=vl.get("libelle") or op.get("Libellé", ""),
                    libelle_meta=libelle_meta,
                    montant=round(effective_montant, 2),
                    montant_brut=round(montant_brut, 2) if montant_brut is not None else None,
                    taux_pro=taux_pro,
                    flags=_vlflags_from_vline(vl, op),
                )
                sub_groups[key].append(livret_op)
                sub_totals[key] += effective_montant
                if livret_op.flags.a_revoir:
                    sub_counts[key]["a_revoir"] += 1
                if livret_op.flags.justificatif_manquant:
                    sub_counts[key]["justif_manquant"] += 1
                if livret_op.flags.is_mixte:
                    sub_counts[key]["mixte"] += 1
                total_ytd += effective_montant
        else:
            # Op simple (non ventilée)
            sub_name = (op.get("Sous-catégorie") or "Non classé").strip() or "Non classé"
            taux_pro = _resolve_taux_pro(cat, postes_index)
            libelle_meta = None
            montant_brut: Optional[float] = None
            if taux_pro is not None and taux_pro < 100:
                libelle_meta = f"mixte {int(taux_pro)}%"
                montant_brut = debit

            key = f"{cat} / {sub_name}" if sub_name else cat
            livret_op = LivretOperation(
                operation_file=filename,
                operation_index=idx,
                ventilation_index=None,
                date=op.get("Date", ""),
                libelle=op.get("Libellé", ""),
                libelle_meta=libelle_meta,
                montant=round(debit, 2),
                montant_brut=round(montant_brut, 2) if montant_brut is not None else None,
                taux_pro=taux_pro,
                flags=_flags_from_op(op, taux_pro),
            )
            sub_groups[key].append(livret_op)
            sub_totals[key] += debit
            if livret_op.flags.a_revoir:
                sub_counts[key]["a_revoir"] += 1
            if livret_op.flags.justificatif_manquant:
                sub_counts[key]["justif_manquant"] += 1
            if livret_op.flags.is_mixte:
                sub_counts[key]["mixte"] += 1
            total_ytd += debit

    subcategories = []
    for key in sorted(sub_groups.keys(), key=lambda k: sub_totals.get(k, 0), reverse=True):
        ops = sub_groups[key]
        ops_sorted = sorted(ops, key=lambda o: o.date or "", reverse=True)
        subcategories.append(LivretSubcategory(
            name=key,
            total_ytd=round(sub_totals[key], 2),
            total_projected_annual=None,
            nb_operations=len(ops),
            nb_a_revoir=sub_counts[key]["a_revoir"],
            nb_justif_manquant=sub_counts[key]["justif_manquant"],
            nb_mixte=sub_counts[key]["mixte"],
            operations=ops_sorted,
        ))

    chap_03 = LivretChapter(
        number="03",
        title="Charges professionnelles",
        tag="Ventilation éclatée",
        ventilation_mode="eclate",
        total_ytd=round(total_ytd, 2),
        total_projected_annual=round(float(annual_charges_projected), 2),
        subcategories=subcategories,
    )

    # Phase 5 — donut répartition charges par catégorie (top-8 + Autres)
    try:
        from backend.services import livret_charts_service
        donut = livret_charts_service.build_donut_charges_categories(chap_03)
        if donut is not None:
            chap_03.charts = [donut]
    except Exception as e:
        logger.warning("build_donut_charges_categories failed: %s", e)

    return chap_03


# ─── Helpers communs Phase 2 ──────────────────────────────────────

_FORFAIT_SOURCES: tuple[str, ...] = ("blanchissage", "repas", "vehicule")
_FORFAIT_LABELS: dict[str, str] = {
    "blanchissage": "Blanchissage professionnel",
    "repas": "Repas pro",
    "vehicule": "Véhicule (quote-part forfait)",
}

_CARMF_KEYWORDS: tuple[str, ...] = ("carmf",)
_ODM_KEYWORDS: tuple[str, ...] = ("ordre des médecins", "ordre des medecins", "cnom", "odm")
# URSSAF est détecté via fiscal_service._is_urssaf_op (déjà testé en prod).


def _classify_cotisation(op: dict) -> Optional[str]:
    """Retourne 'urssaf' / 'carmf' / 'odm' si l'op est une cotisation sociale, sinon None."""
    from backend.services import fiscal_service

    if fiscal_service._is_urssaf_op(op):
        return "urssaf"

    libelle = (op.get("Libellé") or "").lower()
    cat = (op.get("Catégorie") or "").lower()
    sous = (op.get("Sous-catégorie") or "").lower()

    if any(k in libelle for k in _CARMF_KEYWORDS) or "carmf" in cat or "carmf" in sous:
        return "carmf"
    if any(k in libelle for k in _ODM_KEYWORDS):
        return "odm"
    if "ordre des médecins" in cat or "ordre des medecins" in cat:
        return "odm"
    if "ordre" in cat and "med" in cat:
        return "odm"

    return None


# ─── Chapitre 04 — Charges forfaitaires (mode groupé) ─────────────

def _build_chapter_04_forfaitaires(
    year: int,
    as_of: date,
    ops_with_meta: list[tuple[str, int, dict]],
) -> LivretForfaitairesChapter:
    """Compose le chapitre 04 — Charges forfaitaires.

    Source : opérations OD générées (`source ∈ {blanchissage, repas, vehicule}`)
    + barèmes annuels et metadata `charges_forfaitaires_service` pour la décomposition.
    """
    from backend.services.charges_forfaitaires_service import ChargesForfaitairesService

    cf_svc = ChargesForfaitairesService()
    # Charge metadata des forfaits générés (3 sources : blanchissage / repas / véhicule)
    try:
        blanchissage_list = cf_svc.get_forfaits_generes(year) or []
    except Exception as e:
        logger.warning("get_forfaits_generes(%s) failed: %s", year, e)
        blanchissage_list = []
    try:
        repas_list = cf_svc.get_repas_generes(year) or []
    except Exception as e:
        logger.warning("get_repas_generes(%s) failed: %s", year, e)
        repas_list = []
    try:
        vehicule_genere = cf_svc.get_vehicule_genere(year)
    except Exception:
        vehicule_genere = None

    forfaits_by_type: dict[str, dict] = {}
    if blanchissage_list:
        forfaits_by_type["blanchissage"] = blanchissage_list[0]
    if repas_list:
        forfaits_by_type["repas"] = repas_list[0]

    # Charge config (jours travaillés, honoraires liasse, etc.) pour enrichir la déco
    try:
        cf_config = cf_svc.get_config(year) or {}
    except Exception:
        cf_config = {}

    # Charge les barèmes pour l'historique des paramètres
    def _load_bareme(name: str) -> Optional[dict]:
        try:
            from backend.services import fiscal_service
            return fiscal_service.load_bareme(name, year)
        except Exception:
            return None

    bareme_blanchissage = _load_bareme("blanchissage")
    bareme_repas = _load_bareme("repas")
    bareme_vehicule = _load_bareme("vehicule")

    # Sous-cat regroupements (Blanchissage / Repas / Véhicule)
    sub_groups: dict[str, list[LivretOperation]] = defaultdict(list)
    sub_totals: dict[str, float] = defaultdict(float)
    sub_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"a_revoir": 0, "justif_manquant": 0, "mixte": 0})

    total_ytd = 0.0

    for filename, idx, op in ops_with_meta:
        source = op.get("source")
        if source not in _FORFAIT_SOURCES:
            continue
        debit = float(op.get("Débit") or 0)
        # Le véhicule peut être une OD signalétique (Débit=0) — on l'inclut quand même
        # pour signaler la quote-part appliquée.
        if debit < 0:
            continue

        sub_name = _FORFAIT_LABELS.get(source, source.capitalize())

        livret_op = LivretOperation(
            operation_file=filename,
            operation_index=idx,
            ventilation_index=None,
            date=op.get("Date", ""),
            libelle=op.get("Libellé", ""),
            libelle_meta=f"Forfait {source} · OD 31/12",
            montant=round(debit, 2),
            flags=_flags_from_op(op),
        )
        sub_groups[sub_name].append(livret_op)
        sub_totals[sub_name] += debit
        if livret_op.flags.a_revoir:
            sub_counts[sub_name]["a_revoir"] += 1
        if livret_op.flags.justificatif_manquant:
            sub_counts[sub_name]["justif_manquant"] += 1
        total_ytd += debit

    subcategories: list[LivretSubcategory] = []
    for sub_name in sorted(sub_groups.keys(), key=lambda s: sub_totals.get(s, 0), reverse=True):
        ops = sorted(sub_groups[sub_name], key=lambda o: o.date or "", reverse=True)
        subcategories.append(LivretSubcategory(
            name=sub_name,
            total_ytd=round(sub_totals[sub_name], 2),
            total_projected_annual=None,
            nb_operations=len(ops),
            nb_a_revoir=sub_counts[sub_name]["a_revoir"],
            nb_justif_manquant=sub_counts[sub_name]["justif_manquant"],
            nb_mixte=sub_counts[sub_name]["mixte"],
            operations=ops,
        ))

    # Décompositions enrichies (pour l'expansion UI)
    decompositions: list[LivretForfaitDecomposition] = []
    jours_travailles = cf_config.get("jours_travailles") if isinstance(cf_config, dict) else None

    for tf, finfo in forfaits_by_type.items():
        deco = LivretForfaitDecomposition(
            type_forfait=tf,  # type: ignore[arg-type]
            montant=float(finfo.get("montant") or 0),
            date_ecriture=finfo.get("date_ecriture"),
            pdf_filename=finfo.get("pdf_filename"),
            ged_doc_id=finfo.get("ged_doc_id"),
        )
        if tf == "blanchissage" and bareme_blanchissage:
            deco.jours = jours_travailles
            deco.articles = bareme_blanchissage.get("articles") or []
            deco.reference_legale = bareme_blanchissage.get("reference_legale")
        elif tf == "repas" and bareme_repas:
            deco.jours = jours_travailles
            seuil = float(bareme_repas.get("seuil_repas_maison") or 0)
            plafond = float(bareme_repas.get("plafond_repas_restaurant") or 0)
            deco.seuil_repas_maison = seuil or None
            deco.plafond_repas_restaurant = plafond or None
            deco.forfait_jour = round(plafond - seuil, 2) if (plafond and seuil) else None
            deco.reference_legale = bareme_repas.get("reference_legale")
        decompositions.append(deco)

    # Véhicule : pas d'OD débit > 0 mais une signalétique. Si appliqué dans l'année,
    # on expose la quote-part via vehicule_genere (lecture metadata barème).
    if vehicule_genere:
        decompositions.append(LivretForfaitDecomposition(
            type_forfait="vehicule",
            montant=0.0,  # signalétique
            date_ecriture=vehicule_genere.get("date_application"),
            pdf_filename=vehicule_genere.get("pdf_filename"),
            ged_doc_id=vehicule_genere.get("ged_doc_id"),
            ratio_pro_pct=float(vehicule_genere.get("ratio_pro") or 0) or None,
            distance_km=float(vehicule_genere.get("distance") or 0) or None,
            km_supplementaires=float(vehicule_genere.get("km_sup") or 0) or None,
            km_totaux_compteur=float(vehicule_genere.get("km_totaux") or 0) or None,
            reference_legale=(bareme_vehicule or {}).get("reference_legale") if bareme_vehicule else None,
        ))

    return LivretForfaitairesChapter(
        number="04",
        title="Charges forfaitaires",
        tag="Ventilation groupée",
        ventilation_mode="groupe",
        total_ytd=round(total_ytd, 2),
        total_projected_annual=None,
        subcategories=subcategories,
        decompositions=decompositions,
    )


# ─── Chapitre 05 — Charges sociales (mode groupé) ─────────────────

def _build_chapter_05_sociales(
    year: int,
    as_of: date,
    ops_with_meta: list[tuple[str, int, dict]],
) -> LivretChapter:
    """Compose le chapitre 05 — Charges sociales (URSSAF / CARMF / OdM).

    Mode groupé. Pour les ops URSSAF, expose `csg_non_deductible` dans `libelle_meta`.
    """
    sub_groups: dict[str, list[LivretOperation]] = defaultdict(list)
    sub_totals: dict[str, float] = defaultdict(float)
    sub_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"a_revoir": 0, "justif_manquant": 0, "mixte": 0})

    total_ytd = 0.0
    sub_label_map = {"urssaf": "URSSAF", "carmf": "CARMF", "odm": "Ordre des Médecins"}

    for filename, idx, op in ops_with_meta:
        kind = _classify_cotisation(op)
        if kind is None:
            continue
        debit = float(op.get("Débit") or 0)
        if debit <= 0:
            continue

        sub_name = sub_label_map[kind]
        csg_nd = float(op.get("csg_non_deductible") or 0)
        libelle_meta = None
        if kind == "urssaf" and csg_nd > 0:
            libelle_meta = f"CSG non déductible : {csg_nd:.2f} €"

        livret_op = LivretOperation(
            operation_file=filename,
            operation_index=idx,
            ventilation_index=None,
            date=op.get("Date", ""),
            libelle=op.get("Libellé", ""),
            libelle_meta=libelle_meta,
            montant=round(debit, 2),
            flags=_flags_from_op(op),
        )
        # Sub-lines pour décomposition URSSAF déductible / non-déductible
        if kind == "urssaf" and csg_nd > 0:
            ded_amount = round(debit - csg_nd, 2)
            livret_op.sub_lines = [
                LivretOperation(
                    operation_file=filename,
                    operation_index=idx,
                    ventilation_index=0,
                    date=op.get("Date", ""),
                    libelle="Part déductible",
                    libelle_meta=f"{round(100 * (debit - csg_nd) / debit) if debit > 0 else 0}% du brut",
                    montant=ded_amount,
                    flags=LivretFlag(),
                ),
                LivretOperation(
                    operation_file=filename,
                    operation_index=idx,
                    ventilation_index=1,
                    date=op.get("Date", ""),
                    libelle="CSG non déductible + CRDS",
                    libelle_meta="Hors BNC (assiette CSG/CRDS)",
                    montant=round(csg_nd, 2),
                    flags=LivretFlag(),
                ),
            ]

        sub_groups[sub_name].append(livret_op)
        sub_totals[sub_name] += debit
        if livret_op.flags.a_revoir:
            sub_counts[sub_name]["a_revoir"] += 1
        if livret_op.flags.justificatif_manquant:
            sub_counts[sub_name]["justif_manquant"] += 1
        total_ytd += debit

    subcategories: list[LivretSubcategory] = []
    for sub_name in sorted(sub_groups.keys(), key=lambda s: sub_totals.get(s, 0), reverse=True):
        ops = sorted(sub_groups[sub_name], key=lambda o: o.date or "", reverse=True)
        subcategories.append(LivretSubcategory(
            name=sub_name,
            total_ytd=round(sub_totals[sub_name], 2),
            total_projected_annual=None,
            nb_operations=len(ops),
            nb_a_revoir=sub_counts[sub_name]["a_revoir"],
            nb_justif_manquant=sub_counts[sub_name]["justif_manquant"],
            nb_mixte=sub_counts[sub_name]["mixte"],
            operations=ops,
        ))

    return LivretChapter(
        number="05",
        title="Cotisations sociales",
        tag="Ventilation groupée",
        ventilation_mode="groupe",
        total_ytd=round(total_ytd, 2),
        total_projected_annual=None,
        subcategories=subcategories,
    )


# ─── Chapitre 06 — Amortissements (mode groupé) ───────────────────

def _build_chapter_06_amortissements(year: int, as_of: date) -> LivretAmortissementsChapter:
    """Compose le chapitre 06 — Amortissements.

    Source : `amortissement_service.get_dotations(year).detail` + `get_all_immobilisations()`.
    Le tag mentionne le nombre d'immos actives + le total déductible YTD.
    """
    from backend.services import amortissement_service

    try:
        dotations = amortissement_service.get_dotations(year) or {}
    except Exception as e:
        logger.warning("get_dotations(%s) failed: %s", year, e)
        dotations = {}

    detail = dotations.get("detail") or []
    detail_by_id: dict[str, dict] = {d.get("immo_id"): d for d in detail if d.get("immo_id")}
    total_dotations = float(dotations.get("total_deductible") or 0.0)

    # Charge le registre complet (actif + amorti + sorti) pour avoir VNC + cumul
    try:
        immos = amortissement_service.get_all_immobilisations(statut=None, poste=None, year=None) or []
    except Exception as e:
        logger.warning("get_all_immobilisations() failed: %s", e)
        immos = []

    immos_models: list[LivretAmortissementImmo] = []
    sub_groups: dict[str, list[LivretOperation]] = defaultdict(list)
    sub_totals: dict[str, float] = defaultdict(float)
    sub_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"a_revoir": 0, "justif_manquant": 0, "mixte": 0})

    for immo in immos:
        immo_id = immo.get("id")
        nom = immo.get("designation") or "(sans nom)"
        poste = immo.get("poste") or "Non classé"
        valeur_origine = float(immo.get("base_amortissable") or 0)
        date_acq = immo.get("date_acquisition") or ""
        duree = int(immo.get("duree") or 0)
        vnc = float(immo.get("vnc_actuelle") or 0)
        cumul_amort = max(0.0, valeur_origine - vnc)

        ddet = detail_by_id.get(immo_id) or {}
        dotation_annuelle = float(ddet.get("dotation_deductible") or 0)
        is_backfill = bool(immo.get("exercice_entree_neuronx"))

        immos_models.append(LivretAmortissementImmo(
            nom=nom,
            poste=poste,
            valeur_origine=round(valeur_origine, 2),
            date_acquisition=date_acq,
            duree_amortissement=duree,
            dotation_annuelle=round(dotation_annuelle, 2),
            cumul_amortissement=round(cumul_amort, 2),
            vnc=round(vnc, 2),
            is_backfill=is_backfill,
        ))

        # Sous-cat = poste comptable. Une "opération" virtuelle par immobilisation
        # (montant = dotation YTD pour ce bien).
        if dotation_annuelle > 0:
            livret_op = LivretOperation(
                operation_file=f"_amort_{immo_id}",
                operation_index=0,
                ventilation_index=None,
                date=date_acq or f"{year}-12-31",
                libelle=nom,
                libelle_meta=(
                    f"Acquisition {date_acq} · {duree} ans · base {round(valeur_origine, 2)} €"
                    + (" · reprise" if is_backfill else "")
                ),
                montant=round(dotation_annuelle, 2),
                flags=LivretFlag(locked=True, lettre=True),
            )
            sub_groups[poste].append(livret_op)
            sub_totals[poste] += dotation_annuelle

    subcategories: list[LivretSubcategory] = []
    for poste in sorted(sub_groups.keys(), key=lambda s: sub_totals.get(s, 0), reverse=True):
        ops = sorted(sub_groups[poste], key=lambda o: o.date or "", reverse=True)
        subcategories.append(LivretSubcategory(
            name=poste,
            total_ytd=round(sub_totals[poste], 2),
            total_projected_annual=None,
            nb_operations=len(ops),
            nb_a_revoir=sub_counts[poste]["a_revoir"],
            nb_justif_manquant=sub_counts[poste]["justif_manquant"],
            nb_mixte=sub_counts[poste]["mixte"],
            operations=ops,
        ))

    nb_actives = sum(1 for i in immos if i.get("statut") in (None, "en_cours"))
    tag = f"{nb_actives} immobilisation{'s' if nb_actives > 1 else ''} active{'s' if nb_actives > 1 else ''}"

    return LivretAmortissementsChapter(
        number="06",
        title="Amortissements",
        tag=tag,
        ventilation_mode="groupe",
        total_ytd=round(total_dotations, 2),
        total_projected_annual=None,
        subcategories=subcategories,
        immobilisations=immos_models,
        total_dotations_annuelles=round(total_dotations, 2),
    )


# ─── Chapitre 07 — Provisions & coussin (mode éclaté) ─────────────

_PROVISION_SUBCATS: tuple[str, ...] = (
    "Provision IR",
    "Provision Charges sociales",
    "Coussin",
)


def _build_chapter_07_provisions(
    year: int,
    as_of: date,
    ops_with_meta: list[tuple[str, int, dict]],
    fiscal_projection: Optional[dict] = None,
) -> LivretProvisionsChapter:
    """Compose le chapitre 07 — Provisions & coussin.

    Mode éclaté. Source : opérations dont `Sous-catégorie ∈ {Provision IR,
    Provision Charges sociales, Coussin}`. Total = somme des transferts vers
    l'épargne fiscale taggés ainsi.
    """
    sub_groups: dict[str, list[LivretOperation]] = {k: [] for k in _PROVISION_SUBCATS}
    sub_totals: dict[str, float] = {k: 0.0 for k in _PROVISION_SUBCATS}

    total_ytd = 0.0

    for filename, idx, op in ops_with_meta:
        sub_cat = (op.get("Sous-catégorie") or "").strip()
        if sub_cat not in _PROVISION_SUBCATS:
            continue
        debit = float(op.get("Débit") or 0)
        if debit <= 0:
            continue
        livret_op = LivretOperation(
            operation_file=filename,
            operation_index=idx,
            ventilation_index=None,
            date=op.get("Date", ""),
            libelle=op.get("Libellé", ""),
            libelle_meta=f"Tag {sub_cat}",
            montant=round(debit, 2),
            flags=_flags_from_op(op),
        )
        sub_groups[sub_cat].append(livret_op)
        sub_totals[sub_cat] += debit
        total_ytd += debit

    subcategories: list[LivretSubcategory] = []
    for sub_name in _PROVISION_SUBCATS:
        ops = sorted(sub_groups[sub_name], key=lambda o: o.date or "", reverse=True)
        subcategories.append(LivretSubcategory(
            name=sub_name,
            total_ytd=round(sub_totals[sub_name], 2),
            total_projected_annual=None,
            nb_operations=len(ops),
            nb_a_revoir=0,
            nb_justif_manquant=0,
            nb_mixte=0,
            operations=ops,
        ))

    # Calcul des cibles à partir de la projection fiscale
    proj = fiscal_projection or {}
    cible_ir = float(proj.get("ir_estime") or 0)
    cible_social = float(proj.get("urssaf_estime") or 0) + float(proj.get("carmf_estime") or 0) + float(proj.get("odm_estime") or 0)
    bnc_proj = float(proj.get("bnc_projete_annuel") or 0)
    cible_coussin = max(0.0, bnc_proj * 0.10)  # 10% du BNC projeté en coussin sécurité

    def _ratio(cumul: float, cible: float) -> float:
        if cible <= 0:
            return 0.0
        return min(1.5, round(cumul / cible, 4))

    gauges = [
        LivretProvisionGauge(
            name="Provision IR",
            cumul_ytd=round(sub_totals["Provision IR"], 2),
            cible_estimee=round(cible_ir, 2),
            ratio=_ratio(sub_totals["Provision IR"], cible_ir),
        ),
        LivretProvisionGauge(
            name="Provision Charges sociales",
            cumul_ytd=round(sub_totals["Provision Charges sociales"], 2),
            cible_estimee=round(cible_social, 2),
            ratio=_ratio(sub_totals["Provision Charges sociales"], cible_social),
        ),
        LivretProvisionGauge(
            name="Coussin",
            cumul_ytd=round(sub_totals["Coussin"], 2),
            cible_estimee=round(cible_coussin, 2),
            ratio=_ratio(sub_totals["Coussin"], cible_coussin),
        ),
    ]

    return LivretProvisionsChapter(
        number="07",
        title="Provisions & coussin",
        tag="Ventilation éclatée",
        ventilation_mode="eclate",
        total_ytd=round(total_ytd, 2),
        total_projected_annual=None,
        subcategories=subcategories,
        gauges=gauges,
    )


# ─── Chapitre 08 — BNC fiscal (synthèse) ──────────────────────────

def _build_chapter_08_bnc(
    year: int,
    as_of: date,
    bnc_breakdown,
    projection,
) -> LivretBncChapter:
    """Compose le chapitre 08 — BNC, synthèse fiscale.

    Pas de sous-cat. `formula` expose 5 lignes (recettes / charges / dotations /
    forfaits / BNC). `projection` consomme `fiscal_service.simulate_multi(bnc_projete)`
    pour estimer charges sociales et IR annuelles.
    """
    from backend.services import fiscal_service

    recettes = float(bnc_breakdown.recettes_pro)
    recettes_bancaires = float(bnc_breakdown.recettes_pro_bancaires)
    charges = float(bnc_breakdown.charges_pro)
    dotations = float(bnc_breakdown.dotations_amortissements)
    forfaits = float(bnc_breakdown.forfaits_total)
    bnc_ytd = float(bnc_breakdown.bnc)
    base_recettes = bnc_breakdown.base_recettes  # "liasse" | "bancaire"

    formula: list[LivretBncFormulaLine] = [
        LivretBncFormulaLine(
            label=("CA déclaré (liasse SCP)" if base_recettes == "liasse" else "Recettes pro (proxy bancaire)"),
            amount=round(recettes, 2),
            operator="plus",
            note=("Provisoire — saisir la liasse fiscale pour finaliser." if base_recettes != "liasse" else None),
        ),
        LivretBncFormulaLine(
            label="Charges professionnelles",
            amount=round(charges, 2),
            operator="minus",
            note="Hors immobilisations/dotations/ventilations parentes.",
        ),
        LivretBncFormulaLine(
            label="Dotations aux amortissements",
            amount=round(dotations, 2),
            operator="minus",
            note=None if dotations > 0 else "Aucune immobilisation active.",
        ),
        LivretBncFormulaLine(
            label="Charges forfaitaires (blanchissage + repas)",
            amount=round(forfaits, 2),
            operator="minus",
            note=None if forfaits > 0 else "OD déjà comptées en charges (Phase 1).",
        ),
        LivretBncFormulaLine(
            label="BNC réalisé YTD",
            amount=round(bnc_ytd, 2),
            operator="equals",
        ),
    ]

    formula_comment = (
        f"BNC = Recettes − Charges − Dotations − Forfaits. "
        f"Base de recettes : {base_recettes}. "
        + ("CA liasse SCP saisi. " if base_recettes == "liasse" else "Liasse SCP non saisie — proxy bancaire. ")
        + f"Bancaires année : {recettes_bancaires:,.2f} € (référence)."
    )

    # Projection annuelle via fiscal_service
    bnc_projete = float(projection.bnc_projected_annual)
    try:
        sim = fiscal_service.simulate_multi(
            bnc_actuel=max(0.0, bnc_projete),
            year=year,
            parts=1.0,
            leviers={},
        )
        ir_est = float(sim.get("ir_actuel") or 0)
        urssaf_est = float(sim.get("urssaf_actuel") or 0)
        carmf_est = float(sim.get("carmf_actuel") or 0)
        odm_est = float(sim.get("odm") or 0)
    except Exception as e:
        logger.warning("simulate_multi(%s) failed: %s", year, e)
        ir_est = urssaf_est = carmf_est = odm_est = 0.0

    total_charges_sociales = round(urssaf_est + carmf_est + odm_est, 2)
    revenu_net = round(bnc_projete - total_charges_sociales - ir_est, 2)

    proj = LivretBncProjection(
        bnc_projete_annuel=round(bnc_projete, 2),
        ir_estime=round(ir_est, 2),
        urssaf_estime=round(urssaf_est, 2),
        carmf_estime=round(carmf_est, 2),
        odm_estime=round(odm_est, 2),
        total_charges_sociales_estime=total_charges_sociales,
        revenu_net_apres_charges=revenu_net,
    )

    sources = {
        "recettes": base_recettes,  # "liasse" | "bancaire"
        "charges": "operations",
        "dotations": "amortissement_service",
        "forfaits": "charges_forfaitaires_service",
        "projection": projection.source,  # previsionnel | fallback_ytd_extrapolation | empty
    }

    chap_08 = LivretBncChapter(
        number="08",
        title="BNC fiscal — synthèse",
        tag="Source unique : bnc_service.compute_bnc",
        ventilation_mode="none",
        total_ytd=round(bnc_ytd, 2),
        total_projected_annual=round(bnc_projete, 2),
        subcategories=[],
        formula=formula,
        formula_comment=formula_comment,
        projection=proj,
        sources=sources,
    )

    # Phase 5 — waterfall BNC (Recettes − Charges − Dotations − Forfaits = BNC)
    try:
        from backend.services import livret_charts_service
        waterfall = livret_charts_service.build_waterfall_bnc(chap_08)
        if waterfall is not None:
            chap_08.charts = [waterfall]
    except Exception as e:
        logger.warning("build_waterfall_bnc failed: %s", e)

    return chap_08


# ─── Chapitre 09 — Annexes (méta) ─────────────────────────────────

_GLOSSAIRE_DEFAUT: list[dict[str, str]] = [
    {"term": "BNC", "definition": "Bénéfices Non Commerciaux. Régime fiscal des professions libérales — assiette = recettes encaissées − charges payées."},
    {"term": "Liasse SCP", "definition": "Déclaration 2035 de la SCP. Source officielle des recettes professionnelles annuelles."},
    {"term": "Quote-part SCP", "definition": "Part du chiffre d'affaires SCP qui revient à l'associé selon les statuts."},
    {"term": "Dotation aux amortissements", "definition": "Charge déductible fiscale qui répartit le coût d'un bien immobilisable sur sa durée d'usage (linéaire en BNC)."},
    {"term": "VNC", "definition": "Valeur Nette Comptable = base amortissable − cumul des amortissements à date."},
    {"term": "URSSAF", "definition": "Cotisations maladie/famille/CSG/CRDS/IJ. CSG non déductible + CRDS sont hors BNC (assiette CSG/CRDS)."},
    {"term": "CARMF", "definition": "Caisse Autonome de Retraite des Médecins de France. Régime de base + complémentaire + ASV."},
    {"term": "OdM", "definition": "Cotisation à l'Ordre des Médecins (Conseil National). Forfait annuel."},
    {"term": "PER vs Madelin", "definition": "PER déduit de l'IR uniquement. Madelin déduit du BNC social ET imposable."},
    {"term": "Provision IR / Charges sociales", "definition": "Tag posé sur un transfert vers le compte épargne fiscale. Permet de cumuler les sommes mises de côté pour les régularisations."},
    {"term": "Coussin", "definition": "Part de trésorerie professionnelle non affectée à un usage fiscal — sécurité exploitation."},
    {"term": "Ventilation", "definition": "Décomposition d'une opération bancaire en N sous-lignes catégorisées (sum = montant op). La catégorie parente devient « Ventilé »."},
    {"term": "YTD", "definition": "Year-To-Date — cumul depuis le 1er janvier jusqu'à la date d'arrêt courante."},
]

_METHODOLOGIE_DEFAULT = """\
## Méthodologie de composition du livret

Ce livret est un **agrégateur vivant** sur les services métier existants — il ne crée aucune donnée nouvelle.

- **BNC** (chap 08) : `bnc_service.compute_bnc(year)` est la source unique. Formule : recettes − charges − dotations − forfaits. Les ops `perso` sont hors assiette.
- **Recettes** (chap 02) : crédits pro classés par sous-catégorie (Bloc, Optam, etc.). Mode groupé : op mère + sous-lignes ventilation.
- **Charges pro** (chap 03) : débits pro classés en éclaté (chaque sous-ligne ventilée injectée dans sa vraie sous-cat). Exclus : Immobilisations (achat → dotation), Dotations (chap 06), Ventilé (parent), forfaits (chap 04).
- **Forfaitaires** (chap 04) : OD générées au 31/12 (blanchissage, repas) + signalétique véhicule.
- **Cotisations sociales** (chap 05) : URSSAF (avec CSG/CRDS non déd.), CARMF, OdM. Détectées via libellé + catégorie.
- **Amortissements** (chap 06) : registre des immobilisations + dotations YTD (linéaire pur en BNC, dégressif interdit).
- **Provisions** (chap 07) : transferts taggués `Provision IR` / `Provision Charges sociales` / `Coussin` depuis l'Éditeur.
- **Projection annuelle** : `previsionnel_service.get_timeline(year)` quand disponible, sinon extrapolation linéaire `ytd / months_elapsed`.

**Stratégie live** : refetch 60 s + invalidation à chaque mutation impactante. Pas de cache disque en Phase 1.
"""


def _build_chapter_09_annexes(year: int, as_of: date) -> LivretAnnexeChapter:
    """Compose le chapitre 09 — Annexes (justifs index + barèmes + glossaire + méthodologie)."""
    from backend.core.config import BAREMES_DIR
    from backend.services import justificatif_service
    import json as _json
    import os as _os

    # 1) Index des justificatifs liés à des ops de l'année
    justifs_index: list[LivretAnnexeJustifEntry] = []
    try:
        referenced: set[str] = justificatif_service.get_all_referenced_justificatifs() or set()
    except Exception as e:
        logger.warning("get_all_referenced_justificatifs() failed: %s", e)
        referenced = set()

    # Pour chaque justif référencé, on cherche son op via find_operations_by_justificatif
    # mais on filtre sur l'année (Date de l'op).
    for filename in sorted(referenced):
        try:
            ops_link = justificatif_service.find_operations_by_justificatif(filename) or []
        except Exception:
            ops_link = []
        # On ne conserve que les ops de l'année cible
        ops_in_year = [o for o in ops_link if (o.get("date") or "").startswith(f"{year}-")]
        if not ops_in_year:
            continue
        # Une entrée par op (le même justif peut être lié à plusieurs ops — rare mais possible)
        for o in ops_in_year:
            justifs_index.append(LivretAnnexeJustifEntry(
                filename=filename,
                montant=float(abs(o.get("debit") or 0) or abs(o.get("credit") or 0) or 0) or None,
                date=o.get("date"),
                fournisseur=None,
                operation_file=o.get("operation_file"),
                operation_index=o.get("operation_index"),
                libelle_op=o.get("libelle"),
                is_facsimile="_fs" in filename or filename.startswith("reconstitue_"),
            ))

    # Tri par date desc
    justifs_index.sort(key=lambda j: j.date or "", reverse=True)

    # 2) Barèmes appliqués pour l'année
    baremes_appliques: list[LivretAnnexeBareme] = []
    if BAREMES_DIR.exists():
        for fp in sorted(BAREMES_DIR.glob(f"*_{year}.json")):
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    content = _json.load(f) or {}
            except Exception:
                continue
            # Sommaire ad-hoc selon le type
            stem = fp.stem  # ex: "urssaf_2026", "blanchissage_2025"
            kind = stem.rsplit("_", 1)[0]
            summary: dict
            if kind == "urssaf":
                summary = {
                    "pass": content.get("pass"),
                    "csg_crds_total_pct": (
                        round((content.get("csg_crds", {}).get("taux_csg_deductible", 0)
                               + content.get("csg_crds", {}).get("taux_csg_non_deductible", 0)
                               + content.get("csg_crds", {}).get("taux_crds", 0)) * 100, 1)
                    ),
                    "assiette_mode": content.get("csg_crds", {}).get("assiette_mode"),
                }
            elif kind == "carmf":
                summary = {
                    "regime_base_taux": content.get("regime_base", {}).get("taux"),
                    "complementaire_classe_M": content.get("regime_complementaire", {}).get("classe_M"),
                }
            elif kind == "odm":
                summary = {"cotisation_annuelle": content.get("cotisation_annuelle")}
            elif kind == "ir":
                summary = {"tranches": len(content.get("tranches") or [])}
            elif kind == "blanchissage":
                summary = {
                    "articles": len(content.get("articles") or []),
                    "decote_domicile": content.get("decote_domicile"),
                    "reference_legale": content.get("reference_legale"),
                }
            elif kind == "repas":
                summary = {
                    "seuil": content.get("seuil_repas_maison"),
                    "plafond": content.get("plafond_repas_restaurant"),
                    "forfait_jour": round((content.get("plafond_repas_restaurant") or 0) - (content.get("seuil_repas_maison") or 0), 2),
                }
            elif kind == "vehicule":
                summary = {
                    "ratio_pro_applique": content.get("ratio_pro_applique"),
                    "date_derniere_application": content.get("date_derniere_application"),
                }
            else:
                summary = {"keys": list(content.keys())[:5]}

            try:
                mtime = _os.path.getmtime(fp)
                last_updated = datetime.fromtimestamp(mtime).isoformat()
            except Exception:
                last_updated = None

            baremes_appliques.append(LivretAnnexeBareme(
                nom=stem.replace("_", " ").upper(),
                file=fp.name,
                last_updated=last_updated,
                summary=summary,
            ))

    return LivretAnnexeChapter(
        number="09",
        title="Annexes",
        tag=f"{len(justifs_index)} justificatifs · {len(baremes_appliques)} barèmes",
        ventilation_mode="none",
        total_ytd=0.0,
        total_projected_annual=None,
        subcategories=[],
        justificatifs_index=justifs_index,
        baremes_appliques=baremes_appliques,
        glossaire=_GLOSSAIRE_DEFAUT,
        methodologie=_METHODOLOGIE_DEFAULT,
    )


# ─── Phase 4 — Comparaison N-1 ────────────────────────────────────

# Catégories favorables à la hausse (recettes, BNC, provisions). Tout le reste
# (charges, charges sociales, amortissements, forfaits) est favorable à la baisse.
_FAVORABLE_UP_CHAPTERS: set[str] = {"01", "02", "07"}  # 01 spécial : metric par metric


def _last_day_of_month(year: int, month: int) -> int:
    """Retourne le dernier jour du mois donné (gère 29 fév en bissextile)."""
    from calendar import monthrange
    return monthrange(year, month)[1]


def _compute_as_of_n1(year: int, as_of: date, mode: CompareMode) -> date:
    """Calcule la date d'arrêt YTD comparable côté N-1.

    - `ytd_comparable` : même mois/jour en N-1, clamp 29 fév → 28 fév en année non-bissextile.
    - `annee_pleine`   : 31 décembre N-1 (exercice clos).
    """
    if mode == "annee_pleine":
        return date(year - 1, 12, 31)
    if mode == "ytd_comparable":
        target_year = year - 1
        target_month = as_of.month
        target_day = min(as_of.day, _last_day_of_month(target_year, target_month))
        return date(target_year, target_month, target_day)
    raise ValueError(f"Mode comparaison inconnu : {mode}")


def _has_year_data(year: int) -> bool:
    """True si l'année a au moins un fichier d'opérations enregistré."""
    try:
        from backend.services import operation_service
        files = operation_service.list_operation_files() or []
        return any(f.get("year") == year for f in files)
    except Exception:
        return False


def _make_delta(value_n: float, value_n1: float, favorable_up: bool) -> LivretDelta:
    """Construit un `LivretDelta` à partir des 2 valeurs et du contexte de favorabilité.

    Convention `direction` :
      - `up` si value_n > value_n1 (différence > 0,5% du max abs).
      - `down` si value_n < value_n1.
      - `stable` sinon.

    Convention `is_favorable` :
      - `favorable_up=True` (recettes, BNC, provisions) : up = vert.
      - `favorable_up=False` (charges) : down ou stable = vert.
    """
    diff = round(value_n - value_n1, 2)
    if value_n1 != 0:
        diff_pct = round((value_n - value_n1) / abs(value_n1) * 100, 2)
    else:
        diff_pct = None

    threshold = max(abs(value_n), abs(value_n1)) * 0.005  # 0.5%
    if abs(diff) <= threshold:
        direction: str = "stable"
    elif diff > 0:
        direction = "up"
    else:
        direction = "down"

    if favorable_up:
        is_favorable = direction == "up" or direction == "stable"
    else:
        is_favorable = direction == "down" or direction == "stable"

    return LivretDelta(
        value_n1=round(value_n1, 2),
        value_diff=diff,
        value_diff_pct=diff_pct,
        direction=direction,  # type: ignore[arg-type]
        is_favorable=is_favorable,
    )


def _is_favorable_up_for_metric(label: str) -> bool:
    """Inférence de favorabilité pour les metrics du chapitre 01."""
    lab = label.lower()
    if "charges" in lab:
        return False
    return True  # recettes / bnc → up favorable


def _is_favorable_up_for_chapter(number: str, sub_name: Optional[str] = None) -> bool:
    """Inférence de favorabilité pour les totaux chapitre / sous-cat.

    Phase 4 : on traite les recettes (02) et provisions (07) comme up-favorable,
    tout le reste (charges pro, forfaitaires, sociales, amortissements, BNC sous-totaux)
    comme down-favorable. Le chapitre 08 est un cas particulier : sa carte BNC
    est up-favorable (cf. `_is_favorable_up_for_metric`).
    """
    if number in _FAVORABLE_UP_CHAPTERS:
        return True
    if number == "08":
        return True  # le total YTD du chap 08 = BNC réalisé YTD → up favorable
    return False


def _annotate_chapter_deltas(
    chap_n,
    chap_n1,
) -> None:
    """Annote `chap_n` (mutation in-place) avec les deltas extraits de `chap_n1`.

    - Total chapitre (sauf 09).
    - Sous-cat par nom (matching strict). Sous-cat orpheline (présente en N-1
      mais plus en N) : ajoute une ligne fantôme avec total_ytd=0 + flag.
    - Si `chap_n` est un `LivretSynthese` (chap 01) : annote chaque metric par label.
    """
    num = getattr(chap_n, "number", "")
    if num == "09":
        return  # annexes non comparables

    if num != "01":
        favorable_up = _is_favorable_up_for_chapter(num)
        chap_n.delta_n1 = _make_delta(chap_n.total_ytd, chap_n1.total_ytd, favorable_up)

    # Synthèse : annote les metrics (sauf projection)
    if num == "01":
        syn_n = getattr(chap_n, "synthese", None)
        syn_n1 = getattr(chap_n1, "synthese", None)
        if syn_n is not None and syn_n1 is not None:
            metrics_n1_by_label = {m.label: m for m in syn_n1.metrics}
            for m in syn_n.metrics:
                if m.is_projection:
                    continue  # pas de delta sur la projection annuelle
                m_n1 = metrics_n1_by_label.get(m.label)
                if m_n1 is None:
                    continue
                fav_up = _is_favorable_up_for_metric(m.label)
                m.delta_n1 = _make_delta(m.value, m_n1.value, fav_up)

            # Cadence mensuelle : annote recettes_n1 / charges_n1 par mois
            n1_by_month = {p.month: p for p in syn_n1.cadence_mensuelle}
            for p in syn_n.cadence_mensuelle:
                p_n1 = n1_by_month.get(p.month)
                if p_n1 is not None:
                    p.recettes_n1 = round(p_n1.recettes, 2)
                    p.charges_n1 = round(p_n1.charges, 2)

    # Sous-catégories — matching par name
    subs_n1_by_name = {s.name: s for s in chap_n1.subcategories}
    favorable_up_default = _is_favorable_up_for_chapter(num)

    for sub in chap_n.subcategories:
        sub_n1 = subs_n1_by_name.get(sub.name)
        if sub_n1 is None:
            sub.delta_n1 = _make_delta(sub.total_ytd, 0.0, favorable_up_default)
        else:
            sub.delta_n1 = _make_delta(sub.total_ytd, sub_n1.total_ytd, favorable_up_default)

    # Sous-cat orphelines (présentes en N-1 mais plus en N) → ligne fantôme
    sub_names_n = {s.name for s in chap_n.subcategories}
    for sub_n1 in chap_n1.subcategories:
        if sub_n1.name in sub_names_n:
            continue
        if sub_n1.total_ytd <= 0:
            continue  # pas la peine d'afficher une orpheline vide
        ghost = LivretSubcategory(
            name=sub_n1.name,
            total_ytd=0.0,
            total_projected_annual=None,
            nb_operations=0,
            nb_a_revoir=0,
            nb_justif_manquant=0,
            nb_mixte=0,
            operations=[],
            delta_n1=_make_delta(0.0, sub_n1.total_ytd, favorable_up_default),
            is_orphan_from_n1=True,
        )
        chap_n.subcategories.append(ghost)


def _annotate_deltas(livret_n: Livret, livret_n1: Livret) -> None:
    """Traverse les 2 livrets en parallèle et annote `livret_n` avec les deltas N-1."""
    chapters_n1 = livret_n1.chapters
    for num, chap_n in livret_n.chapters.items():
        chap_n1 = chapters_n1.get(num)
        if chap_n1 is None:
            continue
        try:
            _annotate_chapter_deltas(chap_n, chap_n1)
        except Exception as e:
            logger.warning("delta annotation chap %s failed: %s", num, e)


# ─── Cache mémoire (TTL 60s) pour livret_internal ─────────────────

_LIVRET_CACHE: dict[tuple, tuple[float, Livret]] = {}
_LIVRET_CACHE_TTL_SEC = 60.0


def invalidate_livret_cache() -> None:
    """Flush le cache mémoire — à appeler depuis les hooks de mutation backend."""
    _LIVRET_CACHE.clear()


def _cache_key(year: int, as_of_iso: str, snapshot_id: Optional[str]) -> tuple:
    return (year, as_of_iso, snapshot_id)


def _cache_get(key: tuple) -> Optional[Livret]:
    import time
    entry = _LIVRET_CACHE.get(key)
    if entry is None:
        return None
    ts, livret = entry
    if (time.time() - ts) > _LIVRET_CACHE_TTL_SEC:
        _LIVRET_CACHE.pop(key, None)
        return None
    # Retourne une copie deep pour éviter les mutations accidentelles
    return livret.model_copy(deep=True)


def _cache_set(key: tuple, livret: Livret) -> None:
    import time
    _LIVRET_CACHE[key] = (time.time(), livret.model_copy(deep=True))


# ─── API publique ─────────────────────────────────────────────────

def _build_livret_internal(
    year: int,
    as_of_date: Optional[date] = None,
    snapshot_id: Optional[str] = None,
    use_cache: bool = True,
) -> Livret:
    """Construction interne du livret (un seul exercice, pas de comparaison).

    Mémoïsé 60 s sur la clé `(year, as_of_iso, snapshot_id)` quand `use_cache=True`.
    """
    as_of_resolved = _today_clamped(year, as_of_date)
    cache_key = _cache_key(year, as_of_resolved.isoformat(), snapshot_id)
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    livret = _build_livret_uncached(year, as_of_resolved, snapshot_id)
    if use_cache:
        _cache_set(cache_key, livret)
    return livret


def _build_livret_uncached(
    year: int,
    as_of: date,
    snapshot_id: Optional[str] = None,
) -> Livret:
    """Construction effective sans cache."""
    from backend.services import bnc_service, projection_service

    months_elapsed, months_remaining = _months_elapsed_remaining(year, as_of)

    # 1) Métadonnées
    data_sources = _detect_data_sources(year)
    metadata = LivretMetadata(
        year=year,
        generated_at=datetime.now().isoformat(),
        as_of_date=as_of.isoformat(),
        months_elapsed=months_elapsed,
        months_remaining=months_remaining,
        is_live=(snapshot_id is None),
        snapshot_id=snapshot_id,
        data_sources=data_sources,
    )

    # 2) Projection (avec fallback interne)
    projection = projection_service.project(year, as_of)

    # 3) BNC fiscal — source unique
    try:
        bnc_breakdown = bnc_service.compute_bnc(year)
    except Exception as e:
        logger.warning("compute_bnc(%s) failed: %s — building empty livret", year, e)
        # Réponse gracieuse : livret vide pour année sans données
        empty_chapter = LivretChapter(
            number="00",
            title="—",
            tag=None,
            ventilation_mode="none",
            total_ytd=0.0,
            total_projected_annual=None,
            subcategories=[],
        )
        return Livret(
            metadata=metadata,
            chapters={
                "01": LivretSynthese(
                    number="01",
                    title="Synthèse exécutive",
                    tag="Exercice à venir" if as_of.year < year else "Aucune donnée",
                    ventilation_mode="none",
                    total_ytd=0.0,
                    total_projected_annual=projection.bnc_projected_annual,
                    subcategories=[],
                    synthese=LivretSyntheseChapter(metrics=[], cadence_mensuelle=[]),
                ),
            },
            toc=[TocEntry(number="01", title="Synthèse exécutive")],
        )

    # 4) Year overview (KPIs mensuels — alimente cadence chapitre 01)
    try:
        from backend.services import analytics_service
        overview = analytics_service.get_year_overview(year)
    except Exception as e:
        logger.warning("get_year_overview(%s) failed: %s", year, e)
        overview = {"mois_data": []}

    # 5) Charge des opérations (avec leurs (filename, index)) — une seule fois
    ops_with_meta = _load_year_operations_with_meta(year)
    postes_index = _build_postes_index()

    # 6) Construction des chapitres
    chap_01 = _build_synthese_chapter(year, as_of, bnc_breakdown, overview, projection)
    chap_02 = _build_recettes_chapter(year, as_of, ops_with_meta, projection.annual_recettes_projected)
    chap_03 = _build_charges_pro_chapter(
        year, as_of, ops_with_meta, projection.annual_charges_projected, postes_index,
    )

    # Phase 2 — 6 chapitres complémentaires
    chap_04 = _build_chapter_04_forfaitaires(year, as_of, ops_with_meta)
    chap_05 = _build_chapter_05_sociales(year, as_of, ops_with_meta)
    chap_06 = _build_chapter_06_amortissements(year, as_of)
    # Chapitre 08 d'abord pour récupérer la projection fiscale → cibles chapitre 07
    chap_08 = _build_chapter_08_bnc(year, as_of, bnc_breakdown, projection)
    chap_07 = _build_chapter_07_provisions(
        year, as_of, ops_with_meta,
        fiscal_projection=chap_08.projection.model_dump() if chap_08.projection else None,
    )
    chap_09 = _build_chapter_09_annexes(year, as_of)

    # 7) TOC
    toc = [
        TocEntry(number="01", title=chap_01.title),
        TocEntry(number="02", title=chap_02.title),
        TocEntry(number="03", title=chap_03.title),
        TocEntry(number="04", title=chap_04.title),
        TocEntry(number="05", title=chap_05.title),
        TocEntry(number="06", title=chap_06.title),
        TocEntry(number="07", title=chap_07.title),
        TocEntry(number="08", title=chap_08.title),
        TocEntry(number="09", title=chap_09.title),
    ]

    return Livret(
        metadata=metadata,
        chapters={
            "01": chap_01,
            "02": chap_02,
            "03": chap_03,
            "04": chap_04,
            "05": chap_05,
            "06": chap_06,
            "07": chap_07,
            "08": chap_08,
            "09": chap_09,
        },
        toc=toc,
    )


def build_livret(
    year: int,
    as_of_date: Optional[date] = None,
    snapshot_id: Optional[str] = None,
    compare_n1: Optional[CompareMode] = None,
) -> Livret:
    """Compose le livret depuis les services métier existants.

    Args:
        year: exercice fiscal cible.
        as_of_date: date d'arrêt YTD. None = today() en mode live.
            Pour exercice clos, est clampée au 31/12/year.
        snapshot_id: rempli en Phase 3 quand on génère un snapshot.
        compare_n1: Phase 4 — si fourni, compose AUSSI le livret N-1 et annote
            les `delta_n1` sur metrics, sous-cat, chapitres + `recettes_n1`/
            `charges_n1` sur cadence mensuelle. Modes :
              - `ytd_comparable` : période [01/01/N → as_of] vs [01/01/(N-1) → même date N-1]
              - `annee_pleine`   : exercice complet N vs exercice complet (N-1)

    Returns:
        Livret Pydantic prêt à sérialiser en JSON.
    """
    as_of = _today_clamped(year, as_of_date)
    livret_n = _build_livret_internal(year, as_of, snapshot_id)

    if compare_n1 is None:
        return livret_n

    # Mode comparaison demandé — on travaille sur une copie pour ne pas polluer le cache
    livret_n = livret_n.model_copy(deep=True)
    livret_n.metadata.compare_mode = compare_n1
    livret_n.metadata.has_n1_data = _has_year_data(year - 1)

    # Annotation flag exercice non clos pour mode année pleine sur exercice en cours
    today = date.today()
    livret_n.metadata.is_year_partial = (
        compare_n1 == "annee_pleine" and today.year == year
    )

    if not livret_n.metadata.has_n1_data:
        # On expose `as_of_date_n1` quand même pour cohérence d'affichage
        try:
            livret_n.metadata.as_of_date_n1 = _compute_as_of_n1(year, as_of, compare_n1).isoformat()
        except Exception:
            livret_n.metadata.as_of_date_n1 = None
        return livret_n

    as_of_n1 = _compute_as_of_n1(year, as_of, compare_n1)
    livret_n.metadata.as_of_date_n1 = as_of_n1.isoformat()

    try:
        livret_n1 = _build_livret_internal(year - 1, as_of_n1, snapshot_id=None)
        _annotate_deltas(livret_n, livret_n1)
    except Exception as e:
        logger.warning("compare_n1 build failed for %s vs %s : %s", year, year - 1, e)

    return livret_n


def get_metadata(year: int, as_of_date: Optional[date] = None) -> LivretMetadata:
    """Endpoint léger : ne calcule pas le livret entier, juste les métadonnées."""
    as_of = _today_clamped(year, as_of_date)
    months_elapsed, months_remaining = _months_elapsed_remaining(year, as_of)
    return LivretMetadata(
        year=year,
        generated_at=datetime.now().isoformat(),
        as_of_date=as_of.isoformat(),
        months_elapsed=months_elapsed,
        months_remaining=months_remaining,
        is_live=True,
        snapshot_id=None,
        data_sources=_detect_data_sources(year),
    )
