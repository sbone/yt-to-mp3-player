# Local Audio Device Sync

A local-first TypeScript app for managing audio sources and syncing downloaded audio to a basic USB MP3 player. It emphasizes clear operational state, safe device copying, interrupted-job recovery, and a UI that makes local sync understandable.

This app can use `yt-dlp` and `ffmpeg` with user-provided media URLs. Use it only for media you have the right to access, download, and transfer for personal use.

## Screenshot

<img width="2880" height="1750" alt="updated UI" src="https://github.com/user-attachments/assets/b31d91ec-adf8-42a3-bde3-1d41794d73db" />

## Problem

Low-cost dedicated MP3 players are useful for offline listening, but their sync workflow is brittle: users need to track sources, download audio, copy files onto a mounted device, recover after interrupted copies, and understand whether the player is safe to disconnect.

This project explores that workflow as local-first software instead of a cloud queue or fake CRUD app.

## Demo Quickstart

Demo mode is safe for reviewers. It uses fake sources, fake downloaded MP3 placeholder files, and a fake mounted player under `data/demo/`. It requires the pinned Node version but does not call Deno, yt-dlp, or FFmpeg.

```bash
npm ci
npm run demo
```

Open `http://127.0.0.1:3000`.

In demo mode:

- Real user data and real mounted devices are not used.
- The fake DB is `data/demo/app.db`.
- Fake downloads are written to `data/demo/downloads`.
- The fake player is `data/demo/player`.

## Runtime Setup

The project pins Node.js 22.14.0 and Deno 2.6.3 in `.tool-versions`. Node runs the app and build tools. Deno is yt-dlp's recommended runtime for YouTube's JavaScript challenges and is enabled by yt-dlp by default.

On macOS, install the system tools and register the asdf plugins once:

```bash
brew bundle
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add deno https://github.com/asdf-community/asdf-deno.git
```

Skip either `plugin add` command when that plugin already appears in `asdf plugin list`. Add asdf's shims to the end of `~/.zshrc`, after other Homebrew or `PATH` setup:

```bash
export PATH="${ASDF_DATA_DIR:-$HOME/.asdf}/shims:$PATH"
```

Then install the pinned runtimes and app dependencies:

```bash
source ~/.zshrc
asdf install
npm ci
./scripts/doctor.sh
```

`doctor.sh` verifies Node, Deno, yt-dlp, FFmpeg, and the native `better-sqlite3` binding. If npm reports `EBADENGINE` with Node 24, the shell is bypassing asdf's shims; fix the `PATH` line and open a new terminal or source `~/.zshrc` before retrying.

Homebrew manages yt-dlp and FFmpeg, including FFmpeg's MP3 support. Their versions are intentionally not pinned because yt-dlp must keep pace with YouTube changes. Run `brew upgrade yt-dlp` if extraction starts failing, or `brew upgrade ffmpeg` if audio conversion starts failing.

## Normal Mode

Normal mode requires Deno, yt-dlp, and FFmpeg in `PATH` in addition to Node and the npm dependencies:

```bash
npm run dev
```

Open `http://127.0.0.1:3000`. The development command starts the Express backend on port `3000` and the Vite client on port `5173`.

Useful commands:

```bash
npm run doctor
npm run check
npm run build
npm run start
```

Install Chromium once before running browser tests or generating screenshots:

```bash
npx playwright install chromium
npm test
npm run screenshots
```

## Workflow

- Add or remove sources from the UI, or edit `channels.txt`.
- Source entries can be a channel handle, `@handle`, channel URL, or playlist URL.
- `Refresh Library` discovers new media and downloads audio.
- `Sync Player` copies downloaded files to the mounted player.
- `Refresh Library + Sync Player` runs both.
- Existing matching files already on the player are reconciled as exported.
- Missing exported files are re-queued so the next sync can restore them.
- Verified player exports remove the local cache copy; missing player files are downloaded again on the next library refresh.
- Cookie/auth failures are tracked separately for recovery.
- Removing a source marks its SQLite channel row inactive, preserving discovered videos and run history.

## Device Configuration

- By default the app looks for a mounted volume named `AGP-A02T`.
- Override the volume name with `DEVICE_VOLUME_NAME=YourVolumeName`.
- Set `DEVICE_MOUNT_PATH=/Volumes/YourVolumeName` to bypass volume detection.
- The app preserves source folders on the device.
- `npm run reconcile:device` reports pending tracks already present on the player.
- `npm run reconcile:device -- --apply` marks high-confidence matches as exported without copying or deleting files.

## Constraints

- Local-first: SQLite and filesystem state are the source of truth.
- Device-aware: copying happens only when the mounted player is detected and writable.
- Recovery-oriented: interrupted runs and missing device files are surfaced instead of hidden.
- Demo-safe: portfolio reviewers can exercise the product without external binaries or real media.

## Screenshots

`npm run screenshots` generates a portfolio set under `artifacts/screenshots/`:

- `01-dashboard-empty-state.png`
- `02-source-management.png`
- `03-refresh-progress.png`
- `04-player-sync.png`
- `05-recovery-state.png`
- `06-device-not-mounted.png`

The app includes a `Screenshot` toggle to redact sensitive source names and paths before capturing real screenshots.

## Architecture

- React renders the dashboard, source ledger, run ledger, and recovery states.
- Express serves the API, SPA shell, live SSE updates, and sync actions.
- SQLite stores sources, discovered videos, sync runs, events, and export state.
- A media provider boundary swaps real yt-dlp behavior for deterministic demo behavior.
- Device sync works against a filesystem boundary, so the same reconciliation path supports real and demo devices.

See [docs/architecture.md](docs/architecture.md) for a deeper walkthrough.

## Reliability Decisions

- Sync runs are persisted and reconciled on startup if the server stops mid-run.
- Device export writes to `.part` files and renames only after size verification.
- Existing player files are detected before copying to avoid duplicate transfers.
- Deleted player files clear their exported state and become pending again.
- Live progress is streamed over SSE so the UI reflects long-running work without refreshes.
- npm dependencies are locked in `package-lock.json`.
- Mismatched Node versions can break `better-sqlite3`; run `npm run rebuild:native` after correcting the active Node version.

## State and Files

- App DB: `data/app.db`
- Download archive: `data/archive.txt`
- Logs: `data/logs/app.log`
- Downloads: `downloads/`

## AI/Codex Collaboration

Codex helped turn an existing personal utility into a portfolio-ready product by adding demo mode, tightening the reviewer workflow, expanding Playwright coverage, and reframing docs around local-first device sync. I reviewed the architecture, product framing, operational states, and implementation tradeoffs.

## Remote Access

Keep the app bound to localhost, then expose it through Tailscale:

```bash
tailscale serve localhost:3000
```

## Future Improvements

- Add import/export for source lists.
- Add a read-only preview of pending copy manifests.
- Capture and commit portfolio screenshots or GIFs.
- Add more granular retry controls per failed item.
- Package a single-command desktop build for non-technical users.
