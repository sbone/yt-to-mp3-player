#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

exec npm rebuild better-sqlite3
