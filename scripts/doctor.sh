#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

EXPECTED_NODE="$(awk '$1 == "nodejs" { print $2; exit }' .tool-versions)"
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

for tool in deno yt-dlp ffmpeg ffprobe; do
  if check_command "$tool"; then
    version_flag="--version"
    if [ "$tool" = "ffmpeg" ] || [ "$tool" = "ffprobe" ]; then
      version_flag="-version"
    fi
    if version_output="$("$tool" "$version_flag" 2>&1)"; then
      echo "$tool: ${version_output%%$'\n'*}"
    else
      echo "$tool: failed to run"
      FAILED=1
    fi
  fi
done

if command -v ffmpeg >/dev/null; then
  if encoder_info="$(ffmpeg -hide_banner -h encoder=libmp3lame 2>&1)" && [[ "$encoder_info" == *"Encoder libmp3lame"* ]]; then
    echo "ffmpeg MP3 encoder: ok"
  else
    echo "ffmpeg MP3 encoder: missing libmp3lame"
    FAILED=1
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Runtime setup: brew bundle, then asdf install (see README.md)."
fi

if [ ! -d node_modules ]; then
  echo "node_modules: missing (run npm ci)"
  FAILED=1
elif [ "$NODE_AVAILABLE" -eq 1 ]; then
  if node --input-type=module <<'EOF'
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const db = new Database(":memory:");
db.prepare("select 1").get();
db.close();
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
