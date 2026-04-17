# Prompt Claude Code — Shutdown propre du backend (fix reloads bloqués)

## Contexte

Quand uvicorn `--reload` redémarre le backend (touch fichier par Claude Code
en parallèle ou save manuel), le process reste parfois bloqué sur
`Waiting for connections to close` pendant ~2s, puis uvicorn SIGKILL le
worker. Résultat : occasionnellement le port 8000 reste squatté par un
zombie et le reload suivant échoue en `EADDRINUSE`.

**Quatre coupables identifiés après audit du code** :

1. **`sandbox_service.stop_sandbox_watchdog()` ligne 683** — fait
   `_observer.join(timeout=5)` → 5s > 2s du `--timeout-graceful-shutdown`
   d'uvicorn → SIGKILL en plein milieu du join → port pas libéré proprement.
2. **Lifespan shutdown `main.py` lignes 189-193** — `_prev_task.cancel()` et
   `_sandbox_auto_task.cancel()` sont appelés mais **jamais awaited**.
   Uvicorn ne peut pas confirmer qu'elles se sont terminées.
3. **`_previsionnel_background_loop` `main.py` lignes 44-57** — `while True`
   avec `await asyncio.sleep(3600)` nu. Cancellable par `CancelledError`,
   mais si la task est en plein milieu d'un `scan_all_prelevements()` lourd
   (synchrone), le cancel attend la fin de l'itération.
4. **SSE `_sse_generator` `routers/sandbox.py` ligne 52** — `timeout=30.0` sur
   `asyncio.wait_for` → heartbeat toutes les 30s. OK en théorie (dépend de
   `CancelledError` propagée par FastAPI au disconnect), mais trop long.

## Objectif

Shutdown uvicorn **sub-seconde** et propre (< 500 ms p99) via :
- Un `asyncio.Event` global de shutdown coopératif.
- Les background loops checkent l'event au lieu de `sleep()` nu.
- Les tasks sont `await`ées avec timeout borné après `.cancel()`.
- Le watchdog join descend de 5s → 1s.

**Contraintes** :
- Backward-compatible : aucun changement d'API publique.
- Pas de nouvelle dépendance.
- Conserver les flags `--timeout-graceful-shutdown 2` et `--reload-exclude` de `start.sh`.

---

## Ordre d'implémentation

### 1. Créer `backend/core/shutdown.py` (nouveau fichier)

```python
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
```

### 2. Modifier `backend/services/sandbox_service.py` — timeout observer 5 → 1

**Ligne 683 actuelle** :
```python
_observer.join(timeout=5)
```

**Remplacer `stop_sandbox_watchdog()` (lignes 677-686) par** :

```python
def stop_sandbox_watchdog() -> None:
    """Arrête le watchdog."""
    global _observer, _watchdog_thread_started

    if _observer is None:
        return
    try:
        _observer.stop()
        _observer.join(timeout=1.0)  # était 5 — trop long vs --timeout-graceful-shutdown 2
        if _observer.is_alive():
            logger.warning(
                "Sandbox watchdog observer still alive after 1s join — "
                "daemon thread will be reaped at process exit"
            )
    finally:
        _observer = None
        _watchdog_thread_started = False
        logger.info("Sandbox watchdog arrêté")
```

L'observer est déjà `daemon=True` (ligne 666), donc même s'il ne join pas à
temps Python le collecte au process exit. Aucun risque de leak persistant.

### 3. Modifier `backend/main.py` — 3 changements

#### 3a. Imports

Ajouter en haut du fichier (après les autres imports `backend.core.*`) :

```python
from backend.core.shutdown import shutdown_event
```

#### 3b. Réécrire `_previsionnel_background_loop` (lignes 44-57)

**Remplacer entièrement** :

