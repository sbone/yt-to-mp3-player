#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
exec node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.client.json
