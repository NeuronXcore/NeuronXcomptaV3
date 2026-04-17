"""
Service Sandbox — inbox pour les justificatifs déposés manuellement.

Comportement (Session 29+) :
- Fichier canonique (`fournisseur_YYYYMMDD_montant.XX.pdf`) → flow historique :
  move sandbox → en_attente + OCR + auto-rapprochement, apparaît dans Gestion OCR.
- Fichier non-canonique (ex: `Scan_0417_103422.pdf`) → reste dans `sandbox/`,
  enregistré en tant qu'arrival in-memory, apparaît dans l'onglet « Sandbox »
  de `/ocr` pour correction manuelle avant OCR.

La source de vérité est le filesystem `data/justificatifs/sandbox/` + l'index
in-memory `_sandbox_arrivals` (timestamp d'arrivée par fichier).
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
    SANDBOX_THUMBS_DIR,
    ensure_directories,
)
from backend.services import ocr_service
from backend.services.justificatif_service import _convert_image_to_pdf

logger = logging.getLogger(__name__)

# ─── SSE Event Queue + ring buffer pour rejeu au (re)connect ───

sandbox_event_queue: asyncio.Queue = asyncio.Queue()
_event_loop: Optional[asyncio.AbstractEventLoop] = None

RECENT_EVENT_WINDOW_SEC = 180
_RECENT_EVENT_MAX = 60
_recent_events: deque = deque(maxlen=_RECENT_EVENT_MAX)
_recent_events_lock = threading.Lock()


def _make_event_id(filename: str, timestamp: str, status: str = "processed") -> str:
    """event_id stable pour dédup cross-reload côté frontend."""
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


# ─── Sandbox arrivals (in-memory, non-canoniques en attente) ───

_sandbox_arrivals: dict[str, datetime] = {}
_arrivals_lock = threading.Lock()


def _register_sandbox_arrival(filename: str, arrived_at: Optional[datetime] = None) -> None:
    """Enregistre une arrivée. Idempotent — ne pas écraser un timestamp existant
    (préserve la date d'arrivée originale après un reboot ou un re-scan)."""
    with _arrivals_lock:
        if filename not in _sandbox_arrivals:
            _sandbox_arrivals[filename] = arrived_at or datetime.now()


def _unregister_sandbox_arrival(filename: str) -> None:
    """Retire un fichier du tracking. Appelé sur process / delete / rename."""
    with _arrivals_lock:
        _sandbox_arrivals.pop(filename, None)


def _rename_sandbox_arrival(old: str, new: str) -> None:
    """Transfère le timestamp old → new (préserve l'ancienneté lors d'un rename inplace)."""
    with _arrivals_lock:
        ts = _sandbox_arrivals.pop(old, None)
        if ts is not None:
            _sandbox_arrivals[new] = ts
        elif new not in _sandbox_arrivals:
            _sandbox_arrivals[new] = datetime.now()


def list_sandbox_arrivals() -> dict[str, datetime]:
    """Snapshot du dict arrivals (thread-safe copy)."""
    with _arrivals_lock:
        return dict(_sandbox_arrivals)


def get_sandbox_arrival(filename: str) -> Optional[datetime]:
    with _arrivals_lock:
        return _sandbox_arrivals.get(filename)


def scan_existing_sandbox_arrivals() -> int:
    """Au boot : seed `_sandbox_arrivals` depuis les fichiers présents dans sandbox/
    avec `arrived_at = mtime`. Silencieux (pas d'event SSE). À appeler avant
    `start_sandbox_watchdog` dans le lifespan."""
    ensure_directories()
    if not JUSTIFICATIFS_SANDBOX_DIR.exists():
        return 0
    count = 0
    for f in JUSTIFICATIFS_SANDBOX_DIR.iterdir():
        if f.is_file() and f.suffix.lower() in ALLOWED_JUSTIFICATIF_EXTENSIONS:
            _register_sandbox_arrival(
                f.name,
                datetime.fromtimestamp(f.stat().st_mtime),
            )
            count += 1
    if count:
        logger.info("Sandbox: %d fichier(s) pré-existant(s) seedés comme arrivals", count)
    return count


def count_sandbox_files() -> int:
    """Compteur rapide des fichiers sandbox (utilisé par /api/justificatifs/stats)."""
    ensure_directories()
    if not JUSTIFICATIFS_SANDBOX_DIR.exists():
        return 0
    return sum(
        1 for f in JUSTIFICATIFS_SANDBOX_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED_JUSTIFICATIF_EXTENSIONS
    )


def get_sandbox_path(filename: str) -> Optional[Path]:
    """Résolveur dédié sandbox (miroir de `justificatif_service.get_justificatif_path`).
    Scope strictement sandbox/ — ne retombe jamais sur en_attente/ ou traites/."""
    if not filename or "/" in filename or "\\" in filename:
        return None
    p = JUSTIFICATIFS_SANDBOX_DIR / filename
    # Garde sécu path traversal
    try:
        if p.resolve().parent != JUSTIFICATIFS_SANDBOX_DIR.resolve():
            return None
    except Exception:
        return None
    if p.exists() and p.is_file():
        return p
    return None


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
    """Scan en_attente/ + traites/ + sandbox/ et seed le ring buffer.

    Appelé au démarrage pour rattraper les events perdus si le backend a redémarré.
    Ne pousse PAS dans la queue — uniquement pour le rejeu au premier SSE connect.
    """
    ensure_directories()
    cutoff = datetime.now() - timedelta(seconds=window_sec)
    seeded = 0

    # 1. Events `processed` depuis en_attente/ et traites/ (comme avant)
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
                "is_canonical": True,
                "replayed": True,
            }
            with _recent_events_lock:
                _recent_events.append(event)
            seeded += 1

    # 2. Events `arrived` depuis sandbox/ (fichiers déposés récemment, non traités)
    if JUSTIFICATIFS_SANDBOX_DIR.exists():
        try:
            from backend.services import rename_service
        except Exception:
            rename_service = None  # type: ignore
        for pdf in JUSTIFICATIFS_SANDBOX_DIR.iterdir():
            if not (pdf.is_file() and pdf.suffix.lower() in ALLOWED_JUSTIFICATIF_EXTENSIONS):
                continue
            mtime = datetime.fromtimestamp(pdf.stat().st_mtime)
            if mtime < cutoff:
                continue
            ts = mtime.isoformat()
            is_canon = bool(rename_service and rename_service.is_canonical(pdf.name))
            event = {
                "event_id": _make_event_id(pdf.name, ts, "arrived"),
                "filename": pdf.name,
                "status": "arrived",
                "timestamp": ts,
                "auto_renamed": False,
                "original_filename": pdf.name,
                "supplier": None,
                "best_date": None,
                "best_amount": None,
                "auto_associated": False,
                "operation_ref": None,
                "is_canonical": is_canon,
                "replayed": True,
            }
            with _recent_events_lock:
                _recent_events.append(event)
            seeded += 1

    if seeded:
        logger.info("Sandbox: %d event(s) récent(s) seedés depuis disque", seeded)
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
    stem = dest.stem
    suffix = dest.suffix
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return JUSTIFICATIFS_EN_ATTENTE_DIR / f"{stem}_{ts}{suffix}"