```python
async def _previsionnel_background_loop():
    """Refresh echeances + scan matching toutes les heures.

    Sleep interrompable via shutdown_event — sortie sub-seconde au shutdown
    uvicorn au lieu d'attendre la fin du sleep(3600).
    """
    import datetime

    # Sleep de démarrage — sortable si shutdown avant les 30s
    try:
        await asyncio.wait_for(shutdown_event.wait(), timeout=30)
        return  # event set pendant l'attente → shutdown, on sort
    except asyncio.TimeoutError:
        pass  # 30s écoulées, on démarre normalement

    while not shutdown_event.is_set():
        try:
            from backend.services import previsionnel_service
            year = datetime.date.today().year
            previsionnel_service.refresh_echeances(year)
            previsionnel_service.update_statuts_retard()
            previsionnel_service.scan_matching()
            previsionnel_service.scan_all_prelevements(year)
        except Exception as e:
            logging.getLogger(__name__).warning(
                f"Previsionnel background scan error: {e}"
            )

        # Sleep interrompable — sort immédiatement si shutdown_event set
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=3600)
            break  # event set → sortir de la boucle
        except asyncio.TimeoutError:
            pass  # tick normal — itération suivante
```

**Le pattern `asyncio.wait_for(shutdown_event.wait(), timeout=N)` est le
remplacement canonique de `asyncio.sleep(N)` quand on veut un sleep
interrompable** : si l'event est set avant N secondes → retour immédiat ;
sinon `TimeoutError` → tick normal.

#### 3c. Réécrire le shutdown du `lifespan` (lignes 188-193)

**Remplacer la partie après `yield`** :

```python
    yield

    # === SHUTDOWN ===
    log = logging.getLogger(__name__)

    # 1. Signal coopératif — débloque les boucles qui checkent shutdown_event
    shutdown_event.set()

    # 2. Stop watchdog (thread) avec join borné à 1s — voir stop_sandbox_watchdog
    try:
        stop_sandbox_watchdog()
    except Exception as e:
        log.warning("stop_sandbox_watchdog error: %s", e)

    # 3. Cancel + await tasks asyncio avec timeout global de 1.5s
    tasks = [t for t in (_prev_task, _sandbox_auto_task) if t is not None]
    for t in tasks:
        t.cancel()
    if tasks:
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=1.5,
            )
        except asyncio.TimeoutError:
            log.warning(
                "Shutdown: %d background task(s) non terminée(s) en 1.5s — "
                "uvicorn les killera",
                sum(1 for t in tasks if not t.done()),
            )
```

**Différences clés avec l'existant** :
- `shutdown_event.set()` en PREMIER → débloque les boucles coopératives avant tout.
- `asyncio.gather(*tasks, return_exceptions=True)` collecte les `CancelledError`
  sans propager → le lifespan sort proprement.
- `asyncio.wait_for(..., timeout=1.5)` garantit qu'on n'attend jamais plus
  de 1.5s, sous le budget 2s d'uvicorn.

#### 3d. Auditer `backend/services/sandbox_auto_processor.py` (si boucle asyncio présente)

Le lifespan lance aussi `asyncio.create_task(auto_processor_loop())` depuis ce
module (main.py ligne 187). **Ouvrir ce fichier et vérifier sa boucle principale** :

- Si elle contient `while True: await asyncio.sleep(N)` → appliquer la même
  transformation qu'au §3b : remplacer par le pattern
  `asyncio.wait_for(shutdown_event.wait(), timeout=N)` avec check
  `while not shutdown_event.is_set()`.
- Importer `shutdown_event` en tête du fichier :
  `from backend.core.shutdown import shutdown_event`.
- Si la boucle ne contient pas de `sleep` long (ex. déjà coopérative avec
  polling court ou events), aucune modif nécessaire — le `.cancel()` +
  `await` du §3c suffit.

Exemple de transformation si besoin :

