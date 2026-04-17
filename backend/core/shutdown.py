"""Event global signalé au shutdown du lifespan.

Les services en boucle longue (SSE, background loops) doivent checker
cet event pour garantir un shutdown uvicorn propre et rapide.
"""
from __future__ import annotations

import asyncio

shutdown_event: asyncio.Event = asyncio.Event()


def is_shutting_down() -> bool:
    """Helper pour les checks dans les boucles."""
    return shutdown_event.is_set()
