import type { ChannelOverview, ChannelRecord, RunSummary, VideoStatus } from "../types.js";

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

export interface LibrarySyncState {
  running: boolean;
  startedAt: string | null;
  runId: number | null;
  scope: "all" | "single-channel" | null;
  targetHandle: string | null;
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
  nextPendingItem: PendingExportDto | null;
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

export interface RunEventDto {
  id: number;
  level: string;
  event_type: string;
  message: string;
  created_at: string;
  channel_handle: string | null;
}

export interface LiveEventDto {
  id: number;
  run_id: number;
  level: string;
  event_type: string;
  message: string;
  created_at: string;
  channel_handle: string | null;
}

export interface PendingExportDto {
  id: number;
  title: string;
  local_path: string;
  downloaded_at: string | null;
  channel_handle: string | null;
}

export interface CookieBlockedVideoDto {
  id: number;
  youtube_video_id: string;
  title: string;
  upload_date: string | null;
  failure_message: string | null;
  channel_id: number;
  channel_handle: string;
}

export interface DashboardDto {
  channels: ChannelOverview[];
  runs: RunSummary[];
  cookieBlocked: CookieBlockedVideoDto[];
  latestDeviceSync: DeviceSyncRecord | null;
  pendingExport: PendingExportDto[];
  deviceStatus: DeviceStatus;
  deviceReadyForExport: boolean;
  syncState: SyncState;
  safeToDisconnect: boolean;
}

export interface ChannelsDto {
  channels: ChannelOverview[];
}

export interface ChannelDetailDto {
  channel: ChannelRecord;
  videos: VideoRecord[];
}

export interface RunsDto {
  runs: RunSummary[];
}

export interface RunDetailDto {
  run: RunSummary;
  events: RunEventDto[];
}

export interface LiveActivityDto {
  state: SyncState;
  events: LiveEventDto[];
  deviceStatus: DeviceStatus;
  deviceReadyForExport: boolean;
  safeToDisconnect: boolean;
  latestDeviceSync: DeviceSyncRecord | null;
  pendingExport: PendingExportDto[];
}

export interface ActionResponse {
  started: boolean;
  reason: string | null;
  message: string;
}

export interface SyncAndExportActionResponse {
  started: boolean;
  libraryStarted: boolean;
  playerStarted: boolean;
  reason: string | null;
  message: string;
}