def _resolve_sandbox_target(filename: str) -> Path:
    """Résout un chemin dans sandbox/ sans collision (incrément _2, _3, ...).

    Utilisé pour la conversion image→PDF inplace (rester dans sandbox/ jusqu'à
    action manuelle si le nom n'est pas canonique).
    """
    target = JUSTIFICATIFS_SANDBOX_DIR / filename
    if not target.exists():
        return target
    stem = target.stem
    ext = target.suffix
    for i in range(2, 100):
        candidate = JUSTIFICATIFS_SANDBOX_DIR / f"{stem}_{i}{ext}"
        if not candidate.exists():
            return candidate
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return JUSTIFICATIFS_SANDBOX_DIR / f"{stem}_{ts}{ext}"


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
    is_canonical: Optional[bool] = None,
) -> None:
    """Pousse un event SSE dans la queue + ring buffer."""
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
        "is_canonical": is_canonical,
    }
    with _recent_events_lock:
        _recent_events.append(event)
    if _event_loop and _event_loop.is_running():
        _event_loop.call_soon_threadsafe(sandbox_event_queue.put_nowait, event)
    else:
        logger.warning("Event loop non disponible, event SSE bufferisé (rejeu au connect) pour %s", filename)


def _process_from_sandbox(filename: str, original_filename: Optional[str] = None) -> dict:
    """Move sandbox → en_attente + OCR + auto-rename + auto-rapprochement.

    Point d'entrée unifié pour :
    - watchdog canonique (`_process_file` quand `is_canonical` True)
    - endpoint unitaire `POST /api/sandbox/{filename}/process`
    - auto-processor loop (si mode auto activé)

    Retourne : `{filename, status, auto_renamed, auto_associated, operation_ref}`.
    Le `filename` retourné peut différer de l'input si l'auto-rename post-OCR
    a reclassé le fichier.
    """
    src = JUSTIFICATIFS_SANDBOX_DIR / filename
    if not src.exists():
        raise FileNotFoundError(f"Fichier {filename} introuvable dans sandbox/")

    # 1. Move sandbox → en_attente
    dest = _resolve_destination(filename)
    shutil.move(str(src), str(dest))
    _unregister_sandbox_arrival(filename)
    logger.info("Sandbox: %s déplacé vers %s", filename, dest.name)

    # 2. Push scanning (toast loading côté frontend)
    _push_event(
        dest.name,
        "scanning",
        original_filename=original_filename if original_filename and original_filename != dest.name else None,
        is_canonical=True,
    )

    # 3. OCR
    try:
        ocr_service.extract_or_cached(dest, original_filename=original_filename or filename)
        logger.info("Sandbox: OCR terminé pour %s", dest.name)
    except Exception as e:
        logger.error("Sandbox: erreur OCR pour %s: %s", dest.name, e)

    # 4. Auto-rename post-OCR (filename-first avec fallback OCR)
    auto_renamed = False
    original_filename_for_sse = original_filename
    try:
        from backend.services import justificatif_service
        ocr_cached = ocr_service.get_cached_result(dest)
        if ocr_cached and ocr_cached.get("status") == "success":
            new_name = justificatif_service.auto_rename_from_ocr(
                dest.name, ocr_cached.get("extracted_data", {})
            )
            if new_name:
                original_filename_for_sse = original_filename_for_sse or dest.name
                dest = JUSTIFICATIFS_EN_ATTENTE_DIR / new_name
                auto_renamed = True
                logger.info("Sandbox: auto-renamed → %s", new_name)
    except Exception as e:
        logger.warning("Sandbox: auto-rename échoué: %s", e)

    # 5. Hook previsionnel — document matching
    try:
        from backend.services import previsionnel_service
        previsionnel_service.check_single_document(dest.name, "justificatif")
    except Exception:
        pass

    # 6. Auto-rapprochement — capter l'association éventuelle sur CE justif
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

    # 7. Résoudre chemin final (peut avoir été déplacé vers traites/ par auto-rapprochement)
    try:
        from backend.services import justificatif_service as _jsvc
        final_path = _jsvc.get_justificatif_path(dest.name)
        if final_path and final_path.exists():
            dest = final_path
    except Exception:
        pass

    # 8. Push processed avec données OCR pour toast riche
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
        is_canonical=True,
    )

    return {
        "filename": dest.name,
        "status": "processed",
        "auto_renamed": auto_renamed,
        "auto_associated": auto_associated,
        "operation_ref": operation_ref,
    }


