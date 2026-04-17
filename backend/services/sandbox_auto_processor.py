"""
Sandbox auto-processor — loop asyncio qui déclenche `_process_from_sandbox`
pour les fichiers non-canoniques laissés en sandbox/ depuis plus de
`sandbox_auto_delay_seconds`, quand `sandbox_auto_mode` est activé.

Off par défaut (mode manuel). Lifespan hook dans `main.py` démarre/arrête
la tâche autour de start/stop du watchdog.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from backend.core.config import SETTINGS_FILE
from backend.core.shutdown import shutdown_event

logger = logging.getLogger(__name__)

_POLL_INTERVAL_SEC = 10.0


def _load_auto_settings() -> tuple[bool, int]:
    """Lit `sandbox_auto_mode` + `sandbox_auto_delay_seconds` depuis settings.json.

    Fallback défensif : off, 30s. Lu à chaque tick → les changements UI sont
    pris en compte sans redémarrage backend.
    """
    if not SETTINGS_FILE.exists():
        return (False, 30)
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Sandbox auto-processor: lecture settings échouée: %s", e)
        return (False, 30)
    try:
        auto_mode = bool(data.get("sandbox_auto_mode", False))
        delay = int(data.get("sandbox_auto_delay_seconds", 30))
        # Clamp à des bornes raisonnables pour éviter les abus
        delay = max(5, min(delay, 3600))
        return (auto_mode, delay)
    except Exception:
        return (False, 30)


async def auto_processor_loop(stop_event: Optional[asyncio.Event] = None) -> None:
    """Tourne jusqu'à cancellation. Scanne les arrivals toutes les 10s.

    Sleep interrompable via shutdown_event — sortie sub-seconde au shutdown
    uvicorn au lieu d'attendre la fin du sleep(10).
    """
    logger.info("Sandbox auto-processor: loop démarrée (off par défaut, off/on via settings)")
    while not shutdown_event.is_set():
        try:
            if stop_event is not None and stop_event.is_set():
                break

            # Sleep interrompable — sort immédiatement si shutdown_event set
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=_POLL_INTERVAL_SEC)
                break  # event set → sortir de la boucle
            except asyncio.TimeoutError:
                pass  # tick normal — poursuivre

            auto_mode, delay = _load_auto_settings()
            if not auto_mode:
                continue

            # Import local pour éviter import circulaire au boot
            from backend.services import sandbox_service

            now = datetime.now()
            arrivals = sandbox_service.list_sandbox_arrivals()
            if not arrivals:
                continue

            to_process: list[str] = []
            for filename, arrived_at in arrivals.items():
                elapsed = (now - arrived_at).total_seconds()
                if elapsed >= delay:
                    to_process.append(filename)

            if not to_process:
                continue

            logger.info(
                "Sandbox auto-processor: %d fichier(s) éligible(s) (délai %ds)",
                len(to_process), delay,
            )
            for filename in to_process:
                try:
                    # Vérifier que le fichier est toujours là (peut avoir été renommé
                    # entre le snapshot et maintenant)
                    if sandbox_service.get_sandbox_path(filename) is None:
                        sandbox_service._unregister_sandbox_arrival(filename)
                        continue
                    sandbox_service._process_from_sandbox(filename)
                except Exception as e:
                    logger.warning(
                        "Sandbox auto-processor: échec pour %s: %s",
                        filename, e,
                    )

        except asyncio.CancelledError:
            logger.info("Sandbox auto-processor: loop annulée")
            raise
        except Exception as e:
            logger.error("Sandbox auto-processor: erreur inattendue: %s", e)
            # Ne pas crash la loop — attendre avant de ré-essayer, en restant coopératif
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=_POLL_INTERVAL_SEC)
                break  # event set → sortir
            except asyncio.TimeoutError:
                pass  # tick normal
