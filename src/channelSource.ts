import { readFileSync } from "node:fs";
import { config } from "./config.js";

export interface ChannelSourceEntry {
  key: string;
  url: string;
}

function extractSource(raw: string): ChannelSourceEntry | null {
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

export function channelUrlForHandle(handle: string): string {
  return `https://www.youtube.com/@${encodeURIComponent(handle)}/videos`;
}
