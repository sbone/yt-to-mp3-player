#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VITE_PID=""
DEV_CLIENT_HOST="${DEV_CLIENT_HOST:-127.0.0.1}"
DEV_CLIENT_PORT="${DEV_CLIENT_PORT:-5173}"

cleanup() {
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

npm run dev:client -- --host "$DEV_CLIENT_HOST" --port "$DEV_CLIENT_PORT" &
VITE_PID=$!

exec ./scripts/dev-server.sh
