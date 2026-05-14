#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ASDF_BIN="$(command -v asdf 2>/dev/null || true)"
if [ -z "$ASDF_BIN" ] && [ -x /opt/homebrew/bin/asdf ]; then
  ASDF_BIN=/opt/homebrew/bin/asdf
fi

if [ -n "$ASDF_BIN" ]; then
  "$ASDF_BIN" exec node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
  exec "$ASDF_BIN" exec node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.client.json
fi

node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
exec node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.client.json
