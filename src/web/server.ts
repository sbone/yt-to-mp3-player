import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { AppDb } from "../db.js";
import { DeviceSyncService } from "../deviceSync.js";
import { Logger } from "../logger.js";
import { SyncService } from "../sync/syncService.js";
import { fmtDate, h, page } from "./html.js";

function badgeClass(status: string): string {
  if (status === "downloaded" || status === "success") return "badge badge-ok";
  if (status === "cookie_blocked") return "badge badge-warn";
  if (status === "warn") return "badge badge-warn";
  if (status === "failed") return "badge badge-bad";
  if (status === "error") return "badge badge-bad";
  if (status === "partial" || status === "running") return "badge badge-warn";
  return "badge";
}

function channelLabel(handle: string | null | undefined): string {
  if (!handle) {
    return "";
  }
  return handle.startsWith("playlist:") ? handle : `@${handle}`;
}

function deviceStateBadge(video: { status: string; exported_at?: string | null }): string {
  if (video.status === "downloaded" && video.exported_at) {
    return `<span class="${badgeClass("success")}">On player</span>`;
  }
  if (video.status === "downloaded") {
    return `<span class="${badgeClass("running")}">Local only</span>`;
  }
  if (video.status === "failed") {
    return `<span class="${badgeClass("failed")}">Failed</span>`;
  }
  if (video.status === "cookie_blocked") {
    return `<span class="${badgeClass("warn")}">Cookie blocked</span>`;
  }
  return `<span class="${badgeClass("discovered")}">Not downloaded</span>`;
}

function syncStateBox(syncService: SyncService): string {
  const state = syncService.getState();
  if (!state.library.running && !state.player.running) {
    return `<div class="card"><p class="mono">library: idle</p><p class="mono">player: idle</p></div>`;
  }
  return `<div class="card">
    <p class="mono">library: ${state.library.running ? "running" : "idle"}</p>
    <p class="mono">library run: ${h(state.library.runId ?? "n/a")}</p>
    <p class="mono">library scope: ${h(state.library.scope ?? "n/a")}</p>
    <p class="mono">library target: ${h(state.library.targetHandle ?? "all channels")}</p>
    <p class="mono">library started: ${h(fmtDate(state.library.startedAt))}</p>
    <p class="mono">player: ${state.player.running ? "running" : "idle"}</p>
    <p class="mono">player run: ${h(state.player.runId ?? "n/a")}</p>
    <p class="mono">player volume: ${h(state.player.targetVolume ?? "n/a")}</p>
    <p class="mono">player started: ${h(fmtDate(state.player.startedAt))}</p>
    <p class="mono">player progress: reconciled=${h(state.player.reconciled)} copied=${h(state.player.copied)} failed=${h(state.player.failed)} remaining=${h(state.player.remaining)}</p>
    <p class="mono">player current: ${h(state.player.currentItemTitle ?? "idle")}</p>
  </div>`;
}

