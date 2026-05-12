#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ASDF_BIN="$(command -v asdf 2>/dev/null || true)"
if [ -z "$ASDF_BIN" ] && [ -x /opt/homebrew/bin/asdf ]; then
  ASDF_BIN=/opt/homebrew/bin/asdf
fi

DEV_CLIENT_HOST="${DEV_CLIENT_HOST:-127.0.0.1}"
DEV_CLIENT_PORT="${DEV_CLIENT_PORT:-5173}"
VITE_DEV_SERVER_URL="${VITE_DEV_SERVER_URL:-http://${DEV_CLIENT_HOST}:${DEV_CLIENT_PORT}}"

if [ -n "$ASDF_BIN" ]; then
  exec env VITE_DEV_SERVER_URL="$VITE_DEV_SERVER_URL" "$ASDF_BIN" exec node --import tsx src/index.ts
fi

exec env VITE_DEV_SERVER_URL="$VITE_DEV_SERVER_URL" node --import tsx src/index.ts
