# Architecture

Local Audio Device Sync is a local-first React/TypeScript app with an Express API, SQLite state, and a filesystem/device sync boundary.

## Runtime Shape

- The Express server starts from `src/index.ts`, initializes SQLite, reconciles interrupted runs, seeds demo data when `DEMO_MODE=1`, and serves the SPA/API.
- The React SPA uses a small Elm-style update loop in `src/client/app.tsx` and `src/client/screens.tsx`.
- Live dashboard updates use server-sent events from `/api/events`.
- Development embeds Vite middleware and hot reload in the Express HTTP server; browser assets and API calls share one origin and port.
- Build output places server code in `dist/` and client assets in `dist/public/`.

Node is pinned through asdf in `.tool-versions`. Homebrew installs yt-dlp (with Deno) and FFmpeg/FFprobe through `Brewfile`; `npm run doctor` checks runnable binaries and MP3 encoding support.

## State Model

SQLite tracks:

- sources in the existing `channels` table
- discovered media in `videos`
- library and player jobs in `sync_runs`
- operational events in `sync_events`
- completed player exports in `device_syncs`

The database intentionally keeps the original `youtube_video_id` naming for compatibility, even though the product UI now talks about generic media sources.

## Media Provider Boundary

`SyncService` depends on a media provider instead of calling `yt-dlp` directly.

- Normal mode uses the real provider, which wraps discovery/download behavior from `src/sync/ytDlp.ts`.
- Demo mode uses a deterministic fake provider that returns seeded sources and writes harmless MP3 placeholder files.
- This keeps demo mode realistic because refresh, DB writes, progress state, and device sync still run through the production service path.

## Filesystem And Device Boundary

`DeviceSyncService` detects a writable player mount, reconciles existing files, and copies pending audio files.

- Normal mode discovers a mounted player from `DEVICE_MOUNT_PATH`, `DEVICE_VOLUME_NAME`, or `/Volumes`.
- Demo mode points the same service at `data/demo/player`.
- Copying writes `<target>.part`, verifies file size and SHA-256 contents, then renames into place.
- Exact filename matches are checked for duplicate names and verified against local contents before being treated as exported. Fuzzy matches are suggestions only.
- After local cache deletion, stored file sizes detect truncated player files.
- Verified exports delete the local source copy; SQLite retains its path and export history.

## Recovery Behavior

- Runs left as `running` are marked failed on startup with an interruption event.
- Missing local audio and missing or truncated player exports are reset to `discovered`.
- SQLite controls download eligibility; the yt-dlp download archive no longer blocks recovery.
- Refresh checks the full discovered feed and retries stored pending items absent from that feed.
- Combined refresh-and-sync jobs reserve both operations and export after refresh completes.
- Cookie/auth failures are tracked as `cookie_blocked` so they do not disappear into generic failures.
- The dashboard exposes safe-to-disconnect, device-readiness, pending export, and recent events as first-class state.

## Tests

`npm run test:unit` runs API, reconciliation, and service regression tests without a web server. Browser tests run with `DEMO_MODE=1 DEMO_RESET=1`; `npm run test:production` runs the same smoke suite against built assets. All use fake media and temporary or demo devices.

Covered scenarios include:

- dashboard render and SSE updates
- source management
- demo refresh/download
- fake player export
- device-not-mounted recovery state
- direct routes and not-found states
