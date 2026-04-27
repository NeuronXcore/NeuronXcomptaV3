"""Service Check d'envoi — rituel pré-vol récurrent (mensuel + annuel).

Catalogue statique des sections + items + évaluateurs auto qui consomment
**uniquement** les services existants (zéro nouvelle source de vérité).

Persistance : items auto recalculés à chaque GET, seuls `comment`,
`validated_at` et le statut des items `manual` sont écrits sur disque.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from backend.core.config import (
    CHECK_ENVOI_DIR,
    CHECK_ENVOI_REMINDERS_FILE,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_SANDBOX_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    MOIS_FR,
    SETTINGS_FILE,
    TASKS_FILE,
    ensure_directories,
)
from backend.models.check_envoi import (
    CheckEnvoiInstance,
    CheckEnvoiItem,
    CheckEnvoiSection,
    CheckPeriod,
    CheckSource,
    CheckStatus,
    ReminderState,
)

logger = logging.getLogger(__name__)


# ───────────────────────────── Persistance ─────────────────────────────


def _instance_path(year: int) -> Path:
    return CHECK_ENVOI_DIR / f"{year}.json"


def _load_year_file(year: int) -> dict:
    """Charge `data/check_envoi/{year}.json`. Retourne dict vide si absent."""
    ensure_directories()
    p = _instance_path(year)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Lecture check_envoi/%d.json impossible: %s", year, e)
        return {}


def _save_year_file(year: int, data: dict) -> None:
    ensure_directories()
    p = _instance_path(year)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def _period_key(period: CheckPeriod, month: Optional[int]) -> str:
    if period == CheckPeriod.YEAR:
        return "annual"
    if month is None:
        raise ValueError("month requis pour period=month")
    return f"{month:02d}"


def _reminder_period_key(year: int, period: CheckPeriod, month: Optional[int]) -> str:
    if period == CheckPeriod.YEAR:
        return f"{year}-annual"
    return f"{year}-{month:02d}"


def _load_reminders() -> dict:
    if not CHECK_ENVOI_REMINDERS_FILE.exists():
        return {}
    try:
        return json.loads(CHECK_ENVOI_REMINDERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_reminders(data: dict) -> None:
    ensure_directories()
    CHECK_ENVOI_REMINDERS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def _load_settings_dict() -> dict:
    if not SETTINGS_FILE.exists():
        return {}
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


# ───────────────────────────── Évaluateurs auto ─────────────────────────────


def _safe_call(fn: Callable, *args, **kwargs) -> tuple[CheckStatus, Optional[str]]:
    """Exécute un évaluateur en absorbant les exceptions (retourne PENDING)."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        logger.warning("Évaluateur %s a échoué: %s", getattr(fn, "__name__", "?"), e)
        return CheckStatus.PENDING, "non évaluable"


# ── Section 1 : données brutes ──


