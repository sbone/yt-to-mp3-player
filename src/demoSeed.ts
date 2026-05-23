import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { saveChannelSources } from "./channelSource.js";
import { AppDb } from "./db.js";
import type { DiscoveredVideo } from "./types.js";

const seededSources = [
  { key: "demo-field-notes", url: "https://example.invalid/@demo-field-notes/videos" },
  { key: "demo-workshop", url: "https://example.invalid/@demo-workshop/videos" },
  { key: "demo-recovery", url: "https://example.invalid/@demo-recovery/videos" }
];

const seededVideos: Array<{ sourceKey: string; video: DiscoveredVideo; state: "downloaded" | "failed" | "cookie_blocked" }> = [
  {
    sourceKey: "demo-recovery",
    state: "downloaded",
    video: {
      youtubeVideoId: "demo-recovery-local",
      channelName: "Recovery Lab",
      title: "Recovery Lab - Already Downloaded",
      uploadDate: "2026-01-20",
      durationSeconds: 910,
      webpageUrl: "https://example.invalid/demo-recovery-local",
      thumbnailUrl: null
    }
  },
  {
    sourceKey: "demo-recovery",
    state: "failed",
    video: {
      youtubeVideoId: "demo-recovery-failed",
      channelName: "Recovery Lab",
      title: "Recovery Lab - Interrupted Copy",
      uploadDate: "2026-01-13",
      durationSeconds: 650,
      webpageUrl: "https://example.invalid/demo-recovery-failed",
      thumbnailUrl: null
    }
  },
  {
    sourceKey: "demo-recovery",
    state: "cookie_blocked",
    video: {
      youtubeVideoId: "demo-recovery-auth",
      channelName: "Recovery Lab",
      title: "Recovery Lab - Auth Required",
      uploadDate: "2026-01-06",
      durationSeconds: 780,
      webpageUrl: "https://example.invalid/demo-recovery-auth",
      thumbnailUrl: null
    }
  }
];

export function seedDemoData(db: AppDb): void {
  if (!config.isDemo || db.listChannelsOverview().length > 0) {
    return;
  }

  saveChannelSources(seededSources);
  for (const source of seededSources) {
    db.upsertChannel(source.key, source.url);
  }

  for (const item of seededVideos) {
    const channel = db.upsertChannel(item.sourceKey, `https://example.invalid/@${item.sourceKey}/videos`);
    const upserted = db.upsertDiscoveredVideo(channel.id, item.video);
    if (item.state === "downloaded") {
      const localPath = `${config.downloadsDir}/${item.video.channelName}/${item.video.uploadDate} - ${item.video.title} [${item.video.youtubeVideoId}].mp3`;
      mkdirSync(dirname(localPath), { recursive: true });
      if (!existsSync(localPath)) {
        writeFileSync(localPath, `Demo MP3 placeholder for ${item.video.title}\n`, "utf8");
      }
      db.markVideoDownloaded(upserted.id, localPath, 48);
    } else if (item.state === "failed") {
      db.markVideoFailed(upserted.id, "Demo recovery state: previous transfer was interrupted.");
    } else {
      db.markVideoCookieBlocked(upserted.id, "Demo recovery state: source requires auth/cookies.");
    }
  }
}
