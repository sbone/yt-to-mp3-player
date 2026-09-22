#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

EXPECTED_NODE="$(awk '$1 == "nodejs" { print $2; exit }' .tool-versions)"
EXPECTED_DENO="$(awk '$1 == "deno" { print $2; exit }' .tool-versions)"
FAILED=0
NODE_AVAILABLE=0

check_command() {
  if ! command -v "$1" >/dev/null; then
    echo "$1: missing"
    FAILED=1
    return 1
  fi
}

if check_command node; then
  NODE_AVAILABLE=1
  NODE_VERSION="$(node --version)"
  echo "node: $NODE_VERSION (expected v$EXPECTED_NODE)"
  if [ "$NODE_VERSION" != "v$EXPECTED_NODE" ]; then
    FAILED=1
  fi
fi

if check_command deno; then
  DENO_VERSION="$(deno --version | awk 'NR == 1 { print $2 }')"
  echo "deno: $DENO_VERSION (expected $EXPECTED_DENO)"
  if [ "$DENO_VERSION" != "$EXPECTED_DENO" ]; then
    FAILED=1
  fi
fi

if check_command yt-dlp; then
  echo "yt-dlp: $(yt-dlp --version)"
fi

if check_command ffmpeg; then
  echo "$(ffmpeg -version 2>/dev/null | awk 'NR == 1 { print $1 ": " $3 }')"
fi

if [ ! -d node_modules ]; then
  echo "node_modules: missing (run npm ci)"
  FAILED=1
elif [ "$NODE_AVAILABLE" -eq 1 ]; then
  if node --input-type=module <<'EOF'
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("better-sqlite3");
console.log("better-sqlite3: ok");
EOF
  then
    :
  else
    echo "better-sqlite3: incompatible with the active Node version"
    FAILED=1
  fi
fi

exit "$FAILED"
