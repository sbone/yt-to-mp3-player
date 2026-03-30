import Database from "better-sqlite3";
import { config } from "./config.js";
import type {
  ChannelOverview,
  ChannelRecord,
  DiscoveredVideo,
  RunSummary,
  SyncCounters,
  VideoStatus
} from "./types.js";

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

export class AppDb {
  private readonly db: Database;

  constructor() {
    this.db = new Database(config.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists channels (
        id integer primary key,
        handle text not null unique,
        url text not null unique,
        active integer not null default 1,
        created_at text not null,
        updated_at text not null,
        last_checked_at text,
        last_success_at text,
        last_error_at text
      );

      create table if not exists videos (
        id integer primary key,
        youtube_video_id text not null unique,
        channel_id integer not null references channels(id),
        title text not null,
        upload_date text,
        duration_seconds integer,
        webpage_url text not null,
        thumbnail_url text,
        status text not null,
        local_path text,
        file_size_bytes integer,
        discovered_at text not null,
        downloaded_at text,
        exported_at text,
        exported_device_sync_id integer references device_syncs(id),
        last_seen_at text not null,
        failure_message text
      );

      create table if not exists device_syncs (
        id integer primary key,
        created_at text not null,
        note text,
        item_count integer not null default 0
      );

      create table if not exists sync_runs (
        id integer primary key,
        started_at text not null,
        finished_at text,
        scope text not null,
        channel_id integer references channels(id),
        status text not null,
        discovered_count integer not null default 0,
        downloaded_count integer not null default 0,
        skipped_count integer not null default 0,
        failed_count integer not null default 0,
        notes text
      );

      create table if not exists sync_events (
        id integer primary key,
        run_id integer not null references sync_runs(id),
        channel_id integer references channels(id),
        video_id integer references videos(id),
        level text not null,
        event_type text not null,
        message text not null,
        created_at text not null
      );
    `);

    // Cheap forward-compatible migration for earlier DBs.
    const videoColumns = this.db.prepare(`pragma table_info(videos)`).all() as Array<{ name: string }>;
    const columnNames = new Set(videoColumns.map((column) => column.name));
    if (!columnNames.has("exported_at")) {
      this.db.exec(`alter table videos add column exported_at text`);
    }
    if (!columnNames.has("exported_device_sync_id")) {
      this.db.exec(`alter table videos add column exported_device_sync_id integer references device_syncs(id)`);
    }
  }

  upsertChannel(handle: string, url: string): ChannelRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into channels (handle, url, active, created_at, updated_at)
         values (@handle, @url, 1, @now, @now)
         on conflict(handle) do update set
           url=excluded.url,
           updated_at=excluded.updated_at`
      )
      .run({ handle, url, now });

    return this.db
      .prepare("select * from channels where handle = ?")
      .get(handle) as ChannelRecord;
  }

  touchChannelChecked(channelId: number, ok: boolean): void {
    const now = new Date().toISOString();
    if (ok) {
      this.db
        .prepare(
          `update channels
           set last_checked_at = ?, last_success_at = ?, updated_at = ?
           where id = ?`
        )
        .run(now, now, now, channelId);
      return;
    }

    this.db
      .prepare(
        `update channels
         set last_checked_at = ?, last_error_at = ?, updated_at = ?
         where id = ?`
      )
      .run(now, now, now, channelId);
  }

