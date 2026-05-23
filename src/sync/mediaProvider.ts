import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import type { DiscoveredVideo } from "../types.js";
import { discoverChannel, downloadVideo, isCookieAuthError, type DownloadProgress, type DownloadOutcome } from "./ytDlp.js";

export interface MediaProvider {
  discoverSource(sourceUrl: string, sourceKey: string): Promise<DiscoveredVideo[]>;
  downloadAudio(videoId: string, onProgress?: (progress: DownloadProgress) => void): Promise<DownloadOutcome>;
  isAuthError(message: string): boolean;
}

class RealMediaProvider implements MediaProvider {
  discoverSource(sourceUrl: string): Promise<DiscoveredVideo[]> {
    return discoverChannel(sourceUrl);
  }

  downloadAudio(videoId: string, onProgress?: (progress: DownloadProgress) => void): Promise<DownloadOutcome> {
    return downloadVideo(videoId, onProgress);
  }

  isAuthError(message: string): boolean {
    return isCookieAuthError(message);
  }
}

const demoLibrary: Record<string, DiscoveredVideo[]> = {
  "demo-field-notes": [
    {
      youtubeVideoId: "demo-field-001",
      channelName: "Field Notes Radio",
      title: "Field Notes 001 - Morning Walk",
      uploadDate: "2026-01-08",
      durationSeconds: 840,
      webpageUrl: "https://example.invalid/demo-field-001",
      thumbnailUrl: null
    },
    {
      youtubeVideoId: "demo-field-002",
      channelName: "Field Notes Radio",
      title: "Field Notes 002 - Train Window",
      uploadDate: "2026-01-15",
      durationSeconds: 1020,
      webpageUrl: "https://example.invalid/demo-field-002",
      thumbnailUrl: null
    }
  ],
  "demo-workshop": [
    {
      youtubeVideoId: "demo-workshop-001",
      channelName: "Workshop Talks",
      title: "Workshop Talk - Repair Before Replace",
      uploadDate: "2026-02-03",
      durationSeconds: 1370,
      webpageUrl: "https://example.invalid/demo-workshop-001",
      thumbnailUrl: null
    },
    {
      youtubeVideoId: "demo-workshop-002",
      channelName: "Workshop Talks",
      title: "Workshop Talk - Small Tools",
      uploadDate: "2026-02-10",
      durationSeconds: 1180,
      webpageUrl: "https://example.invalid/demo-workshop-002",
      thumbnailUrl: null
    }
  ]
};

function fallbackDemoVideo(sourceKey: string): DiscoveredVideo {
  const safeKey = sourceKey.replace(/[^a-z0-9._:-]+/gi, "-").slice(0, 48) || "source";
  return {
    youtubeVideoId: `demo-${safeKey}-001`,
    channelName: sourceKey,
    title: `Demo track from ${sourceKey}`,
    uploadDate: "2026-03-01",
    durationSeconds: 720,
    webpageUrl: `https://example.invalid/${encodeURIComponent(safeKey)}`,
    thumbnailUrl: null
  };
}

class DemoMediaProvider implements MediaProvider {
  async discoverSource(_sourceUrl: string, sourceKey: string): Promise<DiscoveredVideo[]> {
    return demoLibrary[sourceKey] ?? [fallbackDemoVideo(sourceKey)];
  }

  async downloadAudio(videoId: string, onProgress?: (progress: DownloadProgress) => void): Promise<DownloadOutcome> {
    const video = Object.values(demoLibrary).flat().find((item) => item.youtubeVideoId === videoId);
    const title = video?.title ?? `Demo track ${videoId}`;
    const channel = video?.channelName ?? "Demo Source";
    const date = video?.uploadDate ?? "2026-03-01";
    const path = `${config.downloadsDir}/${channel}/${date} - ${title} [${videoId}].mp3`;

    mkdirSync(dirname(path), { recursive: true });
    onProgress?.({
      phase: "downloading",
      percent: 35,
      downloadedBytes: 35_000,
      totalBytes: 100_000,
      speed: "demo",
      eta: "00:01",
      rawLine: "demo download 35%"
    });
    writeFileSync(path, `Demo MP3 placeholder for ${title}\n`, "utf8");
    onProgress?.({
      phase: "postprocessing",
      percent: 100,
      downloadedBytes: 100_000,
      totalBytes: 100_000,
      speed: "demo",
      eta: "00:00",
      rawLine: "demo postprocess complete"
    });

    return { status: "downloaded", localPath: path, fileSize: statSync(path).size };
  }

  isAuthError(message: string): boolean {
    return /auth|cookie|sign in/i.test(message);
  }
}

export function createMediaProvider(): MediaProvider {
  return config.isDemo ? new DemoMediaProvider() : new RealMediaProvider();
}
