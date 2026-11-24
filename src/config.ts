import { mkdirSync, rmSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const rootDir = process.cwd();
const mode: "normal" | "demo" = process.env.DEMO_MODE === "1" ? "demo" : "normal";
const selectedLibrary = mode === "normal" ? process.env.MP3_STATE_DIR : undefined;
const stateRoot = selectedLibrary || rootDir;
if (selectedLibrary && (!isAbsolute(stateRoot) ||
    !["channels.txt", "data/app.db"].every(name => statSync(resolve(stateRoot, name), { throwIfNoEntry: false })?.isFile()) ||
    !statSync(resolve(stateRoot, "downloads"), { throwIfNoEntry: false })?.isDirectory())) {
  throw new Error("MP3_STATE_DIR must be an absolute path to a restored library containing channels.txt, data/app.db and downloads/.");
}
const dataDir = mode === "demo" ? resolve(rootDir, "data/demo") : resolve(stateRoot, "data");
const logsDir = resolve(dataDir, "logs");
const downloadsDir = mode === "demo" ? resolve(dataDir, "downloads") : resolve(stateRoot, "downloads");
const demoPlayerDir = resolve(dataDir, "player");

if (mode === "demo" && process.env.DEMO_RESET === "1") {
  rmSync(dataDir, { recursive: true, force: true });
}

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
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  deviceMountPath: process.env.DEVICE_MOUNT_PATH?.trim() || (mode === "demo" ? demoPlayerDir : null),
  deviceVolumeName: process.env.DEVICE_VOLUME_NAME?.trim() || "AGP-A02T",
  channelListPath: mode === "demo" ? resolve(dataDir, "sources.txt") : resolve(stateRoot, "channels.txt"),
  dbPath: resolve(dataDir, "app.db"),
  downloadsDir,
  demoPlayerDir,
  logsDir,
  logPath: resolve(logsDir, "app.log")
};
