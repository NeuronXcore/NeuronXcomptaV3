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