function liveTerminalShell(): string {
  return `
    <section class="card">
      <h2>Live Activity</h2>
      <p class="small">Auto-refreshes every 2s while this page is open.</p>
      <pre id="live-terminal" class="terminal">Loading...</pre>
      <div id="sync-notification-root"></div>
      <script>
        (() => {
          const terminal = document.getElementById("live-terminal");
          const notificationRoot = document.getElementById("sync-notification-root");
          if (!terminal) return;
          if (!notificationRoot) return;

          const seenNotifications = new Set();
          const dismissedNotifications = new Set();
          const notificationQueue = [];
          let activeNotificationId = null;

          const fmt = (iso) => {
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
          };

          const escapeHtml = (value) =>
            String(value)
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;")
              .replaceAll("'", "&#039;");

          const titleClass = (status) => {
            if (status === "success") return "sync-notification-title sync-notification-title-ok";
            if (status === "failed") return "sync-notification-title sync-notification-title-bad";
            return "sync-notification-title sync-notification-title-warn";
          };

          const closeActiveNotification = () => {
            if (!activeNotificationId) return;
            dismissedNotifications.add(activeNotificationId);
            const idx = notificationQueue.findIndex((item) => item.id === activeNotificationId);
            if (idx >= 0) {
              notificationQueue.splice(idx, 1);
            }
            activeNotificationId = null;
            renderNotification();
          };

          const renderNotification = () => {
            const next = notificationQueue.find((item) => !dismissedNotifications.has(item.id)) ?? null;
            activeNotificationId = next ? next.id : null;
            if (!next) {
              notificationRoot.innerHTML = "";
              return;
            }

            const detailItems = next.details
              .map((detail) => "<li>" + escapeHtml(detail) + "</li>")
              .join("");

            notificationRoot.innerHTML = [
              '<div class="sync-notification-backdrop" data-close-notification="true">',
              '  <section class="sync-notification-modal card" role="dialog" aria-modal="true" aria-labelledby="sync-notification-title">',
              '    <button type="button" class="sync-notification-close" aria-label="Dismiss notification" data-close-notification="true">x</button>',
              '    <p class="' + titleClass(next.status) + '" id="sync-notification-title">' + escapeHtml(next.title) + '</p>',
              '    <p class="sync-notification-summary">' + escapeHtml(next.summary) + '</p>',
              '    <p class="small sync-notification-meta">' + escapeHtml(fmt(next.createdAt)) + '</p>',
              '    <ul class="sync-notification-list">' + detailItems + '</ul>',
              '  </section>',
              '</div>'
            ].join("");
          };

          const render = (payload) => {
            const state = payload.state;
            const lines = [];
            lines.push("[LIBRARY " + (state.library.running ? "RUNNING" : "IDLE") + "] run=" + (state.library.runId ?? "n/a") + " scope=" + (state.library.scope ?? "n/a") + " target=" + (state.library.targetHandle ?? "all"));
            lines.push("[PLAYER " + (state.player.running ? "RUNNING" : "IDLE") + "] run=" + (state.player.runId ?? "n/a") + " volume=" + (state.player.targetVolume ?? "n/a"));
            lines.push("         reconciled=" + state.player.reconciled + " copied=" + state.player.copied + " failed=" + state.player.failed + " remaining=" + state.player.remaining + " current=" + (state.player.currentItemTitle ?? "idle"));
            lines.push("");
            for (const event of payload.events) {
              const channel = event.channel_handle ? " " + event.channel_handle : "";
              lines.push("[" + fmt(event.created_at) + "] [" + event.level.toUpperCase() + "] [run " + event.run_id + "] " + event.event_type + channel + " :: " + event.message);
            }
            terminal.textContent = lines.join("\\n");
            terminal.scrollTop = terminal.scrollHeight;

            for (const notification of state.notifications ?? []) {
              if (seenNotifications.has(notification.id) || dismissedNotifications.has(notification.id)) {
                continue;
              }
              seenNotifications.add(notification.id);
              notificationQueue.push(notification);
            }
            renderNotification();
          };

          notificationRoot.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.closeNotification === "true") {
              closeActiveNotification();
            }
          });

          document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && activeNotificationId) {
              closeActiveNotification();
            }
          });

          const load = async () => {
            try {
              const response = await fetch("/api/live", { cache: "no-store" });
              if (!response.ok) return;
              const payload = await response.json();
              render(payload);
            } catch {
              // Keep the panel stable if polling fails.
            }
          };

          void load();
          setInterval(load, 2000);
        })();
      </script>
    </section>
  `;
}

