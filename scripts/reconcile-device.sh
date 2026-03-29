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

APPLY_MODE="${1:-}"
export APPLY_MODE

"${NODE_CMD[@]}" --import tsx --input-type=module <<'EOF'
import { AppDb } from "./src/db.ts";
import { DeviceSyncService } from "./src/deviceSync.ts";
import { reconcilePendingAgainstDevice } from "./src/deviceReconcile.ts";

const apply = process.env.APPLY_MODE === "--apply";
const db = new AppDb();
const deviceSyncService = new DeviceSyncService();
const device = deviceSyncService.getStatus();

if (!device.connected || !device.mountPath) {
  console.error(JSON.stringify({ ok: false, device }, null, 2));
  process.exit(1);
}

const pending = db.listPendingExportVideos(5000);
const report = reconcilePendingAgainstDevice(pending, device.mountPath);
const reconciledIds = [
  ...report.exactMatches.map((match) => match.item.id),
  ...report.normalizedMatches.map((match) => match.item.id)
];

let dbResult = null;
if (apply && reconciledIds.length > 0) {
  dbResult = db.markVideosAsExported(
    reconciledIds,
    `device reconciliation; exact=${report.exactMatches.length}, normalized=${report.normalizedMatches.length}, ambiguous=${report.ambiguous.length}, unmatched=${report.unmatched.length}`
  );
}

console.log(JSON.stringify({
  ok: true,
  apply,
  device,
  pendingCount: pending.length,
  scannedDeviceFiles: report.scannedDeviceFiles,
  exactMatchCount: report.exactMatches.length,
  normalizedMatchCount: report.normalizedMatches.length,
  ambiguousCount: report.ambiguous.length,
  unmatchedCount: report.unmatched.length,
  dbResult,
  exactMatches: report.exactMatches.map((match) => ({
    id: match.item.id,
    channel: match.item.channel_handle,
    localPath: match.item.local_path,
    devicePath: match.devicePath
  })),
  normalizedMatches: report.normalizedMatches.map((match) => ({
    id: match.item.id,
    channel: match.item.channel_handle,
    localPath: match.item.local_path,
    devicePath: match.devicePath
  })),
  ambiguous: report.ambiguous.map((entry) => ({
    id: entry.item.id,
    channel: entry.item.channel_handle,
    localPath: entry.item.local_path,
    candidateDevicePaths: entry.candidateDevicePaths
  })),
  unmatched: report.unmatched.map((entry) => ({
    id: entry.item.id,
    channel: entry.item.channel_handle,
    localPath: entry.item.local_path,
    normalizedName: entry.normalizedName
  }))
}, null, 2));
EOF
