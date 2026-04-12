#!/bin/bash
# Start NeuronXcompta — backend (FastAPI) + frontend (Vite)

cd "$(dirname "$0")"

# Backend
echo "Starting backend on :8000..."
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload &
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
