"""Router pour les paramètres de l'application."""
from __future__ import annotations

import json
import platform
import shutil
import sys
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from backend.core.config import (
    SETTINGS_FILE, DATA_DIR, IMPORTS_OPERATIONS_DIR, IMPORTS_RELEVES_DIR, EXPORTS_DIR,
    REPORTS_DIR, RAPPORTS_DIR, LOGS_DIR,
    JUSTIFICATIFS_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR, ML_DIR,
    APP_NAME, APP_VERSION, ensure_directories,
)
from backend.models.settings import AppSettings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings():
    """Charge les paramètres de l'application."""
    if not SETTINGS_FILE.exists():
        return AppSettings().model_dump()
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return AppSettings().model_dump()


@router.put("")
async def save_settings(settings: AppSettings):
    """Sauvegarde les paramètres."""
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings.model_dump(), f, ensure_ascii=False, indent=2)
    return {"message": "Paramètres sauvegardés"}


@router.get("/disk-space")
async def get_disk_space():
    """Retourne l'espace disque disponible."""
    usage = shutil.disk_usage(str(DATA_DIR))
    return {
        "total_gb": round(usage.total / (1024**3), 2),
        "used_gb": round(usage.used / (1024**3), 2),
        "free_gb": round(usage.free / (1024**3), 2),
        "percent_used": round(usage.used / usage.total * 100, 1),
    }


@router.get("/data-stats")
async def get_data_stats():
    """Retourne des statistiques sur les dossiers de données."""
    ensure_directories()

    def folder_stats(path: Path) -> dict:
        if not path.exists():
            return {"count": 0, "size": 0, "size_human": "0 o"}
        files = [f for f in path.iterdir() if f.is_file()]
        total = sum(f.stat().st_size for f in files)
        return {
            "count": len(files),
            "size": total,
            "size_human": _format_size(total),
        }

    return {
        "imports": {
            "count": folder_stats(IMPORTS_OPERATIONS_DIR)["count"] + folder_stats(IMPORTS_RELEVES_DIR)["count"],
            "size": folder_stats(IMPORTS_OPERATIONS_DIR)["size"] + folder_stats(IMPORTS_RELEVES_DIR)["size"],
            "size_human": _format_size(
                folder_stats(IMPORTS_OPERATIONS_DIR)["size"] + folder_stats(IMPORTS_RELEVES_DIR)["size"]
            ),
        },
        "exports": folder_stats(EXPORTS_DIR),
        "reports": {
            "count": folder_stats(REPORTS_DIR)["count"] + folder_stats(RAPPORTS_DIR)["count"],
            "size": folder_stats(REPORTS_DIR)["size"] + folder_stats(RAPPORTS_DIR)["size"],
            "size_human": _format_size(
                folder_stats(REPORTS_DIR)["size"] + folder_stats(RAPPORTS_DIR)["size"]
            ),
        },
        "justificatifs_en_attente": folder_stats(JUSTIFICATIFS_EN_ATTENTE_DIR),
        "justificatifs_traites": folder_stats(JUSTIFICATIFS_TRAITES_DIR),
        "ml": folder_stats(ML_DIR),
        "logs": folder_stats(LOGS_DIR),
    }


@router.get("/system-info")
async def get_system_info():
    """Retourne les informations système."""
    return {
        "app_name": APP_NAME,
        "app_version": APP_VERSION,
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "data_dir": str(DATA_DIR),
    }


def _format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} o"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.0f} Ko"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} Mo"


@router.get("/file-tree")
async def get_file_tree():
    """Retourne l'arborescence de data/ (max profondeur 3)."""

    def scan_dir(path, depth=0, max_depth=3):
        if depth > max_depth or not path.exists():
            return None
        result = {
            "name": path.name,
            "type": "dir",
            "children": [],
            "count": 0,
            "size": 0,
        }
        try:
            for entry in sorted(path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
                if entry.name.startswith("."):
                    continue
                if entry.is_dir():
                    child = scan_dir(entry, depth + 1, max_depth)
                    if child:
                        result["children"].append(child)
                        result["count"] += child["count"]
                        result["size"] += child["size"]
                else:
                    sz = entry.stat().st_size
                    result["children"].append({
                        "name": entry.name,
                        "type": "file",
                        "size": sz,
                        "size_human": _format_size(sz),
                    })
                    result["count"] += 1
                    result["size"] += sz
        except PermissionError:
            pass
        result["size_human"] = _format_size(result["size"])
        return result

    tree = scan_dir(DATA_DIR)
    return tree or {"name": "data", "type": "dir", "children": [], "count": 0, "size": 0, "size_human": "0 o"}
