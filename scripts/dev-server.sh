#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DEV_CLIENT_HOST="${DEV_CLIENT_HOST:-127.0.0.1}"
DEV_CLIENT_PORT="${DEV_CLIENT_PORT:-5173}"
VITE_DEV_SERVER_URL="${VITE_DEV_SERVER_URL:-http://${DEV_CLIENT_HOST}:${DEV_CLIENT_PORT}}"

exec env VITE_DEV_SERVER_URL="$VITE_DEV_SERVER_URL" node --import tsx src/index.ts
