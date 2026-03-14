import { AppDb } from "../db.js";
import { channelUrlForHandle, loadChannelHandles } from "../channelSource.js";
import { Logger } from "../logger.js";
import type { ChannelRecord, SyncCounters } from "../types.js";
import { downloadVideo, discoverChannel, isCookieAuthError } from "./ytDlp.js";
import { ExistingDownloadIndex } from "./fileIndex.js";
import { config } from "../config.js";

interface SyncState {
  running: boolean;
  startedAt: string | null;
  runId: number | null;
  scope: "all" | "single-channel" | null;
  targetHandle: string | null;
}

const ZERO_COUNTERS: SyncCounters = {
  discovered: 0,
  downloaded: 0,
  skipped: 0,
  failed: 0
};

function isKnownBeforeCutoff(uploadDate: string | null): boolean {
  if (!uploadDate) {
    return false;
  }
  return uploadDate < config.minUploadDate;
}

function nextCounters(base: SyncCounters, delta: Partial<SyncCounters>): SyncCounters {
  return {
    discovered: base.discovered + (delta.discovered ?? 0),
    downloaded: base.downloaded + (delta.downloaded ?? 0),
    skipped: base.skipped + (delta.skipped ?? 0),
    failed: base.failed + (delta.failed ?? 0)
  };
}

export class SyncService {
  private state: SyncState = {
    running: false,
    startedAt: null,
    runId: null,
    scope: null,
    targetHandle: null
  };

  constructor(private readonly db: AppDb, private readonly logger: Logger) {}

  getState(): SyncState {
    return { ...this.state };
  }

  startSyncAll(): boolean {
    if (this.state.running) {
      return false;
    }
    void this.syncAll();
    return true;
  }

  startSyncChannel(handle: string): boolean {
    if (this.state.running) {
      return false;
    }
    void this.syncSingleChannel(handle);
    return true;
  }

  startRetryCookieBlocked(): boolean {
    if (this.state.running) {
      return false;
    }
    void this.retryCookieBlockedVideos();
    return true;
  }

  private setState(next: Partial<SyncState>): void {
    this.state = { ...this.state, ...next };
  }

