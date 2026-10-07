import {
  createReadStream,
  createWriteStream,
  constants as fsConstants
} from "node:fs";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { filesMatch } from "./fileVerification.js";
import { config } from "./config.js";
import type { DeviceStatus, PendingExportItem } from "./types.js";

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
  currentItemBytesCopied: number;
  currentItemBytesTotal: number | null;
  event: "copying" | "copied" | "already-present" | "missing-source" | "failed";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isLikelyPlayerVolume(mountPath: string): Promise<boolean> {
  return (await pathExists(join(mountPath, "MUSIC.LIB"))) && (await pathExists(join(mountPath, "AUDIBLE.LIB")));
}

async function canWriteToVolume(mountPath: string): Promise<boolean> {
  try {
    await access(mountPath, fsConstants.W_OK);
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

async function connectedStatus(mountPath: string, volumeName: string): Promise<DeviceStatus> {
  const writable = await canWriteToVolume(mountPath);
  return {
    connected: true,
    writable,
    volumeName,
    mountPath,
    reason: writable ? null : `Device is mounted read-only: ${mountPath}`
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class DeviceSyncService {
  async getStatus(): Promise<DeviceStatus> {
    const fallback = disconnectedStatus(config.deviceMountPath, config.deviceVolumeName, "Device probe timed out or failed");
    return Promise.race([
      this.probeStatus().catch(() => fallback),
      new Promise<DeviceStatus>((resolve) => setTimeout(() => resolve(fallback), 2000))
    ]);
  }

  private async probeStatus(): Promise<DeviceStatus> {
    const configuredMountPath = config.deviceMountPath;
    if (configuredMountPath) {
      const configuredVolumeName = basename(configuredMountPath);
      if (!(await pathExists(configuredMountPath))) {
        return disconnectedStatus(
          configuredMountPath,
          configuredVolumeName,
          `Configured device mount path not found: ${configuredMountPath}`
        );
      }

      if (!(await isLikelyPlayerVolume(configuredMountPath))) {
        return disconnectedStatus(
          configuredMountPath,
          configuredVolumeName,
          `Configured device mount path exists but player libraries were not found: ${configuredMountPath}`
        );
      }

      return connectedStatus(configuredMountPath, configuredVolumeName);
    }

    const volumesRoot = "/Volumes";
    const entries = (await readdir(volumesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    const volumeEntries = entries.map((entry) => ({
      volumeName: entry.name,
      mountPath: join(volumesRoot, entry.name)
    }));
    const candidates = [];
    for (const entry of volumeEntries) {
      if (await isLikelyPlayerVolume(entry.mountPath)) candidates.push(entry);
    }
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
    const device = await this.getStatus();
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
      nextItem: PendingExportItem | null,
      currentItemBytesCopied: number,
      currentItemBytesTotal: number | null
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
        currentItemBytesCopied,
        currentItemBytesTotal,
        event
      });
    };

    for (const [index, item] of items.entries()) {
      const nextItem = items[index + 1] ?? null;
      if (!(await pathExists(item.local_path))) {
        outcome.missingSource.push(item);
        emitProgress("missing-source", item, nextItem, 0, null);
        continue;
      }

      const targetDirName = basename(dirname(item.local_path));
      const targetDir = join(device.mountPath, targetDirName);
      const targetPath = join(targetDir, basename(item.local_path));
      const tempTargetPath = `${targetPath}.part`;

      try {
        await mkdir(targetDir, { recursive: true });
        const sourceSize = (await stat(item.local_path)).size;
        emitProgress("copying", item, nextItem, 0, sourceSize);
        if (config.isDemo) {
          for (const percent of [15, 34, 53, 72, 90]) {
            await sleep(140);
            emitProgress("copying", item, nextItem, Math.round(sourceSize * (percent / 100)), sourceSize);
          }
        }
        if (await pathExists(targetPath)) {
          const targetSize = (await stat(targetPath)).size;
          if (sourceSize === targetSize && await filesMatch(item.local_path, targetPath)) {
            if (config.isDemo) {
              await sleep(120);
            }
            outcome.alreadyPresent.push(item);
            emitProgress("already-present", item, nextItem, sourceSize, sourceSize);
            continue;
          }
        }
        await rm(tempTargetPath, { force: true });
        let copiedBytes = 0;
        const progressTap = new Transform({
          transform(chunk, _encoding, callback) {
            copiedBytes += chunk.length;
            emitProgress("copying", item, nextItem, copiedBytes, sourceSize);
            callback(null, chunk);
          }
        });
        await pipeline(createReadStream(item.local_path), progressTap, createWriteStream(tempTargetPath));
        const copiedSize = (await stat(tempTargetPath)).size;
        if (sourceSize !== copiedSize || !await filesMatch(item.local_path, tempTargetPath)) {
          throw new Error(`Copied file verification failed: source=${sourceSize} target=${copiedSize}`);
        }
        await rename(tempTargetPath, targetPath);
        outcome.copied.push(item);
        emitProgress("copied", item, nextItem, sourceSize, sourceSize);
      } catch (error) {
        await rm(tempTargetPath, { force: true });
        outcome.failed.push({
          item,
          message: error instanceof Error ? error.message : String(error)
        });
        emitProgress("failed", item, nextItem, 0, null);
      }
    }

    return outcome;
  }
}
