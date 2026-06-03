# Architecture

Local Audio Device Sync is a local-first React/TypeScript app with an Express API, SQLite state, and a filesystem/device sync boundary.

## Runtime Shape

- The Express server starts from `src/index.ts`, initializes SQLite, reconciles interrupted runs, seeds demo data when `DEMO_MODE=1`, and serves the SPA/API.
- The React SPA uses a small Elm-style update loop in `src/client/app.tsx` and `src/client/screens.tsx`.
- Live dashboard updates use server-sent events from `/api/events`.
- Build output places server code in `dist/` and client assets in `dist/public/`.

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
- Copying writes `<target>.part`, verifies file size, then renames into place.
- Existing matching files are treated as already exported.

## Recovery Behavior

- Runs left as `running` are marked failed on startup with an interruption event.
- Exported files missing from the player are re-queued by clearing `exported_at`.
- Cookie/auth failures are tracked as `cookie_blocked` so they do not disappear into generic failures.
- The dashboard exposes safe-to-disconnect, device-readiness, pending export, and recent events as first-class state.

## Tests

Playwright runs with `DEMO_MODE=1 DEMO_RESET=1`, so tests exercise the app without external binaries or real mounted devices.

Covered scenarios include:

- dashboard render and SSE updates
- source management
- demo refresh/download
- fake player export
- device-not-mounted recovery state
- direct routes and not-found states
