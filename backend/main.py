"""
NeuronXcompta V3 - FastAPI Backend
Point d'entrée principal de l'API.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import APP_NAME, APP_VERSION, LOGS_DIR, ensure_directories, migrate_imports_directory
from backend.routers import operations, categories, ml, analytics, settings, reports, queries, justificatifs, ocr, exports, rapprochement, lettrage, cloture, sandbox, alertes, ged, amortissements, simulation, templates, previsionnel, tasks, ventilation, email
from backend.services.sandbox_service import start_sandbox_watchdog, stop_sandbox_watchdog

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

# Lifespan — démarrage/arrêt du sandbox watchdog + previsionnel
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _prev_task
    start_sandbox_watchdog()
    # Réconciliation index rapports
    from backend.services.report_service import reconcile_index
    reconcile_index()
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
