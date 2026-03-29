#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ASDF_BIN="$(command -v asdf 2>/dev/null || true)"
if [ -z "$ASDF_BIN" ] && [ -x /opt/homebrew/bin/asdf ]; then
  ASDF_BIN=/opt/homebrew/bin/asdf
fi

NODE_CMD=(node)
if [ -n "$ASDF_BIN" ]; then
  NODE_CMD=("$ASDF_BIN" exec node)
fi

"${NODE_CMD[@]}" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const toolVersions = readFileSync(".tool-versions", "utf8");
const match = toolVersions.match(/^nodejs\s+([^\s]+)$/m);
const expected = match?.[1] ?? "unknown";

let sqliteStatus = "ok";
let sqliteError = null;
try {
  require("better-sqlite3");
} catch (error) {
  sqliteStatus = "error";
  sqliteError = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify({
  node: process.version,
  expectedNode: expected,
  betterSqlite3: sqliteStatus,
  betterSqlite3Error: sqliteError
}, null, 2));
EOF