  private async syncAll(): Promise<void> {
    const handles = loadChannelHandles();
    const channels = handles.map((handle) => this.db.upsertChannel(handle, channelUrlForHandle(handle)));
    const runId = this.db.createRun("all", null);

    this.setState({
      running: true,
      startedAt: new Date().toISOString(),
      runId,
      scope: "all",
      targetHandle: null
    });

    let totals = { ...ZERO_COUNTERS };
    let status: "success" | "partial" | "failed" = "success";
    const index = new ExistingDownloadIndex(config.downloadsDir);
    this.logger.info(`run=${runId} sync-all started (${channels.length} channels)`);
    this.db.addEvent(runId, "info", "run-start", `sync all started for ${channels.length} channels`);

    try {
      for (const channel of channels) {
        const result = await this.syncChannel(runId, channel, index);
        totals = nextCounters(totals, result.counters);
        if (!result.ok && status === "success") {
          status = "partial";
        }
      }
      if (totals.downloaded === 0 && totals.failed > 0 && totals.discovered === 0) {
        status = "failed";
      }
    } catch (error) {
      status = "failed";
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`run=${runId} fatal error: ${message}`);
      this.db.addEvent(runId, "error", "run-fatal", message);
    } finally {
      this.db.finishRun(runId, totals, status);
      this.db.addEvent(
        runId,
        status === "failed" ? "error" : status === "partial" ? "warn" : "info",
        "run-finish",
        `run completed status=${status} discovered=${totals.discovered} downloaded=${totals.downloaded} skipped=${totals.skipped} failed=${totals.failed}`
      );
      this.logger.info(`run=${runId} sync-all finished status=${status}`);
      this.setState({
        running: false,
        startedAt: null,
        runId: null,
        scope: null,
        targetHandle: null
      });
    }
  }

  private async syncSingleChannel(handle: string): Promise<void> {
    const channel = this.db.upsertChannel(handle, channelUrlForHandle(handle));
    const runId = this.db.createRun("single-channel", channel.id);
    const index = new ExistingDownloadIndex(config.downloadsDir);

    this.setState({
      running: true,
      startedAt: new Date().toISOString(),
      runId,
      scope: "single-channel",
      targetHandle: handle
    });

    this.logger.info(`run=${runId} sync-channel started handle=${handle}`);
    this.db.addEvent(runId, "info", "run-start", `sync channel started`, channel.id);

    let counters = { ...ZERO_COUNTERS };
    let status: "success" | "partial" | "failed" = "success";
    try {
      const result = await this.syncChannel(runId, channel, index);
      counters = result.counters;
      if (!result.ok) {
        status = counters.downloaded > 0 ? "partial" : "failed";
      }
    } catch (error) {
      status = "failed";
      const message = error instanceof Error ? error.message : String(error);
      this.db.addEvent(runId, "error", "run-fatal", message, channel.id);
      this.logger.error(`run=${runId} fatal error: ${message}`);
    } finally {
      this.db.finishRun(runId, counters, status);
      this.db.addEvent(runId, "info", "run-finish", `run completed status=${status}`, channel.id);
      this.logger.info(`run=${runId} sync-channel finished handle=${handle} status=${status}`);
      this.setState({
        running: false,
        startedAt: null,
        runId: null,
        scope: null,
        targetHandle: null
      });
    }
  }

  private async retryCookieBlockedVideos(): Promise<void> {
    const runId = this.db.createRun("all", null);
    this.setState({
      running: true,
      startedAt: new Date().toISOString(),
      runId,
      scope: "all",
      targetHandle: "cookie-blocked"
    });

    let counters = { ...ZERO_COUNTERS };
    let status: "success" | "partial" | "failed" = "success";
    const blockedVideos = this.db.listCookieBlockedVideos(1000);
    this.logger.info(`run=${runId} retry-cookie-blocked started count=${blockedVideos.length}`);
    this.db.addEvent(runId, "info", "retry-cookie-start", `retrying ${blockedVideos.length} cookie-blocked videos`);

    try {
      for (const video of blockedVideos) {
        if (isKnownBeforeCutoff(video.upload_date)) {
          this.db.markVideoSkipped(
            video.id,
            `Skipped by cutoff date: upload_date=${video.upload_date ?? "unknown"} < ${config.minUploadDate}`
          );
          this.db.addEvent(
            runId,
            "info",
            "retry-cookie-skipped-cutoff",
            `skipped "${video.title}" because upload_date is before ${config.minUploadDate}`,
            video.channel_id,
            video.id
          );
          counters = nextCounters(counters, { skipped: 1 });
          continue;
        }

        try {
          const result = await downloadVideo(video.youtube_video_id);
          if (result.status === "downloaded") {
            this.db.markVideoDownloaded(video.id, result.localPath, result.fileSize);
            this.db.addEvent(
              runId,
              "info",
              "retry-cookie-downloaded",
              `downloaded "${video.title}"`,
              video.channel_id,
              video.id
            );
            counters = nextCounters(counters, { downloaded: 1 });
          } else {
            this.db.markVideoSkipped(video.id, result.reason);
            counters = nextCounters(counters, { skipped: 1 });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isCookieAuthError(message)) {
            this.db.markVideoCookieBlocked(video.id, message);
            this.db.addEvent(
              runId,
              "warn",
              "retry-cookie-still-blocked",
              `still blocked "${video.title}": ${message}`,
              video.channel_id,
              video.id
            );
          } else {
            this.db.markVideoFailed(video.id, message);
            this.db.addEvent(
              runId,
              "error",
              "retry-cookie-failed",
              `failed "${video.title}": ${message}`,
              video.channel_id,
              video.id
            );
          }
          counters = nextCounters(counters, { failed: 1 });
        }
      }
      if (counters.failed > 0 && counters.downloaded > 0) {
        status = "partial";
      } else if (counters.failed > 0 && counters.downloaded === 0) {
        status = "failed";
      }
    } catch (error) {
      status = "failed";
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`run=${runId} retry-cookie-blocked fatal error: ${message}`);
      this.db.addEvent(runId, "error", "retry-cookie-fatal", message);
    } finally {
      this.db.finishRun(runId, counters, status, "retry-cookie-blocked");
      this.db.addEvent(runId, "info", "retry-cookie-finish", `retry finished status=${status}`);
      this.logger.info(`run=${runId} retry-cookie-blocked finished status=${status}`);
      this.setState({
        running: false,
        startedAt: null,
        runId: null,
        scope: null,
        targetHandle: null
      });
    }
  }

  private async syncChannel(
    runId: number,
    channel: ChannelRecord,
    index: ExistingDownloadIndex
  ): Promise<{ ok: boolean; counters: SyncCounters }> {
    let counters = { ...ZERO_COUNTERS };
    let ok = true;
    this.db.addEvent(runId, "info", "channel-start", `checking channel ${channel.handle}`, channel.id);
    this.logger.info(`run=${runId} channel=${channel.handle} checking`);

    try {
      // Date cutoff is enforced by yt-dlp via --dateafter during discovery.
      const discovered = await discoverChannel(channel.url, config.minUploadDate);
      this.db.addEvent(
        runId,
        "info",
        "channel-discovered",
        `found ${discovered.length} videos in feed (date cutoff >= ${config.minUploadDate})`,
        channel.id
      );

      for (const item of discovered) {
        const upsert = this.db.upsertDiscoveredVideo(channel.id, item);
        if (upsert.isNew) {
          counters = nextCounters(counters, { discovered: 1 });
        }

        if (upsert.status === "downloaded" || upsert.status === "cookie_blocked") {
          counters = nextCounters(counters, { skipped: 1 });
          continue;
        }

        const likely = index.findLikelyMatch(item.title, [channel.handle, item.channelName ?? ""]);
        if (likely) {
          this.db.markVideoDownloaded(upsert.id, likely.path, likely.size);
          this.db.addEvent(
            runId,
            "info",
            "video-imported",
            `mapped existing file for "${item.title}"`,
            channel.id,
            upsert.id
          );
          counters = nextCounters(counters, { skipped: 1 });
          continue;
        }

        try {
          const result = await downloadVideo(item.youtubeVideoId);
          if (result.status === "downloaded") {
            this.db.markVideoDownloaded(upsert.id, result.localPath, result.fileSize);
            this.db.addEvent(
              runId,
              "info",
              "video-downloaded",
              `downloaded "${item.title}"`,
              channel.id,
              upsert.id
            );
            this.logger.info(`run=${runId} channel=${channel.handle} downloaded video=${item.youtubeVideoId}`);
            counters = nextCounters(counters, { downloaded: 1 });
          } else {
            this.db.markVideoSkipped(upsert.id, result.reason);
            counters = nextCounters(counters, { skipped: 1 });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isCookieAuthError(message)) {
            this.db.markVideoCookieBlocked(upsert.id, message);
            this.db.addEvent(
              runId,
              "warn",
              "video-cookie-blocked",
              `cookie/auth blocked "${item.title}": ${message}`,
              channel.id,
              upsert.id
            );
            this.logger.warn(
              `run=${runId} channel=${channel.handle} cookie-blocked video=${item.youtubeVideoId} error=${message}`
            );
            counters = nextCounters(counters, { failed: 1 });
            ok = false;
          } else {
            this.db.markVideoFailed(upsert.id, message);
            this.db.addEvent(
              runId,
              "error",
              "video-failed",
              `failed "${item.title}": ${message}`,
              channel.id,
              upsert.id
            );
            this.logger.error(
              `run=${runId} channel=${channel.handle} failed video=${item.youtubeVideoId} error=${message}`
            );
            counters = nextCounters(counters, { failed: 1 });
            ok = false;
          }
        }
      }

      this.db.touchChannelChecked(channel.id, ok);
      this.db.addEvent(
        runId,
        ok ? "info" : "warn",
        "channel-finish",
        `channel finished downloaded=${counters.downloaded} failed=${counters.failed} skipped=${counters.skipped}`,
        channel.id
      );
      return { ok, counters };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.touchChannelChecked(channel.id, false);
      const eventType = isCookieAuthError(message) ? "channel-cookie-blocked" : "channel-error";
      const level = isCookieAuthError(message) ? "warn" : "error";
      this.db.addEvent(runId, level, eventType, message, channel.id);
      if (isCookieAuthError(message)) {
        this.logger.warn(`run=${runId} channel=${channel.handle} discovery cookie-blocked error=${message}`);
      } else {
        this.logger.error(`run=${runId} channel=${channel.handle} discovery failed error=${message}`);
      }
      counters = nextCounters(counters, { failed: 1 });
      return { ok: false, counters };
    }
  }
}
