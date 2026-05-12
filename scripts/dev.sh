#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VITE_PID=""

cleanup() {
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

npm run dev:client &
VITE_PID=$!

ASDF_BIN="$(command -v asdf 2>/dev/null || true)"
if [ -z "$ASDF_BIN" ] && [ -x /opt/homebrew/bin/asdf ]; then
  ASDF_BIN=/opt/homebrew/bin/asdf
fi

if [ -n "$ASDF_BIN" ]; then
  exec env VITE_DEV_SERVER_URL="http://127.0.0.1:5173" "$ASDF_BIN" exec node --import tsx src/index.ts
fi

exec env VITE_DEV_SERVER_URL="http://127.0.0.1:5173" node --import tsx src/index.ts
