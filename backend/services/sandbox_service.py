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
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from backend.core.config import (
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_SANDBOX_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    ALLOWED_JUSTIFICATIF_EXTENSIONS,
    IMAGE_EXTENSIONS,
    ensure_directories,
)
from backend.services import ocr_service
from backend.services.justificatif_service import _convert_image_to_pdf

logger = logging.getLogger(__name__)

# ─── SSE Event Queue + ring buffer pour rejeu au (re)connect ───

sandbox_event_queue: asyncio.Queue = asyncio.Queue()
_event_loop: Optional[asyncio.AbstractEventLoop] = None

# Ring buffer des events récents — rejoué à chaque nouveau client SSE
# (cas reload uvicorn / frontend fermé au moment du push / reconnect).
RECENT_EVENT_WINDOW_SEC = 180
_RECENT_EVENT_MAX = 30
_recent_events: deque = deque(maxlen=_RECENT_EVENT_MAX)
_recent_events_lock = threading.Lock()


def _make_event_id(filename: str, timestamp: str, status: str = "processed") -> str:
    """event_id stable : permet au frontend de dédupliquer entre push live et rejeu disque.

    Inclut le status pour différencier les events « scanning » (arrivée) et
    « processed » (fin du pipeline) sur le même fichier.
    """
    return f"{filename}@{timestamp}@{status}"


def get_recent_events(window_sec: int = RECENT_EVENT_WINDOW_SEC) -> list[dict]:
    """Events des dernières `window_sec` secondes (rejeu SSE au connect)."""
    cutoff = datetime.now() - timedelta(seconds=window_sec)
    with _recent_events_lock:
        return [
            e for e in _recent_events
            if _parse_iso(e.get("timestamp")) >= cutoff
        ]


def _parse_iso(ts: Optional[str]) -> datetime:
    if not ts:
        return datetime.min
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return datetime.min


def _lookup_operation_ref(pdf_name: str) -> Optional[dict]:
    """Cherche l'op qui référence ce justificatif (ou une sous-ligne ventilée)."""
    try:
        from backend.services import operation_service
        for meta in operation_service.list_operation_files():
            fname = meta["filename"]
            try:
                ops = operation_service.load_operations(fname)
            except Exception:
                continue
            for idx, op in enumerate(ops):
                link = op.get("Lien justificatif") or ""
                if link and Path(link).name == pdf_name:
                    return {
                        "file": fname,
                        "index": idx,
                        "ventilation_index": None,
                        "libelle": op.get("Libellé", ""),
                        "date": op.get("Date", ""),
                        "montant": abs(float(op.get("Débit", 0) or 0)) or abs(float(op.get("Crédit", 0) or 0)),
                        "locked": bool(op.get("locked")),
                    }
                for vl_idx, vl in enumerate(op.get("ventilation", []) or []):
                    if vl.get("justificatif") == pdf_name:
                        return {
                            "file": fname,
                            "index": idx,
                            "ventilation_index": vl_idx,
                            "libelle": op.get("Libellé", ""),
                            "date": op.get("Date", ""),
                            "montant": float(vl.get("montant", 0) or 0),
                            "locked": bool(op.get("locked")),
                        }
    except Exception:
        pass
    return None


