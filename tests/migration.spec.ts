import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDb } from "../src/db.js";

test("an Air WAL snapshot opens on a different Pro path with the same library and history", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mp3-migration-")));
  const air = join(root, "Air checkout"), pro = join(root, "Pro library"), archive = join(root, "air.zip");
  const folder = join(air, "downloads", "Artist");
  mkdirSync(join(air, "data"), { recursive: true });
  mkdirSync(folder, { recursive: true });
  const db = new AppDb(join(air, "data", "app.db"));
  const migrate = (...args: string[]) => execFileSync("python3", ["scripts/migrate-state.py", ...args], { encoding: "utf8" });
  try {
    const sources = "# personal sources\n@Artist\n";
    writeFileSync(join(air, "channels.txt"), sources);
    const channel = db.upsertChannel("Artist", "https://www.youtube.com/@Artist/videos");
    for (const name of ["pending", "exported"]) {
      const video = db.upsertDiscoveredVideo(channel.id, {
        youtubeVideoId: name, title: name, webpageUrl: "https://example.test/" + name,
        uploadDate: null, durationSeconds: null, thumbnailUrl: null, channelName: "Artist"
      });
      db.markVideoDownloaded(video.id, join(folder, name + ".mp3"), 5);
      if (name === "exported") db.markVideosAsExported([video.id], "fixture device");
    }
    writeFileSync(join(folder, "pending.mp3"), "audio");
    writeFileSync(join(folder, "pending.info.json"), "{}");
    const run = db.createRun("all", null);
    expect(() => migrate("snapshot", air, archive)).toThrow(/still marked running/);
    expect(existsSync(archive)).toBe(false);
    db.addEvent(run, "info", "fixture", "test history");
    db.finishRun(run, { discovered: 2, downloaded: 2, skipped: 0, failed: 0 }, "success");
    expect(existsSync(join(air, "data", "app.db-wal"))).toBe(true);
    const counts = "channels=1 videos=2 sync_runs=1 sync_events=1 device_syncs=1";
    expect(migrate("snapshot", air, archive)).toContain(counts);
    const restored = migrate("restore", archive, pro);
    expect(restored).toContain(counts);
    expect(restored).toContain("missing=0, size mismatches=0");
    expect(() => migrate("restore", archive, pro)).toThrow(/already exists/);
    expect(readFileSync(join(pro, "channels.txt"), "utf8")).toBe(sources);
    expect(readFileSync(join(pro, "downloads/Artist/pending.info.json"), "utf8")).toBe("{}");
    // Start through the app's normal configuration and database constructor with no USB or network.
    const probe = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { config } from "./src/config.ts";
      import { AppDb } from "./src/db.ts";
      const db = new AppDb();
      console.log(JSON.stringify([config.downloadsDir, config.channelListPath, db.listPendingExportVideos()[0].local_path,
        db.listExportedVideos()[0].local_path, db.listRecentRuns(1)[0].status]));
      db.close();
    `], { env: { ...process.env, DEMO_MODE: "0", MP3_STATE_DIR: pro }, encoding: "utf8" });
    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout)).toEqual([join(pro, "downloads"), join(pro, "channels.txt"),
      join(pro, "downloads/Artist/pending.mp3"), join(pro, "downloads/Artist/exported.mp3"), "success"]);
    expect(readFileSync(join(pro, "downloads/Artist/pending.mp3"), "utf8")).toBe("audio");
    expect(db.listPendingExportVideos()[0]?.local_path).toBe(join(folder, "pending.mp3"));
    const damaged = join(root, "damaged.zip");
    writeFileSync(damaged, readFileSync(archive).subarray(0, 100));
    expect(() => migrate("restore", damaged, join(root, "another"))).toThrow();
    expect(existsSync(join(root, "another"))).toBe(false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a library predating USB export opens through the current app migration", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mp3-legacy-")));
  const air = join(root, "air"), pro = join(root, "pro"), archive = join(root, "legacy.zip");
  try {
    mkdirSync(join(air, "data"), { recursive: true });
    mkdirSync(join(air, "downloads"));
    writeFileSync(join(air, "channels.txt"), "@legacy\n");
    const seed = new AppDb(join(air, "data/app.db"));
    seed.upsertChannel("legacy", "https://www.youtube.com/@legacy/videos");
    seed.close();
    const legacy = new Database(join(air, "data/app.db"));
    try {
      legacy.exec("ALTER TABLE videos DROP COLUMN exported_device_sync_id; ALTER TABLE videos DROP COLUMN exported_at; DROP TABLE device_syncs");
    } finally {
      legacy.close();
    }
    execFileSync("python3", ["scripts/migrate-state.py", "snapshot", air, archive]);
    execFileSync("python3", ["scripts/migrate-state.py", "restore", archive, pro]);
    const restored = new AppDb(join(pro, "data/app.db"));
    try {
      expect(restored.getChannel("legacy")?.active).toBe(1);
      expect(restored.listExportedVideos()).toEqual([]);
    } finally {
      restored.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
