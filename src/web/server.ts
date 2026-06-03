import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ActionResponse,
  AddSourceResponse,
  ChannelDetailDto,
  ChannelsDto,
  DashboardDto,
  LiveActivityDto,
  RemoveSourceResponse,
  RunDetailDto,
  RunsDto,
  SourcesDto,
  SyncAndExportActionResponse
} from "../api/contracts.js";
import { addChannelSource, loadChannelSources, removeChannelSource } from "../channelSource.js";
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
  db.reconcileChannelSources(loadChannelSources());
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
    mode: config.mode,
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

function createLivePayload(
  db: AppDb,
  syncService: SyncService,
  deviceSyncService: DeviceSyncService,
  override?: Partial<Pick<LiveActivityDto, "deviceStatus" | "deviceReadyForExport" | "safeToDisconnect">>
): LiveActivityDto {
  const deviceStatus = deviceSyncService.getStatus();
  const state = syncService.getState();
  const latestDeviceSync = db.getLatestDeviceSync();
  const pendingExport = db.listPendingExportVideos(400);
  const deviceReadyForExport = deviceStatus.connected && Boolean(deviceStatus.mountPath) && deviceStatus.writable;
  const safeToDisconnect =
    deviceStatus.connected && !state.player.running && state.player.remaining === 0 && state.player.lastFailedCount === 0;

  return {
    mode: config.mode,
    state,
    events: db.listRecentEvents(120).reverse(),
    deviceStatus: override?.deviceStatus ?? deviceStatus,
    deviceReadyForExport: override?.deviceReadyForExport ?? deviceReadyForExport,
    safeToDisconnect: override?.safeToDisconnect ?? safeToDisconnect,
    latestDeviceSync,
    pendingExport
  };
}

function actionResponse(started: boolean, message: string, reason: string | null = null): ActionResponse {
  return {
    started,
    reason,
    message
  };
}

function activeLibraryMessage(syncService: SyncService): string {
  const state = syncService.getState().library;
  if (state.scope === "single-channel" && state.targetHandle) {
    return `Library run already active for ${state.targetHandle}.`;
  }
  if (state.targetHandle === "cookie-blocked") {
    return "Library run already active for cookie-blocked retry.";
  }
  return "Library run already active.";
}

