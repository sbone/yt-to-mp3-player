import {
  accessSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  constants as fsConstants
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";

export interface PendingExportItem {
  id: number;
  title: string;
  local_path: string;
  downloaded_at: string | null;
  channel_handle: string | null;
}

export interface DeviceStatus {
  connected: boolean;
  writable: boolean;
  volumeName: string | null;
  mountPath: string | null;
  reason: string | null;
}

export interface DeviceSyncOutcome {
  device: DeviceStatus;
  copied: PendingExportItem[];
  alreadyPresent: PendingExportItem[];
  missingSource: PendingExportItem[];
  failed: Array<{ item: PendingExportItem; message: string }>;
}

export interface DeviceSyncProgressSnapshot {
  total: number;
  processed: number;
  copied: number;
  failed: number;
  remaining: number;
  currentItem: PendingExportItem | null;
  event: "copying" | "copied" | "already-present" | "missing-source" | "failed";
}

function isLikelyPlayerVolume(mountPath: string): boolean {
  return existsSync(join(mountPath, "MUSIC.LIB")) && existsSync(join(mountPath, "AUDIBLE.LIB"));
}

function canWriteToVolume(mountPath: string): boolean {
  try {
    accessSync(mountPath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export class DeviceSyncService {
  getStatus(): DeviceStatus {
    const configuredMountPath = config.deviceMountPath;
    if (configuredMountPath) {
      if (existsSync(configuredMountPath)) {
        return {
          connected: true,
          writable: canWriteToVolume(configuredMountPath),
          volumeName: basename(configuredMountPath),
          mountPath: configuredMountPath,
          reason: canWriteToVolume(configuredMountPath) ? null : `Device is mounted read-only: ${configuredMountPath}`
        };
      }
      return {
        connected: false,
        writable: false,
        volumeName: basename(configuredMountPath),
        mountPath: configuredMountPath,
        reason: `Configured device mount path not found: ${configuredMountPath}`
      };
    }

    const volumesRoot = "/Volumes";
    const entries = readdirSync(volumesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const candidates = entries
      .map((entry) => ({
        volumeName: entry.name,
        mountPath: join(volumesRoot, entry.name)
      }))
      .filter((entry) => isLikelyPlayerVolume(entry.mountPath));

    const preferred = candidates.find((entry) => entry.volumeName === config.deviceVolumeName) ?? candidates[0];
    if (!preferred) {
      return {
        connected: false,
        writable: false,
        volumeName: config.deviceVolumeName,
        mountPath: null,
        reason: `No mounted player volume found in ${volumesRoot}`
      };
    }

    const writable = canWriteToVolume(preferred.mountPath);
    return {
      connected: true,
      writable,
      volumeName: preferred.volumeName,
      mountPath: preferred.mountPath,
      reason: writable ? null : `Device is mounted read-only: ${preferred.mountPath}`
    };
  }

  async syncPending(
    items: PendingExportItem[],
    onProgress?: (snapshot: DeviceSyncProgressSnapshot) => void
  ): Promise<DeviceSyncOutcome> {
    const device = this.getStatus();
    const outcome: DeviceSyncOutcome = {
      device,
      copied: [],
      alreadyPresent: [],
      missingSource: [],
      failed: []
    };

    if (!device.connected || !device.mountPath || !device.writable) {
      return outcome;
    }

    const emitProgress = (event: DeviceSyncProgressSnapshot["event"], currentItem: PendingExportItem | null): void => {
      onProgress?.({
        total: items.length,
        processed:
          outcome.copied.length + outcome.alreadyPresent.length + outcome.missingSource.length + outcome.failed.length,
        copied: outcome.copied.length + outcome.alreadyPresent.length,
        failed: outcome.failed.length,
        remaining:
          items.length - (outcome.copied.length + outcome.alreadyPresent.length + outcome.missingSource.length + outcome.failed.length),
        currentItem,
        event
      });
    };

    for (const item of items) {
      if (!existsSync(item.local_path)) {
        outcome.missingSource.push(item);
        emitProgress("missing-source", item);
        continue;
      }

      const targetDirName = basename(dirname(item.local_path));
      const targetDir = join(device.mountPath, targetDirName);
      const targetPath = join(targetDir, basename(item.local_path));
      const tempTargetPath = `${targetPath}.part`;

      try {
        mkdirSync(targetDir, { recursive: true });
        emitProgress("copying", item);
        if (existsSync(targetPath)) {
          const sourceSize = statSync(item.local_path).size;
          const targetSize = statSync(targetPath).size;
          if (sourceSize === targetSize) {
            outcome.alreadyPresent.push(item);
            emitProgress("already-present", item);
            continue;
          }
        }
        rmSync(tempTargetPath, { force: true });
        await pipeline(createReadStream(item.local_path), createWriteStream(tempTargetPath));
        const sourceSize = statSync(item.local_path).size;
        const copiedSize = statSync(tempTargetPath).size;
        if (sourceSize !== copiedSize) {
          throw new Error(`Copied file size mismatch: source=${sourceSize} target=${copiedSize}`);
        }
        renameSync(tempTargetPath, targetPath);
        outcome.copied.push(item);
        emitProgress("copied", item);
      } catch (error) {
        rmSync(tempTargetPath, { force: true });
        outcome.failed.push({
          item,
          message: error instanceof Error ? error.message : String(error)
        });
        emitProgress("failed", item);
      }
    }

    return outcome;
  }
}
