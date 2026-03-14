import { readFileSync } from "node:fs";
import { config } from "./config.js";

function extractHandle(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.startsWith("#")) {
    return null;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const atSegment = parts.find((part) => part.startsWith("@"));
    if (atSegment) {
      return atSegment.slice(1);
    }
    return parts[0] ?? null;
  }

  if (value.startsWith("@")) {
    return value.slice(1);
  }

  return value;
}

export function loadChannelHandles(): string[] {
  let text = "";
  try {
    text = readFileSync(config.channelListPath, "utf8");
  } catch {
    return [];
  }
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const handle = extractHandle(line);
    if (!handle) {
      continue;
    }
    seen.add(handle);
  }
  return [...seen];
}

export function channelUrlForHandle(handle: string): string {
  return `https://www.youtube.com/@${encodeURIComponent(handle)}/videos`;
}
