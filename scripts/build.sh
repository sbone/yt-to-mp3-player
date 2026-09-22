#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf ./dist
node ./node_modules/typescript/bin/tsc -p tsconfig.json
exec ./node_modules/.bin/vite build