def seed_recent_events_from_disk(window_sec: int = RECENT_EVENT_WINDOW_SEC) -> int:
    """Scan en_attente/ ET traites/ *.ocr.json, seed le ring buffer.

    Appelé au démarrage pour rattraper les events perdus si le backend
    a redémarré pendant/après un batch sandbox. Ne pousse PAS dans la queue —
    c'est uniquement pour le rejeu au premier SSE connect. Les fichiers en
    traites/ sont marqués `auto_associated: true` avec leur op de rattachement.
    """
    ensure_directories()
    cutoff = datetime.now() - timedelta(seconds=window_sec)
    seeded = 0
    for directory, in_traites in ((JUSTIFICATIFS_EN_ATTENTE_DIR, False), (JUSTIFICATIFS_TRAITES_DIR, True)):
        if not directory.exists():
            continue
        for ocr_file in directory.glob("*.ocr.json"):
            try:
                data = json.loads(ocr_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            if data.get("status") != "success":
                continue
            processed_at = data.get("processed_at")
            if not processed_at or _parse_iso(processed_at) < cutoff:
                continue
            pdf_name = data.get("filename") or ocr_file.name.replace(".ocr.json", ".pdf")
            if not (directory / pdf_name).exists():
                continue
            ed = data.get("extracted_data") or {}
            operation_ref = _lookup_operation_ref(pdf_name) if in_traites else None
            event = {
                "event_id": _make_event_id(pdf_name, processed_at),
                "filename": pdf_name,
                "status": "processed",
                "timestamp": processed_at,
                "auto_renamed": False,
                "original_filename": None,
                "supplier": ed.get("supplier"),
                "best_date": ed.get("best_date"),
                "best_amount": ed.get("best_amount"),
                "auto_associated": in_traites and operation_ref is not None,
                "operation_ref": operation_ref,
                "replayed": True,
            }
            with _recent_events_lock:
                _recent_events.append(event)
            seeded += 1
    if seeded:
        logger.info("Sandbox: %d event(s) récent(s) seedés depuis en_attente/ + traites/", seeded)
    return seeded

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


def _push_event(
    filename: str,
    status: str = "processed",
    auto_renamed: bool = False,
    original_filename: Optional[str] = None,
    supplier: Optional[str] = None,
    best_date: Optional[str] = None,
    best_amount: Optional[float] = None,
    timestamp: Optional[str] = None,
    auto_associated: bool = False,
    operation_ref: Optional[dict] = None,
) -> None:
    """Pousse un event SSE dans la queue + ring buffer rejeu.

    `timestamp` : si fourni (typiquement `processed_at` de l'OCR), utilisé
    pour garantir un `event_id` stable entre push live et rejeu disque.
    `operation_ref` : {file, index, libelle, date, montant, ventilation_index?}
    si `auto_associated` est True.
    """
    ts = timestamp or datetime.now().isoformat()
    event = {
        "event_id": _make_event_id(filename, ts, status),
        "filename": filename,
        "status": status,
        "timestamp": ts,
        "auto_renamed": auto_renamed,
        "original_filename": original_filename,
        "supplier": supplier,
        "best_date": best_date,
        "best_amount": best_amount,
        "auto_associated": auto_associated,
        "operation_ref": operation_ref,
    }
    with _recent_events_lock:
        _recent_events.append(event)
    if _event_loop and _event_loop.is_running():
        _event_loop.call_soon_threadsafe(sandbox_event_queue.put_nowait, event)
    else:
        logger.warning("Event loop non disponible, event SSE bufferisé (rejeu au connect) pour %s", filename)


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

        # Push event « scanning » : le fichier est dans en_attente/, OCR à venir.
        # Toast minimal côté frontend pour feedback immédiat (~10-15s avant processed).
        _push_event(
            dest.name,
            "scanning",
            original_filename=filename if filename != dest.name else None,
        )

        # Lancer l'OCR (passer le nom original pour le parsing convention)
        auto_renamed = False
        original_filename_for_sse = None
        try:
            ocr_service.extract_or_cached(dest, original_filename=filename)
            logger.info("Sandbox: OCR terminé pour %s", dest.name)
        except Exception as e:
            logger.error("Sandbox: erreur OCR pour %s: %s", dest.name, e)

        # Auto-rename post-OCR
        try:
            from backend.services import justificatif_service
            ocr_cached = ocr_service.get_cached_result(dest)
            if ocr_cached and ocr_cached.get("status") == "success":
                new_name = justificatif_service.auto_rename_from_ocr(
                    dest.name, ocr_cached.get("extracted_data", {})
                )
                if new_name:
                    original_filename_for_sse = dest.name
                    dest = JUSTIFICATIFS_EN_ATTENTE_DIR / new_name
                    auto_renamed = True
                    logger.info("Sandbox: auto-renamed %s → %s", original_filename_for_sse, new_name)
        except Exception as e:
            logger.warning("Sandbox: auto-rename échoué pour %s: %s", dest.name, e)

        # Hook previsionnel — check document matching
        try:
            from backend.services import previsionnel_service
            previsionnel_service.check_single_document(dest.name, "justificatif")
        except Exception:
            pass

        # Auto-rapprochement après OCR — capturer l'éventuelle association pour CE justificatif
        auto_associated = False
        operation_ref: Optional[dict] = None
        try:
            from backend.services import rapprochement_service
            rap_result = rapprochement_service.run_auto_rapprochement()
            if rap_result.get("associations_auto", 0) > 0:
                logger.info(f"Sandbox auto-rapprochement: {rap_result['associations_auto']} associations")
                for detail in rap_result.get("associations_detail", []) or []:
                    if detail.get("justificatif") == dest.name:
                        auto_associated = True
                        operation_ref = {
                            "file": detail.get("operation_file"),
                            "index": detail.get("operation_index"),
                            "ventilation_index": detail.get("ventilation_index"),
                            "libelle": detail.get("libelle"),
                            "date": detail.get("date"),
                            "montant": detail.get("montant"),
                            "locked": bool(detail.get("locked")),
                            "score": detail.get("score"),
                        }
                        break
        except Exception as e:
            logger.warning(f"Sandbox auto-rapprochement échoué: {e}")

        # Résoudre le chemin final (en_attente/ OU traites/ si auto-associé)
        try:
            from backend.services import justificatif_service as _jsvc
            final_path = _jsvc.get_justificatif_path(dest.name)
            if final_path and final_path.exists():
                dest = final_path
        except Exception:
            pass

        # Notifier via SSE (avec info auto-rename + données OCR pour le toast riche)
        ocr_supplier: Optional[str] = None
        ocr_date: Optional[str] = None
        ocr_amount: Optional[float] = None
        ocr_processed_at: Optional[str] = None
        try:
            ocr_final = ocr_service.get_cached_result(dest)
            if ocr_final and ocr_final.get("status") == "success":
                ed = ocr_final.get("extracted_data") or {}
                ocr_supplier = ed.get("supplier")
                ocr_date = ed.get("best_date")
                ocr_amount = ed.get("best_amount")
                ocr_processed_at = ocr_final.get("processed_at")
        except Exception:
            pass

        _push_event(
            dest.name,
            "processed",
            auto_renamed=auto_renamed,
            original_filename=original_filename_for_sse,
            supplier=ocr_supplier,
            best_date=ocr_date,
            best_amount=ocr_amount,
            timestamp=ocr_processed_at,
            auto_associated=auto_associated,
            operation_ref=operation_ref,
        )

    except FileNotFoundError:
        logger.warning("Sandbox: fichier %s déjà déplacé ou supprimé", filename)
    except Exception as e:
        logger.error("Sandbox: erreur lors du traitement de %s: %s", filename, e)
        _push_event(filename, "error")


def process_existing_files() -> None:
    """Traite les fichiers (PDF/images) déjà présents dans sandbox/."""
    from concurrent.futures import ThreadPoolExecutor

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

    if not unique_files:
        return

    logger.info("Sandbox: %d fichier(s) existant(s) à traiter", len(unique_files))
    # Traiter en parallèle (max 3 threads pour ne pas saturer OCR/CPU)
    with ThreadPoolExecutor(max_workers=3) as pool:
        pool.map(_process_file, unique_files)


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
