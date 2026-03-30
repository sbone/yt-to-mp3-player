import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const dataDir = resolve(rootDir, "data");
const logsDir = resolve(dataDir, "logs");
const downloadsDir = resolve(rootDir, "downloads");

mkdirSync(dataDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
mkdirSync(downloadsDir, { recursive: true });

export const config = {
  rootDir,
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  deviceMountPath: process.env.DEVICE_MOUNT_PATH?.trim() || null,
  deviceVolumeName: process.env.DEVICE_VOLUME_NAME?.trim() || "AGP-A02T",
  channelListPath: resolve(rootDir, "channels.txt"),
  dbPath: resolve(dataDir, "app.db"),
  archivePath: resolve(dataDir, "archive.txt"),
  downloadsDir,
  logsDir,
  logPath: resolve(logsDir, "app.log")
};