def _process_file(filepath: Path, from_watchdog: bool = True) -> None:
    """Traite un fichier déposé dans sandbox/ — branche selon la canonicité.

    - Image (JPG/PNG) : conversion inplace en PDF dans sandbox/ (le PDF reste dans
      sandbox/, pas de move automatique).
    - PDF canonique : délègue à `_process_from_sandbox` (flow historique).
    - PDF non-canonique : reste dans sandbox/, `_register_sandbox_arrival` + event
      `arrived` (si `from_watchdog`) pour apparaître dans l'onglet Sandbox.
    """
    filename = filepath.name
    logger.info("Sandbox: traitement de %s", filename)

    try:
        if not _wait_for_file_ready(filepath):
            logger.warning("Sandbox: timeout en attente d'écriture pour %s", filename)
            return

        ext = filepath.suffix.lower()

        # Conversion image → PDF INPLACE (ne pas move vers en_attente)
        if ext in IMAGE_EXTENSIONS:
            try:
                image_bytes = filepath.read_bytes()
                pdf_bytes = _convert_image_to_pdf(image_bytes)
                new_name = filepath.stem + ".pdf"
                new_path = _resolve_sandbox_target(new_name)
                new_path.write_bytes(pdf_bytes)
                filepath.unlink()
                filepath = new_path
                filename = new_path.name
                logger.info("Sandbox: conversion image→PDF inplace → %s", filename)
            except Exception as e:
                logger.error("Sandbox: erreur conversion image %s: %s", filename, e)
                _push_event(filename, "error")
                return

        # Branchement selon la canonicité du nom final
        try:
            from backend.services import rename_service
            is_canon = rename_service.is_canonical(filename)
        except Exception:
            is_canon = False

        if is_canon:
            _unregister_sandbox_arrival(filename)
            _process_from_sandbox(filename)
        else:
            _register_sandbox_arrival(filename)
            if from_watchdog:
                _push_event(
                    filename,
                    "arrived",
                    is_canonical=False,
                    original_filename=filename,
                )
            logger.info("Sandbox: %s non-canonique, reste en attente dans sandbox/", filename)

    except FileNotFoundError:
        logger.warning("Sandbox: fichier %s déjà déplacé ou supprimé", filename)
    except Exception as e:
        logger.error("Sandbox: erreur lors du traitement de %s: %s", filename, e)
        _push_event(filename, "error")