export function createServer(
  db: AppDb,
  syncService: SyncService,
  deviceSyncService: DeviceSyncService,
  logger: Logger
): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  const distAssetPath = resolve(config.rootDir, "dist/public");
  const devAssetPath = resolve(config.rootDir, "src/web/static");
  const assetPath = process.env.NODE_ENV === "production" && existsSync(distAssetPath) ? distAssetPath : devAssetPath;
  app.use("/assets", express.static(assetPath));

  app.get("/", (_req, res) => {
    const channels = db.listChannelsOverview();
    const runs = db.listRecentRuns(10);
    const cookieBlocked = db.listCookieBlockedVideos(50);
    const latestDeviceSync = db.getLatestDeviceSync();
    const pendingExport = db.listPendingExportVideos(400);
    const deviceStatus = deviceSyncService.getStatus();
    const deviceReadyForExport = deviceStatus.connected && Boolean(deviceStatus.mountPath) && deviceStatus.writable;
    const syncState = syncService.getState();
    const safeToDisconnect = deviceStatus.connected && !syncState.player.running && syncState.player.remaining === 0 && syncState.player.lastFailedCount === 0;
    const body = `
      <section class="hero">
        <h1>Channel Sync Dashboard</h1>
        <p>Server-rendered status page for yt-dlp channel tracking.</p>
        <div class="actions">
          <form method="post" action="/sync">
            <button type="submit">Refresh Library</button>
          </form>
          <form method="post" action="/device-sync/sync-player">
            <button type="submit" ${deviceReadyForExport ? "" : "disabled"}>Sync Player</button>
          </form>
          <form method="post" action="/sync-and-export">
            <button type="submit" ${deviceReadyForExport ? "" : "disabled"}>Refresh Library + Sync Player</button>
          </form>
          <form method="post" action="/retry/cookie-errors">
            <button type="submit">Retry Cookie-Blocked (${cookieBlocked.length})</button>
          </form>
        </div>
      </section>

      ${syncStateBox(syncService)}

      <section class="card">
        <h2>MP3 Player Export</h2>
        <p class="small">Tracks ready to copy now: <strong>${pendingExport.length}</strong></p>
        <p class="small">
          Device status:
          <strong>${deviceStatus.connected ? `connected (${h(deviceStatus.volumeName)})` : "not connected"}</strong>
          ${deviceStatus.mountPath ? `at <code>${h(deviceStatus.mountPath)}</code>` : ""}
        </p>
        <p class="small">
          Disconnect status:
          <strong>${safeToDisconnect ? "Safe to disconnect" : syncState.player.running ? "Do not disconnect during player sync" : "Not ready to disconnect"}</strong>
        </p>
        ${
          deviceStatus.reason
            ? `<p class="small">Detection note: ${h(deviceStatus.reason)}</p>`
            : ""
        }
        <p class="small">
          Last device update:
          <strong>${latestDeviceSync ? h(fmtDate(latestDeviceSync.created_at)) : "never"}</strong>
          ${latestDeviceSync ? `(tracks: ${h(latestDeviceSync.item_count)})` : ""}
        </p>
        ${
          latestDeviceSync?.note
            ? `<p class="small">Last note: ${h(latestDeviceSync.note)}</p>`
            : ""
        }
        ${
          syncState.player.lastSummary
            ? `<p class="small">Last player sync summary: ${h(syncState.player.lastSummary)}</p>`
            : ""
        }
        <p class="small">
          Player sync:
          <strong>reconciled=${h(syncState.player.reconciled)}</strong>,
          <strong>copied=${h(syncState.player.copied)}</strong>,
          <strong>failed=${h(syncState.player.failed)}</strong>,
          <strong>remaining=${h(syncState.player.remaining)}</strong>
          ${syncState.player.currentItemTitle ? `, current=${h(syncState.player.currentItemTitle)}` : ""}
        </p>
        <div class="actions">
          <form method="post" action="/device-sync/sync-player" class="inline-form">
            <input name="note" type="text" placeholder="Optional note (e.g. auto-copied to AGP-A02T)" />
            <button type="submit" ${deviceReadyForExport ? "" : "disabled"}>Sync Player Now</button>
          </form>
          <form method="post" action="/device-sync/mark-pending" class="inline-form">
            <input name="note" type="text" placeholder="Optional note (e.g. copied to SanDisk)" />
            <button type="submit">Mark Pending As Exported</button>
          </form>
          <a class="button-link" href="/device-sync/pending-manifest.txt">Download Pending Manifest</a>
        </div>
      </section>

      <section class="card">
        <h2>Pending Export Queue</h2>
        <p class="small">Newest local-only tracks are listed first so the player gets fresh audio before older backlog.</p>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Title</th>
              <th>Downloaded</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            ${
              pendingExport.length === 0
                ? `<tr><td colspan="4">No pending tracks.</td></tr>`
                : pendingExport
                    .map(
                      (video) => `<tr>
                        <td>${h(channelLabel(video.channel_handle))}</td>
                        <td>${h(video.title)}</td>
                        <td>${h(fmtDate(video.downloaded_at))}</td>
                        <td class="mono small">${h(video.local_path)}</td>
                      </tr>`
                    )
                    .join("")
            }
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Channels</h2>
        <table>
          <thead>
            <tr>
              <th>Handle</th>
              <th>Known</th>
              <th>On Player</th>
              <th>Local Only</th>
              <th>Needs Sync</th>
              <th>Failed</th>
              <th>Cookie blocked</th>
              <th>Newest upload</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            ${channels
              .map(
                (channel) => `<tr>
                <td><a href="/channels/${encodeURIComponent(channel.handle)}">${h(channelLabel(channel.handle))}</a></td>
                <td>${h(channel.known_videos)}</td>
                <td>${h(channel.on_player_videos)}</td>
                <td>${h(channel.local_only_videos)}</td>
                <td>${h(channel.needs_sync_videos)}</td>
                <td>${h(channel.failed_videos)}</td>
                <td>${h(channel.cookie_blocked_videos)}</td>
                <td>${h(channel.newest_upload ?? "n/a")}</td>
                <td>${h(fmtDate(channel.last_checked_at))}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Cookie-Blocked Videos</h2>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Title</th>
              <th>Video</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${
              cookieBlocked.length === 0
                ? `<tr><td colspan="4">No cookie/auth blocked videos.</td></tr>`
                : cookieBlocked
                    .map(
                      (video) => `<tr>
                        <td><a href="/channels/${encodeURIComponent(video.channel_handle)}">${h(channelLabel(video.channel_handle))}</a></td>
                        <td>${h(video.title)}</td>
                        <td><a href="https://www.youtube.com/watch?v=${h(video.youtube_video_id)}">${h(video.youtube_video_id)}</a></td>
                        <td class="small">${h(video.failure_message ?? "")}</td>
                      </tr>`
                    )
                    .join("")
            }
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Recent Runs</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Started</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Discovered</th>
              <th>Downloaded</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            ${runs
              .map(
                (run) => `<tr>
                <td><a href="/runs/${run.id}">${run.id}</a></td>
                <td>${h(fmtDate(run.started_at))}</td>
                <td>${h(run.scope)} ${run.channel_handle ? `(${h(run.channel_handle)})` : ""}</td>
                <td><span class="${badgeClass(run.status)}">${h(run.status)}</span></td>
                <td>${h(run.discovered_count)}</td>
                <td>${h(run.downloaded_count)}</td>
                <td>${h(run.failed_count)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>

      ${liveTerminalShell()}
    `;
    res.send(page("Dashboard", body));
  });

  app.get("/channels", (_req, res) => {
    const channels = db.listChannelsOverview();
    const body = `
      <section class="hero">
        <h1>Tracked Channels</h1>
        <p>Edit <code>channels.txt</code> to change what is tracked.</p>
      </section>
      <section class="card">
        <table>
          <thead>
            <tr>
              <th>Handle</th>
              <th>URL</th>
              <th>Known videos</th>
              <th>On Player</th>
              <th>Local Only</th>
              <th>Needs Sync</th>
              <th>Cookie blocked</th>
              <th>Last success</th>
            </tr>
          </thead>
          <tbody>
            ${channels
              .map(
                (channel) => `<tr>
                <td><a href="/channels/${encodeURIComponent(channel.handle)}">${h(channelLabel(channel.handle))}</a></td>
                <td><a href="${h(channel.url)}">${h(channel.url)}</a></td>
                <td>${h(channel.known_videos)}</td>
                <td>${h(channel.on_player_videos)}</td>
                <td>${h(channel.local_only_videos)}</td>
                <td>${h(channel.needs_sync_videos)}</td>
                <td>${h(channel.cookie_blocked_videos)}</td>
                <td>${h(fmtDate(channel.last_success_at))}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `;
    res.send(page("Channels", body));
  });

  app.get("/channels/:handle", (req, res) => {
    const handle = req.params.handle;
    const channel = db.getChannel(handle);
    if (!channel) {
      res.status(404).send(page("Not Found", `<section class="card"><h1>Unknown channel</h1></section>`));
      return;
    }
    const videos = db.listChannelVideos(handle);
    const body = `
      <section class="hero">
        <h1>${h(channelLabel(channel.handle))}</h1>
        <p>${h(channel.url)}</p>
        <div class="actions">
          <form method="post" action="/channels/${encodeURIComponent(channel.handle)}/sync">
            <button type="submit">Sync This Channel</button>
          </form>
        </div>
      </section>
      <section class="card">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Upload</th>
              <th>Status</th>
              <th>Device State</th>
              <th>Exported</th>
              <th>Local path</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${videos
              .map(
                (video) => `<tr>
                <td><a href="https://www.youtube.com/watch?v=${h(video.youtube_video_id)}">${h(video.title)}</a></td>
                <td>${h(video.upload_date ?? "n/a")}</td>
                <td><span class="${badgeClass(video.status)}">${h(video.status)}</span></td>
                <td>${deviceStateBadge(video)}</td>
                <td>${h(fmtDate(video.exported_at))}</td>
                <td class="mono small">${h(video.local_path ?? "")}</td>
                <td class="small">${h(video.failure_message ?? "")}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `;
    res.send(page(`Channel ${handle}`, body));
  });

  app.get("/runs", (_req, res) => {
    const runs = db.listRecentRuns(200);
    const body = `
      <section class="hero">
        <h1>Sync Runs</h1>
      </section>
      <section class="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Scope</th>
              <th>Status</th>
              <th>D/S/F</th>
            </tr>
          </thead>
          <tbody>
            ${runs
              .map(
                (run) => `<tr>
                <td><a href="/runs/${run.id}">${run.id}</a></td>
                <td>${h(fmtDate(run.started_at))}</td>
                <td>${h(fmtDate(run.finished_at))}</td>
                <td>${h(run.scope)} ${run.channel_handle ? `(${h(run.channel_handle)})` : ""}</td>
                <td><span class="${badgeClass(run.status)}">${h(run.status)}</span></td>
                <td>${h(run.downloaded_count)}/${h(run.skipped_count)}/${h(run.failed_count)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `;
    res.send(page("Runs", body));
  });

  app.get("/runs/:runId", (req, res) => {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) {
      res.status(400).send(page("Bad Request", `<section class="card"><h1>Invalid run id</h1></section>`));
      return;
    }
    const run = db.getRun(runId);
    if (!run) {
      res.status(404).send(page("Not Found", `<section class="card"><h1>Run not found</h1></section>`));
      return;
    }
    const events = db.listRunEvents(runId);
    const body = `
      <section class="hero">
        <h1>Run #${h(run.id)}</h1>
        <p>
          <span class="${badgeClass(run.status)}">${h(run.status)}</span>
          started ${h(fmtDate(run.started_at))}
        </p>
      </section>
      <section class="card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Type</th>
              <th>Channel</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${events
              .map(
                (event) => `<tr>
                <td>${h(fmtDate(event.created_at))}</td>
                <td><span class="${badgeClass(event.level)}">${h(event.level)}</span></td>
                <td class="mono">${h(event.event_type)}</td>
                <td>${h(channelLabel(event.channel_handle))}</td>
                <td>${h(event.message)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `;
    res.send(page(`Run ${run.id}`, body));
  });

  app.post("/sync", (_req, res) => {
    const started = syncService.startSyncAll();
    logger.info(started ? "manual sync-all triggered" : "sync-all request ignored because a run is active");
    res.redirect("/");
  });

  app.post("/sync-and-export", (_req, res) => {
    const deviceStatus = deviceSyncService.getStatus();
    const deviceReadyForExport = deviceStatus.connected && Boolean(deviceStatus.mountPath) && deviceStatus.writable;
    const result = deviceReadyForExport ? syncService.startSyncAllAndExport() : { libraryStarted: false, playerStarted: false };
    if (!deviceReadyForExport) {
      logger.warn(`sync-and-export blocked: ${deviceStatus.reason ?? "device is not writable"}`);
    } else {
      logger.info(
        result.libraryStarted || result.playerStarted
          ? `manual sync-and-export triggered library=${result.libraryStarted} player=${result.playerStarted}`
          : "sync-and-export request ignored because no operation could start"
      );
    }
    res.redirect("/");
  });

  app.post("/device-sync/sync-player", (req, res) => {
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    const started = syncService.startPlayerSync(note.length > 0 ? note : null);
    logger.info(started ? "manual player-sync triggered" : "player-sync request ignored");
    res.redirect("/");
  });

  app.post("/channels/:handle/sync", (req, res) => {
    const handle = req.params.handle;
    const started = syncService.startSyncChannel(handle);
    logger.info(started ? `manual sync-channel triggered handle=${handle}` : `sync-channel ignored handle=${handle} active run`);
    res.redirect(`/channels/${encodeURIComponent(handle)}`);
  });

  app.post("/retry/cookie-errors", (_req, res) => {
    const started = syncService.startRetryCookieBlocked();
    logger.info(started ? "manual retry-cookie-errors triggered" : "retry-cookie-errors ignored because a run is active");
    res.redirect("/");
  });

  app.post("/device-sync/mark-pending", (req, res) => {
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    const result = db.markPendingAsExported(note.length > 0 ? note : null);
    logger.info(`device-sync mark-pending sync_id=${result.syncId ?? "none"} item_count=${result.itemCount}`);
    res.redirect("/");
  });

  app.get("/device-sync/pending-manifest.txt", (_req, res) => {
    const pending = db.listPendingExportVideos(5000);
    const lines = [
      `# pending export manifest`,
      `# generated_at: ${new Date().toISOString()}`,
      `# count: ${pending.length}`,
      ""
    ];

    for (const item of pending) {
      lines.push(item.local_path);
    }

    const body = `${lines.join("\n")}\n`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pending-export-manifest.txt"`);
    res.send(body);
  });

  app.get("/api/live", (_req, res) => {
    const state = syncService.getState();
    // We read newest-first in SQL and reverse for chronological terminal output.
    const events = db.listRecentEvents(120).reverse();
    res.json({ state, events });
  });

  return app;
}
