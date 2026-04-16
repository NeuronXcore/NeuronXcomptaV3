#!/bin/bash
# Start NeuronXcompta — backend (FastAPI) + frontend (Vite)

cd "$(dirname "$0")"

# Backend
# Flags uvicorn :
#   --timeout-graceful-shutdown 2  : force le kill du worker après 2s même si
#                                    des connexions SSE/watchdog/background
#                                    tasks sont encore ouvertes. Sans ce flag,
#                                    le reload reste bloqué sur "Waiting for
#                                    connections to close" (bug classique
#                                    quand l'app a des StreamingResponse).
#   --reload-exclude ...           : ignore les changements sur data/, frontend/,
#                                    logs, pkl : évite les reloads inutiles qui
#                                    font juste tomber le worker (ex. un fichier
#                                    JSON modifié par le backend lui-même ne doit
#                                    pas déclencher de reload).
echo "Starting backend on :8000..."
python3 -m uvicorn backend.main:app \
  --host 0.0.0.0 --port 8000 \
  --reload \
  --timeout-graceful-shutdown 2 \
  --reload-exclude 'data/*' \
  --reload-exclude 'frontend/*' \
  --reload-exclude '*.pkl' \
  --reload-exclude '*.log' \
  --reload-exclude 'backups/*' \
  --reload-exclude '__pycache__/*' \
  &
BACKEND_PID=$!

# Frontend
echo "Starting frontend on :5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

# Trap Ctrl+C to kill both
trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

echo "Backend PID=$BACKEND_PID | Frontend PID=$FRONTEND_PID"
echo "Press Ctrl+C to stop both."

wait
