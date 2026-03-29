#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ASDF_BIN="$(command -v asdf 2>/dev/null || true)"
if [ -z "$ASDF_BIN" ] && [ -x /opt/homebrew/bin/asdf ]; then
  ASDF_BIN=/opt/homebrew/bin/asdf
fi

if [ -n "$ASDF_BIN" ]; then
  mkdir -p ./dist/public
  cp ./src/web/static/app.css ./dist/public/app.css
  exec "$ASDF_BIN" exec node ./node_modules/typescript/bin/tsc -p tsconfig.json
fi

mkdir -p ./dist/public
cp ./src/web/static/app.css ./dist/public/app.css
exec node ./node_modules/typescript/bin/tsc -p tsconfig.json
