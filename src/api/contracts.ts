import type {
  ChannelOverview,
  ChannelRecord,
  DeviceStatus,
  DeviceSyncRecord,
  PendingExportItem,
  RunSummary,
  SyncState,
  VideoRecord
} from "../types.js";

export type { LibrarySyncState, PlayerSyncState, SyncNotification, SyncState } from "../types.js";

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

export type PendingExportDto = PendingExportItem;

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
  mode: "normal" | "demo";
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
  sources: SourceDto[];
}

export interface SourceDto {
  key: string;
  url: string;
}

export interface SourcesDto {
  sources: SourceDto[];
}

export interface AddSourceResponse {
  source: SourceDto;
  message: string;
}

export interface RemoveSourceResponse {
  source: SourceDto;
  message: string;
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
  mode: "normal" | "demo";
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
