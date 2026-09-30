#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

exec env DEV_MODE=1 node --import tsx src/index.ts
