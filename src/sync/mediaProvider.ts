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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function demoSourceLabel(sourceKey: string): string {
  if (sourceKey === "demo-field-notes") {
    return "Field Notes Radio";
  }
  if (sourceKey === "demo-workshop") {
    return "Workshop Talks";
  }
  if (sourceKey === "demo-recovery") {
    return "Recovery Lab";
  }
  return sourceKey;
}

function createDynamicDemoVideo(sourceKey: string, sequence: number): DiscoveredVideo {
  const safeKey = sourceKey.replace(/[^a-z0-9._:-]+/gi, "-").slice(0, 48) || "source";
  const timestamp = Date.now();
  return {
    youtubeVideoId: `demo-${safeKey}-live-${timestamp}-${sequence}`,
    channelName: demoSourceLabel(sourceKey),
    title: `Demo live item ${sequence} from ${demoSourceLabel(sourceKey)}`,
    uploadDate: "2026-03-15",
    durationSeconds: 900 + sequence,
    webpageUrl: `https://example.invalid/${encodeURIComponent(safeKey)}/live-${timestamp}-${sequence}`,
    thumbnailUrl: null
  };
}

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
  private readonly generatedVideos = new Map<string, DiscoveredVideo>();
  private sequence = 0;

  async discoverSource(_sourceUrl: string, sourceKey: string): Promise<DiscoveredVideo[]> {
    this.sequence += 1;
    const liveVideo = createDynamicDemoVideo(sourceKey, this.sequence);
    this.generatedVideos.set(liveVideo.youtubeVideoId, liveVideo);
    return [liveVideo, ...(demoLibrary[sourceKey] ?? [fallbackDemoVideo(sourceKey)])];
  }

  async downloadAudio(videoId: string, onProgress?: (progress: DownloadProgress) => void): Promise<DownloadOutcome> {
    const video = this.generatedVideos.get(videoId) ?? Object.values(demoLibrary).flat().find((item) => item.youtubeVideoId === videoId);
    const title = video?.title ?? `Demo track ${videoId}`;
    const channel = video?.channelName ?? "Demo Source";
    const date = video?.uploadDate ?? "2026-03-01";
    const path = `${config.downloadsDir}/${channel}/${date} - ${title} [${videoId}].mp3`;

    mkdirSync(dirname(path), { recursive: true });
    const totalBytes = 1_200_000;
    for (const percent of [10, 28, 46, 64, 82, 94]) {
      onProgress?.({
        phase: "downloading",
        percent,
        downloadedBytes: Math.round(totalBytes * (percent / 100)),
        totalBytes,
        speed: "demo 420 KiB/s",
        eta: `${Math.max(1, Math.ceil((100 - percent) / 22)).toString().padStart(2, "0")}s`,
        rawLine: `demo download ${percent}%`
      });
      await sleep(140);
    }
    writeFileSync(path, `Demo MP3 placeholder for ${title}\n`.repeat(32_000), "utf8");
    await sleep(160);
    onProgress?.({
      phase: "postprocessing",
      percent: 100,
      downloadedBytes: totalBytes,
      totalBytes,
      speed: "demo",
      eta: "00:00",
      rawLine: "demo postprocess complete"
    });
    await sleep(140);

    return { status: "downloaded", localPath: path, fileSize: statSync(path).size };
  }

  isAuthError(message: string): boolean {
    return /auth|cookie|sign in/i.test(message);
  }
}

export function createMediaProvider(): MediaProvider {
  return config.isDemo ? new DemoMediaProvider() : new RealMediaProvider();
}