def _eval_releve_importe(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import operation_service

    files = operation_service.list_operation_files()
    matching = [
        f for f in files
        if f.get("year") == year
        and f.get("month") == month
        and not (f.get("filename") or "").startswith("operations_manual_")
    ]
    if not matching:
        return CheckStatus.AUTO_WARNING, "aucun relevé importé"
    nb_ops = sum(f.get("count", 0) for f in matching)
    return CheckStatus.AUTO_OK, f"{len(matching)} fichier{'s' if len(matching) > 1 else ''} · {nb_ops} ops"


def _eval_sandbox_vide(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    if not JUSTIFICATIFS_SANDBOX_DIR.exists():
        return CheckStatus.AUTO_OK, "0 fichier"
    nb = sum(1 for p in JUSTIFICATIFS_SANDBOX_DIR.iterdir() if p.suffix.lower() == ".pdf")
    if nb == 0:
        return CheckStatus.AUTO_OK, "0 fichier"
    return CheckStatus.AUTO_WARNING, f"{nb} fichier{'s' if nb > 1 else ''} en sandbox"


def _eval_ocr_pending_associes(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    """OK si 0 OCR en attente daté du mois (best_date dans le mois)."""
    from backend.services import ocr_service

    history = ocr_service.get_extraction_history(limit=2000)
    target_prefix = f"{year}-{month:02d}"
    pending = []
    for item in history:
        best_date = item.get("best_date") or ""
        if best_date.startswith(target_prefix):
            # Vérifier qu'il est en attente : présent dans en_attente/ et non dans traites/
            fn = item.get("filename") or ""
            if (JUSTIFICATIFS_EN_ATTENTE_DIR / fn).exists():
                pending.append(fn)
    if not pending:
        return CheckStatus.AUTO_OK, "0 OCR en attente"
    return CheckStatus.AUTO_WARNING, f"{len(pending)} OCR en attente"


def _eval_facsimiles_attribues(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import rename_service

    if not JUSTIFICATIFS_EN_ATTENTE_DIR.exists():
        return CheckStatus.AUTO_OK, "0 fac-similé orphelin"
    target_prefix = f"{year}{month:02d}"
    orphans = 0
    for p in JUSTIFICATIFS_EN_ATTENTE_DIR.iterdir():
        if p.suffix.lower() != ".pdf":
            continue
        if not rename_service.is_facsimile(p.name):
            continue
        # Tenter de matcher la date dans le filename (format _YYYYMMDD_)
        if f"_{target_prefix}" in p.name:
            orphans += 1
    if orphans == 0:
        return CheckStatus.AUTO_OK, "0 fac-similé orphelin"
    return CheckStatus.AUTO_WARNING, f"{orphans} fac-similé{'s' if orphans > 1 else ''} orphelin{'s' if orphans > 1 else ''}"


# ── Section 2 : catégorisation ──


def _load_month_ops(year: int, month: int) -> list[dict]:
    """Charge toutes les ops du mois (concat des fichiers)."""
    from backend.services import operation_service

    ops: list[dict] = []
    for f in operation_service.list_operation_files():
        if f.get("year") != year or f.get("month") != month:
            continue
        try:
            ops.extend(operation_service.load_operations(f["filename"]))
        except Exception:
            continue
    return ops


_BAD_CATS = {"", "Autres", "Non catégorisé", "?"}


def _eval_categorisation_taux_100(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    ops = _load_month_ops(year, month)
    if not ops:
        return CheckStatus.AUTO_OK, "aucune op"
    bad = sum(1 for op in ops if (op.get("Catégorie") or "").strip() in _BAD_CATS)
    if bad == 0:
        return CheckStatus.AUTO_OK, f"{len(ops)} ops catégorisées"
    return CheckStatus.AUTO_WARNING, f"{bad}/{len(ops)} non catégorisée{'s' if bad > 1 else ''}"


def _eval_aucune_a_revoir(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    ops = _load_month_ops(year, month)
    flagged = sum(
        1 for op in ops
        if op.get("À revoir") or op.get("A_revoir") or op.get("a_revoir")
    )
    if flagged == 0:
        return CheckStatus.AUTO_OK, "aucune op flaguée"
    return CheckStatus.AUTO_WARNING, f"{flagged} op{'s' if flagged > 1 else ''} à revoir"


def _eval_aucune_non_classee(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    ops = _load_month_ops(year, month)
    if not ops:
        return CheckStatus.AUTO_OK, "aucune op"
    bad = [
        op for op in ops
        if (op.get("Catégorie") or "").strip() in _BAD_CATS
    ]
    if not bad:
        return CheckStatus.AUTO_OK, "0 sans catégorie"
    return CheckStatus.AUTO_WARNING, f"{len(bad)} sans catégorie"


# ── Section 3 : justificatifs ──


def _annual_status_for(year: int, month: int) -> Optional[dict]:
    from backend.services import cloture_service

    try:
        annual = cloture_service.get_annual_status(year)
    except Exception:
        return None
    for entry in annual:
        if entry.get("mois") == month:
            return entry
    return None


def _eval_justificatifs_taux_100(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    entry = _annual_status_for(year, month)
    if not entry or not entry.get("has_releve"):
        return CheckStatus.AUTO_OK, "aucun mois à auditer"
    taux = entry.get("taux_justificatifs", 0.0)
    if taux >= 1.0:
        return CheckStatus.AUTO_OK, f"{int(round(taux * 100))} %"
    nb_ok = entry.get("nb_justificatifs_ok", 0)
    nb_total = entry.get("nb_justificatifs_total", 0)
    return CheckStatus.AUTO_WARNING, f"{nb_ok}/{nb_total} ({int(round(taux * 100))} %)"


def _eval_ops_verrouillees(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    ops = _load_month_ops(year, month)
    with_justif = [op for op in ops if (op.get("Lien justificatif") or "").strip()]
    if not with_justif:
        return CheckStatus.AUTO_OK, "aucune op avec justif"
    locked = sum(1 for op in with_justif if op.get("locked"))
    if locked == len(with_justif):
        return CheckStatus.AUTO_OK, f"{locked}/{len(with_justif)} verrouillées"
    return CheckStatus.AUTO_WARNING, f"{locked}/{len(with_justif)} verrouillées"


def _eval_aucun_orphelin(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import justificatif_service

    try:
        issues = justificatif_service.scan_link_issues()
    except Exception:
        return CheckStatus.PENDING, "scan indisponible"
    nb = (
        len(issues.get("ghost_refs", []))
        + len(issues.get("orphans_to_move_to_attente", []))
        + len(issues.get("misplaced_to_move_to_traites", []))
    )
    if nb == 0:
        return CheckStatus.AUTO_OK, "aucun lien cassé"
    return CheckStatus.AUTO_WARNING, f"{nb} lien{'s' if nb > 1 else ''} cassé{'s' if nb > 1 else ''}"


# ── Section 4 : lettrage ──


def _eval_lettrage_taux_100(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    entry = _annual_status_for(year, month)
    if not entry or not entry.get("has_releve"):
        return CheckStatus.AUTO_OK, "aucun mois à auditer"
    taux = entry.get("taux_lettrage", 0.0)
    if taux >= 1.0:
        return CheckStatus.AUTO_OK, "100 %"
    return CheckStatus.AUTO_WARNING, f"{int(round(taux * 100))} %"


def _eval_auto_pointage_actif(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    settings = _load_settings_dict()
    if settings.get("auto_pointage", True):
        return CheckStatus.AUTO_OK, "activé"
    return CheckStatus.AUTO_WARNING, "désactivé"


# ── Section 5 : compte d'attente ──


def _attente_op_hash(filename: str, op_date: str, libelle: str, debit: float, credit: float) -> str:
    """Hash stable d'une op en compte d'attente (12 chars)."""
    raw = f"{filename}|{op_date}|{libelle}|{debit:.2f}|{credit:.2f}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]


def _collect_attente_with_filename(year: int, month: Optional[int]) -> list[dict]:
    """Variante de `_collect_attente_operations` qui retourne aussi le filename source."""
    from backend.services import operation_service

    out: list[dict] = []
    target_prefix = f"{year}-{month:02d}" if month else f"{year}-"
    for meta in operation_service.list_operation_files():
        if meta.get("year") != year:
            continue
        if month is not None and meta.get("month") != month:
            continue
        try:
            ops = operation_service.load_operations(meta["filename"])
        except Exception:
            continue
        for idx, op in enumerate(ops):
            if month is not None and not (op.get("Date") or "").startswith(target_prefix):
                continue
            cat = (op.get("Catégorie") or "").strip()
            is_attente = bool(op.get("compte_attente"))
            is_empty = cat in _BAD_CATS
            if not (is_attente or is_empty):
                continue
            out.append({
                "filename": meta["filename"],
                "index": idx,
                "Date": op.get("Date") or "",
                "Libelle": op.get("Libellé") or op.get("Libelle") or "",
                "Debit": float(op.get("Débit") or 0),
                "Credit": float(op.get("Crédit") or 0),
                "Categorie": cat,
                "Commentaire": op.get("compte_attente_commentaire") or op.get("Commentaire") or "",
            })
    return out


def _eval_compte_attente_alertes_resolues(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    """Compte les alertes brutes du mois via le champ `alertes` sur chaque op."""
    ops = _load_month_ops(year, month)
    nb_alertes = sum(len(op.get("alertes") or []) for op in ops)
    if nb_alertes == 0:
        return CheckStatus.AUTO_OK, "0 alerte"
    return CheckStatus.AUTO_WARNING, f"{nb_alertes} alerte{'s' if nb_alertes > 1 else ''}"


# ── Section 6 : cohérences ──


def _eval_debits_credits_equilibres(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    ops = _load_month_ops(year, month)
    if not ops:
        return CheckStatus.AUTO_OK, "aucune op"
    total_debit = sum(float(op.get("Débit") or 0) for op in ops)
    total_credit = sum(float(op.get("Crédit") or 0) for op in ops)
    ecart = abs(total_debit - total_credit)
    if ecart <= 1.0:
        return CheckStatus.AUTO_OK, f"écart {ecart:.2f} €"
    return CheckStatus.AUTO_WARNING, f"écart {ecart:.2f} €"


def _eval_bnc_plausible_vs_n1(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    """Compare BNC mensuel proxy bancaire à la moyenne mensuelle de N-1.

    OK si pas d'historique. Warning si écart > 25 %.
    """
    ops_n = _load_month_ops(year, month)
    bnc_n = sum(float(op.get("Crédit") or 0) for op in ops_n) - sum(
        float(op.get("Débit") or 0) for op in ops_n
    )

    # Moyenne mensuelle N-1
    from backend.services import operation_service

    try:
        files_n1 = [f for f in operation_service.list_operation_files() if f.get("year") == year - 1]
    except Exception:
        files_n1 = []
    if not files_n1:
        return CheckStatus.AUTO_OK, "pas d'historique"
    total_n1 = 0.0
    nb_months_n1 = len({f.get("month") for f in files_n1 if f.get("month")})
    for f in files_n1:
        try:
            ops_year = operation_service.load_operations(f["filename"])
        except Exception:
            continue
        total_n1 += sum(float(op.get("Crédit") or 0) for op in ops_year)
        total_n1 -= sum(float(op.get("Débit") or 0) for op in ops_year)
    if nb_months_n1 == 0:
        return CheckStatus.AUTO_OK, "pas d'historique"
    moyenne_n1 = total_n1 / nb_months_n1
    if abs(moyenne_n1) < 1.0:
        return CheckStatus.AUTO_OK, "moyenne N-1 ≈ 0"
    delta_pct = abs((bnc_n - moyenne_n1) / moyenne_n1) * 100
    if delta_pct > 25:
        return CheckStatus.AUTO_WARNING, f"écart {delta_pct:.0f} % vs moyenne N-1"
    return CheckStatus.AUTO_OK, f"écart {delta_pct:.0f} % vs moyenne N-1"


# ── Section 7 : spécifique mois ──


def _eval_urssaf_trimestrielle(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    if month not in (3, 6, 9, 12):
        return CheckStatus.AUTO_OK, "non applicable"
    from backend.services import previsionnel_service

    try:
        echeances = previsionnel_service.get_echeances(year=year)
    except Exception:
        return CheckStatus.PENDING, "previsionnel indisponible"
    cibles = [
        e for e in echeances
        if "urssaf" in (e.periode_label or "").lower()
        or "urssaf" in (e.provider_id or "").lower()
    ]
    if not cibles:
        return CheckStatus.AUTO_OK, "aucune échéance URSSAF"
    avec_doc = sum(1 for e in cibles if e.document_ref)
    if avec_doc == len(cibles):
        return CheckStatus.AUTO_OK, f"{avec_doc}/{len(cibles)} liées"
    return CheckStatus.AUTO_WARNING, f"{avec_doc}/{len(cibles)} liées"


def _eval_od_decembre_passees(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    if month != 12:
        return CheckStatus.AUTO_OK, "non applicable"
    ops = _load_month_ops(year, 12)
    sources_attendues = {"amortissement", "blanchissage", "repas"}
    sources_presentes = {op.get("source") for op in ops if op.get("source") in sources_attendues}
    manquantes = sources_attendues - sources_presentes
    if not manquantes:
        return CheckStatus.AUTO_OK, "3/3 OD passées"
    return CheckStatus.AUTO_WARNING, f"manque {', '.join(sorted(manquantes))}"


# ── Section 8 : avant envoi ──


def _eval_taches_kanban_fermees(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    if not TASKS_FILE.exists():
        return CheckStatus.AUTO_OK, "0 tâche"
    try:
        data = json.loads(TASKS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return CheckStatus.PENDING, "tasks.json illisible"
    tasks = data.get("tasks", []) if isinstance(data, dict) else data
    year_tasks = [
        t for t in tasks
        if t.get("year") == year
        and not t.get("dismissed")
        and t.get("status") not in ("done",)
    ]
    if not year_tasks:
        return CheckStatus.AUTO_OK, "toutes fermées"
    return CheckStatus.AUTO_WARNING, f"{len(year_tasks)} ouverte{'s' if len(year_tasks) > 1 else ''}"


def _eval_export_a_jour(year: int, month: int) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import export_service, operation_service

    history = export_service.get_exports_history(year)
    matching = [e for e in history if e.get("year") == year and e.get("month") == month]
    if not matching:
        return CheckStatus.AUTO_WARNING, "aucun export"
    last = sorted(matching, key=lambda e: e.get("generated_at") or "", reverse=True)[0]
    last_ts_str = last.get("generated_at") or ""
    try:
        last_ts = datetime.fromisoformat(last_ts_str)
    except Exception:
        return CheckStatus.AUTO_OK, "export présent"

    # mtime du fichier d'ops principal
    files = [f for f in operation_service.list_operation_files() if f.get("year") == year and f.get("month") == month]
    if not files:
        return CheckStatus.AUTO_OK, "export présent (aucune op)"
    from backend.core.config import IMPORTS_OPERATIONS_DIR

    op_mtimes = []
    for f in files:
        p = IMPORTS_OPERATIONS_DIR / f["filename"]
        if p.exists():
            op_mtimes.append(datetime.fromtimestamp(p.stat().st_mtime))
    if op_mtimes and max(op_mtimes) > last_ts:
        return CheckStatus.AUTO_WARNING, "export antérieur aux ops"
    return CheckStatus.AUTO_OK, "à jour"


# ── Section annuelle 1 : liasse SCP ──


def _eval_liasse_ca_saisi(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import liasse_scp_service

    liasse = liasse_scp_service.get_liasse(year)
    if liasse:
        ca = liasse.get("ca_declare")
        return CheckStatus.AUTO_OK, f"CA {ca:,.2f} €".replace(",", " ")
    return CheckStatus.AUTO_WARNING, "non saisi"


def _eval_liasse_pdf_dans_ged(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import ged_service

    metadata = ged_service.load_metadata()
    docs = ged_service.get_documents(metadata, type_filter="liasse_fiscale_scp", year=year)
    if docs:
        return CheckStatus.AUTO_OK, f"{len(docs)} document{'s' if len(docs) > 1 else ''}"
    return CheckStatus.AUTO_WARNING, "absent de la GED"


# ── Section annuelle 2 : charges forfaitaires ──


def _eval_blanchissage_genere(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    from backend.services.charges_forfaitaires_service import ChargesForfaitairesService

    svc = ChargesForfaitairesService()
    generes = svc.get_forfaits_generes(year)
    if generes:
        return CheckStatus.AUTO_OK, f"{generes[0].get('montant', 0):.2f} €"
    return CheckStatus.AUTO_WARNING, "non généré"


def _eval_repas_genere(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    from backend.services.charges_forfaitaires_service import ChargesForfaitairesService

    svc = ChargesForfaitairesService()
    generes = svc.get_repas_generes(year)
    if generes:
        return CheckStatus.AUTO_OK, f"{generes[0].get('montant', 0):.2f} €"
    return CheckStatus.AUTO_WARNING, "non généré"


def _eval_vehicule_applique(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    from backend.services.charges_forfaitaires_service import ChargesForfaitairesService

    svc = ChargesForfaitairesService()
    info = svc.get_vehicule_genere(year)
    if info:
        return CheckStatus.AUTO_OK, f"{info.get('ratio_pro_applique', 0)} %"
    return CheckStatus.AUTO_WARNING, "non appliqué"


# ── Section annuelle 3 : amortissements ──


def _eval_dotation_n_appliquee(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import amortissement_service

    od = amortissement_service.find_dotation_operation(year)
    if od:
        return CheckStatus.AUTO_OK, "OD passée"
    return CheckStatus.AUTO_WARNING, "OD manquante"


# ── Section annuelle 4 : mois validés ──


def _eval_12_mois_validated(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    data = _load_year_file(year)
    nb_validated = 0
    for m in range(1, 13):
        key = f"{m:02d}"
        inst = data.get(key)
        if isinstance(inst, dict) and inst.get("validated_at"):
            nb_validated += 1
    if nb_validated == 12:
        return CheckStatus.AUTO_OK, "12/12 validés"
    return CheckStatus.AUTO_WARNING, f"{nb_validated}/12 validés"


# ── Section annuelle 5 : cohérences annuelles ──


def _eval_somme_bnc(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    """Vérifie que Σ BNC mensuels ≈ BNC annuel."""
    from backend.services import analytics_service, bnc_service

    try:
        overview = analytics_service.get_year_overview(year)
        somme_mensuels = sum(m.get("bnc_solde", 0) for m in overview.get("mois", []))
        bnc_annuel = bnc_service.compute_bnc(year).bnc
    except Exception:
        return CheckStatus.PENDING, "indisponible"
    ecart = abs(somme_mensuels - bnc_annuel)
    if ecart <= 0.01:
        return CheckStatus.AUTO_OK, f"écart {ecart:.2f} €"
    return CheckStatus.AUTO_WARNING, f"écart {ecart:.2f} €"


def _eval_somme_recettes_vs_liasse(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    from backend.services import bnc_service, liasse_scp_service

    ca_liasse = liasse_scp_service.get_ca_for_bnc(year)
    if ca_liasse is None:
        return CheckStatus.AUTO_OK, "liasse non saisie"
    try:
        bnc = bnc_service.compute_bnc(year)
    except Exception:
        return CheckStatus.PENDING, "BNC indisponible"
    recettes_bancaires = bnc.recettes_pro_bancaires
    if recettes_bancaires <= 0:
        return CheckStatus.AUTO_OK, "pas de recettes bancaires"
    delta_pct = abs((recettes_bancaires - ca_liasse) / ca_liasse) * 100
    if delta_pct > 5:
        return CheckStatus.AUTO_WARNING, f"écart {delta_pct:.1f} %"
    return CheckStatus.AUTO_OK, f"écart {delta_pct:.1f} %"


def _eval_charges_sociales_provisoire(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    """Charges sociales : OK si présence de cotisations URSSAF + CARMF dans l'année."""
    from backend.services import operation_service

    cotis = 0.0
    for f in operation_service.list_operation_files():
        if f.get("year") != year:
            continue
        try:
            ops = operation_service.load_operations(f["filename"])
        except Exception:
            continue
        for op in ops:
            cat = (op.get("Catégorie") or "").lower()
            sub = (op.get("Sous-catégorie") or "").lower()
            if "urssaf" in cat or "carmf" in cat or "urssaf" in sub or "carmf" in sub:
                cotis += float(op.get("Débit") or 0)
    if cotis > 0:
        return CheckStatus.AUTO_OK, f"{cotis:,.0f} €".replace(",", " ")
    return CheckStatus.AUTO_WARNING, "pas de cotisations"


# ── Catalogue ──


# Item statique. `evaluator` = nom de fonction (clé dans _EVALUATORS).
_StaticItem = dict[str, Any]
_StaticSection = dict[str, Any]


MONTHLY_SECTIONS: list[_StaticSection] = [
    {
        "key": "donnees_brutes",
        "label": "Données brutes",
        "items": [
            {"key": "donnees_brutes.releve_importe", "label": "Relevé bancaire importé", "source": "auto", "evaluator": "_eval_releve_importe"},
            {"key": "donnees_brutes.sandbox_vide", "label": "Sandbox vidée", "source": "auto", "evaluator": "_eval_sandbox_vide"},
            {"key": "donnees_brutes.ocr_pending_associes", "label": "OCR en attente associés", "source": "auto", "evaluator": "_eval_ocr_pending_associes"},
            {"key": "donnees_brutes.facsimiles_attribues", "label": "Fac-similés attribués", "source": "auto", "evaluator": "_eval_facsimiles_attribues"},
        ],
    },
    {
        "key": "categorisation",
        "label": "Catégorisation",
        "items": [
            {"key": "categorisation.taux_100", "label": "100 % catégorisé", "source": "auto", "evaluator": "_eval_categorisation_taux_100"},
            {"key": "categorisation.aucune_a_revoir", "label": "Aucune op à revoir", "source": "auto", "evaluator": "_eval_aucune_a_revoir"},
            {"key": "categorisation.aucune_non_classee", "label": "Aucune non classée", "source": "auto", "evaluator": "_eval_aucune_non_classee"},
        ],
    },
    {
        "key": "justificatifs",
        "label": "Justificatifs",
        "items": [
            {"key": "justificatifs.taux_100", "label": "100 % justifiés", "source": "auto", "evaluator": "_eval_justificatifs_taux_100"},
            {"key": "justificatifs.ops_verrouillees", "label": "Ops verrouillées", "source": "auto", "evaluator": "_eval_ops_verrouillees"},
            {"key": "justificatifs.aucun_orphelin", "label": "Aucun lien orphelin", "source": "auto", "evaluator": "_eval_aucun_orphelin"},
        ],
    },
    {
        "key": "lettrage",
        "label": "Lettrage",
        "items": [
            {"key": "lettrage.taux_100", "label": "100 % lettré", "source": "auto", "evaluator": "_eval_lettrage_taux_100"},
            {"key": "lettrage.auto_pointage_actif", "label": "Auto-pointage actif", "source": "auto", "evaluator": "_eval_auto_pointage_actif"},
        ],
    },
    {
        "key": "compte_attente",
        "label": "Compte d'attente",
        "items": [
            # `vide_ou_commente` est dynamique (un item par op en attente). Voir _build_section_items_for_month.
            {"key": "compte_attente.vide_ou_commente", "label": "Vide ou commenté", "source": "auto", "evaluator": "__compte_attente_dynamic__"},
            {"key": "compte_attente.alertes_resolues", "label": "Alertes résolues", "source": "auto", "evaluator": "_eval_compte_attente_alertes_resolues"},
        ],
    },
    {
        "key": "coherences",
        "label": "Cohérences",
        "items": [
            {"key": "coherences.debits_credits_equilibres", "label": "Débits / Crédits équilibrés", "source": "auto", "evaluator": "_eval_debits_credits_equilibres"},
            {"key": "coherences.bnc_plausible_vs_n1", "label": "BNC plausible vs N-1", "source": "auto", "evaluator": "_eval_bnc_plausible_vs_n1"},
        ],
    },
    {
        "key": "specifique_mois",
        "label": "Spécifique au mois",
        "items": [
            {"key": "specifique_mois.urssaf_trimestrielle", "label": "URSSAF trimestrielle liée", "source": "auto", "evaluator": "_eval_urssaf_trimestrielle"},
            {"key": "specifique_mois.od_decembre_passees", "label": "OD de décembre passées", "source": "auto", "evaluator": "_eval_od_decembre_passees"},
        ],
    },
    {
        "key": "avant_envoi",
        "label": "Avant envoi",
        "items": [
            {"key": "avant_envoi.snapshot_pre_envoi_cree", "label": "Snapshot pré-envoi créé", "source": "manual"},
            {"key": "avant_envoi.taches_kanban_fermees", "label": "Tâches kanban fermées", "source": "auto", "evaluator": "_eval_taches_kanban_fermees"},
            {"key": "avant_envoi.export_a_jour", "label": "Export à jour", "source": "auto", "evaluator": "_eval_export_a_jour"},
        ],
    },
]


ANNUAL_SECTIONS: list[_StaticSection] = [
    {
        "key": "liasse_scp",
        "label": "Liasse SCP",
        "items": [
            {"key": "liasse_scp.ca_saisi", "label": "CA saisi", "source": "auto", "evaluator": "_eval_liasse_ca_saisi"},
            {"key": "liasse_scp.liasse_pdf_dans_ged", "label": "Liasse PDF dans la GED", "source": "auto", "evaluator": "_eval_liasse_pdf_dans_ged"},
        ],
    },
    {
        "key": "charges_forfaitaires",
        "label": "Charges forfaitaires",
        "items": [
            {"key": "charges_forfaitaires.blanchissage_genere", "label": "Blanchissage généré", "source": "auto", "evaluator": "_eval_blanchissage_genere"},
            {"key": "charges_forfaitaires.repas_genere", "label": "Repas généré", "source": "auto", "evaluator": "_eval_repas_genere"},
            {"key": "charges_forfaitaires.vehicule_applique", "label": "Véhicule appliqué", "source": "auto", "evaluator": "_eval_vehicule_applique"},
        ],
    },
    {
        "key": "amortissements",
        "label": "Amortissements",
        "items": [
            {"key": "amortissements.registre_a_jour", "label": "Registre à jour", "source": "manual"},
            {"key": "amortissements.dotation_n_appliquee", "label": "Dotation N appliquée", "source": "auto", "evaluator": "_eval_dotation_n_appliquee"},
        ],
    },
    {
        "key": "mois_valides",
        "label": "Mois validés",
        "items": [
            {"key": "mois_valides.12_mois_validated", "label": "12 mois validés", "source": "auto", "evaluator": "_eval_12_mois_validated"},
        ],
    },
    {
        "key": "coherences_annuelles",
        "label": "Cohérences annuelles",
        "items": [
            {"key": "coherences_annuelles.somme_bnc", "label": "Σ BNC mensuels ≈ annuel", "source": "auto", "evaluator": "_eval_somme_bnc"},
            {"key": "coherences_annuelles.somme_recettes_vs_liasse", "label": "Recettes ≈ CA liasse", "source": "auto", "evaluator": "_eval_somme_recettes_vs_liasse"},
            {"key": "coherences_annuelles.charges_sociales_provisoire", "label": "Charges sociales présentes", "source": "auto", "evaluator": "_eval_charges_sociales_provisoire"},
        ],
    },
    {
        "key": "documents_annuels",
        "label": "Documents annuels",
        "items": [
            {"key": "documents_annuels.attestation_carmf", "label": "Attestation CARMF", "source": "manual"},
            {"key": "documents_annuels.attestation_urssaf", "label": "Attestation URSSAF", "source": "manual"},
            {"key": "documents_annuels.avis_ir_n_moins_1", "label": "Avis IR N-1", "source": "manual"},
            {"key": "documents_annuels.convention_scp", "label": "Convention SCP", "source": "manual"},
        ],
    },
    {
        "key": "snapshot_annuel",
        "label": "Snapshot annuel",
        "items": [
            {"key": "snapshot_annuel.bilan_pre_envoi_cree", "label": "Bilan pré-envoi créé", "source": "manual"},
        ],
    },
    {
        "key": "regularisations",
        "label": "Régularisations",
        "items": [
            {"key": "regularisations.od_decembre_passees", "label": "OD de décembre passées", "source": "auto", "evaluator": "_eval_od_decembre_passees_annual"},
            {"key": "regularisations.compte_attente_decembre_traite", "label": "Compte d'attente déc. traité", "source": "auto", "evaluator": "_eval_compte_attente_decembre_annual"},
        ],
    },
]


def _eval_od_decembre_passees_annual(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    return _eval_od_decembre_passees(year, 12)


def _eval_compte_attente_decembre_annual(year: int, month: Optional[int] = None) -> tuple[CheckStatus, Optional[str]]:
    """OK si compte d'attente de décembre vide OU tous commentés."""
    items = _collect_attente_with_filename(year, 12)
    if not items:
        return CheckStatus.AUTO_OK, "vide"
    sans_comm = sum(1 for it in items if not (it.get("Commentaire") or "").strip())
    if sans_comm == 0:
        return CheckStatus.AUTO_OK, f"{len(items)} commenté{'s' if len(items) > 1 else ''}"
    return CheckStatus.BLOCKING, f"{sans_comm}/{len(items)} sans commentaire"


# Mapping nom évaluateur → callable
_EVALUATORS: dict[str, Callable[[int, Optional[int]], tuple[CheckStatus, Optional[str]]]] = {
    name: fn
    for name, fn in globals().items()
    if name.startswith("_eval_") and callable(fn)
}


# ───────────────────────────── Construction d'instance ─────────────────────────────


def _build_compte_attente_dynamic_items(year: int, month: int, persisted: dict) -> list[CheckEnvoiItem]:
    """Pour chaque op en compte d'attente, génère un item bloquant avec key incluant le hash."""
    attente_ops = _collect_attente_with_filename(year, month)
    items: list[CheckEnvoiItem] = []
    for op in attente_ops:
        op_hash = _attente_op_hash(
            op["filename"], op["Date"], op["Libelle"],
            op.get("Debit", 0), op.get("Credit", 0),
        )
        key = f"compte_attente.vide_ou_commente.{op_hash}"
        existing = persisted.get(key, {})
        comment = op.get("Commentaire") or existing.get("comment") or None
        amount = op.get("Debit", 0) - op.get("Credit", 0)
        label = f"{op['Date']} · {op['Libelle']} · {amount:+.2f} €"
        manual_ok = bool(comment and comment.strip())
        status = CheckStatus.MANUAL_OK if manual_ok else CheckStatus.BLOCKING
        items.append(CheckEnvoiItem(
            key=key,
            label=label,
            source=CheckSource.AUTO,
            status=status,
            detail=op["filename"],
            comment=comment,
            requires_comment=True,
            last_evaluated_at=datetime.now(),
        ))
    if not items:
        # Aucune op en attente → un item synthétique OK
        items.append(CheckEnvoiItem(
            key="compte_attente.vide_ou_commente",
            label="Compte d'attente vide",
            source=CheckSource.AUTO,
            status=CheckStatus.AUTO_OK,
            detail="0 op en attente",
            requires_comment=False,
            last_evaluated_at=datetime.now(),
        ))
    return items


def _build_section(
    section_def: _StaticSection,
    year: int,
    month: Optional[int],
    persisted_items: dict,
) -> CheckEnvoiSection:
    """Construit une section : pour chaque item statique, évalue (auto) ou lit le persisté (manual)."""
    items: list[CheckEnvoiItem] = []
    for item_def in section_def["items"]:
        key = item_def["key"]
        source_str = item_def["source"]
        evaluator_name = item_def.get("evaluator")

        # Cas spécial : compte d'attente dynamique
        if evaluator_name == "__compte_attente_dynamic__":
            assert month is not None
            items.extend(_build_compte_attente_dynamic_items(year, month, persisted_items))
            continue

        persisted = persisted_items.get(key, {})

        if source_str == "manual":
            manual_ok = bool(persisted.get("manual_ok"))
            comment = persisted.get("comment")
            status = CheckStatus.MANUAL_OK if manual_ok else CheckStatus.PENDING
            items.append(CheckEnvoiItem(
                key=key,
                label=item_def["label"],
                source=CheckSource.MANUAL,
                status=status,
                detail=None,
                comment=comment,
                requires_comment=False,
                last_evaluated_at=None,
            ))
        else:  # auto
            fn = _EVALUATORS.get(evaluator_name) if evaluator_name else None
            if fn is None:
                status, detail = CheckStatus.PENDING, "évaluateur manquant"
            else:
                status, detail = _safe_call(fn, year, month)
            items.append(CheckEnvoiItem(
                key=key,
                label=item_def["label"],
                source=CheckSource.AUTO,
                status=status,
                detail=detail,
                comment=persisted.get("comment"),
                requires_comment=False,
                last_evaluated_at=datetime.now(),
            ))
    return CheckEnvoiSection(
        key=section_def["key"],
        label=section_def["label"],
        items=items,
    )


def _persisted_items_for(year: int, period: CheckPeriod, month: Optional[int]) -> dict:
    """Lit la map persistée `{item_key: {comment, manual_ok, ...}}` pour une instance."""
    data = _load_year_file(year)
    key = _period_key(period, month)
    inst = data.get(key) or {}
    return inst.get("items", {})


def _compute_counts_and_ready(sections: list[CheckEnvoiSection]) -> tuple[dict[str, int], bool]:
    counts = {"ok": 0, "warning": 0, "blocking": 0, "pending": 0}
    has_blocking = False
    for s in sections:
        for it in s.items:
            if it.status in (CheckStatus.AUTO_OK, CheckStatus.MANUAL_OK):
                counts["ok"] += 1
            elif it.status == CheckStatus.AUTO_WARNING:
                counts["warning"] += 1
            elif it.status == CheckStatus.BLOCKING:
                counts["blocking"] += 1
                has_blocking = True
            else:
                counts["pending"] += 1
    return counts, not has_blocking


def get_instance(year: int, period: CheckPeriod, month: Optional[int] = None) -> CheckEnvoiInstance:
    """Construit l'instance courante (items auto recalculés à chaque appel)."""
    if period == CheckPeriod.MONTH and month is None:
        raise ValueError("month requis pour period=month")

    persisted = _persisted_items_for(year, period, month)

    catalog = MONTHLY_SECTIONS if period == CheckPeriod.MONTH else ANNUAL_SECTIONS
    sections = [_build_section(s, year, month, persisted) for s in catalog]
    counts, ready = _compute_counts_and_ready(sections)

    data = _load_year_file(year)
    key = _period_key(period, month)
    inst_persisted = data.get(key) or {}
    validated_at_str = inst_persisted.get("validated_at")
    validated_at = None
    if validated_at_str:
        try:
            validated_at = datetime.fromisoformat(validated_at_str)
        except Exception:
            validated_at = None

    return CheckEnvoiInstance(
        period=period,
        year=year,
        month=month,
        sections=sections,
        validated_at=validated_at,
        validated_by=inst_persisted.get("validated_by", "user"),
        ready_for_send=ready,
        counts=counts,
    )


def update_item(
    year: int,
    period: CheckPeriod,
    month: Optional[int],
    item_key: str,
    *,
    comment: Optional[str] = None,
    manual_ok: Optional[bool] = None,
) -> CheckEnvoiInstance:
    """Met à jour un item (commentaire libre ou toggle manuel)."""
    data = _load_year_file(year)
    key = _period_key(period, month)
    inst = data.get(key) or {}
    items = inst.get("items") or {}
    entry = items.get(item_key) or {}

    if comment is not None:
        # Vide → suppression du champ
        cleaned = comment.strip()
        if cleaned:
            entry["comment"] = cleaned
        else:
            entry.pop("comment", None)
    if manual_ok is not None:
        entry["manual_ok"] = bool(manual_ok)

    if entry:
        items[item_key] = entry
    else:
        items.pop(item_key, None)
    inst["items"] = items
    data[key] = inst
    _save_year_file(year, data)

    # Si l'item est un sous-item du compte d'attente, propager le commentaire
    # vers l'op pour que l'export CSV le garde.
    if comment is not None and item_key.startswith("compte_attente.vide_ou_commente."):
        _propagate_attente_comment(year, month, item_key, comment.strip() if comment else None)

    return get_instance(year, period, month)


def _propagate_attente_comment(
    year: int,
    month: Optional[int],
    item_key: str,
    comment: Optional[str],
) -> None:
    """Pose le commentaire sur l'op `compte_attente_commentaire` (lookup par hash)."""
    if month is None:
        return
    expected_hash = item_key.rsplit(".", 1)[-1]
    from backend.services import operation_service

    for meta in operation_service.list_operation_files():
        if meta.get("year") != year or meta.get("month") != month:
            continue
        try:
            ops = operation_service.load_operations(meta["filename"])
        except Exception:
            continue
        modified = False
        for op in ops:
            cat = (op.get("Catégorie") or "").strip()
            is_attente = bool(op.get("compte_attente"))
            is_empty = cat in _BAD_CATS
            if not (is_attente or is_empty):
                continue
            h = _attente_op_hash(
                meta["filename"],
                op.get("Date") or "",
                op.get("Libellé") or op.get("Libelle") or "",
                float(op.get("Débit") or 0),
                float(op.get("Crédit") or 0),
            )
            if h == expected_hash:
                if comment:
                    op["compte_attente_commentaire"] = comment
                else:
                    op.pop("compte_attente_commentaire", None)
                modified = True
        if modified:
            try:
                operation_service.save_operations(ops, meta["filename"])
            except Exception as e:
                logger.warning("Propagation commentaire attente échouée: %s", e)


def validate_instance(year: int, period: CheckPeriod, month: Optional[int] = None) -> CheckEnvoiInstance:
    """Marque `validated_at = now()` si ready_for_send. Sinon ValueError."""
    instance = get_instance(year, period, month)
    if not instance.ready_for_send:
        raise ValueError("Instance non prête : items bloquants restants")

    data = _load_year_file(year)
    key = _period_key(period, month)
    inst = data.get(key) or {}
    inst["validated_at"] = datetime.now().isoformat()
    inst["validated_by"] = "user"
    data[key] = inst
    _save_year_file(year, data)

    # Reminder dismissed pour cette période
    reminders = _load_reminders()
    rkey = _reminder_period_key(year, period, month)
    reminders.pop(rkey, None)
    _save_reminders(reminders)

    return get_instance(year, period, month)


def unvalidate_instance(year: int, period: CheckPeriod, month: Optional[int] = None) -> CheckEnvoiInstance:
    """Annule la validation."""
    data = _load_year_file(year)
    key = _period_key(period, month)
    inst = data.get(key) or {}
    inst.pop("validated_at", None)
    data[key] = inst
    _save_year_file(year, data)
    return get_instance(year, period, month)


# ───────────────────────────── Coverage + email ─────────────────────────────


def get_coverage(year: int) -> dict:
    """Retourne `{'01': bool, ..., '12': bool, 'annual': bool}` indiquant si chaque
    instance est validée. Un mois est considéré couvert s'il a `validated_at`.
    """
    data = _load_year_file(year)
    out: dict[str, bool] = {}
    for m in range(1, 13):
        key = f"{m:02d}"
        inst = data.get(key) or {}
        out[key] = bool(inst.get("validated_at"))
    inst_a = data.get("annual") or {}
    out["annual"] = bool(inst_a.get("validated_at"))
    return out


def get_notes_for_email(year: int, month: int) -> str:
    """Format `- {Section.label} / {item.label} : {comment}` une ligne par commentaire."""
    instance = get_instance(year, CheckPeriod.MONTH, month)
    lines: list[str] = []
    for section in instance.sections:
        for it in section.items:
            if it.comment and it.comment.strip():
                lines.append(f"- {section.label} / {it.label} : {it.comment.strip()}")
    return "\n".join(lines)


# ───────────────────────────── Reminders ─────────────────────────────


def _compute_level(period_key: str, now: datetime, settings: dict) -> Optional[int]:
    """Retourne 1/2/3 ou None selon delta jours.

    period_key format : "YYYY-MM" ou "YYYY-annual".
    Mois M : delta = (now - date(Y, M+1, 1)).days
    Annual : delta = (now - date(Y+1, 1, 31)).days
    """
    n1 = int(settings.get("check_envoi_reminder_n1_offset", 10))
    n2 = int(settings.get("check_envoi_reminder_n2_offset", 15))
    n3 = int(settings.get("check_envoi_reminder_n3_offset", 20))

    # Vacances : pas de reminder pendant la fenêtre
    vacances = settings.get("check_envoi_vacances_jusquau")
    if vacances:
        try:
            dt_vac = date.fromisoformat(vacances)
            if now.date() <= dt_vac:
                return None
        except Exception:
            pass

    try:
        if period_key.endswith("-annual"):
            year = int(period_key.split("-")[0])
            ref_date = date(year + 1, 1, 31)
        else:
            year_str, month_str = period_key.split("-")
            year, month = int(year_str), int(month_str)
            if month == 12:
                ref_date = date(year + 1, 1, 1)
            else:
                ref_date = date(year, month + 1, 1)
    except Exception:
        return None

    delta = (now.date() - ref_date).days
    if delta < n1:
        return None
    if delta < n2:
        return 1
    if delta < n3:
        return 2
    return 3


def get_active_reminder(now: Optional[datetime] = None) -> Optional[ReminderState]:
    """Retourne le reminder actif (le plus haut niveau non-snoozé non-dismissé)."""
    if now is None:
        now = datetime.now()
    settings = _load_settings_dict()
    reminders = _load_reminders()

    # Scanner les périodes possibles : 12 derniers mois + annuel N-1
    candidates: list[ReminderState] = []
    current_year = now.year
    for delta_month in range(0, 13):
        ref = now.replace(day=1) - timedelta(days=delta_month * 30)
        period_key = f"{ref.year}-{ref.month:02d}"
        # Si validé → skip
        coverage = get_coverage(ref.year)
        if coverage.get(f"{ref.month:02d}"):
            continue
        level = _compute_level(period_key, now, settings)
        if not level:
            continue
        existing = reminders.get(period_key) or {}
        if existing.get("dismissed_for_period"):
            continue
        snoozed_until = existing.get("snoozed_until")
        if snoozed_until:
            try:
                if datetime.fromisoformat(snoozed_until) > now:
                    continue
            except Exception:
                pass
        candidates.append(ReminderState(
            period_key=period_key,
            level=level,  # type: ignore[arg-type]
            last_shown_at=now,
            snoozed_until=None,
            dismissed_for_period=False,
        ))

    # Annual reminder pour year-1
    annual_key = f"{current_year - 1}-annual"
    cov_n1 = get_coverage(current_year - 1)
    if not cov_n1.get("annual"):
        level_a = _compute_level(annual_key, now, settings)
        if level_a:
            existing = reminders.get(annual_key) or {}
            if not existing.get("dismissed_for_period"):
                snoozed_until = existing.get("snoozed_until")
                snooze_blocked = False
                if snoozed_until:
                    try:
                        if datetime.fromisoformat(snoozed_until) > now:
                            snooze_blocked = True
                    except Exception:
                        pass
                if not snooze_blocked:
                    candidates.append(ReminderState(
                        period_key=annual_key,
                        level=level_a,  # type: ignore[arg-type]
                        last_shown_at=now,
                        snoozed_until=None,
                        dismissed_for_period=False,
                    ))

    if not candidates:
        return None
    # Niveau le plus haut
    candidates.sort(key=lambda r: r.level, reverse=True)
    return candidates[0]


def get_reminder_state_response(now: Optional[datetime] = None) -> dict:
    """Format pour le frontend."""
    active = get_active_reminder(now)
    if not active:
        return {"should_show": False}

    # Wording
    period_key = active.period_key
    if period_key.endswith("-annual"):
        year = period_key.split("-")[0]
        period_label = f"l'année {year}"
    else:
        year_str, month_str = period_key.split("-")
        period_label = f"{MOIS_FR[int(month_str) - 1]} {year_str}"

    if active.level == 1:
        message = f"Check {period_label} en attente — pense à valider quand tu peux."
    elif active.level == 2:
        message = f"Check {period_label} toujours pas validé — il vaut mieux s'y mettre."
    else:
        message = f"Check {period_label} en retard — l'envoi au comptable n'a pas eu lieu."

    return {
        "should_show": True,
        "level": active.level,
        "period_key": active.period_key,
        "message": message,
    }


def snooze_reminder(period_key: str, until_iso: str) -> dict:
    """Reporte un reminder à plus tard."""
    reminders = _load_reminders()
    entry = reminders.get(period_key) or {}
    entry["snoozed_until"] = until_iso
    entry["period_key"] = period_key
    reminders[period_key] = entry
    _save_reminders(reminders)
    return entry


def dismiss_reminder(period_key: str) -> dict:
    """Dismiss définitivement (jusqu'à ré-validation cassée)."""
    reminders = _load_reminders()
    entry = reminders.get(period_key) or {}
    entry["dismissed_for_period"] = True
    entry["period_key"] = period_key
    reminders[period_key] = entry
    _save_reminders(reminders)
    return entry


def daily_recompute_reminders() -> int:
    """Job quotidien : pour chaque (year, month) entre N-1 mois et N+0, recalcule
    `level` et nettoie les entrées des instances validées. Retourne nb d'entrées
    écrites/modifiées.
    """
    now = datetime.now()
    settings = _load_settings_dict()
    reminders = _load_reminders()
    written = 0

    # Nettoyer les entrées d'instances désormais validées
    keys_to_remove: list[str] = []
    for key in list(reminders.keys()):
        try:
            if key.endswith("-annual"):
                year = int(key.split("-")[0])
                cov = get_coverage(year)
                if cov.get("annual"):
                    keys_to_remove.append(key)
            else:
                year_str, month_str = key.split("-")
                year = int(year_str)
                cov = get_coverage(year)
                if cov.get(month_str):
                    keys_to_remove.append(key)
        except Exception:
            continue
    for k in keys_to_remove:
        reminders.pop(k, None)
        written += 1

    # Recalculer le niveau pour les périodes pertinentes
    for delta in range(0, 14):
        ref = now.replace(day=1) - timedelta(days=delta * 30)
        period_key = f"{ref.year}-{ref.month:02d}"
        cov = get_coverage(ref.year)
        if cov.get(f"{ref.month:02d}"):
            continue
        level = _compute_level(period_key, now, settings)
        if not level:
            continue
        entry = reminders.get(period_key) or {}
        if entry.get("level") != level:
            entry["level"] = level
            entry["period_key"] = period_key
            reminders[period_key] = entry
            written += 1

    annual_key = f"{now.year - 1}-annual"
    cov_n1 = get_coverage(now.year - 1)
    if not cov_n1.get("annual"):
        level_a = _compute_level(annual_key, now, settings)
        if level_a:
            entry = reminders.get(annual_key) or {}
            if entry.get("level") != level_a:
                entry["level"] = level_a
                entry["period_key"] = annual_key
                reminders[annual_key] = entry
                written += 1

    _save_reminders(reminders)
    return written
