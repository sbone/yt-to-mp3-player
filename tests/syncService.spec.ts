import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDb } from "../src/db.js";
import { config } from "../src/config.js";
import { DeviceSyncService } from "../src/deviceSync.js";
import { Logger } from "../src/logger.js";
import { downloadVideo } from "../src/sync/ytDlp.js";
import { SyncService } from "../src/sync/syncService.js";
import type { MediaProvider } from "../src/sync/mediaProvider.js";
import type { DiscoveredVideo } from "../src/types.js";

const video = (id: string): DiscoveredVideo => ({ youtubeVideoId: id, title: id, channelName: "source", uploadDate: null, durationSeconds: null, webpageUrl: `https://example.invalid/${id}`, thumbnailUrl: null });
let root: string;
let db: AppDb;
const originalConfig = { ...config };

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "audio-service-"));
  Object.assign(config, { isDemo: false, downloadsDir: join(root, "cache"), channelListPath: join(root, "sources.txt"), logPath: join(root, "app.log"), deviceMountPath: join(root, "player") });
  mkdirSync(config.downloadsDir);
  mkdirSync(join(config.deviceMountPath!, "MUSIC.LIB"), { recursive: true });
  mkdirSync(join(config.deviceMountPath!, "AUDIBLE.LIB"));
  writeFileSync(config.channelListPath, "https://www.youtube.com/@source/videos\n");
  db = new AppDb(join(root, "app.db"));
});

test.afterEach(() => {
  Object.assign(config, originalConfig);
  rmSync(root, { recursive: true, force: true });
});

function provider(discovered: DiscoveredVideo[], downloads: string[]): MediaProvider {
  return {
    async discoverSource() { return discovered; },
    async downloadAudio(id) {
      downloads.push(id);
      const path = join(config.downloadsDir, `${id} [${id}].mp3`);
      writeFileSync(path, `audio for ${id}`);
      return { status: "downloaded", localPath: path, fileSize: readFileSync(path).length };
    },
    isAuthError() { return false; }
  };
}

test("refresh retries older and absent recovery items beyond twenty known videos", async () => {
  const channel = db.upsertChannel("source", "https://www.youtube.com/@source/videos");
  const discovered = Array.from({ length: 25 }, (_, i) => video(`known-${i}`));
  for (const item of discovered) {
    const record = db.upsertDiscoveredVideo(channel.id, item);
    db.markVideoDownloaded(record.id, `/already-exported/${item.youtubeVideoId}.mp3`, 1);
  }
  db.markVideosForRedownload([db.upsertDiscoveredVideo(channel.id, discovered[24]!).id]);
  const old = db.upsertDiscoveredVideo(channel.id, video("old"));
  db.markVideoDownloaded(old.id, "/deleted/old.mp3", 1);
  db.markVideosAsExported([old.id], null);
  db.markVideosForRedownload([old.id]);
  const downloads: string[] = [];
  const service = new SyncService(db, new Logger(), new DeviceSyncService(), provider(discovered, downloads));
  expect(service.startSyncAll()).toBe(true);
  await expect.poll(() => service.getState().library.running).toBe(false);
  expect(downloads).toEqual(["known-24", "old"]);
});

test("combined action exports newly downloaded audio and reserves both operations", async () => {
  const downloads: string[] = [];
  const service = new SyncService(db, new Logger(), new DeviceSyncService(), provider([video("new")], downloads));
  expect(service.startSyncAllAndExport()).toEqual({ libraryStarted: true, playerStarted: true });
  expect(service.startPlayerSync()).toBe(false);
  expect(service.startSyncAllAndExport()).toEqual({ libraryStarted: false, playerStarted: false });
  await expect.poll(() => db.listExportedVideos().length).toBe(1);
  expect(readFileSync(join(config.deviceMountPath!, "cache", "new [new].mp3"), "utf8")).toBe("audio for new");
  expect(db.listPendingExportVideos()).toHaveLength(0);
});


test("download does not let a stale archive block recovery", async () => {
  const bin = join(root, "bin");
  mkdirSync(bin);
  const output = join(config.downloadsDir, "recovered.mp3");
  writeFileSync(output, "recovered audio");
  writeFileSync(join(bin, "yt-dlp"), '#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "--download-archive" ]; then exit 1; fi\ndone\nprintf "%s\\n" "$RECOVERY_OUTPUT"\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.RECOVERY_OUTPUT = output;
  try {
    expect(await downloadVideo("recovery-id")).toEqual({ status: "downloaded", localPath: output, fileSize: 15 });
  } finally {
    process.env.PATH = oldPath;
    delete process.env.RECOVERY_OUTPUT;
  }
});
