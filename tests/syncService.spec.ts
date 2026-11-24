import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statfsSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { demoVolumeID, StationVolume } from "../src/stationVolume.js";
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
  db.close();
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
  expect(await service.startSyncAllAndExport()).toEqual({ libraryStarted: true, playerStarted: true });
  expect(await service.startPlayerSync()).toBe(false);
  expect(await service.startSyncAllAndExport()).toEqual({ libraryStarted: false, playerStarted: false });
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

test("player sync repairs corrupt audio and copies instead of trusting fuzzy matches", async () => {
  const channel = db.upsertChannel("source", "https://www.youtube.com/@source/videos");
  const deviceFolder = join(config.deviceMountPath!, "cache");
  mkdirSync(deviceFolder);
  for (const [id, filename] of [["repair", "repair [repair].mp3"], ["fuzzy", "01 - Track [fuzzy].mp3"]]) {
    const path = join(config.downloadsDir, filename);
    writeFileSync(path, "good");
    db.markVideoDownloaded(db.upsertDiscoveredVideo(channel.id, video(id)).id, path, 4);
  }
  writeFileSync(join(deviceFolder, "repair [repair].mp3"), "bad!");
  writeFileSync(join(deviceFolder, "Track.mp3"), "bad!");
  const service = new SyncService(db, new Logger(), new DeviceSyncService(), provider([], []));
  expect(await service.startPlayerSync()).toBe(true);
  await expect.poll(() => service.getState().player.running).toBe(false);
  expect(readFileSync(join(deviceFolder, "repair [repair].mp3"), "utf8")).toBe("good");
  expect(readFileSync(join(deviceFolder, "01 - Track [fuzzy].mp3"), "utf8")).toBe("good");
  expect(readFileSync(join(deviceFolder, "Track.mp3"), "utf8")).toBe("bad!");
  expect(db.listExportedVideos()).toHaveLength(2);
});

test("missing local audio is reported as an error and re-queued for download", async () => {
  const channel = db.upsertChannel("source", "https://www.youtube.com/@source/videos");
  const record = db.upsertDiscoveredVideo(channel.id, video("missing"));
  db.markVideoDownloaded(record.id, join(config.downloadsDir, "missing.mp3"), 4);
  const service = new SyncService(db, new Logger(), new DeviceSyncService(), provider([], []));
  expect(await service.startPlayerSync()).toBe(true);
  await expect.poll(() => service.getState().player.running).toBe(false);
  expect(service.getState().player.lastFailedCount).toBe(1);
  expect(service.getState().notifications[0]?.status).toBe("partial");
  expect(db.listRetryableVideos(channel.id).map((item) => item.youtubeVideoId)).toEqual(["missing"]);
});

test("truncated exported audio is re-queued after the local cache was removed", async () => {
  const channel = db.upsertChannel("source", "https://www.youtube.com/@source/videos");
  const record = db.upsertDiscoveredVideo(channel.id, video("truncated"));
  const path = join(config.downloadsDir, "truncated [truncated].mp3");
  db.markVideoDownloaded(record.id, path, 10);
  db.markVideosAsExported([record.id], null);
  const deviceFolder = join(config.deviceMountPath!, "cache");
  mkdirSync(deviceFolder);
  writeFileSync(join(deviceFolder, "truncated [truncated].mp3"), "short");
  const service = new SyncService(db, new Logger(), new DeviceSyncService(), provider([], []));
  expect(await service.startPlayerSync()).toBe(true);
  await expect.poll(() => service.getState().player.running).toBe(false);
  expect(db.listExportedVideos()).toHaveLength(0);
  expect(db.listRetryableVideos(channel.id).map((item) => item.youtubeVideoId)).toEqual(["truncated"]);
});

function stationFixture() {
  const mount = config.deviceMountPath!;
  Object.assign(config, { isDemo: true, demoPlayerDir: mount });
  const device = new DeviceSyncService();
  const service = new SyncService(db, new Logger(), device, provider([video("song")], []));
  return { mount, service, device };
}

