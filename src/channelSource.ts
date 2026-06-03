import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.js";

export interface ChannelSourceEntry {
  key: string;
  url: string;
}

export function extractSource(raw: string): ChannelSourceEntry | null {
  const value = raw.trim();
  if (!value || value.startsWith("#")) {
    return null;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    const playlistId = url.searchParams.get("list")?.trim();
    if (playlistId) {
      return {
        key: `playlist:${playlistId}`,
        url: value
      };
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const atSegment = parts.find((part) => part.startsWith("@"));
    if (atSegment) {
      const handle = atSegment.slice(1);
      return {
        key: handle,
        url: channelUrlForHandle(handle)
      };
    }

    const fallback = parts[0]?.trim();
    if (!fallback) {
      return null;
    }
    return {
      key: fallback,
      url: value
    };
  }

  if (value.startsWith("@")) {
    const handle = value.slice(1);
    return {
      key: handle,
      url: channelUrlForHandle(handle)
    };
  }

  return {
    key: value,
    url: channelUrlForHandle(value)
  };
}

export function loadChannelSources(): ChannelSourceEntry[] {
  let text = "";
  try {
    text = readFileSync(config.channelListPath, "utf8");
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const entries: ChannelSourceEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const source = extractSource(line);
    if (!source) {
      continue;
    }
    if (seen.has(source.key)) {
      continue;
    }
    seen.add(source.key);
    entries.push(source);
  }
  return entries;
}

export function saveChannelSources(entries: ChannelSourceEntry[]): void {
  const body = entries.map((entry) => entry.url).join("\n");
  writeFileSync(config.channelListPath, body ? `${body}\n` : "", "utf8");
}

export function addChannelSource(raw: string): ChannelSourceEntry {
  const source = extractSource(raw);
  if (!source) {
    throw new Error("Enter a source handle, channel URL, or playlist URL.");
  }

  const existing = loadChannelSources();
  if (existing.some((entry) => entry.key === source.key)) {
    return source;
  }

  appendFileSync(config.channelListPath, `${source.url}\n`, "utf8");
  return source;
}

export function removeChannelSource(key: string): ChannelSourceEntry {
  const sourceKey = key.trim();
  if (!sourceKey) {
    throw new Error("Choose a source to remove.");
  }

  const existing = loadChannelSources();
  const source = existing.find((entry) => entry.key === sourceKey);
  if (!source) {
    throw new Error("Source is not tracked.");
  }

  saveChannelSources(existing.filter((entry) => entry.key !== sourceKey));
  return source;
}

export function channelUrlForHandle(handle: string): string {
  return `https://www.youtube.com/@${encodeURIComponent(handle)}/videos`;
}
