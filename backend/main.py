"""
NeuronXcompta V3 - FastAPI Backend
Point d'entrée principal de l'API.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import APP_NAME, APP_VERSION, LOGS_DIR, ensure_directories, migrate_imports_directory
from backend.routers import operations, categories, ml, analytics, settings, reports, queries, justificatifs, ocr, exports, rapprochement, lettrage, cloture, sandbox, alertes, ged, amortissements, simulation, templates, previsionnel, tasks, ventilation, email, charges_forfaitaires, snapshots
from backend.services.sandbox_service import (
    seed_recent_events_from_disk,
    start_sandbox_watchdog,
    stop_sandbox_watchdog,
)

# Initialiser les répertoires et migrer les fichiers existants
ensure_directories()
migrate_imports_directory()

# Configurer le logging
log_file = LOGS_DIR / "app.log"
file_handler = RotatingFileHandler(
    str(log_file), maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
file_handler.setLevel(logging.INFO)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
file_handler.setFormatter(formatter)
logging.getLogger().addHandler(file_handler)
logging.getLogger().setLevel(logging.INFO)

# Background task — previsionnel scan periodique
async def _previsionnel_background_loop():
    """Refresh echeances + scan matching toutes les heures."""
    import datetime
    await asyncio.sleep(30)  # attendre 30s apres demarrage
    while True:
        try:
            from backend.services import previsionnel_service
            year = datetime.date.today().year
            previsionnel_service.refresh_echeances(year)
            previsionnel_service.update_statuts_retard()
            previsionnel_service.scan_matching()
            previsionnel_service.scan_all_prelevements(year)
        except Exception as e:
            logging.getLogger(__name__).warning(f"Previsionnel background scan error: {e}")
        await asyncio.sleep(3600)  # 1 heure

_prev_task = None


def _migrate_repas_to_repas_pro() -> None:
    """Migration one-shot : 'repas' → 'Repas pro' + sous-cat 'Repas seul' dans les opérations."""
    from backend.core.config import IMPORTS_OPERATIONS_DIR
    log = logging.getLogger(__name__)
    ops_dir = Path(IMPORTS_OPERATIONS_DIR)
    if not ops_dir.exists():
        return
    total_migrated = 0
    for fp in ops_dir.glob("*.json"):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        changed = False
        for op in data:
            if op.get("Catégorie") == "repas":
                op["Catégorie"] = "Repas pro"
                if not op.get("Sous-catégorie"):
                    op["Sous-catégorie"] = "Repas seul"
                changed = True
                total_migrated += 1
        if changed:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if total_migrated > 0:
        log.info(f"Migration repas→Repas pro: {total_migrated} opérations mises à jour")

    # Phase 2 : UBER EATS → perso (food delivery = personnel)
    uber_migrated = 0
    for fp in ops_dir.glob("*.json"):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        changed = False
        for op in data:
            lib = (op.get("Libellé") or "").upper()
            if ("UBER" in lib and "EATS" in lib) or "UBEREATS" in lib.replace(" ", ""):
                if op.get("Catégorie") != "perso" or op.get("Sous-catégorie") != "Repas":
                    op["Catégorie"] = "perso"
                    op["Sous-catégorie"] = "Repas"
                    changed = True
                    uber_migrated += 1
        if changed:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if uber_migrated > 0:
        log.info(f"Migration UBER EATS→perso: {uber_migrated} opérations mises à jour")


# Lifespan — démarrage/arrêt du sandbox watchdog + previsionnel
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _prev_task
    start_sandbox_watchdog()
    # Rejeu des events sandbox récents (fenêtre 180s) — rattrape les reloads uvicorn
    try:
        seed_recent_events_from_disk()
    except Exception as e:
        logging.getLogger(__name__).warning("seed_recent_events_from_disk: %s", e)
    # Réconciliation index rapports
    from backend.services.report_service import reconcile_index
    reconcile_index()
    # Réparation silencieuse des liens justificatifs (duplicatas, orphelins, ghosts)
    try:
        from backend.services import justificatif_service
        repair_result = justificatif_service.apply_link_repair()
        total_touched = (
            repair_result["deleted_from_attente"]
            + repair_result["moved_to_traites"]
            + repair_result["deleted_from_traites"]
            + repair_result["moved_to_attente"]
            + repair_result["ghost_refs_cleared"]
        )
        if total_touched > 0:
            logging.getLogger(__name__).info(
                f"Justificatifs link repair: "
                f"{repair_result['moved_to_traites']} moves→traites, "
                f"{repair_result['moved_to_attente']} moves→en_attente, "
                f"{repair_result['deleted_from_attente'] + repair_result['deleted_from_traites']} dup supprimés, "
                f"{repair_result['ghost_refs_cleared']} ghosts clearés, "
                f"{repair_result['conflicts_skipped']} conflits skippés"
            )
        elif repair_result["conflicts_skipped"] > 0:
            logging.getLogger(__name__).warning(
                f"Justificatifs: {repair_result['conflicts_skipped']} conflits de hash à résoudre manuellement "
                "(voir GET /api/justificatifs/scan-links)"
            )
    except Exception as e:
        logging.getLogger(__name__).warning(f"Justificatifs link repair error: {e}")
    # Migration one-shot : repas → Repas pro + Repas seul
    try:
        _migrate_repas_to_repas_pro()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Migration repas→Repas pro error: {e}")
    # Demarrer la tache previsionnel en arriere-plan
    _prev_task = asyncio.create_task(_previsionnel_background_loop())
    yield
    stop_sandbox_watchdog()
    if _prev_task:
        _prev_task.cancel()


# Créer l'app FastAPI
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="API backend pour NeuronXcompta - Assistant Comptable IA",
    lifespan=lifespan,
)

# CORS - autoriser le frontend React (Vite dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Monter les routers
app.include_router(operations.router)
app.include_router(categories.router)
app.include_router(ml.router)
app.include_router(analytics.router)
app.include_router(settings.router)
app.include_router(reports.router)
app.include_router(queries.router)
app.include_router(justificatifs.router)
app.include_router(ocr.router)
app.include_router(exports.router)
app.include_router(rapprochement.router)
app.include_router(lettrage.router)
app.include_router(cloture.router)
app.include_router(sandbox.router, prefix="/api/sandbox", tags=["sandbox"])
app.include_router(alertes.router)
app.include_router(ged.router)
app.include_router(amortissements.router)
app.include_router(simulation.router)
app.include_router(templates.router)
app.include_router(previsionnel.router)
app.include_router(tasks.router)
app.include_router(ventilation.router)
app.include_router(email.router)
app.include_router(charges_forfaitaires.router)
app.include_router(snapshots.router)


@app.get("/")
async def root():
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "status": "running",
        "docs": "/docs",
    }


@app.get("/api/health")
async def health():
    return {"status": "ok"}
