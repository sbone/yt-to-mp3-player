# yt-to-audio sync app

Local, server-rendered TypeScript app that tracks YouTube channels and downloads new videos to MP3 using `yt-dlp`.

## Requirements

- Node.js 20+
- `yt-dlp` in PATH
- `ffmpeg` in PATH

## Setup

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Behavior

- Channels are read from `channels.txt`.
- Only videos with `upload_date >= 2026-01-01` are eligible by default.
- Override cutoff with env var: `MIN_UPLOAD_DATE=YYYY-MM-DD`.
- Sync is manual from the UI (`Sync All Channels` or per-channel sync).
- Cookie/auth failures are tracked as `cookie_blocked` and listed on the dashboard.
- Use `Retry Cookie-Blocked` in the dashboard after fixing cookies/auth.
- State is stored in `data/app.db`.
- Logs are written to `data/logs/app.log`.
- Downloads go to `downloads/`.
- `data/archive.txt` is used with `--download-archive` to avoid duplicate downloads.

The first sync also tries to map existing MP3s by channel/title heuristics so old files can be recognized.

## Build for production

```bash
npm run build
npm run start
```

`build` compiles TypeScript and builds Tailwind CSS into `dist/public/app.css`.

## Tailscale

Keep app bound to localhost, then expose with:

```bash
tailscale serve localhost:3000
```