def process_existing_files() -> None:
    """Traite les fichiers déjà présents dans sandbox/ (au boot OU trigger /process-all).

    Parallèle (3 threads max). Passe `from_watchdog=False` → les non-canoniques
    sont enregistrés silencieusement (seeded), seuls les canoniques déclenchent
    le pipeline OCR.
    """
    from concurrent.futures import ThreadPoolExecutor

    ensure_directories()
    if not JUSTIFICATIFS_SANDBOX_DIR.exists():
        return
    all_files: list[Path] = []
    for ext in ALLOWED_JUSTIFICATIF_EXTENSIONS:
        all_files.extend(JUSTIFICATIFS_SANDBOX_DIR.glob(f"*{ext}"))
        all_files.extend(JUSTIFICATIFS_SANDBOX_DIR.glob(f"*{ext.upper()}"))
    all_files.sort(key=lambda p: p.stat().st_mtime)
    seen: set[str] = set()
    unique_files: list[Path] = []
    for p in all_files:
        if p.name not in seen:
            seen.add(p.name)
            unique_files.append(p)

    if not unique_files:
        return

    logger.info("Sandbox: %d fichier(s) existant(s) à scanner", len(unique_files))
    with ThreadPoolExecutor(max_workers=3) as pool:
        pool.map(lambda p: _process_file(p, from_watchdog=False), unique_files)


class _SandboxHandler:
    """Handler pour les événements filesystem du watchdog."""

    def dispatch(self, event) -> None:
        if event.is_directory:
            return
        if event.event_type == "created":
            self.on_created(event)

    def on_created(self, event) -> None:
        src_path = Path(event.src_path)
        if src_path.suffix.lower() not in ALLOWED_JUSTIFICATIF_EXTENSIONS:
            return
        logger.info("Sandbox: nouveau fichier détecté: %s", src_path.name)
        thread = threading.Thread(
            target=_process_file,
            args=(src_path,),
            kwargs={"from_watchdog": True},
            daemon=True,
        )
        thread.start()


