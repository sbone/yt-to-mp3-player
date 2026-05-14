export type VideoStatus = "discovered" | "downloaded" | "failed" | "skipped" | "cookie_blocked";

export interface ChannelRecord {
  id: number;
  handle: string;
  url: string;
  active: number;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
}

export interface DiscoveredVideo {
  youtubeVideoId: string;
  channelName: string | null;
  title: string;
  uploadDate: string | null;
  durationSeconds: number | null;
  webpageUrl: string;
  thumbnailUrl: string | null;
}

export interface SyncCounters {
  discovered: number;
  downloaded: number;
  skipped: number;
  failed: number;
}

export interface RunSummary {
  id: number;
  started_at: string;
  finished_at: string | null;
  scope: string;
  status: string;
  notes: string | null;
  discovered_count: number;
  downloaded_count: number;
  skipped_count: number;
  failed_count: number;
  channel_handle: string | null;
}

export interface ChannelOverview {
  id: number;
  handle: string;
  url: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  known_videos: number;
  downloaded_videos: number;
  on_player_videos: number;
  local_only_videos: number;
  needs_sync_videos: number;
  failed_videos: number;
  cookie_blocked_videos: number;
  newest_upload: string | null;
}
