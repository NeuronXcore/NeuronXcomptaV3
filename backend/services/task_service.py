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

    return tasks