def start_sandbox_watchdog() -> None:
    """Démarre le watchdog sur le dossier sandbox."""
    global _observer, _watchdog_thread_started, _event_loop

    ensure_directories()

    try:
        _event_loop = asyncio.get_running_loop()
    except RuntimeError:
        _event_loop = None
        logger.warning("Sandbox: pas d'event loop asyncio, SSE désactivé")

    existing_thread = threading.Thread(target=process_existing_files, daemon=True)
    existing_thread.start()

    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler

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


# ─── API publique ───

def list_sandbox_files() -> list:
    """Liste les fichiers actuellement dans sandbox/ avec méta enrichies.

    Chaque item : {filename, size, size_human, modified, is_canonical, arrived_at,
    auto_deadline (si mode auto activé)}. Consommé par `GET /api/sandbox/list` et
    par `useSandboxInbox` côté frontend.
    """
    ensure_directories()
    if not JUSTIFICATIFS_SANDBOX_DIR.exists():
        return []

    try:
        from backend.services import rename_service
    except Exception:
        rename_service = None  # type: ignore

    # Auto-mode + delay lus depuis settings (optionnel)
    auto_mode = False
    auto_delay = 30
    try:
        from backend.core.config import SETTINGS_FILE
        if SETTINGS_FILE.exists():
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            auto_mode = bool(data.get("sandbox_auto_mode", False))
            auto_delay = int(data.get("sandbox_auto_delay_seconds", 30))
    except Exception:
        pass

    arrivals = list_sandbox_arrivals()
    files = []
    for f in sorted(JUSTIFICATIFS_SANDBOX_DIR.iterdir()):
        if f.suffix.lower() not in ALLOWED_JUSTIFICATIF_EXTENSIONS or not f.is_file():
            continue
        stat = f.stat()
        size = stat.st_size
        if size < 1024:
            size_human = f"{size} o"
        elif size < 1024 * 1024:
            size_human = f"{size / 1024:.1f} Ko"
        else:
            size_human = f"{size / (1024 * 1024):.1f} Mo"

        arrived_at = arrivals.get(f.name) or datetime.fromtimestamp(stat.st_mtime)
        # Si absent du dict (cas fichier apparu sans passer par le watchdog), seed
        if f.name not in arrivals:
            _register_sandbox_arrival(f.name, arrived_at)

        is_canon = bool(rename_service and rename_service.is_canonical(f.name))
        auto_deadline = None
        if auto_mode:
            auto_deadline = (arrived_at + timedelta(seconds=auto_delay)).isoformat()

        files.append({
            "filename": f.name,
            "size": size,
            "size_human": size_human,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "is_canonical": is_canon,
            "arrived_at": arrived_at.isoformat(),
            "auto_deadline": auto_deadline,
        })
    return files


def delete_sandbox_file(filename: str) -> bool:
    """Supprime un fichier du sandbox sans le traiter."""
    filepath = JUSTIFICATIFS_SANDBOX_DIR / filename
    if not filepath.resolve().parent == JUSTIFICATIFS_SANDBOX_DIR.resolve():
        logger.warning("Sandbox: tentative de path traversal pour %s", filename)
        return False
    if filepath.exists() and filepath.is_file():
        _delete_sandbox_thumbnail(filename)
        filepath.unlink()
        _unregister_sandbox_arrival(filename)
        logger.info("Sandbox: fichier %s supprimé", filename)
        return True
    return False


