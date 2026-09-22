# yt-to-audio sync app

Local TypeScript app with an Express API and React SPA. It tracks YouTube channels and playlists with `yt-dlp`, downloads new videos as MP3s, and syncs them to a basic USB MP3 player.

## Screenshot

<img width="2880" height="1750" alt="updated ui" src="https://github.com/user-attachments/assets/b31d91ec-adf8-42a3-bde3-1d41794d73db" />

## Requirements

- Node.js 22.14.0 (includes npm 10.9.2), pinned in `.tool-versions`
- Deno 2.6.3, pinned in `.tool-versions`, for yt-dlp's YouTube JavaScript challenges
- `yt-dlp` and `ffmpeg` in `PATH` (installed with Homebrew on macOS)

## Setup

On macOS, install the tools and register the asdf plugins (once per machine):

```bash
brew bundle
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add deno https://github.com/asdf-community/asdf-deno.git
```

Skip `plugin add` for plugins already listed by `asdf plugin list`.
Add this line to the end of `~/.zshrc`, after any Homebrew/PATH setup:

```bash
export PATH="${ASDF_DATA_DIR:-$HOME/.asdf}/shims:$PATH"
```

Then, from this repository:

```bash
source ~/.zshrc
asdf install
npm ci
./scripts/doctor.sh
npm run dev
```

If `npm install` reports `EBADENGINE` with Node 24, the shell is bypassing
asdf's shims. Fix the PATH line above and open a new terminal or source
`~/.zshrc` before retrying. Keep `engine-strict` enabled.

Homebrew manages yt-dlp and FFmpeg, including FFmpeg's MP3 support. Their
versions are intentionally not pinned because yt-dlp must keep pace with
YouTube changes. Run `brew upgrade yt-dlp` if extraction starts failing, or
`brew upgrade ffmpeg` if audio conversion starts failing.

Deno is separate from the Node runtime used by the app. yt-dlp recommends
Deno and enables it by default for YouTube's JavaScript challenges; keep the
pinned Deno executable available in `PATH`.

Open `http://127.0.0.1:3000`.

`./scripts/dev.sh` starts:
- the backend on `3000`
- the Vite client on `5173`

Run them separately if needed:

```bash
npm run dev:server
npm run dev:client
```

## Quick checks

```bash
./scripts/doctor.sh
./scripts/check.sh
./scripts/reconcile-device.sh
```

`doctor.sh` verifies the pinned Node and Deno versions, yt-dlp, FFmpeg, and
the native `better-sqlite3` binding.

## Content sources

- Sources come from `channels.txt`.
- Each line can be:
  - a channel handle (case-insensitive)
  - an `@handle`
  - a channel URL
  - a playlist URL

## Main workflow

- `Refresh Library` checks tracked sources and downloads new items.
- `Sync Player` copies downloaded MP3s to the mounted player.
- `Refresh Library + Sync Player` does both.
- Existing files already on the player are treated as exported.
- If files were manually deleted from the player, the next player sync re-queues and recopies them.
- Cookie/auth failures are tracked as `cookie_blocked`. Use `Cookie/Auth Recovery` after fixing auth.

## Device sync notes

- By default the app looks for a mounted volume named `AGP-A02T`.
- Override with `DEVICE_VOLUME_NAME=YourVolumeName`.
- Or bypass detection with `DEVICE_MOUNT_PATH=/Volumes/YourVolumeName`.
- The app preserves source folders on-device. Example:
  - `downloads/Wiztale/...`
  - `/Volumes/<device>/Wiztale/...`
- `./scripts/reconcile-device.sh` reports pending tracks already present on the player.
- `./scripts/reconcile-device.sh --apply` marks high-confidence matches as exported without copying or deleting files.

## State and files

- App DB: `data/app.db`
- Download archive: `data/archive.txt`
- Logs: `data/logs/app.log`
- Downloads: `downloads/`

On startup, any interrupted sync runs still marked `running` are reconciled to failed.

## Production build

```bash
./scripts/build.sh
./scripts/start.sh
```

This builds the backend into `dist/` and the client into `dist/public`.

## Runtime note

- `.tool-versions` pins Node and Deno; the scripts use those tools from `PATH`,
  and CI reads the same Node pin.
- npm comes with Node; application dependencies are pinned in `package-lock.json`.
- Mismatched Node versions can break the native `better-sqlite3` binding.
- If that happens after reinstalling dependencies, run `./scripts/rebuild-native.sh`.

## Tailscale

Keep the app bound to localhost, then expose it with:

```bash
tailscale serve localhost:3000
```
