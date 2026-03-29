import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { PendingExportItem } from "./deviceSync.js";

export interface ReconcileMatch {
  item: PendingExportItem;
  devicePath: string;
  matchType: "exact" | "normalized";
}

export interface ReconcileAmbiguous {
  item: PendingExportItem;
  candidateDevicePaths: string[];
}

export interface ReconcileUnmatched {
  item: PendingExportItem;
  normalizedName: string;
}

export interface DeviceReconcileReport {
  scannedDeviceFiles: number;
  exactMatches: ReconcileMatch[];
  normalizedMatches: ReconcileMatch[];
  ambiguous: ReconcileAmbiguous[];
  unmatched: ReconcileUnmatched[];
}

function walkAudioFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkAudioFiles(fullPath));
      continue;
    }

    if (/\.(mp3|m4a|flac|wav)$/i.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/^\d{4}-\d{2}-\d{2}\s+-\s+/, " ")
    .replace(/^\d{8}\s+-\s+/, " ")
    .replace(/^\d+\s+-\s+/, " ")
    .replace(/\.[^.]+$/, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .replace(/\b(official|music|video|lyrics?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function folderLooksRelated(devicePath: string, localPath: string): boolean {
  const deviceFolder = basename(dirname(devicePath)).toLowerCase();
  const localFolder = basename(dirname(localPath)).toLowerCase();
  return deviceFolder.includes(localFolder) || localFolder.includes(deviceFolder);
}

export function reconcilePendingAgainstDevice(pending: PendingExportItem[], mountPath: string): DeviceReconcileReport {
  const deviceFiles = walkAudioFiles(mountPath);
  const exactByBaseName = new Map(deviceFiles.map((path) => [basename(path), path]));
  const normalizedIndex = new Map<string, string[]>();

  for (const path of deviceFiles) {
    const key = normalizeName(basename(path));
    const list = normalizedIndex.get(key) ?? [];
    list.push(path);
    normalizedIndex.set(key, list);
  }

  const exactMatches: ReconcileMatch[] = [];
  const normalizedMatches: ReconcileMatch[] = [];
  const ambiguous: ReconcileAmbiguous[] = [];
  const unmatched: ReconcileUnmatched[] = [];

  for (const item of pending) {
    const baseName = basename(item.local_path);
    const exactPath = exactByBaseName.get(baseName);
    if (exactPath) {
      exactMatches.push({ item, devicePath: exactPath, matchType: "exact" });
      continue;
    }

    const normalizedName = normalizeName(baseName);
    const candidates = normalizedIndex.get(normalizedName) ?? [];
    const relatedFolderCandidates = candidates.filter((candidate) => folderLooksRelated(candidate, item.local_path));

    if (relatedFolderCandidates.length === 1) {
      const candidate = relatedFolderCandidates[0]!;
      normalizedMatches.push({
        item,
        devicePath: candidate,
        matchType: "normalized"
      });
      continue;
    }

    if (relatedFolderCandidates.length > 1) {
      ambiguous.push({
        item,
        candidateDevicePaths: relatedFolderCandidates
      });
      continue;
    }

    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      normalizedMatches.push({
        item,
        devicePath: candidate,
        matchType: "normalized"
      });
      continue;
    }

    if (candidates.length > 1) {
      ambiguous.push({
        item,
        candidateDevicePaths: candidates
      });
      continue;
    }

    unmatched.push({
      item,
      normalizedName
    });
  }

  return {
    scannedDeviceFiles: deviceFiles.length,
    exactMatches,
    normalizedMatches,
    ambiguous,
    unmatched
  };
}