  createRun(scope: string, channelId: number | null): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `insert into sync_runs (started_at, scope, channel_id, status)
         values (?, ?, ?, 'running')`
      )
      .run(now, scope, channelId);
    return Number(result.lastInsertRowid);
  }

  finishRun(runId: number, counters: SyncCounters, status: "success" | "partial" | "failed", notes: string | null = null): void {
    this.db
      .prepare(
        `update sync_runs
         set finished_at = @finishedAt,
             status = @status,
             discovered_count = @discovered,
             downloaded_count = @downloaded,
             skipped_count = @skipped,
             failed_count = @failed,
             notes = @notes
         where id = @runId`
      )
      .run({
        runId,
        finishedAt: new Date().toISOString(),
        status,
        discovered: counters.discovered,
        downloaded: counters.downloaded,
        skipped: counters.skipped,
        failed: counters.failed,
        notes
      });
  }

  addEvent(
    runId: number,
    level: "info" | "warn" | "error",
    eventType: string,
    message: string,
    channelId: number | null = null,
    videoId: number | null = null
  ): void {
    this.db
      .prepare(
        `insert into sync_events
         (run_id, channel_id, video_id, level, event_type, message, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(runId, channelId, videoId, level, eventType, message, new Date().toISOString());
  }

  upsertDiscoveredVideo(channelId: number, video: DiscoveredVideo): { id: number; isNew: boolean; status: VideoStatus } {
    const existing = this.db
      .prepare("select id, status from videos where youtube_video_id = ?")
      .get(video.youtubeVideoId) as { id: number; status: VideoStatus } | undefined;

    const now = new Date().toISOString();
    if (!existing) {
      const result = this.db
        .prepare(
          `insert into videos
          (youtube_video_id, channel_id, title, upload_date, duration_seconds, webpage_url, thumbnail_url, status, discovered_at, last_seen_at)
          values
          (@youtubeVideoId, @channelId, @title, @uploadDate, @durationSeconds, @webpageUrl, @thumbnailUrl, 'discovered', @now, @now)`
        )
        .run({
          youtubeVideoId: video.youtubeVideoId,
          channelId,
          title: video.title,
          uploadDate: video.uploadDate,
          durationSeconds: video.durationSeconds,
          webpageUrl: video.webpageUrl,
          thumbnailUrl: video.thumbnailUrl,
          now
        });
      return { id: Number(result.lastInsertRowid), isNew: true, status: "discovered" };
    }

    this.db
      .prepare(
        `update videos
         set channel_id = @channelId,
             title = @title,
             upload_date = coalesce(@uploadDate, upload_date),
             duration_seconds = coalesce(@durationSeconds, duration_seconds),
             webpage_url = @webpageUrl,
             thumbnail_url = coalesce(@thumbnailUrl, thumbnail_url),
             last_seen_at = @now
         where youtube_video_id = @youtubeVideoId`
      )
      .run({
        youtubeVideoId: video.youtubeVideoId,
        channelId,
        title: video.title,
        uploadDate: video.uploadDate,
        durationSeconds: video.durationSeconds,
        webpageUrl: video.webpageUrl,
        thumbnailUrl: video.thumbnailUrl,
        now
      });

    return { id: existing.id, isNew: false, status: existing.status };
  }

  markVideoDownloaded(videoId: number, localPath: string, fileSizeBytes: number | null): void {
    this.db
      .prepare(
        `update videos
         set status='downloaded',
             local_path=@localPath,
             file_size_bytes=@fileSizeBytes,
             downloaded_at=@now,
             failure_message=null
         where id=@videoId`
      )
      .run({ videoId, localPath, fileSizeBytes, now: new Date().toISOString() });
  }

  markVideoSkipped(videoId: number, reason: string): void {
    this.db
      .prepare(
        `update videos
         set status='skipped', failure_message=@reason
         where id=@videoId and status <> 'downloaded'`
      )
      .run({ videoId, reason });
  }

  markVideoFailed(videoId: number, message: string): void {
    this.db
      .prepare(
        `update videos
         set status='failed', failure_message=@message
         where id=@videoId`
      )
      .run({ videoId, message });
  }

  markVideoCookieBlocked(videoId: number, message: string): void {
    this.db
      .prepare(
        `update videos
         set status='cookie_blocked', failure_message=@message
         where id=@videoId`
      )
      .run({ videoId, message });
  }

  listChannelsOverview(): ChannelOverview[] {
    return this.db
      .prepare(
        `select
          c.id,
          c.handle,
          c.url,
          c.last_checked_at,
          c.last_success_at,
          c.last_error_at,
          count(v.id) as known_videos,
          sum(case when v.status = 'downloaded' then 1 else 0 end) as downloaded_videos,
          sum(case when v.status = 'downloaded' and v.exported_at is not null then 1 else 0 end) as on_player_videos,
          sum(case when v.status = 'downloaded' and v.exported_at is null then 1 else 0 end) as local_only_videos,
          sum(case when v.status = 'downloaded' and v.exported_at is null then 1 else 0 end) as needs_sync_videos,
          sum(case when v.status = 'failed' then 1 else 0 end) as failed_videos,
          sum(case when v.status = 'cookie_blocked' then 1 else 0 end) as cookie_blocked_videos,
          max(v.upload_date) as newest_upload
        from channels c
        left join videos v on v.channel_id = c.id
        where c.active = 1
        group by c.id
        order by c.handle asc`
      )
      .all() as ChannelOverview[];
  }

  listChannelVideos(handle: string): VideoRecord[] {
    return this.db
      .prepare(
        `select v.id, v.youtube_video_id, v.title, v.upload_date, v.status, v.local_path, v.failure_message, v.downloaded_at, v.exported_at, v.last_seen_at
         from videos v
         join channels c on c.id = v.channel_id
         where c.handle = ?
         order by coalesce(v.upload_date, '0000-00-00') desc, v.id desc`
      )
      .all(handle) as VideoRecord[];
  }

  listCookieBlockedVideos(limit = 200): Array<{
    id: number;
    youtube_video_id: string;
    title: string;
    upload_date: string | null;
    failure_message: string | null;
    channel_id: number;
    channel_handle: string;
  }> {
    return this.db
      .prepare(
        `select
          v.id,
          v.youtube_video_id,
          v.title,
          v.upload_date,
          v.failure_message,
          v.channel_id,
          c.handle as channel_handle
         from videos v
         join channels c on c.id = v.channel_id
         where v.status = 'cookie_blocked'
         order by v.id asc
         limit ?`
      )
      .all(limit) as Array<{
      id: number;
      youtube_video_id: string;
      title: string;
      upload_date: string | null;
      failure_message: string | null;
      channel_id: number;
      channel_handle: string;
    }>;
  }

  getChannel(handle: string): ChannelRecord | null {
    return (this.db.prepare("select * from channels where handle = ?").get(handle) as ChannelRecord | undefined) ?? null;
  }

  listRecentRuns(limit = 25): RunSummary[] {
    return this.db
      .prepare(
        `select r.*, c.handle as channel_handle
         from sync_runs r
         left join channels c on c.id = r.channel_id
         order by r.id desc
         limit ?`
      )
      .all(limit) as RunSummary[];
  }

  getRun(runId: number): RunSummary | null {
    return (
      this.db
        .prepare(
          `select r.*, c.handle as channel_handle
           from sync_runs r
           left join channels c on c.id = r.channel_id
           where r.id = ?`
        )
        .get(runId) as RunSummary | undefined
    ) ?? null;
  }

  listRunEvents(runId: number): Array<{
    id: number;
    level: string;
    event_type: string;
    message: string;
    created_at: string;
    channel_handle: string | null;
  }> {
    return this.db
      .prepare(
        `select e.id, e.level, e.event_type, e.message, e.created_at, c.handle as channel_handle
         from sync_events e
         left join channels c on c.id = e.channel_id
         where e.run_id = ?
         order by e.id asc`
      )
      .all(runId) as Array<{
      id: number;
      level: string;
      event_type: string;
      message: string;
      created_at: string;
      channel_handle: string | null;
    }>;
  }

  listRecentEvents(limit = 120): Array<{
    id: number;
    run_id: number;
    level: string;
    event_type: string;
    message: string;
    created_at: string;
    channel_handle: string | null;
  }> {
    return this.db
      .prepare(
        `select
          e.id,
          e.run_id,
          e.level,
          e.event_type,
          e.message,
          e.created_at,
          c.handle as channel_handle
         from sync_events e
         left join channels c on c.id = e.channel_id
         order by e.id desc
         limit ?`
      )
      .all(limit) as Array<{
      id: number;
      run_id: number;
      level: string;
      event_type: string;
      message: string;
      created_at: string;
      channel_handle: string | null;
    }>;
  }

  getLatestDeviceSync(): DeviceSyncRecord | null {
    return (
      this.db
        .prepare(
          `select id, created_at, note, item_count
           from device_syncs
           order by id desc
           limit 1`
        )
        .get() as DeviceSyncRecord | undefined
    ) ?? null;
  }

  listPendingExportVideos(limit = 500): Array<{
    id: number;
    title: string;
    local_path: string;
    downloaded_at: string | null;
    channel_handle: string | null;
  }> {
    return this.db
      .prepare(
        `select
          v.id,
          v.title,
          v.local_path,
          v.downloaded_at,
          c.handle as channel_handle
         from videos v
         left join channels c on c.id = v.channel_id
         where v.status = 'downloaded'
           and v.local_path is not null
           and v.exported_at is null
         order by coalesce(v.downloaded_at, v.last_seen_at) desc, v.id desc
         limit ?`
      )
      .all(limit) as Array<{
      id: number;
      title: string;
      local_path: string;
      downloaded_at: string | null;
      channel_handle: string | null;
    }>;
  }

  markVideosAsExported(videoIds: number[], note: string | null): { syncId: number | null; itemCount: number } {
    if (videoIds.length === 0) {
      return { syncId: null, itemCount: 0 };
    }

    const now = new Date().toISOString();

    const insertSync = this.db.prepare(
      `insert into device_syncs (created_at, note, item_count)
      values (?, ?, ?)`
    );
    const updateVideo = this.db.prepare(
      `update videos
       set exported_at = ?, exported_device_sync_id = ?
       where id = ?`
    );

    const tx = this.db.transaction(() => {
      const syncInsert = insertSync.run(now, note, videoIds.length);
      const syncId = Number(syncInsert.lastInsertRowid);
      for (const videoId of videoIds) {
        updateVideo.run(now, syncId, videoId);
      }
      return { syncId, itemCount: videoIds.length };
    });

    return tx();
  }

  markPendingAsExported(note: string | null): { syncId: number | null; itemCount: number } {
    const pendingIds = this.db
      .prepare(
        `select id
         from videos
         where status = 'downloaded'
           and local_path is not null
           and exported_at is null`
      )
      .all() as Array<{ id: number }>;

    return this.markVideosAsExported(
      pendingIds.map((video) => video.id),
      note
    );
  }
}
