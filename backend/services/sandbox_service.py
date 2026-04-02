"""
Service Sandbox Watchdog — surveille data/justificatifs/sandbox/
et déclenche automatiquement le pipeline OCR pour chaque PDF déposé.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import (
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_SANDBOX_DIR,
    ALLOWED_JUSTIFICATIF_EXTENSIONS,
    IMAGE_EXTENSIONS,
    ensure_directories,
)
from backend.services import ocr_service
from backend.services.justificatif_service import _convert_image_to_pdf

logger = logging.getLogger(__name__)

# ─── SSE Event Queue (single client) ───

sandbox_event_queue: asyncio.Queue = asyncio.Queue()
_event_loop: Optional[asyncio.AbstractEventLoop] = None

# ─── Watchdog ───

_observer = None
_watchdog_thread_started = False


def _wait_for_file_ready(filepath: Path, timeout: float = 10.0) -> bool:
    """Attend que le fichier soit complètement écrit (taille stable sur 500ms)."""
    prev_size = -1
    start = time.time()
    while time.time() - start < timeout:
        try:
            current_size = os.path.getsize(filepath)
        except OSError:
            return False
        if current_size == prev_size and current_size > 0:
            return True
        prev_size = current_size
        time.sleep(0.5)
    return False


def _resolve_destination(filename: str) -> Path:
    """Résout le chemin de destination dans en_attente/, gère les doublons."""
    dest = JUSTIFICATIFS_EN_ATTENTE_DIR / filename
    if not dest.exists():
        return dest
    # Doublon : ajouter un suffix timestamp
    stem = dest.stem
    suffix = dest.suffix
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return JUSTIFICATIFS_EN_ATTENTE_DIR / f"{stem}_{ts}{suffix}"


def _push_event(filename: str, status: str = "processed") -> None:
    """Pousse un event SSE dans la queue depuis un thread OS."""
    event = {
        "filename": filename,
        "status": status,
        "timestamp": datetime.now().isoformat(),
    }
    if _event_loop and _event_loop.is_running():
        _event_loop.call_soon_threadsafe(sandbox_event_queue.put_nowait, event)
    else:
        logger.warning("Event loop non disponible, event SSE perdu pour %s", filename)


def _process_file(filepath: Path) -> None:
    """Traite un fichier (PDF ou image) : convertir si image, move vers en_attente + OCR + event SSE."""
    filename = filepath.name
    logger.info("Sandbox: traitement de %s", filename)

    try:
        # Attendre que le fichier soit prêt
        if not _wait_for_file_ready(filepath):
            logger.warning("Sandbox: timeout en attente d'écriture pour %s", filename)
            return

        ext = filepath.suffix.lower()

        if ext in IMAGE_EXTENSIONS:
            # Convertir image → PDF
            image_bytes = filepath.read_bytes()
            pdf_bytes = _convert_image_to_pdf(image_bytes)
            dest = _resolve_destination(filepath.stem + ".pdf")
            dest.write_bytes(pdf_bytes)
            filepath.unlink()
            logger.info("Sandbox: %s converti en PDF → %s", filename, dest.name)
        else:
            # PDF : déplacer directement
            dest = _resolve_destination(filename)
            shutil.move(str(filepath), str(dest))
            logger.info("Sandbox: %s déplacé vers %s", filename, dest.name)

        # Lancer l'OCR
        try:
            ocr_service.extract_or_cached(dest)
            logger.info("Sandbox: OCR terminé pour %s", dest.name)
        except Exception as e:
            logger.error("Sandbox: erreur OCR pour %s: %s", dest.name, e)

        # Notifier via SSE
        _push_event(dest.name, "processed")

    except FileNotFoundError:
        logger.warning("Sandbox: fichier %s déjà déplacé ou supprimé", filename)
    except Exception as e:
        logger.error("Sandbox: erreur lors du traitement de %s: %s", filename, e)
        _push_event(filename, "error")


def process_existing_files() -> None:
    """Traite les fichiers (PDF/images) déjà présents dans sandbox/ au démarrage."""
    ensure_directories()
    if not JUSTIFICATIFS_SANDBOX_DIR.exists():
        return
    all_files: list[Path] = []
    for ext in ALLOWED_JUSTIFICATIF_EXTENSIONS:
        all_files.extend(JUSTIFICATIFS_SANDBOX_DIR.glob(f"*{ext}"))
        all_files.extend(JUSTIFICATIFS_SANDBOX_DIR.glob(f"*{ext.upper()}"))
    all_files.sort(key=lambda p: p.stat().st_mtime)
    # Dédupliquer (cas où glob est case-insensitive sur macOS)
    seen: set[str] = set()
    unique_files: list[Path] = []
    for p in all_files:
        if p.name not in seen:
            seen.add(p.name)
            unique_files.append(p)

    if unique_files:
        logger.info("Sandbox: %d fichier(s) existant(s) à traiter au démarrage", len(unique_files))
    for f in unique_files:
        _process_file(f)


class _SandboxHandler:
    """Handler pour les événements filesystem du watchdog."""

    def dispatch(self, event) -> None:
        """Dispatch les événements pertinents."""
        if event.is_directory:
            return
        if event.event_type == "created":
            self.on_created(event)

    def on_created(self, event) -> None:
        src_path = Path(event.src_path)
        if src_path.suffix.lower() not in ALLOWED_JUSTIFICATIF_EXTENSIONS:
            return
        logger.info("Sandbox: nouveau fichier détecté: %s", src_path.name)
        # Traiter dans un thread séparé pour ne pas bloquer le watchdog
        thread = threading.Thread(
            target=_process_file,
            args=(src_path,),
            daemon=True,
        )
        thread.start()


def start_sandbox_watchdog() -> None:
    """Démarre le watchdog sur le dossier sandbox."""
    global _observer, _watchdog_thread_started, _event_loop

    ensure_directories()

    # Capturer l'event loop asyncio courant
    try:
        _event_loop = asyncio.get_running_loop()
    except RuntimeError:
        _event_loop = None
        logger.warning("Sandbox: pas d'event loop asyncio, SSE désactivé")

    # Traiter les fichiers existants dans un thread
    existing_thread = threading.Thread(target=process_existing_files, daemon=True)
    existing_thread.start()

    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler

        # Créer un handler qui wrap notre _SandboxHandler
        class WatchdogAdapter(FileSystemEventHandler):
            def __init__(self) -> None:
                super().__init__()
                self._handler = _SandboxHandler()

            def on_created(self, event) -> None:
                self._handler.on_created(event)

        _observer = Observer()
        _observer.schedule(
            WatchdogAdapter(),
            str(JUSTIFICATIFS_SANDBOX_DIR),
            recursive=False,
        )
        _observer.daemon = True
        _observer.start()
        _watchdog_thread_started = True
        logger.info("Sandbox watchdog démarré sur %s", JUSTIFICATIFS_SANDBOX_DIR)

    except ImportError:
        logger.warning("Module 'watchdog' non installé — sandbox watchdog désactivé")
    except Exception as e:
        logger.error("Erreur démarrage sandbox watchdog: %s", e)


def stop_sandbox_watchdog() -> None:
    """Arrête le watchdog."""
    global _observer, _watchdog_thread_started

    if _observer is not None:
        _observer.stop()
        _observer.join(timeout=5)
        _observer = None
        _watchdog_thread_started = False
        logger.info("Sandbox watchdog arrêté")


def list_sandbox_files() -> list:
    """Liste les PDF actuellement dans le dossier sandbox."""
    ensure_directories()
    if not JUSTIFICATIFS_SANDBOX_DIR.exists():
        return []

    files = []
    for f in sorted(JUSTIFICATIFS_SANDBOX_DIR.iterdir()):
        if f.suffix.lower() in ALLOWED_JUSTIFICATIF_EXTENSIONS and f.is_file():
            stat = f.stat()
            size = stat.st_size
            if size < 1024:
                size_human = f"{size} o"
            elif size < 1024 * 1024:
                size_human = f"{size / 1024:.1f} Ko"
            else:
                size_human = f"{size / (1024 * 1024):.1f} Mo"
            files.append({
                "filename": f.name,
                "size": size,
                "size_human": size_human,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return files


def delete_sandbox_file(filename: str) -> bool:
    """Supprime un fichier du sandbox sans le traiter."""
    filepath = JUSTIFICATIFS_SANDBOX_DIR / filename
    # Sécurité : empêcher path traversal
    if not filepath.resolve().parent == JUSTIFICATIFS_SANDBOX_DIR.resolve():
        logger.warning("Sandbox: tentative de path traversal pour %s", filename)
        return False
    if filepath.exists() and filepath.is_file():
        filepath.unlink()
        logger.info("Sandbox: fichier %s supprimé", filename)
        return True
    return False
