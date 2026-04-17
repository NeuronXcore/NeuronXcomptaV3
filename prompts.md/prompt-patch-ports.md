# Patch — Filet de sécurité ports (kill-ports.sh + trap start.sh)

## Contexte

Le backend uvicorn se retrouve parfois zombie après un reload :
worker qui accumule du CPU (EasyOCR en cours, PDF processing, MD5 scan)
et que `--timeout-graceful-shutdown 2` n'arrive pas à trancher.
Résultat : port 8000 squatté, obligation de `lsof` + `kill -9` à la main.

Ce patch automatise ce cleanup en 2 fichiers. **Il ne règle pas la cause
racine** (les handlers natifs bloqués), il industrialise le workaround.
Le fix profond coopératif viendra dans un second prompt.

## 1. Créer `kill-ports.sh` à la racine du repo

```bash
#!/usr/bin/env bash
# kill-ports.sh — libère de force les ports 8000 (backend) et 5173 (frontend).
# À lancer quand un reload uvicorn a mal fini et laisse un zombie.
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

## 2. Modifier `start.sh` — pre-kill au boot + trap cleanup

**Ajouter juste après le shebang `#!/usr/bin/env bash` (ou `#!/bin/bash`),
AVANT toute autre commande du script** :

```bash
# Pre-kill : libère les ports si une session précédente a mal fini
lsof -ti tcp:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti tcp:5173 2>/dev/null | xargs kill -9 2>/dev/null || true

# Trap cleanup : garantit la libération des ports à la sortie du script
# (Ctrl+C, kill, exit normal — tous les cas sont couverts)
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

**Ne pas toucher au reste du script** — les flags uvicorn existants
(`--timeout-graceful-shutdown 2`, `--reload-exclude ...`) restent tels quels.

## Validation

1. Lance `./start.sh` — vérifie que les logs pre-kill s'affichent sans erreur
   (même s'il n'y a rien à tuer).
2. Ctrl+C — tu dois voir le bloc `🧹 Cleanup — libération des ports...`.
3. Relance immédiatement `./start.sh` — zéro `EADDRINUSE`.
4. Teste `./kill-ports.sh` seul — il doit marcher même quand rien ne tourne
   (affiche `✅ Port X libre` ou `🔪 Kill port X → PIDs: ...`).

## CHANGELOG

Ajouter sous `### Added` de la session en cours :

> - **DevX — filet de sécurité ports** : nouveau script `kill-ports.sh`
>   à la racine (lsof + pkill pour 8000 et 5173) à lancer manuellement
>   quand un worker uvicorn zombie squatte le port. `start.sh` gagne un
>   pre-kill automatique au boot + un trap EXIT/INT/TERM qui libère les
>   ports dans tous les cas de sortie. Résout les `EADDRINUSE` après
>   un reload mal terminé (handler natif bloqué au-delà des 2s de
>   `--timeout-graceful-shutdown`).