function activePlayerMessage(syncService: SyncService, deviceSyncService: DeviceSyncService): string {
  const player = syncService.getState().player;
  if (player.running) {
    return `Player sync already active${player.targetVolume ? ` for ${player.targetVolume}` : ""}.`;
  }
  const deviceStatus = deviceSyncService.getStatus();
  return deviceStatus.reason ? `Player sync unavailable: ${deviceStatus.reason}.` : "Player sync unavailable.";
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
  const sseClients = new Set<express.Response>();
  let lastLivePayloadJson = "";
  let liveOverride: Partial<Pick<LiveActivityDto, "deviceStatus" | "deviceReadyForExport" | "safeToDisconnect">> | null = null;

  const setNoCacheHeaders = (_req: express.Request, res: express.Response, next: express.NextFunction): void => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  };

  const publicAssetPath = resolve(config.rootDir, "dist/public");
  if (existsSync(publicAssetPath)) {
    app.use("/assets", express.static(publicAssetPath));
  }

  app.get("/api/dashboard", setNoCacheHeaders, (_req, res) => {
    res.json(createDashboardPayload(db, syncService, deviceSyncService));
  });

  app.get("/api/channels", (_req, res) => {
    const sources = loadChannelSources();
    db.reconcileChannelSources(sources);
    const payload: ChannelsDto = {
      channels: db.listChannelsOverview(),
      sources
    };
    res.json(payload);
  });

  app.get("/api/sources", (_req, res) => {
    const payload: SourcesDto = {
      sources: loadChannelSources()
    };
    res.json(payload);
  });

  app.post("/api/sources", (req, res) => {
    const raw = typeof req.body?.source === "string" ? req.body.source : "";
    try {
      const source = addChannelSource(raw);
      db.upsertChannel(source.key, source.url);
      const payload: AddSourceResponse = {
        source,
        message: `Source added: ${source.key}`
      };
      res.status(201).json(payload);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/sources/:key", (req, res) => {
    const key = req.params.key;
    try {
      const source = removeChannelSource(key);
      db.deactivateChannel(source.key);
      const payload: RemoveSourceResponse = {
        source,
        message: `Source removed: ${source.key}`
      };
      res.json(payload);
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : String(error) });
    }
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

  app.get("/api/live", setNoCacheHeaders, (_req, res) => {
    res.json(createLivePayload(db, syncService, deviceSyncService, liveOverride ?? undefined));
  });

  app.get("/api/events", setNoCacheHeaders, (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("retry: 1000\n\n");

    const payload = createLivePayload(db, syncService, deviceSyncService, liveOverride ?? undefined);
    res.write(`event: live\ndata: ${JSON.stringify(payload)}\n\n`);
    sseClients.add(res);

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    res.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
      res.end();
    });
  });

  if (process.env.ENABLE_TEST_API === "1") {
    app.post("/api/debug/live", (req, res) => {
      const current = createLivePayload(db, syncService, deviceSyncService);
      const body = req.body as Partial<Pick<LiveActivityDto, "deviceStatus" | "deviceReadyForExport" | "safeToDisconnect">>;
      liveOverride = {
        deviceStatus: body.deviceStatus ?? current.deviceStatus,
        deviceReadyForExport: body.deviceReadyForExport ?? current.deviceReadyForExport,
        safeToDisconnect: body.safeToDisconnect ?? current.safeToDisconnect
      };
      const payload = createLivePayload(db, syncService, deviceSyncService, liveOverride);
      lastLivePayloadJson = JSON.stringify(payload);
      const event = `event: live\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) {
        client.write(event);
      }
      res.json({ ok: true });
    });
  }

  app.post("/api/sync", (_req, res) => {
    const started = syncService.startSyncAll();
    logger.info(started ? "manual sync-all triggered" : "sync-all request ignored because a run is active");
    res.json(
      actionResponse(
        started,
        started ? "Library refresh started." : activeLibraryMessage(syncService),
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
      message: started
        ? "Refresh + sync player started."
        : [
            !result.libraryStarted ? activeLibraryMessage(syncService) : null,
            !result.playerStarted ? activePlayerMessage(syncService, deviceSyncService) : null
          ]
            .filter((value): value is string => value !== null)
            .join(" ")
    };
    res.json(payload);
  });

  app.post("/api/device-sync/sync-player", (_req, res) => {
    const started = syncService.startPlayerSync(null);
    logger.info(started ? "manual player-sync triggered" : "player-sync request ignored");
    res.json(
      actionResponse(
        started,
        started ? "Player sync started." : activePlayerMessage(syncService, deviceSyncService),
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
        started ? `Channel refresh started for ${handle}.` : activeLibraryMessage(syncService),
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
        started ? "Cookie-blocked retry started." : activeLibraryMessage(syncService),
        started ? null : "library run already active"
      )
    );
  });

  const serveShell = (_req: express.Request, res: express.Response): void => {
    res.send(renderSpaShell());
  };

  app.get("/", serveShell);
  app.get("/channels", serveShell);
  app.get("/channels/:handle", serveShell);
  app.get("/runs", serveShell);
  app.get("/runs/:runId", serveShell);

  const publishIfChanged = (): void => {
    const payload = createLivePayload(db, syncService, deviceSyncService, liveOverride ?? undefined);
    const nextJson = JSON.stringify(payload);
    if (nextJson === lastLivePayloadJson) {
      return;
    }
    lastLivePayloadJson = nextJson;
    const event = `event: live\ndata: ${nextJson}\n\n`;
    for (const client of sseClients) {
      client.write(event);
    }
  };

  lastLivePayloadJson = JSON.stringify(createLivePayload(db, syncService, deviceSyncService, liveOverride ?? undefined));
  setInterval(publishIfChanged, 1000);

  return app;
}