test("Deck update locks the server, verifies copies, ejects, and recognizes a no-op on retry", async () => {
  const { mount, service } = stationFixture();
  const id = randomUUID();
  expect(service.startStation("update", id, demoVolumeID)).toBe(true);
  expect(service.startStation("update", id, demoVolumeID)).toBe(true);
  expect(service.startStation("eject", randomUUID(), demoVolumeID)).toBe(false);
  expect(await service.startPlayerSync()).toBe(false);
  expect(service.startSyncAll()).toBe(false);
  await expect.poll(() => service.getState().station?.phase).toBe("ejected");
  expect(service.getState().station?.copied).toBe(1);
  expect(readFileSync(join(mount + ".ejected", "cache", "song [song].mp3"), "utf8")).toBe("audio for song");
  expect(db.listExportedVideos()).toHaveLength(1);
  expect(existsSync(db.listExportedVideos()[0]!.local_path)).toBe(false);
  renameSync(mount + ".ejected", mount);
  expect(service.startStation("update", randomUUID(), demoVolumeID)).toBe(true);
  await expect.poll(() => service.getState().station?.phase).toBe("ejected");
  expect(service.getState().station?.copied).toBe(0);
});

test("a failed OS eject retains verified cache and permits a stand-alone retry", async () => {
  const { mount, service } = stationFixture();
  mkdirSync(mount + ".ejected");
  writeFileSync(join(mount + ".ejected", "busy"), "fixture");
  service.startStation("update", randomUUID(), demoVolumeID);
  await expect.poll(() => service.getState().station?.phase).toBe("failed");
  expect(service.getState().station?.reason).toBe("EJECT FAILED");
  expect(db.listExportedVideos()).toHaveLength(0);
  expect(readFileSync(db.listPendingExportVideos()[0]!.local_path, "utf8")).toBe("audio for song");
  rmSync(mount + ".ejected", {recursive: true});
  service.startStation("eject", randomUUID(), demoVolumeID);
  await expect.poll(() => service.getState().station?.phase).toBe("ejected");
  expect(db.listExportedVideos()).toHaveLength(0);
});

test("Deck refuses unknown players, file collisions, symlink directories and replaced mounts", async () => {
  const { mount, service, device } = stationFixture();
  service.startStation("eject", randomUUID(), randomUUID());
  await expect.poll(() => service.getState().station?.phase).toBe("failed");
  expect(existsSync(mount)).toBe(true);
  mkdirSync(join(mount, "cache"));
  writeFileSync(join(mount, "cache", "song [song].mp3"), "keep");
  service.startStation("update", randomUUID(), demoVolumeID);
  await expect.poll(() => service.getState().station?.phase).toBe("failed");
  const item = db.listPendingExportVideos()[0]!;
  expect(readFileSync(join(mount, "cache", "song [song].mp3"), "utf8")).toBe("keep");
  const target = await StationVolume.attach(await device.getStatus(), demoVolumeID);
  try {
    renameSync(join(mount, "cache"), join(mount, "preserved"));
    symlinkSync(root, join(mount, "cache"));
    await expect(target.copy(item)).rejects.toThrow();
    expect(existsSync(join(root, "song [song].mp3"))).toBe(false);
    renameSync(mount, mount + ".unplugged");
    mkdirSync(mount);
    await expect(target.copy(item)).rejects.toThrow("PLAYER REMOVED");
    expect(existsSync(join(mount, "cache"))).toBe(false);
  } finally { await target.close(); }
});

test("Deck preflight measures required bytes before creating a destination", async () => {
  const { mount, device } = stationFixture();
  const target = await StationVolume.attach(await device.getStatus(), demoVolumeID);
  try {
    const path = join(config.downloadsDir, "sparse.mp3");
    writeFileSync(path, "");
    const { bsize, bavail } = statfsSync(mount);
    truncateSync(path, (bavail + 2) * bsize);
    await expect(target.preflight([{ id: 1, title: "", local_path: path, downloaded_at: null, channel_handle: null }]))
      .rejects.toThrow("NO SPACE");
    expect(existsSync(join(mount, "cache"))).toBe(false);
  } finally { await target.close(); }
});

test("Deck update keeps the player mounted after a failed source refresh", async () => {
  const { mount, device } = stationFixture();
  const failed = provider([], []);
  failed.discoverSource = async () => { throw new Error("fixture network outage"); };
  const service = new SyncService(db, new Logger(), device, failed);
  service.startStation("update", randomUUID(), demoVolumeID);
  await expect.poll(() => service.getState().station?.phase).toBe("failed");
  expect(service.getState().station?.reason).toBe("CHECK FAILED");
  expect(existsSync(mount)).toBe(true);
  expect(db.listExportedVideos()).toHaveLength(0);
});
