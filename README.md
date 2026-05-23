# Local Audio Device Sync

A local-first TypeScript app for managing audio sources and syncing downloaded audio to a basic USB MP3 player. The project focuses on a real filesystem-heavy workflow: clear operational state, safe device copying, interrupted-job recovery, and a UI that makes local sync understandable.

This app can use `yt-dlp` and `ffmpeg` with user-provided media URLs. Use it only for media you have the right to access, download, and transfer for personal use.

## Problem

Low-cost dedicated MP3 players are useful for offline listening, but their sync workflow is brittle: users need to track sources, download audio, copy files onto a mounted device, recover after interrupted copies, and understand whether the player is safe to disconnect.

This project explores that workflow as local-first software instead of a cloud queue or fake CRUD app.

## Demo Quickstart

Demo mode is safe for reviewers. It uses fake sources, fake downloaded MP3 placeholder files, and a fake mounted player under `data/demo/`.

```bash
npm ci
npm run demo
```

Open `http://127.0.0.1:3000`.

In demo mode:

- `yt-dlp` and `ffmpeg` are not called.
- Real user data and real mounted devices are not used.
- The fake DB is `data/demo/app.db`.
- Fake downloads are written to `data/demo/downloads`.
- The fake player is `data/demo/player`.

## Normal Setup

```bash
npm ci
npm run dev
```

Requirements for normal mode:

- Node.js 22.x
- `yt-dlp` in `PATH`
- `ffmpeg` in `PATH`

Useful commands:

```bash
npm run check
npm test
npm run build
npm run start
```

## Workflow

- Add sources from the UI or edit `channels.txt`.
- `Refresh Library` discovers new media and downloads audio.
- `Sync Player` copies downloaded files to the mounted player.
- `Refresh Library + Sync Player` runs both.
- Existing matching files already on the player are reconciled as exported.
- Missing exported files are re-queued so the next sync can restore them.
- Cookie/auth failures are tracked separately for recovery.

## Constraints

- Local-first: SQLite and filesystem state are the source of truth.
- Device-aware: copying happens only when the mounted player is detected and writable.
- Recovery-oriented: interrupted runs and missing device files are surfaced instead of hidden.
- Demo-safe: portfolio reviewers can exercise the product without external binaries or real media.

## Screenshots

Screenshot placeholders for a portfolio case study:

- Empty state: `docs/screenshots/01-empty-state.png`
- Source management: `docs/screenshots/02-source-management.png`
- Refresh progress: `docs/screenshots/03-refresh-progress.png`
- Sync-to-device flow: `docs/screenshots/04-player-sync.png`
- Error/recovery state: `docs/screenshots/05-recovery-state.png`
- Device not mounted: `docs/screenshots/06-device-not-mounted.png`

The app includes a `Screenshot` toggle to redact sensitive source names and paths before capturing real screenshots.

## Architecture

- React SPA renders dashboard, source ledger, run ledger, and recovery states.
- Express serves the API, SPA shell, live SSE updates, and sync actions.
- SQLite stores sources, discovered videos, sync runs, events, and export state.
- A media provider boundary swaps real `yt-dlp` behavior for deterministic demo behavior.
- Device sync works against a filesystem boundary, so the same reconciliation path supports real and demo devices.

See [docs/architecture.md](docs/architecture.md) for a deeper walkthrough.

## Reliability Decisions

- Sync runs are persisted and reconciled on startup if the server stops mid-run.
- Device export writes to `.part` files and renames only after size verification.
- Existing player files are detected before copying to avoid duplicate transfers.
- Deleted player files clear their exported state and become pending again.
- Live progress is streamed over SSE so the UI reflects long-running work without refreshes.

## AI/Codex Collaboration

Codex helped turn an existing personal utility into a portfolio-ready product by adding demo mode, tightening the reviewer workflow, expanding Playwright coverage, and reframing docs around local-first device sync. I reviewed the architecture, product framing, operational states, and implementation tradeoffs.

## Future Improvements

- Add import/export for source lists.
- Add a read-only preview of pending copy manifests.
- Capture and commit portfolio screenshots/GIFs.
- Add more granular retry controls per failed item.
- Package a single-command desktop build for non-technical users.
