import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ActionResponse,
  ChannelDetailDto,
  ChannelsDto,
  DashboardDto,
  LiveActivityDto,
  RunDetailDto,
  RunsDto,
  SyncAndExportActionResponse
} from "../api/contracts.js";
import { config } from "../config.js";
import { AppDb } from "../db.js";
import { DeviceSyncService } from "../deviceSync.js";
import { Logger } from "../logger.js";
import { SyncService } from "../sync/syncService.js";
import { renderSpaShell } from "./shell.js";

function createDashboardPayload(
  db: AppDb,
  syncService: SyncService,
  deviceSyncService: DeviceSyncService
): DashboardDto {
  const channels = db.listChannelsOverview();
  const runs = db.listRecentRuns(10);
  const cookieBlocked = db.listCookieBlockedVideos(50);
  const latestDeviceSync = db.getLatestDeviceSync();
  const pendingExport = db.listPendingExportVideos(400);
  const deviceStatus = deviceSyncService.getStatus();
  const deviceReadyForExport = deviceStatus.connected && Boolean(deviceStatus.mountPath) && deviceStatus.writable;
  const syncState = syncService.getState();
  const safeToDisconnect =
    deviceStatus.connected &&
    !syncState.player.running &&
    syncState.player.remaining === 0 &&
    syncState.player.lastFailedCount === 0;

  return {
    channels,
    runs,
    cookieBlocked,
    latestDeviceSync,
    pendingExport,
    deviceStatus,
    deviceReadyForExport,
    syncState,
    safeToDisconnect
  };
}

function actionResponse(started: boolean, message: string, reason: string | null = null): ActionResponse {
  return {
    started,
    reason,
    message
  };
}

export function createServer(
  db: AppDb,
  syncService: SyncService,
  deviceSyncService: DeviceSyncService,
  logger: Logger
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const publicAssetPath = resolve(config.rootDir, "dist/public");
  if (existsSync(publicAssetPath)) {
    app.use("/assets", express.static(publicAssetPath));
  }

  app.get("/api/dashboard", (_req, res) => {
    res.json(createDashboardPayload(db, syncService, deviceSyncService));
  });

  app.get("/api/channels", (_req, res) => {
    const payload: ChannelsDto = {
      channels: db.listChannelsOverview()
    };
    res.json(payload);
  });

  app.get("/api/channels/:handle", (req, res) => {
    const handle = req.params.handle;
    const channel = db.getChannel(handle);
    if (!channel) {
      res.status(404).json({ message: "Unknown channel" });
      return;
    }

    const payload: ChannelDetailDto = {
      channel,
      videos: db.listChannelVideos(handle)
    };
    res.json(payload);
  });

  app.get("/api/runs", (_req, res) => {
    const payload: RunsDto = {
      runs: db.listRecentRuns(200)
    };
    res.json(payload);
  });

  app.get("/api/runs/:runId", (req, res) => {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ message: "Invalid run id" });
      return;
    }

    const run = db.getRun(runId);
    if (!run) {
      res.status(404).json({ message: "Run not found" });
      return;
    }

    const payload: RunDetailDto = {
      run,
      events: db.listRunEvents(runId)
    };
    res.json(payload);
  });

  app.get("/api/live", (_req, res) => {
    const payload: LiveActivityDto = {
      state: syncService.getState(),
      events: db.listRecentEvents(120).reverse()
    };
    res.json(payload);
  });

  app.post("/api/sync", (_req, res) => {
    const started = syncService.startSyncAll();
    logger.info(started ? "manual sync-all triggered" : "sync-all request ignored because a run is active");
    res.json(
      actionResponse(
        started,
        started ? "Library refresh started." : "A library refresh is already running.",
        started ? null : "library run already active"
      )
    );
  });

  app.post("/api/sync-and-export", (_req, res) => {
    const deviceStatus = deviceSyncService.getStatus();
    const deviceReadyForExport = deviceStatus.connected && Boolean(deviceStatus.mountPath) && deviceStatus.writable;
    if (!deviceReadyForExport) {
      const reason = deviceStatus.reason ?? "device is not writable";
      logger.warn(`sync-and-export blocked: ${reason}`);
      const payload: SyncAndExportActionResponse = {
        started: false,
        libraryStarted: false,
        playerStarted: false,
        reason,
        message: "Refresh + sync player could not start."
      };
      res.json(payload);
      return;
    }

    const result = syncService.startSyncAllAndExport();
    const started = result.libraryStarted || result.playerStarted;
    logger.info(
      started
        ? `manual sync-and-export triggered library=${result.libraryStarted} player=${result.playerStarted}`
        : "sync-and-export request ignored because no operation could start"
    );
    const payload: SyncAndExportActionResponse = {
      started,
      libraryStarted: result.libraryStarted,
      playerStarted: result.playerStarted,
      reason: started ? null : "library or player sync already active",
      message: started ? "Refresh + sync player started." : "Refresh + sync player could not start."
    };
    res.json(payload);
  });

  app.post("/api/device-sync/sync-player", (req, res) => {
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    const started = syncService.startPlayerSync(note.length > 0 ? note : null);
    logger.info(started ? "manual player-sync triggered" : "player-sync request ignored");
    res.json(
      actionResponse(
        started,
        started ? "Player sync started." : "Player sync could not start.",
        started ? null : "player sync already active or device not ready"
      )
    );
  });

  app.post("/api/channels/:handle/sync", (req, res) => {
    const handle = req.params.handle;
    const started = syncService.startSyncChannel(handle);
    logger.info(started ? `manual sync-channel triggered handle=${handle}` : `sync-channel ignored handle=${handle} active run`);
    res.json(
      actionResponse(
        started,
        started ? `Channel refresh started for ${handle}.` : `Channel refresh for ${handle} could not start.`,
        started ? null : "library run already active"
      )
    );
  });

  app.post("/api/retry/cookie-errors", (_req, res) => {
    const started = syncService.startRetryCookieBlocked();
    logger.info(started ? "manual retry-cookie-errors triggered" : "retry-cookie-errors ignored because a run is active");
    res.json(
      actionResponse(
        started,
        started ? "Cookie-blocked retry started." : "Cookie-blocked retry could not start.",
        started ? null : "library run already active"
      )
    );
  });

  app.post("/api/device-sync/mark-pending", (req, res) => {
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    const result = db.markPendingAsExported(note.length > 0 ? note : null);
    logger.info(`device-sync mark-pending sync_id=${result.syncId ?? "none"} item_count=${result.itemCount}`);
    res.json({
      started: result.itemCount > 0,
      reason: result.itemCount > 0 ? null : "no pending tracks",
      message:
        result.itemCount > 0
          ? `Marked ${result.itemCount} pending track${result.itemCount === 1 ? "" : "s"} as exported.`
          : "No pending tracks to mark as exported."
    } satisfies ActionResponse);
  });

  app.get("/device-sync/pending-manifest.txt", (_req, res) => {
    const pending = db.listPendingExportVideos(5000);
    const lines = [`# pending export manifest`, `# generated_at: ${new Date().toISOString()}`, `# count: ${pending.length}`, ""];

    for (const item of pending) {
      lines.push(item.local_path);
    }

    const body = `${lines.join("\n")}\n`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pending-export-manifest.txt"`);
    res.send(body);
  });

  const serveShell = (_req: express.Request, res: express.Response): void => {
    res.send(renderSpaShell());
  };

  app.get("/", serveShell);
  app.get("/channels", serveShell);
  app.get("/channels/:handle", serveShell);
  app.get("/runs", serveShell);
  app.get("/runs/:runId", serveShell);

  return app;
}
