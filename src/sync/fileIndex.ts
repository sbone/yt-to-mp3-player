import { readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

interface IndexedFile {
  path: string;
  size: number;
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
      return {
        path,
        size: statSync(path).size
      };
    });
  }

  findByVideoId(videoId: string): { path: string; size: number } | null {
    const matches = this.files.filter((file) => basename(file.path).includes(`[${videoId}].mp3`) && file.size > 0);
    const match = matches.length === 1 ? matches[0] : null;
    return match ? { path: match.path, size: match.size } : null;
  }
}
