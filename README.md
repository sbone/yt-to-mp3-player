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

Node.js 22.23.3 is pinned in `.tool-versions` and managed by asdf. Homebrew manages the media tools through `Brewfile`: yt-dlp, its Deno dependency, and FFmpeg (including FFprobe and MP3 encoding). npm manages app packages through `package-lock.json`. Deno handles YouTube JavaScript challenges and is enabled by yt-dlp by default.

On macOS, install the system tools and register the Node asdf plugin once:

```bash
brew bundle
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
```

Skip `plugin add` when `nodejs` already appears in `asdf plugin list`. Add asdf's shims to the end of `~/.zshrc`, after other Homebrew or `PATH` setup:

```bash
export PATH="${ASDF_DATA_DIR:-$HOME/.asdf}/shims:$PATH"
```

Then install the pinned Node runtime and app dependencies:

```bash
source ~/.zshrc
asdf install
npm ci
./scripts/doctor.sh
```

`doctor.sh` verifies the pinned Node version, runnable Deno/yt-dlp/FFmpeg/FFprobe binaries, MP3 encoding support, and the native `better-sqlite3` binding. If npm reports `EBADENGINE` with Node 24, the shell is bypassing asdf's shims; fix the `PATH` line and open a new terminal or source `~/.zshrc` before retrying.

Media tool versions are intentionally not pinned: yt-dlp and its JavaScript runtime must keep pace with YouTube changes. Deno is installed through yt-dlp's Homebrew dependency; no separate asdf Deno plugin is needed.

To update the media tools and verify the installation:

```bash
brew update
brew upgrade yt-dlp deno ffmpeg
npm run doctor
```

## Normal Mode

Normal mode requires Deno, yt-dlp, FFmpeg, and FFprobe in `PATH` in addition to Node and the npm dependencies:

```bash
npm run dev
```

Open `http://127.0.0.1:3000`. Development uses one server on port `3000`: Express serves the API and Vite serves client assets and hot reload through the same port.

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
npm run test:production
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
- `npm run reconcile:device -- --apply` marks verified exact matches as exported without copying or deleting files.

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
- Device export writes to `.part` files and renames only after size and SHA-256 verification.
- Exact player matches are verified before removing local audio; fuzzy filename matches remain suggestions.
- Missing or truncated player files are re-queued in SQLite for the next library refresh.
- Library refresh retries stored recovery items even when they are absent from the current feed.
- The combined refresh-and-sync action finishes the library refresh before exporting.
- Live progress is streamed over SSE so the UI reflects long-running work without refreshes.
- npm dependencies are locked in `package-lock.json`.
- Mismatched Node versions can break `better-sqlite3`; run `npm run rebuild:native` after correcting the active Node version.

## State and Files

- App DB: `data/app.db`
- Logs: `data/logs/app.log`
- Downloads: `downloads/`

## AI/Codex Collaboration

Codex helped turn an existing personal utility into a portfolio-ready product by adding demo mode, tightening the reviewer workflow, expanding Playwright coverage, and reframing docs around local-first device sync. I reviewed the architecture, product framing, operational states, and implementation tradeoffs.

## Remote Access

The app binds to `0.0.0.0` by default, accepting connections on all IPv4 interfaces. On the M1 Pro, open `http://localhost:3000`; from another computer, open `http://<m1proIP>:3000`. Development assets, API calls, and hot reload follow the address in your browser. There is no separate Vite port to expose.

`0.0.0.0` is a listening address, not a browser destination. `localhost` always refers to the computer running the browser. The app has no authentication, so use this binding on trusted networks.

Override the port or restrict listening to localhost when needed:

```bash
PORT=4000 npm run dev
HOST=127.0.0.1 npm run dev
```

The same `HOST` and `PORT` settings apply to `npm run start`. For Tailscale Serve, start the app with `HOST=127.0.0.1`, then expose it:

```bash
tailscale serve localhost:3000
```

## Future Improvements

- Add import/export for source lists.
- Add a read-only preview of pending copy manifests.
- Capture and commit portfolio screenshots or GIFs.
- Add more granular retry controls per failed item.
- Package a single-command desktop build for non-technical users.
