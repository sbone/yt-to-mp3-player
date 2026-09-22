export type VideoStatus = "discovered" | "downloaded" | "failed" | "skipped" | "cookie_blocked";

export interface VideoRecord {
  id: number;
  youtube_video_id: string;
  title: string;
  upload_date: string | null;
  status: VideoStatus;
  local_path: string | null;
  failure_message: string | null;
  downloaded_at: string | null;
  exported_at: string | null;
  last_seen_at: string;
}

export interface DeviceSyncRecord {
  id: number;
  created_at: string;
  note: string | null;
  item_count: number;
}

export interface DeviceStatus {
  connected: boolean;
  writable: boolean;
  volumeName: string | null;
  mountPath: string | null;
  reason: string | null;
}

export interface PendingExportItem {
  id: number;
  title: string;
  local_path: string;
  downloaded_at: string | null;
  channel_handle: string | null;
}

export interface LibrarySyncState {
  running: boolean;
  startedAt: string | null;
  runId: number | null;
  scope: "all" | "single-channel" | null;
  targetHandle: string | null;
  currentItemTitle: string | null;
  currentItemPercent: number | null;
  currentItemDownloadedBytes: number | null;
  currentItemTotalBytes: number | null;
  currentItemPhase: "downloading" | "postprocessing" | null;
  currentItemSpeed: string | null;
  currentItemEta: string | null;
}

export interface PlayerSyncState {
  running: boolean;
  startedAt: string | null;
  runId: number | null;
  targetVolume: string | null;
  note: string | null;
  reconciled: number;
  copied: number;
  failed: number;
  remaining: number;
  currentItemTitle: string | null;
  nextPendingItem: PendingExportItem | null;
  totalItems: number;
  processedItems: number;
  totalBytes: number;
  completedBytes: number;
  currentItemBytesCopied: number;
  currentItemBytesTotal: number | null;
  lastCompletedAt: string | null;
  lastSummary: string | null;
  lastFailedCount: number;
}

export interface SyncNotification {
  id: string;
  kind: "library" | "player";
  title: string;
  status: "success" | "partial" | "failed";
  createdAt: string;
  summary: string;
  details: string[];
}

export interface SyncState {
  library: LibrarySyncState;
  player: PlayerSyncState;
  notifications: SyncNotification[];
}

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
