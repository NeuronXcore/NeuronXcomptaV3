"""
NeuronXcompta V3 - FastAPI Backend
Point d'entrée principal de l'API.
"""

import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import APP_NAME, APP_VERSION, LOGS_DIR, ensure_directories
from backend.routers import operations, categories, ml, analytics, settings, reports, queries, justificatifs, ocr, exports, rapprochement, lettrage, cloture, echeancier, sandbox, alertes
from backend.services.sandbox_service import start_sandbox_watchdog, stop_sandbox_watchdog

# Initialiser les répertoires
ensure_directories()

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

# Lifespan — démarrage/arrêt du sandbox watchdog
@asynccontextmanager
async def lifespan(app: FastAPI):
    start_sandbox_watchdog()
    yield
    stop_sandbox_watchdog()


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
app.include_router(echeancier.router)
app.include_router(sandbox.router, prefix="/api/sandbox", tags=["sandbox"])
app.include_router(alertes.router)


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