```python
# AVANT
async def auto_processor_loop():
    while True:
        await asyncio.sleep(30)
        try:
            process_pending()
        except Exception as e:
            logger.warning(f"auto_processor error: {e}")

# APRÈS
from backend.core.shutdown import shutdown_event

async def auto_processor_loop():
    while not shutdown_event.is_set():
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=30)
            break  # event set → sortir
        except asyncio.TimeoutError:
            pass  # tick normal
        try:
            process_pending()
        except Exception as e:
            logger.warning(f"auto_processor error: {e}")
```

### 4. Modifier `backend/routers/sandbox.py` — SSE plus réactif

**Actuellement** (lignes 45-59) :

```python
async def _sse_generator():
    """Générateur SSE avec keepalive ping toutes les 30s."""
    yield f"data: {json.dumps({'status': 'connected', 'timestamp': ''})}\n\n"
    for ev in get_recent_events():
        yield f"data: {json.dumps({**ev, 'replayed': True})}\n\n"
    try:
        while True:
            try:
                event = await asyncio.wait_for(sandbox_event_queue.get(), timeout=30.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    except asyncio.CancelledError:
        logger.info("SSE sandbox: client déconnecté")
```

**Remplacer par** (ajout import `shutdown_event`, check explicite, timeout 30 → 2) :

```python
from backend.core.shutdown import shutdown_event

async def _sse_generator():
    """Générateur SSE avec keepalive ping toutes les 2s.

    Sort proprement sur shutdown_event.set() — évite les connexions SSE
    traînantes qui bloquent le graceful shutdown uvicorn.
    """
    yield f"data: {json.dumps({'status': 'connected', 'timestamp': ''})}\n\n"
    for ev in get_recent_events():
        yield f"data: {json.dumps({**ev, 'replayed': True})}\n\n"
    try:
        while not shutdown_event.is_set():
            try:
                event = await asyncio.wait_for(sandbox_event_queue.get(), timeout=2.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    except asyncio.CancelledError:
        logger.info("SSE sandbox: client déconnecté")
```

Pas besoin de passer `request: Request` en paramètre — la combinaison
`shutdown_event` + `CancelledError` (propagée par FastAPI au disconnect
client) couvre les deux cas de sortie.

### 5. Créer `kill-ports.sh` à la racine du repo

```bash
#!/usr/bin/env bash
# kill-ports.sh — libère de force les ports 8000 (backend) et 5173 (frontend).
# Utile quand un reload uvicorn a mal fini et laisse un zombie.
set -e

PORTS=(8000 5173)

for PORT in "${PORTS[@]}"; do
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "🔪 Kill port $PORT → PIDs: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  else
    echo "✅ Port $PORT libre"
  fi
done

# Filet de sécurité — tue tout process résiduel même s'il n'écoute plus.
pkill -9 -f "uvicorn backend.main" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true

echo "✨ Ports libérés"
```

Puis : `chmod +x kill-ports.sh`

### 6. Modifier `start.sh` — pre-kill + trap cleanup

Ajouter après le shebang, **avant** toute autre commande :

```bash
# Libère les ports si une session précédente a mal fini
lsof -ti tcp:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti tcp:5173 2>/dev/null | xargs kill -9 2>/dev/null || true

cleanup() {
  echo ""
  echo "🧹 Cleanup — libération des ports..."
  lsof -ti tcp:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti tcp:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
  pkill -9 -f "uvicorn backend.main" 2>/dev/null || true
  pkill -9 -f "vite" 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM
```

Conserver le reste du script tel quel (les flags uvicorn existants sont bons).

---

## Validation

Après implémentation, tester dans cet ordre :

1. **Smoke test** — `./start.sh`. Backend démarre sans erreur, page `/` charge,
   SSE sandbox se connecte (badge « Sandbox actif »).
2. **Reload propre** — `touch backend/main.py`. Logs uvicorn : le reload doit
   prendre **moins de 1 seconde**. Aucun `Waiting for connections to close` qui
   traîne. SSE frontend reconnecte sans toast d'erreur visible.
3. **Ctrl+C** — tuer `start.sh`, relancer immédiatement. Zéro `EADDRINUSE`.
4. **Stress parallèle** — lancer Claude Code avec modifications rapides en
   rafale sur plusieurs fichiers backend. Le port 8000 ne doit jamais rester
   squatté.
