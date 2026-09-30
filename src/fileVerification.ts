import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";

function digest(path: string): string {
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytes: number;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

export function filesMatch(source: string, target: string): boolean {
  const size = statSync(source).size;
  return size > 0 && size === statSync(target).size && digest(source) === digest(target);
}
