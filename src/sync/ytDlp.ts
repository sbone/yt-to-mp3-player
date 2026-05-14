import { statSync } from "node:fs";
import { spawn } from "node:child_process";
import { config } from "../config.js";
import type { DiscoveredVideo } from "../types.js";

const COOKIE_ERROR_PATTERNS = [
  /use --cookies-from-browser or --cookies/i,
  /sign in to confirm your age/i,
  /authentication required/i,
  /log in to/i,
  /confirm you're not a bot/i,
  /this video may be inappropriate for some users/i,
  /members-only content/i,
  /join this channel/i
];

function parseSizeToBytes(raw: string): number | null {
  const match = raw.trim().match(/^([\d.]+)\s*([KMGTPE]?)(i)?B$/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  const unit = `${match[2] ?? ""}${match[3] ?? ""}`.toLowerCase();
  const scale =
    unit === ""
      ? 1
      : unit === "ki"
        ? 1024
        : unit === "mi"
          ? 1024 ** 2
          : unit === "gi"
            ? 1024 ** 3
            : unit === "ti"
              ? 1024 ** 4
              : unit === "pi"
                ? 1024 ** 5
                : unit === "ei"
                  ? 1024 ** 6
                  : null;
  return scale === null ? null : Math.round(value * scale);
}

export interface DownloadProgress {
  phase: "downloading" | "postprocessing";
  percent: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speed: string | null;
  eta: string | null;
  rawLine: string;
}

function parseDownloadProgress(line: string): DownloadProgress | null {
  const downloadMatch = line.match(
    /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~?\s*[0-9.]+\s*[KMGTPE]?i?B)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([0-9:]+))?/i
  );
  if (downloadMatch) {
    const totalBytes = parseSizeToBytes(downloadMatch[2]!.replace(/^~\s*/, ""));
    const percent = Number(downloadMatch[1]);
    const downloadedBytes =
      totalBytes !== null && Number.isFinite(percent) ? Math.round(totalBytes * (percent / 100)) : null;
    return {
      phase: "downloading",
      percent: Number.isFinite(percent) ? percent : null,
      downloadedBytes,
      totalBytes,
      speed: downloadMatch[3] ?? null,
      eta: downloadMatch[4] ?? null,
      rawLine: line
    };
  }

  if (/^\[ffmpeg\]\s/i.test(line) || /^\[ExtractAudio\]\s/i.test(line)) {
    return {
      phase: "postprocessing",
      percent: null,
      downloadedBytes: null,
      totalBytes: null,
      speed: null,
      eta: null,
      rawLine: line
    };
  }

  return null;
}

function runCommand(
  args: string[],
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const flushLines = (buffer: string, sink: (line: string) => void): string => {
      const normalized = buffer.replace(/\r/g, "\n");
      const parts = normalized.split("\n");
      const remainder = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (line) {
          sink(line);
        }
      }
      return remainder;
    };

    const handleLine = (line: string): void => {
      const progress = parseDownloadProgress(line);
      if (progress) {
        onProgress?.(progress);
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      stdoutBuffer = flushLines(stdoutBuffer, handleLine);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      stderrBuffer = flushLines(stderrBuffer, handleLine);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`yt-dlp exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

interface ChannelJsonEntry {
  id?: string;
  title?: string;
  channel?: string;
  upload_date?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  url?: string;
}

interface ChannelJsonResponse {
  entries?: ChannelJsonEntry[];
}

export async function discoverChannel(channelUrl: string): Promise<DiscoveredVideo[]> {
  const { stdout } = await runCommand([
    "--flat-playlist",
    "--dump-single-json",
    channelUrl
  ]);
  const parsed = JSON.parse(stdout) as ChannelJsonResponse;
  const entries = parsed.entries ?? [];

  return entries
    .map((entry): DiscoveredVideo | null => {
      const id = entry.id?.trim();
      const title = entry.title?.trim();
      if (!id || !title) {
        return null;
      }

      const uploadDate = entry.upload_date
        ? `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`
        : null;

      return {
        youtubeVideoId: id,
        channelName: entry.channel ?? null,
        title,
        uploadDate,
        durationSeconds: entry.duration ?? null,
        webpageUrl: entry.webpage_url ?? `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl: entry.thumbnail ?? null
      };
    })
    .filter((video): video is DiscoveredVideo => video !== null);
}

function inferSkipReason(output: string): string {
  const lower = output.toLowerCase();
  if (lower.includes("has already been downloaded")) {
    return "Skipped by yt-dlp archive (already downloaded).";
  }
  if (lower.includes("already exists")) {
    return "Skipped because output file already exists.";
  }
  return "yt-dlp completed without producing an MP3 output path.";
}

export type DownloadOutcome =
  | { status: "downloaded"; localPath: string; fileSize: number }
  | { status: "skipped"; reason: string };

export async function downloadVideo(
  videoId: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadOutcome> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outTemplate = `${config.downloadsDir}/%(channel)s/%(upload_date>%Y-%m-%d)s - %(title)s [%(id)s].%(ext)s`;
  const args = [
    "-x",
    "--newline",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "128K",
    "--embed-thumbnail",
    "--add-metadata",
    "--postprocessor-args",
    "ffmpeg:-id3v2_version 3",
    "--download-archive",
    config.archivePath,
    "--write-info-json",
    "--print",
    "after_move:filepath",
    "-o",
    outTemplate,
    url
  ];

  const { stdout, stderr } = await runCommand(args, onProgress);
  const combined = `${stdout}\n${stderr}`;

  const candidate = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.endsWith(".mp3") && line.includes(config.downloadsDir));

  if (!candidate) {
    return { status: "skipped", reason: inferSkipReason(combined) };
  }

  const marker = "Destination:";
  const markerIndex = candidate.indexOf(marker);
  const localPath = markerIndex === -1 ? candidate : candidate.slice(markerIndex + marker.length).trim();
  const fileSize = statSync(localPath).size;
  return { status: "downloaded", localPath, fileSize };
}

export function isCookieAuthError(message: string): boolean {
  return COOKIE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
