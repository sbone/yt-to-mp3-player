#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VITE_PID=""
SERVER_PID=""
DEV_CLIENT_HOST="${DEV_CLIENT_HOST:-127.0.0.1}"
DEV_CLIENT_PORT="${DEV_CLIENT_PORT:-5173}"

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node ./node_modules/vite/bin/vite.js --host "$DEV_CLIENT_HOST" --port "$DEV_CLIENT_PORT" --strictPort &
VITE_PID=$!

./scripts/dev-server.sh &
SERVER_PID=$!
wait "$SERVER_PID"
