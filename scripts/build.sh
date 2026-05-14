#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ASDF_BIN="$(command -v asdf 2>/dev/null || true)"
if [ -z "$ASDF_BIN" ] && [ -x /opt/homebrew/bin/asdf ]; then
  ASDF_BIN=/opt/homebrew/bin/asdf
fi

if [ -n "$ASDF_BIN" ]; then
  rm -rf ./dist
  "$ASDF_BIN" exec node ./node_modules/typescript/bin/tsc -p tsconfig.json
  exec "$ASDF_BIN" exec node ./node_modules/vite/bin/vite.js build
fi

rm -rf ./dist
node ./node_modules/typescript/bin/tsc -p tsconfig.json
exec ./node_modules/.bin/vite build
