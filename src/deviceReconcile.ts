import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { filesMatch } from "./fileVerification.js";
import type { PendingExportItem } from "./types.js";

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

async function walkAudioFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkAudioFiles(fullPath));
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

export async function reconcilePendingAgainstDevice(pending: PendingExportItem[], mountPath: string): Promise<DeviceReconcileReport> {
  const deviceFiles = await walkAudioFiles(mountPath);
  const exactByBaseName = new Map<string, string[]>();
  for (const path of deviceFiles) {
    const key = basename(path);
    exactByBaseName.set(key, [...(exactByBaseName.get(key) ?? []), path]);
  }
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
    const exactCandidates = exactByBaseName.get(baseName) ?? [];
    const related = exactCandidates.filter((path) => basename(dirname(path)) === basename(dirname(item.local_path)));
    const candidatesByName = related.length > 0 ? related : exactCandidates;
    const exactPath = candidatesByName.length === 1 ? candidatesByName[0] : undefined;
    const exactSize = exactPath ? (await stat(exactPath)).size : 0;
    let verified = false;
    if (exactPath) {
      try {
        verified = await filesMatch(item.local_path, exactPath);
      } catch {
        verified = exactSize > 0 && (item.file_size_bytes == null || exactSize === item.file_size_bytes);
      }
    }
    if (exactPath && verified) {
      exactMatches.push({ item, devicePath: exactPath, matchType: "exact" });
      continue;
    }

    if (exactCandidates.length > 0) {
      if (candidatesByName.length > 1) {
        ambiguous.push({ item, candidateDevicePaths: candidatesByName });
      } else {
        unmatched.push({ item, normalizedName: normalizeName(baseName) });
      }
      continue;
    }

    const normalizedName = normalizeName(baseName);
    const candidates = normalizedIndex.get(normalizedName) ?? [];
    const relatedFolderCandidates = candidates.filter((candidate) => folderLooksRelated(candidate, item.local_path));
    const preferredCandidates = relatedFolderCandidates.length > 0 ? relatedFolderCandidates : candidates;

    if (preferredCandidates.length === 1) {
      normalizedMatches.push({
        item,
        devicePath: preferredCandidates[0]!,
        matchType: "normalized"
      });
      continue;
    }

    if (preferredCandidates.length > 1) {
      ambiguous.push({
        item,
        candidateDevicePaths: preferredCandidates
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
