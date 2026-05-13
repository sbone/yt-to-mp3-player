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
  nextItem: PendingExportItem | null;
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

function disconnectedStatus(mountPath: string | null, volumeName: string | null, reason: string): DeviceStatus {
  return {
    connected: false,
    writable: false,
    volumeName,
    mountPath,
    reason
  };
}

function connectedStatus(mountPath: string, volumeName: string): DeviceStatus {
  const writable = canWriteToVolume(mountPath);
  return {
    connected: true,
    writable,
    volumeName,
    mountPath,
    reason: writable ? null : `Device is mounted read-only: ${mountPath}`
  };
}

export class DeviceSyncService {
  getStatus(): DeviceStatus {
    const configuredMountPath = config.deviceMountPath;
    if (configuredMountPath) {
      const configuredVolumeName = basename(configuredMountPath);
      if (!existsSync(configuredMountPath)) {
        return disconnectedStatus(
          configuredMountPath,
          configuredVolumeName,
          `Configured device mount path not found: ${configuredMountPath}`
        );
      }

      if (!isLikelyPlayerVolume(configuredMountPath)) {
        return disconnectedStatus(
          configuredMountPath,
          configuredVolumeName,
          `Configured device mount path exists but player libraries were not found: ${configuredMountPath}`
        );
      }

      return connectedStatus(configuredMountPath, configuredVolumeName);
    }

    const volumesRoot = "/Volumes";
    const entries = readdirSync(volumesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const volumeEntries = entries.map((entry) => ({
      volumeName: entry.name,
      mountPath: join(volumesRoot, entry.name)
    }));
    const candidates = volumeEntries.filter((entry) => isLikelyPlayerVolume(entry.mountPath));
    const preferredByName = volumeEntries.find((entry) => entry.volumeName === config.deviceVolumeName) ?? null;
    const preferred = candidates.find((entry) => entry.volumeName === config.deviceVolumeName) ?? candidates[0] ?? null;
    if (!preferred) {
      if (preferredByName) {
        return disconnectedStatus(
          preferredByName.mountPath,
          preferredByName.volumeName,
          `Mounted volume ${preferredByName.volumeName} was found, but player libraries are missing`
        );
      }

      return disconnectedStatus(null, config.deviceVolumeName, `No mounted player volume found in ${volumesRoot}`);
    }

    return connectedStatus(preferred.mountPath, preferred.volumeName);
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

    const emitProgress = (
      event: DeviceSyncProgressSnapshot["event"],
      currentItem: PendingExportItem | null,
      nextItem: PendingExportItem | null
    ): void => {
      onProgress?.({
        total: items.length,
        processed:
          outcome.copied.length + outcome.alreadyPresent.length + outcome.missingSource.length + outcome.failed.length,
        copied: outcome.copied.length + outcome.alreadyPresent.length,
        failed: outcome.failed.length,
        remaining:
          items.length - (outcome.copied.length + outcome.alreadyPresent.length + outcome.missingSource.length + outcome.failed.length),
        currentItem,
        nextItem,
        event
      });
    };

    for (const [index, item] of items.entries()) {
      const nextItem = items[index + 1] ?? null;
      if (!existsSync(item.local_path)) {
        outcome.missingSource.push(item);
        emitProgress("missing-source", item, nextItem);
        continue;
      }

      const targetDirName = basename(dirname(item.local_path));
      const targetDir = join(device.mountPath, targetDirName);
      const targetPath = join(targetDir, basename(item.local_path));
      const tempTargetPath = `${targetPath}.part`;

      try {
        mkdirSync(targetDir, { recursive: true });
        emitProgress("copying", item, nextItem);
        if (existsSync(targetPath)) {
          const sourceSize = statSync(item.local_path).size;
          const targetSize = statSync(targetPath).size;
          if (sourceSize === targetSize) {
            outcome.alreadyPresent.push(item);
            emitProgress("already-present", item, nextItem);
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
        emitProgress("copied", item, nextItem);
      } catch (error) {
        rmSync(tempTargetPath, { force: true });
        outcome.failed.push({
          item,
          message: error instanceof Error ? error.message : String(error)
        });
        emitProgress("failed", item, nextItem);
      }
    }

    return outcome;
  }
}