def rename_in_sandbox(old_filename: str, new_filename: str) -> dict:
    """Renomme un fichier INPLACE dans sandbox/ (avant OCR).

    - Validation : extension .pdf, pas de path traversal, nom safe.
    - Idempotent si old == new.
    - Collision cible → HTTPException 409.
    - Transfère le timestamp arrival vers le nouveau nom.

    Retourne : `{old, new, is_canonical: bool}`.
    """
    from fastapi import HTTPException

    # Sécurité : valider les noms
    if not new_filename or "/" in new_filename or "\\" in new_filename or new_filename.startswith("."):
        raise HTTPException(400, f"Nom cible invalide : '{new_filename}'")
    if not new_filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Le fichier cible doit avoir l'extension .pdf")

    src = get_sandbox_path(old_filename)
    if src is None:
        raise HTTPException(404, f"Fichier '{old_filename}' introuvable dans sandbox/")

    # Idempotence
    if old_filename == new_filename:
        try:
            from backend.services import rename_service
            is_canon = rename_service.is_canonical(new_filename)
        except Exception:
            is_canon = False
        return {"old": old_filename, "new": new_filename, "is_canonical": is_canon}

    dst = JUSTIFICATIFS_SANDBOX_DIR / new_filename
    if dst.exists():
        raise HTTPException(
            409,
            detail={
                "error": "sandbox_rename_collision",
                "message": f"Un fichier '{new_filename}' existe déjà dans sandbox/.",
            },
        )

    # Invalider l'ancienne vignette AVANT le move (évite orphelin cache)
    _delete_sandbox_thumbnail(old_filename)
    shutil.move(str(src), str(dst))
    _rename_sandbox_arrival(old_filename, new_filename)
    logger.info("Sandbox rename inplace: %s → %s", old_filename, new_filename)

    try:
        from backend.services import rename_service
        is_canon = rename_service.is_canonical(new_filename)
    except Exception:
        is_canon = False

    return {"old": old_filename, "new": new_filename, "is_canonical": is_canon}


# ─── Thumbnails (cache séparé, hors GED) ───

def _sandbox_thumb_path(filename: str) -> Path:
    """Cache path pour thumbnail sandbox. Hash md5 du filename."""
    import hashlib
    ensure_directories()
    h = hashlib.md5(filename.encode()).hexdigest()
    return SANDBOX_THUMBS_DIR / f"{h}.png"


def get_sandbox_thumbnail_path(filename: str) -> Optional[str]:
    """Génère (ou récupère depuis le cache) la thumbnail d'un fichier sandbox.

    Cache dans `data/sandbox_thumbs/` — **JAMAIS** dans `data/ged/thumbnails/`
    (sandbox/ est hors périmètre GED). Invalidé automatiquement si le PDF
    source est plus récent que la vignette.
    """
    src = get_sandbox_path(filename)
    if src is None:
        return None
    if src.suffix.lower() != ".pdf":
        return None

    thumb = _sandbox_thumb_path(filename)
    if thumb.exists() and thumb.stat().st_mtime >= src.stat().st_mtime:
        return str(thumb)

    try:
        from pdf2image import convert_from_path
        images = convert_from_path(str(src), first_page=1, last_page=1, size=(200, None))
        if images:
            images[0].save(str(thumb), "PNG")
            return str(thumb)
    except Exception as e:
        logger.warning("Sandbox: erreur génération thumbnail pour %s: %s", filename, e)
    return None


def _delete_sandbox_thumbnail(filename: str) -> None:
    """Supprime la vignette cache d'un fichier sandbox (best-effort)."""
    thumb = _sandbox_thumb_path(filename)
    if thumb.exists():
        try:
            thumb.unlink()
        except Exception as e:
            logger.warning("Sandbox: erreur suppression thumbnail %s: %s", thumb.name, e)


def process_sandbox_file(filename: str) -> dict:
    """Trigger OCR + auto-rapprochement à la demande pour un fichier sandbox.

    Endpoint `POST /api/sandbox/{filename}/process`. Délègue à
    `_process_from_sandbox` (flow historique : move → en_attente + OCR + rapprochement).
    """
    from fastapi import HTTPException

    src = get_sandbox_path(filename)
    if src is None:
        raise HTTPException(404, f"Fichier '{filename}' introuvable dans sandbox/")

    return _process_from_sandbox(filename)