5. **Script de secours** — `./kill-ports.sh` libère les deux ports sans erreur,
   même quand rien ne tourne.

---

## Fichiers touchés (récap)

| # | Fichier | Action |
|---|---|---|
| 1 | `backend/core/shutdown.py` | **Créer** — event global |
| 2 | `backend/services/sandbox_service.py` | **Modifier** — `_observer.join(timeout=1.0)` au lieu de 5 |
| 3a | `backend/main.py` (imports) | **Ajouter** `from backend.core.shutdown import shutdown_event` |
| 3b | `backend/main.py` (`_previsionnel_background_loop`) | **Réécrire** — sleeps interrompables |
| 3c | `backend/main.py` (lifespan shutdown) | **Réécrire** — set event + await gather tasks |
| 3d | `backend/services/sandbox_auto_processor.py` | **Auditer** — rendre la boucle coopérative si elle contient `sleep` long |
| 4 | `backend/routers/sandbox.py` | **Modifier** — check shutdown_event + timeout 2s |
| 5 | `kill-ports.sh` | **Créer** + `chmod +x` |
| 6 | `start.sh` | **Modifier** — pre-kill + trap cleanup |

---

## CHANGELOG

À ajouter dans `CHANGELOG.md` sous `### Fixed` de la session en cours :

> - **DevX — Shutdown propre du backend (fix reloads bloqués)** :
>   - Nouveau `backend/core/shutdown.py` exposant `shutdown_event: asyncio.Event`
>     global set au début du lifespan shutdown. Les boucles background checkent
>     cet event au lieu d'un `asyncio.sleep()` nu.
>   - `_previsionnel_background_loop` (main.py) : remplace
>     `await asyncio.sleep(3600)` par `await asyncio.wait_for(shutdown_event.wait(), timeout=3600)`
>     → sortie sub-seconde au shutdown au lieu d'attendre la fin du sleep.
>   - Lifespan shutdown : les 2 background tasks (`_prev_task`, `_sandbox_auto_task`)
>     sont maintenant **awaitées** via `asyncio.gather(..., return_exceptions=True)`
>     avec timeout global 1.5s. Auparavant seulement `.cancel()` sans await → uvicorn
>     ne savait pas quand elles finissaient.
>   - `sandbox_service.stop_sandbox_watchdog()` : `_observer.join(timeout=5)` →
>     `timeout=1.0`. 5s était > 2s du `--timeout-graceful-shutdown` uvicorn,
>     donc le join était coupé en plein milieu par un SIGKILL → port potentiellement
>     squatté. L'observer est `daemon=True` donc aucun risque de leak.
>   - SSE `_sse_generator` (routers/sandbox.py) : check explicite `shutdown_event.is_set()`
>     dans la boucle + timeout heartbeat 30s → 2s (réactivité shutdown).
>   - `start.sh` gagne un pre-kill des ports 8000/5173 au boot + trap EXIT/INT/TERM
>     pour libérer les ports dans tous les cas de sortie.
>   - Nouveau script `kill-ports.sh` à la racine pour débloquer manuellement un
>     zombie résiduel (`lsof -ti` + `pkill -f`).

---

## CLAUDE.md

Ajouter une ligne dans la section DevX / reloads :

> - **Shutdown coopératif** : `backend/core/shutdown.py` expose `shutdown_event:
>   asyncio.Event` set dans le lifespan shutdown. Toute nouvelle boucle asyncio
>   longue ou SSE DOIT checker cet event
>   (`while not shutdown_event.is_set()` ou `asyncio.wait_for(shutdown_event.wait(), timeout=N)`)
>   pour garantir un reload uvicorn propre. **Ne jamais** écrire
>   `while True: await asyncio.sleep(N)` nu — utilise toujours le pattern
>   wait_for(shutdown_event.wait(), timeout=N).
