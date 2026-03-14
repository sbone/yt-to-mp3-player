import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { AppDb } from "../db.js";
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

function syncStateBox(syncService: SyncService): string {
  const state = syncService.getState();
  if (!state.running) {
    return `<div class="card"><p class="mono">status: idle</p></div>`;
  }
  return `<div class="card">
    <p class="mono">status: running</p>
    <p class="mono">run: ${h(state.runId)}</p>
    <p class="mono">scope: ${h(state.scope)}</p>
    <p class="mono">target: ${h(state.targetHandle ?? "all channels")}</p>
    <p class="mono">started: ${h(fmtDate(state.startedAt))}</p>
  </div>`;
}

function liveTerminalShell(): string {
  return `
    <section class="card">
      <h2>Live Activity</h2>
      <p class="small">Auto-refreshes every 2s while this page is open.</p>
      <pre id="live-terminal" class="terminal">Loading...</pre>
      <script>
        (() => {
          const terminal = document.getElementById("live-terminal");
          if (!terminal) return;

          const fmt = (iso) => {
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
          };

          const render = (payload) => {
            const state = payload.state;
            const lines = [];
            lines.push(state.running
              ? "[RUNNING] run=" + (state.runId ?? "n/a") + " scope=" + (state.scope ?? "n/a") + " target=" + (state.targetHandle ?? "all")
              : "[IDLE] no active sync run");
            lines.push("");
            for (const event of payload.events) {
              const channel = event.channel_handle ? " @" + event.channel_handle : "";
              lines.push("[" + fmt(event.created_at) + "] [" + event.level.toUpperCase() + "] [run " + event.run_id + "] " + event.event_type + channel + " :: " + event.message);
            }
            terminal.textContent = lines.join("\\n");
            terminal.scrollTop = terminal.scrollHeight;
          };

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

export function createServer(db: AppDb, syncService: SyncService, logger: Logger): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  const distAssetPath = resolve(config.rootDir, "dist/public");
  const devAssetPath = resolve(config.rootDir, "src/web/static");
  app.use("/assets", express.static(existsSync(distAssetPath) ? distAssetPath : devAssetPath));

  app.get("/", (_req, res) => {
    const channels = db.listChannelsOverview();
    const runs = db.listRecentRuns(10);
    const cookieBlocked = db.listCookieBlockedVideos(50);
    const body = `
      <section class="hero">
        <h1>Channel Sync Dashboard</h1>
        <p>Server-rendered status page for yt-dlp channel tracking.</p>
        <p class="small">Download cutoff: videos uploaded on or after ${h(config.minUploadDate)}.</p>
        <div class="actions">
          <form method="post" action="/sync">
            <button type="submit">Sync All Channels</button>
          </form>
          <form method="post" action="/retry/cookie-errors">
            <button type="submit">Retry Cookie-Blocked (${cookieBlocked.length})</button>
          </form>
        </div>
      </section>

      ${syncStateBox(syncService)}

      <section class="card">
        <h2>Channels</h2>
        <table>
          <thead>
            <tr>
              <th>Handle</th>
              <th>Known</th>
              <th>Downloaded</th>
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
                <td><a href="/channels/${encodeURIComponent(channel.handle)}">@${h(channel.handle)}</a></td>
                <td>${h(channel.known_videos)}</td>
                <td>${h(channel.downloaded_videos)}</td>
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
                        <td><a href="/channels/${encodeURIComponent(video.channel_handle)}">@${h(video.channel_handle)}</a></td>
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
              <th>Downloaded</th>
              <th>Cookie blocked</th>
              <th>Last success</th>
            </tr>
          </thead>
          <tbody>
            ${channels
              .map(
                (channel) => `<tr>
                <td><a href="/channels/${encodeURIComponent(channel.handle)}">@${h(channel.handle)}</a></td>
                <td><a href="${h(channel.url)}">${h(channel.url)}</a></td>
                <td>${h(channel.known_videos)}</td>
                <td>${h(channel.downloaded_videos)}</td>
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
        <h1>@${h(channel.handle)}</h1>
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
                <td>${h(event.channel_handle ?? "")}</td>
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

  app.get("/api/live", (_req, res) => {
    const state = syncService.getState();
    // We read newest-first in SQL and reverse for chronological terminal output.
    const events = db.listRecentEvents(120).reverse();
    res.json({ state, events });
  });

  return app;
}
