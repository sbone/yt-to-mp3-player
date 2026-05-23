import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const mode: "normal" | "demo" = process.env.DEMO_MODE === "1" ? "demo" : "normal";
const dataDir = mode === "demo" ? resolve(rootDir, "data/demo") : resolve(rootDir, "data");
const logsDir = resolve(dataDir, "logs");
const downloadsDir = mode === "demo" ? resolve(dataDir, "downloads") : resolve(rootDir, "downloads");
const demoPlayerDir = resolve(dataDir, "player");

mkdirSync(dataDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
mkdirSync(downloadsDir, { recursive: true });
if (mode === "demo") {
  mkdirSync(demoPlayerDir, { recursive: true });
  mkdirSync(resolve(demoPlayerDir, "MUSIC.LIB"), { recursive: true });
  mkdirSync(resolve(demoPlayerDir, "AUDIBLE.LIB"), { recursive: true });
}

export const config = {
  mode,
  isDemo: mode === "demo",
  rootDir,
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  deviceMountPath: process.env.DEVICE_MOUNT_PATH?.trim() || (mode === "demo" ? demoPlayerDir : null),
  deviceVolumeName: process.env.DEVICE_VOLUME_NAME?.trim() || "AGP-A02T",
  knownVideoStreakCutoff: Math.max(1, Number(process.env.KNOWN_VIDEO_STREAK_CUTOFF ?? 20)),
  channelListPath: mode === "demo" ? resolve(dataDir, "sources.txt") : resolve(rootDir, "channels.txt"),
  dbPath: resolve(dataDir, "app.db"),
  archivePath: resolve(dataDir, "archive.txt"),
  downloadsDir,
  demoPlayerDir,
  logsDir,
  logPath: resolve(logsDir, "app.log")
};
