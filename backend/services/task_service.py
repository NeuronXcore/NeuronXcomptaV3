from __future__ import annotations

import logging
from datetime import datetime
from typing import List

from backend.core.config import (
    IMPORTS_OPERATIONS_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    MOIS_FR,
)
from backend.models.task import Task, TaskPriority, TaskSource, TaskStatus
from backend.services import cloture_service, operation_service

logger = logging.getLogger(__name__)


def generate_auto_tasks(year: int) -> List[Task]:
    """Scan app state for the given year and return candidate auto-tasks."""
    tasks: List[Task] = []
    now = datetime.now()
    current_year = now.year
    current_month = now.month

    # 1. Opérations non catégorisées — fichiers de l'année demandée
    try:
        op_files = operation_service.list_operation_files()
        for finfo in op_files:
            if finfo.get("year") != year:
                continue
            filename = finfo.get("filename", "")
            try:
                operations = operation_service.load_operations(filename)
                count = sum(
                    1
                    for op in operations
                    if not op.get("Categorie")
                    or op.get("Categorie") in ("Autres", "Non catégorisé", "?")
                )
                if count > 0:
                    month = finfo.get("month")
                    label_month = MOIS_FR[month - 1] if month and 1 <= month <= 12 else ""
                    tasks.append(
                        Task(
                            title=f"Catégoriser {count} opérations — {label_month} {year}".strip(),
                            description=f"Fichier {filename} contient {count} opérations sans catégorie ou catégorie générique.",
                            status=TaskStatus.todo,
                            priority=TaskPriority.haute if count > 20 else TaskPriority.normale,
                            source=TaskSource.auto,
                            year=year,
                            auto_key=f"categorize:{filename}",
                        )
                    )
            except Exception as e:
                logger.warning("Erreur chargement %s pour auto-tasks: %s", filename, e)
    except Exception as e:
        logger.warning("Erreur listing fichiers opérations: %s", e)

    # 2. Justificatifs en attente de rapprochement (global, pas par année)
    try:
        pending = list(JUSTIFICATIFS_EN_ATTENTE_DIR.glob("*.pdf"))
        count = len(pending)
        if count > 0:
            tasks.append(
                Task(
                    title=f"Rapprocher {count} justificatifs en attente",
                    description=f"{count} justificatifs PDF en attente de rapprochement bancaire.",
                    status=TaskStatus.todo,
                    priority=TaskPriority.haute if count > 10 else TaskPriority.normale,
                    source=TaskSource.auto,
                    year=year,
                    auto_key=f"rapprochement:pending:{year}",
                )
            )
    except Exception as e:
        logger.warning("Erreur scan justificatifs en attente: %s", e)

    # 3. Clôture incomplète — pour l'année demandée
    try:
        annual = cloture_service.get_annual_status(year)
        for m in annual:
            if m.get("has_releve") and m.get("statut") == "partiel":
                month_num = m.get("mois", 0)
                label = m.get("label", MOIS_FR[month_num - 1] if 1 <= month_num <= 12 else "")
                tl = round((m.get("taux_lettrage", 0)) * 100)
                tj = round((m.get("taux_justificatifs", 0)) * 100)
                tasks.append(
                    Task(
                        title=f"Clôturer {label} {year} (lettrage {tl}%, justificatifs {tj}%)",
                        description=f"Mois partiellement clôturé. Taux lettrage {tl}%, taux justificatifs {tj}%.",
                        status=TaskStatus.todo,
                        priority=TaskPriority.haute if tl < 50 and tj < 50 else TaskPriority.normale,
                        source=TaskSource.auto,
                        year=year,
                        auto_key=f"cloture:{year}-{month_num:02d}",
                    )
                )
    except Exception as e:
        logger.warning("Erreur scan clôture: %s", e)

    # 4. Mois sans relevé importé — pour l'année demandée (mois passés seulement)
    try:
        op_files = operation_service.list_operation_files()
        existing_months = {
            f.get("month")
            for f in op_files
            if f.get("year") == year and f.get("month")
        }
        # Pour l'année en cours, limiter aux mois passés ; pour les années passées, les 12 mois
        max_month = current_month if year == current_year else 12
        for m in range(1, max_month + 1):
            if m not in existing_months:
                label = MOIS_FR[m - 1] if 1 <= m <= 12 else str(m)
                retard = (current_year - year) * 12 + (current_month - m)
                tasks.append(
                    Task(
                        title=f"Importer le relevé de {label} {year}",
                        description=f"Aucun relevé bancaire importé pour {label} {year}.",
                        status=TaskStatus.todo,
                        priority=TaskPriority.haute if retard > 2 else TaskPriority.normale,
                        source=TaskSource.auto,
                        year=year,
                        auto_key=f"import:{year}-{m:02d}",
                    )
                )
    except Exception as e:
        logger.warning("Erreur scan mois manquants: %s", e)

    # 5. Alertes non résolues (compte d'attente) — fichiers de l'année demandée
    try:
        total = 0
        op_files = operation_service.list_operation_files()
        year_filenames = {f.get("filename") for f in op_files if f.get("year") == year}
        if IMPORTS_OPERATIONS_DIR.exists():
            for f in IMPORTS_OPERATIONS_DIR.iterdir():
                if f.suffix != ".json" or f.name not in year_filenames:
                    continue
                try:
                    operations = operation_service.load_operations(f.name)
                    total += sum(1 for op in operations if op.get("compte_attente"))
                except Exception:
                    pass
        if total > 0:
            tasks.append(
                Task(
                    title=f"Traiter {total} alertes en compte d'attente",
                    description=f"{total} opérations en compte d'attente nécessitent une résolution.",
                    status=TaskStatus.todo,
                    priority=TaskPriority.haute if total > 50 else TaskPriority.normale,
                    source=TaskSource.auto,
                    year=year,
                    auto_key=f"alertes:pending:{year}",
                )
            )
    except Exception as e:
        logger.warning("Erreur scan alertes: %s", e)

    # 7. OD dotation aux amortissements à générer — déclenche si l'exercice est clos
    #    (today.month >= 12 sur l'année en cours OU year < current_year) ET aucune OD
    #    dotation n'a été créée ET il y a au moins une immo contributive.
    try:
        year_is_past = current_year > year or (current_year == year and current_month >= 12)
        if year_is_past:
            from backend.services import amortissement_service

            already_generated = amortissement_service.find_dotation_operation(year)
            if not already_generated:
                detail = amortissement_service.get_virtual_detail(year)
                if detail.nb_immos_actives > 0:
                    tasks.append(
                        Task(
                            title=f"Générer la dotation aux amortissements {year}",
                            description=(
                                f"{detail.nb_immos_actives} immo(s) active(s) · "
                                f"dotation déductible {detail.total_deductible:.2f} €"
                            ),
                            status=TaskStatus.todo,
                            priority=TaskPriority.haute,
                            source=TaskSource.auto,
                            year=year,
                            auto_key=f"dotation_manquante_{year}",
                            metadata={
                                "nb_immos": detail.nb_immos_actives,
                                "total_deductible": detail.total_deductible,
                                "action_url": f"/amortissements?tab=dotation&year={year}",
                            },
                        )
                    )
    except Exception as e:
        logger.warning("Erreur scan dotation_manquante: %s", e)

    # 8. Alerte régularisation URSSAF — si le BNC N s'écarte de plus de 30 %
    #    du BNC N-2 (volatilité du revenu) ET l'écart entre URSSAF dû sur BNC N
    #    et URSSAF déjà payée en cash dépasse 1 k€, créer une tâche d'alerte.
    #    L'URSSAF assoit ses acomptes sur BNC N-2 → un saut de revenu provoque
    #    une régul significative (à payer ou remboursement) en N+1.
    try:
        from backend.services import urssaf_provisional_service

        delta_pct = urssaf_provisional_service.compute_bnc_delta_pct(year)
        if delta_pct is not None and abs(delta_pct) >= 30:
            regul = urssaf_provisional_service.compute_urssaf_regul_estimate(year)
            ecart = regul.get("ecart_regul", 0.0)
            if abs(ecart) >= 1000:
                signe = regul.get("signe", "regul")
                signe_label = "à payer" if signe == "regul" else "remboursement"
                priority = TaskPriority.haute if abs(delta_pct) >= 50 else TaskPriority.normale
                tasks.append(
                    Task(
                        title=f"Alerte régularisation URSSAF {year}",
                        description=(
                            f"BNC {year} {'+' if delta_pct > 0 else ''}{delta_pct:.0f} % vs N-2 · "
                            f"écart estimé {ecart:+.0f} € ({signe_label})"
                        ),
                        status=TaskStatus.todo,
                        priority=priority,
                        source=TaskSource.auto,
                        year=year,
                        auto_key=f"urssaf_regul_alert_{year}",
                        metadata={
                            "year": year,
                            "bnc_delta_pct": delta_pct,
                            "ecart_regul": round(ecart, 2),
                            "signe": signe,
                            "confiance": regul.get("confiance"),
                            "action_url": f"/visualization?year={year}&category=URSSAF",
                        },
                    )
                )
    except Exception as e:
        logger.warning("Erreur scan urssaf_regul_alert: %s", e)

    # 6. Modèle ML à réentraîner — si corrections manuelles cumulées depuis
    #    le dernier entraînement dépassent les seuils configurés dans Settings.
    try:
        corrections_count = _count_corrections_since_last_training()
        days_since = _days_since_last_training()
        corr_threshold, days_threshold = _load_ml_retrain_thresholds()

        # Condition combinée : volume absolu OU (≥1 correction depuis N jours)
        should_retrain = (
            corrections_count >= corr_threshold
            or (corrections_count >= 1 and days_since >= days_threshold)
        )

        if should_retrain:
            desc_parts = [f"{corrections_count} correction(s) depuis le dernier entraînement"]
            if days_since < 999:
                desc_parts.append(f"{days_since}j sans entraînement")
            description = " · ".join(desc_parts)

            # Priorité haute si volume ≥ 2× le seuil (signal fort que le modèle diverge)
            priority = TaskPriority.haute if corrections_count >= 2 * corr_threshold else TaskPriority.normale

            tasks.append(
                Task(
                    title="Réentraîner le modèle IA",
                    description=description,
                    status=TaskStatus.todo,
                    priority=priority,
                    source=TaskSource.auto,
                    year=year,
                    auto_key="ml_retrain",
                    metadata={
                        "corrections_count": corrections_count,
                        "days_since_training": days_since,
                        "action_url": "/agent-ai",
                    },
                )
            )
    except Exception as e:
        logger.warning("Erreur scan ml_retrain: %s", e)

    return tasks


