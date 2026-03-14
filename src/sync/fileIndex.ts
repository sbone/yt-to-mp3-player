import { readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

interface IndexedFile {
  path: string;
  normalizedBasename: string;
  normalizedParent: string;
  size: number;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function walk(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".mp3") {
        out.push(fullPath);
      }
    }
  }
  return out;
}

export class ExistingDownloadIndex {
  private readonly files: IndexedFile[];

  constructor(downloadsDir: string) {
    this.files = walk(downloadsDir).map((path) => {
      const parent = basename(dirname(path));
      return {
        path,
        normalizedBasename: normalize(basename(path, extname(path))),
        normalizedParent: normalize(parent),
        size: statSync(path).size
      };
    });
  }

  findLikelyMatch(title: string, channelHints: string[]): { path: string; size: number } | null {
    const normalizedTitle = normalize(title);
    if (!normalizedTitle) {
      return null;
    }

    const normalizedHints = channelHints.map(normalize).filter(Boolean);
    const exact = this.files.find((file) => {
      if (!file.normalizedBasename.includes(normalizedTitle)) {
        return false;
      }
      if (normalizedHints.length === 0) {
        return true;
      }
      return normalizedHints.some((hint) => file.normalizedParent.includes(hint));
    });

    if (exact) {
      return { path: exact.path, size: exact.size };
    }

    // Fallback: title-only heuristic if channel folder names changed over time.
    const titleOnly = this.files.find((file) => file.normalizedBasename.includes(normalizedTitle));
    return titleOnly ? { path: titleOnly.path, size: titleOnly.size } : null;
  }
}
