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

function runCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
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

function cutoffForYtDlp(minUploadDate: string): string {
  return minUploadDate.replaceAll("-", "");
}

export async function discoverChannel(channelUrl: string, minUploadDate: string): Promise<DiscoveredVideo[]> {
  const { stdout } = await runCommand([
    "--flat-playlist",
    "--dateafter",
    cutoffForYtDlp(minUploadDate),
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
  if (lower.includes("does not pass filter")) {
    return "Skipped by yt-dlp filter (likely upload date cutoff).";
  }
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

export async function downloadVideo(videoId: string): Promise<DownloadOutcome> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outTemplate = `${config.downloadsDir}/%(channel)s/%(upload_date>%Y-%m-%d)s - %(title)s [%(id)s].%(ext)s`;
  const args = [
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--embed-thumbnail",
    "--add-metadata",
    "--postprocessor-args",
    "ffmpeg:-id3v2_version 3",
    "--download-archive",
    config.archivePath,
    "--dateafter",
    cutoffForYtDlp(config.minUploadDate),
    "--write-info-json",
    "--print",
    "after_move:filepath",
    "-o",
    outTemplate,
    url
  ];

  const { stdout, stderr } = await runCommand(args);
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
