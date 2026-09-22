import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reconcilePendingAgainstDevice } from "../src/deviceReconcile.js";
import type { PendingExportItem } from "../src/types.js";

test("reconciliation prefers the matching folder and reports ambiguous fallbacks", () => {
  const mountPath = mkdtempSync(join(tmpdir(), "device-reconcile-"));

  try {
    const channelA = join(mountPath, "channel-a");
    const channelB = join(mountPath, "channel-b");
    mkdirSync(channelA);
    mkdirSync(channelB);
    writeFileSync(join(channelA, "Shared Song.mp3"), "");
    writeFileSync(join(channelB, "Shared Song.mp3"), "");

    const pending: PendingExportItem[] = [
      {
        id: 1,
        title: "Shared Song",
        local_path: "/cache/channel-a/01 - Shared Song.mp3",
        downloaded_at: null,
        channel_handle: "channel-a"
      },
      {
        id: 2,
        title: "Shared Song",
        local_path: "/cache/unknown/02 - Shared Song.mp3",
        downloaded_at: null,
        channel_handle: null
      }
    ];

    const report = reconcilePendingAgainstDevice(pending, mountPath);

    expect(report.normalizedMatches).toEqual([
      expect.objectContaining({
        item: pending[0],
        devicePath: join(channelA, "Shared Song.mp3")
      })
    ]);
    expect(report.ambiguous).toHaveLength(1);
    expect(report.ambiguous[0]?.item).toBe(pending[1]);
    expect(report.ambiguous[0]?.candidateDevicePaths).toEqual(
      expect.arrayContaining([join(channelA, "Shared Song.mp3"), join(channelB, "Shared Song.mp3")])
    );
  } finally {
    rmSync(mountPath, { recursive: true, force: true });
  }
});
