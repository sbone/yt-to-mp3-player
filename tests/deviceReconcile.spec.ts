import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reconcilePendingAgainstDevice } from "../src/deviceReconcile.js";
import type { PendingExportItem } from "../src/types.js";

test("reconciliation prefers the matching folder and reports ambiguous fallbacks", async () => {
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

    const report = await reconcilePendingAgainstDevice(pending, mountPath);

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

test("exact matches verify contents and do not collapse duplicate names", async () => {
  const root = mkdtempSync(join(tmpdir(), "device-verify-"));
  try {
    const local = join(root, "cache", "a");
    const mount = join(root, "player");
    mkdirSync(local, { recursive: true });
    mkdirSync(join(mount, "a"), { recursive: true });
    mkdirSync(join(mount, "b"));
    const localPath = join(local, "Track [id].mp3");
    writeFileSync(localPath, "good");
    writeFileSync(join(mount, "a", "Track [id].mp3"), "bad!");
    writeFileSync(join(mount, "b", "Track [id].mp3"), "good");
    const item: PendingExportItem = { id: 1, title: "Track", local_path: localPath, downloaded_at: null, channel_handle: "a" };
    expect((await reconcilePendingAgainstDevice([item], mount)).exactMatches).toHaveLength(0);
    writeFileSync(join(mount, "a", "Track [id].mp3"), "good");
    expect((await reconcilePendingAgainstDevice([item], mount)).exactMatches[0]?.devicePath).toBe(join(mount, "a", "Track [id].mp3"));
    item.local_path = "/missing/unknown/Track [id].mp3";
    expect((await reconcilePendingAgainstDevice([item], mount)).ambiguous).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