# ── Helpers ML retrain ───────────────────────────────────────────────────

def _load_ml_retrain_thresholds() -> tuple[int, int]:
    """Charge les seuils configurables depuis settings.json, avec fallback sur
    les valeurs par défaut du modèle (10 corrections, 14 jours)."""
    try:
        import json
        from backend.core.config import SETTINGS_FILE
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                s = json.load(f)
            corr = int(s.get("ml_retrain_corrections_threshold", 10))
            days = int(s.get("ml_retrain_days_threshold", 14))
            return max(1, corr), max(1, days)
    except Exception:
        pass
    return 10, 14


def _count_corrections_since_last_training() -> int:
    """Compte les corrections manuelles postérieures au dernier entraînement sklearn.
    Lit data/ml/logs/trainings.json pour la date, puis scanne corrections/*.json.
    Retourne 0 si indéterminable."""
    import json
    from backend.core.config import DATA_DIR

    trainings_path = DATA_DIR / "ml" / "logs" / "trainings.json"
    if not trainings_path.exists():
        return 0
    try:
        trainings = json.loads(trainings_path.read_text(encoding="utf-8"))
    except Exception:
        return 0
    if not trainings:
        return 0
    last_ts = sorted((t.get("timestamp", "") for t in trainings if t.get("timestamp")))[-1:]
    if not last_ts:
        return 0
    try:
        last_dt = datetime.fromisoformat(last_ts[0])
    except ValueError:
        return 0

    corrections_dir = DATA_DIR / "ml" / "logs" / "corrections"
    if not corrections_dir.exists():
        return 0
    total = 0
    for fp in corrections_dir.glob("corrections_*.json"):
        try:
            entries = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        for entry in entries:
            ts = entry.get("timestamp", "")
            if not ts:
                continue
            try:
                if datetime.fromisoformat(ts) > last_dt:
                    total += 1
            except ValueError:
                continue
    return total


def _days_since_last_training() -> int:
    """Jours écoulés depuis le dernier entraînement. 999 si jamais entraîné."""
    import json
    from backend.core.config import DATA_DIR

    trainings_path = DATA_DIR / "ml" / "logs" / "trainings.json"
    if not trainings_path.exists():
        return 999
    try:
        trainings = json.loads(trainings_path.read_text(encoding="utf-8"))
    except Exception:
        return 999
    if not trainings:
        return 999
    last_ts = sorted((t.get("timestamp", "") for t in trainings if t.get("timestamp")))[-1:]
    if not last_ts:
        return 999
    try:
        last_dt = datetime.fromisoformat(last_ts[0])
    except ValueError:
        return 999
    return max(0, (datetime.now() - last_dt).days)
