# yt-to-audio sync app

Local TypeScript app with an Express API and React SPA that tracks YouTube channels and downloads new videos to MP3 using `yt-dlp`.

## Requirements

- Node.js 20+
- `yt-dlp` in PATH
- `ffmpeg` in PATH

## Setup

```bash
/opt/homebrew/bin/asdf exec npm ci
./scripts/dev.sh
```

Open `http://127.0.0.1:3000`.

Development notes:

- `./scripts/dev.sh` starts both the backend on port `3000` and the Vite client on port `5173`.
- If you want to run them separately, use `npm run dev:server` and `npm run dev:client`.

Quick checks:

```bash
./scripts/doctor.sh
./scripts/check.sh
./scripts/reconcile-device.sh
```

## Behavior

- Sources are read from `channels.txt`.
- Each line in `channels.txt` can be a channel handle like `Haminations`, an `@handle`, a channel URL, or a specific playlist URL.
- Sync is manual from the UI (`Sync All Channels` or per-channel sync).
- `Sync All Channels` is the prefetch path. It downloads/transcodes new items even if the player is not connected.
- `Sync + Export To Player` is device-first. It only starts when the player is connected and writable, then syncs, reconciles tracks already on the player, and copies any remaining pending tracks.
- Cookie/auth failures are tracked as `cookie_blocked` and listed on the dashboard.
- Use `Retry Cookie-Blocked` in the dashboard after fixing cookies/auth.
- Manual device workflow:
  - Dashboard shows a `Pending Export Queue` (downloaded but not yet exported tracks).
  - If your player is mounted on macOS, `Copy Pending To Player` copies queued MP3s onto the device automatically.
- The app preserves the source folder name on-device (for example `downloads/Wiztale/...` goes to `/Volumes/<device>/Wiztale/...`).
- Existing files already present on the device are treated as exported so they leave the queue.
- `./scripts/reconcile-device.sh` scans the mounted player and reports which pending tracks are already present.
- `./scripts/reconcile-device.sh --apply` marks only high-confidence matches as exported without copying or deleting device files.
- State is stored in `data/app.db`.
- Logs are written to `data/logs/app.log`.
- Downloads go to `downloads/`.
- `data/archive.txt` is used with `--download-archive` to avoid duplicate downloads.

## Device detection

- By default the app looks for a mounted volume named `AGP-A02T`.
- If that does not match your player, set `DEVICE_VOLUME_NAME=YourVolumeName`.
- To bypass auto-detection entirely, set `DEVICE_MOUNT_PATH=/Volumes/YourVolumeName`.

The first sync also tries to map existing MP3s by channel/title heuristics so old files can be recognized.

## Build for production

```bash
./scripts/build.sh
./scripts/start.sh
```

`build` compiles the backend with TypeScript and builds the React client into `dist/public`.

## Runtime note

- This repo is pinned to `nodejs 22.14.0` in `.tool-versions`.
- On this Mac, `/opt/homebrew/bin/node` is newer and can break the native `better-sqlite3` binding.
- If that happens after reinstalling dependencies, run `./scripts/rebuild-native.sh`.

## Tailscale

Keep app bound to localhost, then expose with:

```bash
tailscale serve localhost:3000
```
