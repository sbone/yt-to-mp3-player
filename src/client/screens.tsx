import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type {
  ActionResponse,
  ChannelDetailDto,
  ChannelsDto,
  DashboardDto,
  LiveActivityDto,
  RunDetailDto,
  RunsDto,
  SyncAndExportActionResponse,
  SyncNotification
} from "../api/contracts.js";

export interface CommandContext {
  routeHandle?: string;
  routeRunId?: number;
}

export type Cmd =
  | { type: "FetchDashboard" }
  | { type: "FetchChannels" }
  | { type: "FetchChannelDetail"; handle: string }
  | { type: "FetchRuns" }
  | { type: "FetchRunDetail"; runId: number }
  | { type: "FetchLiveActivity" }
  | { type: "StartSync" }
  | { type: "StartSyncAndExport" }
  | { type: "RetryCookieErrors" }
  | { type: "StartPlayerSync"; note: string }
  | { type: "MarkPendingAsExported"; note: string }
  | { type: "StartChannelSync"; handle: string }
  | { type: "Navigate"; path: string };

export interface ViewContext {
  navigate(path: string): void;
}

export interface RemoteData<T> {
  status: "idle" | "loading" | "success" | "failure";
  data: T | null;
  error: string | null;
}

interface ActionState {
  status: "idle" | "working" | "success" | "failure";
  message: string | null;
  awaitingActive: boolean;
}

export interface DashboardModel {
  data: RemoteData<DashboardDto>;
  live: RemoteData<LiveActivityDto>;
  notificationStateInitialized: boolean;
  seenNotificationIds: string[];
  pendingNotificationIds: string[];
  syncPlayerNote: string;
  markPendingNote: string;
  syncAction: ActionState;
  syncAndExportAction: ActionState;
  retryAction: ActionState;
  syncPlayerAction: ActionState;
  markPendingAction: ActionState;
}

export type DashboardMsg =
  | { type: "LoadRequested" }
  | { type: "Loaded"; data: DashboardDto }
  | { type: "LoadFailed"; error: string }
  | { type: "LiveRequested" }
  | { type: "LiveLoaded"; data: LiveActivityDto }
  | { type: "LiveFailed"; error: string }
  | { type: "SyncRequested" }
  | { type: "SyncFinished"; result: ActionResponse }
  | { type: "SyncAndExportRequested" }
  | { type: "SyncAndExportFinished"; result: SyncAndExportActionResponse }
  | { type: "RetryRequested" }
  | { type: "RetryFinished"; result: ActionResponse }
  | { type: "SyncPlayerNoteChanged"; note: string }
  | { type: "SyncPlayerRequested" }
  | { type: "SyncPlayerFinished"; result: ActionResponse }
  | { type: "MarkPendingNoteChanged"; note: string }
  | { type: "MarkPendingRequested" }
  | { type: "MarkPendingFinished"; result: ActionResponse }
  | { type: "NotificationDismissed"; id: string };

export interface ChannelsModel {
  data: RemoteData<ChannelsDto>;
}

export type ChannelsMsg =
  | { type: "LoadRequested" }
  | { type: "Loaded"; data: ChannelsDto }
  | { type: "LoadFailed"; error: string };

export interface ChannelDetailModel {
  handle: string | null;
  data: RemoteData<ChannelDetailDto>;
  syncAction: ActionState;
}

export type ChannelDetailMsg =
  | { type: "LoadRequested"; handle: string }
  | { type: "Loaded"; handle: string; data: ChannelDetailDto }
  | { type: "LoadFailed"; handle: string; error: string }
  | { type: "SyncRequested"; handle: string }
  | { type: "SyncFinished"; handle: string; result: ActionResponse };

export interface RunsModel {
  data: RemoteData<RunsDto>;
}

export type RunsMsg =
  | { type: "LoadRequested" }
  | { type: "Loaded"; data: RunsDto }
  | { type: "LoadFailed"; error: string };

export interface RunDetailModel {
  runId: number | null;
  data: RemoteData<RunDetailDto>;
}

export type RunDetailMsg =
  | { type: "LoadRequested"; runId: number }
  | { type: "Loaded"; runId: number; data: RunDetailDto }
  | { type: "LoadFailed"; runId: number; error: string };

function loading<T>(current: T | null): RemoteData<T> {
  return {
    status: "loading",
    data: current,
    error: null
  };
}

function successAction(message: string): ActionState {
  return {
    status: "success",
    message,
    awaitingActive: false
  };
}

function failureAction(message: string): ActionState {
  return {
    status: "failure",
    message,
    awaitingActive: false
  };
}

function workingAction(awaitingActive = false): ActionState {
  return {
    status: "working",
    message: null,
    awaitingActive
  };
}

function idleAction(): ActionState {
  return {
    status: "idle",
    message: null,
    awaitingActive: false
  };
}

function settleActionAfterProcess(state: ActionState, running: boolean): ActionState {
  if (state.status !== "working") {
    return state;
  }
  if (state.awaitingActive) {
    return running ? workingAction(false) : state;
  }
  if (running) {
    return state;
  }
  return idleAction();
}

function isAlreadyActiveResponse(result: ActionResponse | SyncAndExportActionResponse): boolean {
  const detail = `${result.reason ?? ""} ${result.message}`.toLowerCase();
  return !result.started && detail.includes("already active");
}

export function initDashboardModel(): DashboardModel {
  return {
    data: { status: "idle", data: null, error: null },
    live: { status: "idle", data: null, error: null },
    notificationStateInitialized: false,
    seenNotificationIds: [],
    pendingNotificationIds: [],
    syncPlayerNote: "",
    markPendingNote: "",
    syncAction: idleAction(),
    syncAndExportAction: idleAction(),
    retryAction: idleAction(),
    syncPlayerAction: idleAction(),
    markPendingAction: idleAction()
  };
}

function actionStateFromResult(result: ActionResponse | SyncAndExportActionResponse): ActionState {
  if (isAlreadyActiveResponse(result)) {
    return idleAction();
  }
  return result.started ? successAction(result.message) : failureAction(result.reason ?? result.message);
}

export function updateDashboardModel(model: DashboardModel, msg: DashboardMsg): [DashboardModel, Cmd[]] {
  switch (msg.type) {
    case "LoadRequested":
      return [{ ...model, data: loading(model.data.data) }, [{ type: "FetchDashboard" }]];
    case "Loaded":
      return [{ ...model, data: { status: "success", data: msg.data, error: null } }, []];
    case "LoadFailed":
      return [{ ...model, data: { status: "failure", data: model.data.data, error: msg.error } }, []];
    case "LiveRequested":
      return [model, [{ type: "FetchLiveActivity" }]];
    case "LiveLoaded":
      const nextSyncAction = settleActionAfterProcess(model.syncAction, msg.data.state.library.running);
      const nextSyncAndExportAction = settleActionAfterProcess(
        model.syncAndExportAction,
        msg.data.state.library.running || msg.data.state.player.running
      );
      const nextRetryAction = settleActionAfterProcess(model.retryAction, msg.data.state.library.running);
      const nextSyncPlayerAction = settleActionAfterProcess(model.syncPlayerAction, msg.data.state.player.running);
      if (!model.notificationStateInitialized) {
        return [
          {
            ...model,
            notificationStateInitialized: true,
            syncAction: nextSyncAction,
            syncAndExportAction: nextSyncAndExportAction,
            retryAction: nextRetryAction,
            syncPlayerAction: nextSyncPlayerAction,
            seenNotificationIds: msg.data.state.notifications.map((notification) => notification.id),
            pendingNotificationIds: [],
            live: { status: "success", data: msg.data, error: null },
            data:
              model.data.status === "success" && model.data.data
                ? {
                    status: "success",
                    data: {
                      ...model.data.data,
                      syncState: msg.data.state,
                      deviceStatus: msg.data.deviceStatus ?? model.data.data.deviceStatus,
                      deviceReadyForExport: msg.data.deviceReadyForExport ?? model.data.data.deviceReadyForExport,
                      safeToDisconnect: msg.data.safeToDisconnect ?? model.data.data.safeToDisconnect
                    },
                    error: null
                  }
                : model.data
          },
          []
        ];
      }
      const knownNotificationIds = new Set(model.seenNotificationIds);
      const nextNotificationIds = msg.data.state.notifications
        .map((notification) => notification.id)
        .filter((id) => !knownNotificationIds.has(id));
      return [
        {
          ...model,
          syncAction: nextSyncAction,
          syncAndExportAction: nextSyncAndExportAction,
          retryAction: nextRetryAction,
          syncPlayerAction: nextSyncPlayerAction,
          seenNotificationIds: [...model.seenNotificationIds, ...nextNotificationIds],
          pendingNotificationIds: [...model.pendingNotificationIds, ...nextNotificationIds],
          live: { status: "success", data: msg.data, error: null },
          data:
            model.data.status === "success" && model.data.data
              ? {
                  status: "success",
                  data: {
                    ...model.data.data,
                    syncState: msg.data.state,
                    deviceStatus: msg.data.deviceStatus ?? model.data.data.deviceStatus,
                    deviceReadyForExport: msg.data.deviceReadyForExport ?? model.data.data.deviceReadyForExport,
                    safeToDisconnect: msg.data.safeToDisconnect ?? model.data.data.safeToDisconnect
                  },
                  error: null
                }
              : model.data
        },
        []
      ];
    case "LiveFailed":
      return [{ ...model, live: { status: "failure", data: model.live.data, error: msg.error } }, []];
    case "SyncRequested":
      return [{ ...model, syncAction: workingAction(true) }, [{ type: "StartSync" }]];
    case "SyncFinished":
      return [
        { ...model, syncAction: msg.result.started ? workingAction(true) : actionStateFromResult(msg.result) },
        msg.result.started ? [{ type: "FetchDashboard" }, { type: "FetchLiveActivity" }] : []
      ];
    case "SyncAndExportRequested":
      return [{ ...model, syncAndExportAction: workingAction(true) }, [{ type: "StartSyncAndExport" }]];
    case "SyncAndExportFinished":
      return [
        { ...model, syncAndExportAction: msg.result.started ? workingAction(true) : actionStateFromResult(msg.result) },
        msg.result.started ? [{ type: "FetchDashboard" }, { type: "FetchLiveActivity" }] : []
      ];
    case "RetryRequested":
      return [{ ...model, retryAction: workingAction(true) }, [{ type: "RetryCookieErrors" }]];
    case "RetryFinished":
      return [
        { ...model, retryAction: msg.result.started ? workingAction(true) : actionStateFromResult(msg.result) },
        msg.result.started ? [{ type: "FetchDashboard" }, { type: "FetchLiveActivity" }] : []
      ];
    case "SyncPlayerNoteChanged":
      return [{ ...model, syncPlayerNote: msg.note }, []];
    case "SyncPlayerRequested":
      return [{ ...model, syncPlayerAction: workingAction(true) }, [{ type: "StartPlayerSync", note: model.syncPlayerNote }]];
    case "SyncPlayerFinished":
      return [
        { ...model, syncPlayerAction: msg.result.started ? workingAction(true) : actionStateFromResult(msg.result) },
        msg.result.started ? [{ type: "FetchDashboard" }, { type: "FetchLiveActivity" }] : []
      ];
    case "MarkPendingNoteChanged":
      return [{ ...model, markPendingNote: msg.note }, []];
    case "MarkPendingRequested":
      return [{ ...model, markPendingAction: workingAction(false) }, [{ type: "MarkPendingAsExported", note: model.markPendingNote }]];
    case "MarkPendingFinished":
      return [
        { ...model, markPendingAction: actionStateFromResult(msg.result) },
        [{ type: "FetchDashboard" }]
      ];
    case "NotificationDismissed":
      return [
        {
          ...model,
          pendingNotificationIds: model.pendingNotificationIds.filter((id) => id !== msg.id)
        },
        []
      ];
  }
}

export function initChannelsModel(): ChannelsModel {
  return {
    data: { status: "idle", data: null, error: null }
  };
}

export function updateChannelsModel(model: ChannelsModel, msg: ChannelsMsg): [ChannelsModel, Cmd[]] {
  switch (msg.type) {
    case "LoadRequested":
      return [{ ...model, data: loading(model.data.data) }, [{ type: "FetchChannels" }]];
    case "Loaded":
      return [{ ...model, data: { status: "success", data: msg.data, error: null } }, []];
    case "LoadFailed":
      return [{ ...model, data: { status: "failure", data: model.data.data, error: msg.error } }, []];
  }
}

export function initChannelDetailModel(): ChannelDetailModel {
  return {
    handle: null,
    data: { status: "idle", data: null, error: null },
    syncAction: idleAction()
  };
}

export function updateChannelDetailModel(model: ChannelDetailModel, msg: ChannelDetailMsg): [ChannelDetailModel, Cmd[]] {
  switch (msg.type) {
    case "LoadRequested":
      return [
        {
          ...model,
          handle: msg.handle,
          data: loading(model.handle === msg.handle ? model.data.data : null)
        },
        [{ type: "FetchChannelDetail", handle: msg.handle }]
      ];
    case "Loaded":
      if (model.handle !== msg.handle) {
        return [model, []];
      }
      return [{ ...model, data: { status: "success", data: msg.data, error: null } }, []];
    case "LoadFailed":
      if (model.handle !== msg.handle) {
        return [model, []];
      }
      return [{ ...model, data: { status: "failure", data: model.data.data, error: msg.error } }, []];
    case "SyncRequested":
      return [{ ...model, syncAction: workingAction(true) }, [{ type: "StartChannelSync", handle: msg.handle }]];
    case "SyncFinished":
      if (model.handle !== msg.handle) {
        return [model, []];
      }
      return [
        { ...model, syncAction: msg.result.started ? workingAction(true) : actionStateFromResult(msg.result) },
        msg.result.started ? [{ type: "FetchChannelDetail", handle: msg.handle }, { type: "FetchLiveActivity" }] : []
      ];
  }
}

export function initRunsModel(): RunsModel {
  return {
    data: { status: "idle", data: null, error: null }
  };
}

export function updateRunsModel(model: RunsModel, msg: RunsMsg): [RunsModel, Cmd[]] {
  switch (msg.type) {
    case "LoadRequested":
      return [{ ...model, data: loading(model.data.data) }, [{ type: "FetchRuns" }]];
    case "Loaded":
      return [{ ...model, data: { status: "success", data: msg.data, error: null } }, []];
    case "LoadFailed":
      return [{ ...model, data: { status: "failure", data: model.data.data, error: msg.error } }, []];
  }
}

export function initRunDetailModel(): RunDetailModel {
  return {
    runId: null,
    data: { status: "idle", data: null, error: null }
  };
}

export function updateRunDetailModel(model: RunDetailModel, msg: RunDetailMsg): [RunDetailModel, Cmd[]] {
  switch (msg.type) {
    case "LoadRequested":
      return [
        {
          ...model,
          runId: msg.runId,
          data: loading(model.runId === msg.runId ? model.data.data : null)
        },
        [{ type: "FetchRunDetail", runId: msg.runId }]
      ];
    case "Loaded":
      if (model.runId !== msg.runId) {
        return [model, []];
      }
      return [{ ...model, data: { status: "success", data: msg.data, error: null } }, []];
    case "LoadFailed":
      if (model.runId !== msg.runId) {
        return [model, []];
      }
      return [{ ...model, data: { status: "failure", data: model.data.data, error: msg.error } }, []];
  }
}

function fmtDate(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function badgeClass(status: string): string {
  if (status === "downloaded" || status === "success") return "badge badge-ok";
  if (status === "cookie_blocked" || status === "warn" || status === "partial" || status === "running") return "badge badge-warn";
  if (status === "failed" || status === "error") return "badge badge-bad";
  return "badge";
}

function badgeVariant(status: string): string {
  if (status === "downloaded" || status === "success") return "success";
  if (status === "cookie_blocked" || status === "warn" || status === "partial" || status === "running") return "warning";
  if (status === "failed" || status === "error") return "danger";
  return "muted";
}

function badgeAttributes(status: string): Record<string, string> {
  return {
    "is-": "badge",
    "cap-": "round",
    "variant-": badgeVariant(status)
  };
}

function statBlock(label: string, value: string | number, tone?: "success" | "warning" | "danger"): ReactElement {
  const className = tone ? `stat-block stat-block-${tone}` : "stat-block";
  return (
    <div className={className} {...{ "box-": "round" }}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
    </div>
  );
}

function channelLabel(handle: string | null | undefined): string {
  if (!handle) {
    return "";
  }
  return handle.startsWith("playlist:") ? handle : `@${handle}`;
}

function deviceStateBadge(status: string, exportedAt: string | null): ReactElement {
  if (status === "downloaded" && exportedAt) {
    return <span className={badgeClass("success")} {...badgeAttributes("success")}>On player</span>;
  }
  if (status === "downloaded") {
    return <span className={badgeClass("running")} {...badgeAttributes("running")}>Local only</span>;
  }
  if (status === "failed") {
    return <span className={badgeClass("failed")} {...badgeAttributes("failed")}>Failed</span>;
  }
  if (status === "cookie_blocked") {
    return <span className={badgeClass("warn")} {...badgeAttributes("warn")}>Cookie blocked</span>;
  }
  return <span className={badgeClass("discovered")} {...badgeAttributes("discovered")}>Not downloaded</span>;
}

function renderActionState(state: ActionState): ReactElement | null {
  if (state.status === "idle" || !state.message) {
    return null;
  }
  const className = state.status === "success" ? "small" : "small mono";
  return <p className={className}>{state.message}</p>;
}

function renderButtonLabel(label: string, workingLabel: string, working: boolean): ReactElement {
  if (!working) {
    return <>{label}</>;
  }

  return (
    <span className="button-content">
      <span aria-hidden="true" {...{ "is-": "spinner", "variant-": "dots", "speed-": "fast" }} />
      <span>{workingLabel}</span>
    </span>
  );
}

function wrapWithTooltip(content: ReactElement, tooltip: string | null): ReactElement {
  if (!tooltip) {
    return content;
  }

  return (
    <span className="tooltip-anchor" data-tooltip={tooltip} tabIndex={0}>
      {content}
    </span>
  );
}

function renderRemoteError(error: string | null): ReactElement | null {
  if (!error) {
    return null;
  }
  return <p className="small mono">{error}</p>;
}

function renderTerminal(live: LiveActivityDto | null): ReactElement {
  if (!live) {
    return <pre className="terminal" {...{ "is-": "pre", "box-": "double" }}>Loading...</pre>;
  }

  const lines = [
    `[LIBRARY ${live.state.library.running ? "RUNNING" : "IDLE"}] run=${live.state.library.runId ?? "n/a"} scope=${live.state.library.scope ?? "n/a"} target=${live.state.library.targetHandle ?? "all"}`,
    `[PLAYER ${live.state.player.running ? "RUNNING" : "IDLE"}] run=${live.state.player.runId ?? "n/a"} volume=${live.state.player.targetVolume ?? "n/a"}`,
    `         reconciled=${live.state.player.reconciled} copied=${live.state.player.copied} failed=${live.state.player.failed} remaining=${live.state.player.remaining} current=${live.state.player.currentItemTitle ?? "idle"}`,
    ""
  ];

  for (const event of live.events) {
    const channel = event.channel_handle ? ` ${event.channel_handle}` : "";
    lines.push(`[${new Date(event.created_at).toLocaleTimeString()}] [${event.level.toUpperCase()}] [run ${event.run_id}] ${event.event_type}${channel} :: ${event.message}`);
  }

  return <pre className="terminal" {...{ "is-": "pre", "box-": "double" }}>{lines.join("\n")}</pre>;
}

function activeNotification(notifications: SyncNotification[], pendingNotificationIds: string[]): SyncNotification | null {
  for (const id of pendingNotificationIds) {
    const notification = notifications.find((candidate) => candidate.id === id);
    if (notification) {
      return notification;
    }
  }
  return null;
}

function summarizeRunScope(scope: string, handle: string | null): string {
  return handle ? `${scope} · ${channelLabel(handle)}` : scope;
}

export function renderDashboardScreen(model: DashboardModel, dispatch: (msg: DashboardMsg) => void): ReactElement {
  const payload = model.data.data;
  const livePayload = model.live.data;
  const syncState = livePayload?.state ?? payload?.syncState;
  const libraryActive = syncState?.library.running ?? false;
  const playerActive = syncState?.player.running ?? false;
  const isCookieRetryRun = libraryActive && syncState?.library.targetHandle === "cookie-blocked";
  const isCombinedRun = libraryActive && playerActive;
  const isLibraryRefreshRun =
    libraryActive && !playerActive && syncState?.library.scope === "all" && syncState.library.targetHandle == null;
  const isPlayerOnlyRun = playerActive && !libraryActive;
  const deviceStatus = livePayload?.deviceStatus ?? payload?.deviceStatus;
  const deviceReadyForExport = livePayload?.deviceReadyForExport ?? payload?.deviceReadyForExport ?? false;
  const playerDisabledReason = !deviceReadyForExport ? deviceStatus?.reason ?? "Player not available." : null;
  const safeToDisconnect = livePayload?.safeToDisconnect ?? payload?.safeToDisconnect ?? false;
  const pendingExportCount = payload?.pendingExport?.length ?? 0;
  const cookieBlockedCount = payload?.cookieBlocked?.length ?? 0;
  const notification = livePayload ? activeNotification(livePayload.state.notifications, model.pendingNotificationIds) : null;

  return (
    <>
      <section className="hero" {...{ "box-": "double" }}>
        <h1>Channel Sync Dashboard</h1>
        <p>React-based control panel for yt-dlp channel tracking.</p>
        <div className="actions">
          <button
            type="button"
            {...{ "box-": "round", "variant-": "foreground0" }}
            disabled={libraryActive || model.syncAction.status === "working"}
            onClick={() => dispatch({ type: "SyncRequested" })}
          >
            {renderButtonLabel(
              "Refresh Library",
              isLibraryRefreshRun ? "Library Refresh Active..." : "Refreshing Library...",
              isLibraryRefreshRun || model.syncAction.status === "working"
            )}
          </button>
          {wrapWithTooltip(
            <button
              type="button"
              {...{ "box-": "round", "variant-": "success" }}
              disabled={!deviceReadyForExport || playerActive || model.syncPlayerAction.status === "working"}
              onClick={() => dispatch({ type: "SyncPlayerRequested" })}
            >
              {renderButtonLabel(
                "Sync Player",
                isPlayerOnlyRun ? "Player Sync Active..." : "Syncing Player...",
                isPlayerOnlyRun || model.syncPlayerAction.status === "working"
              )}
            </button>,
            playerDisabledReason
          )}
          {wrapWithTooltip(
            <button
              type="button"
              {...{ "box-": "round", "variant-": "foreground1" }}
              disabled={!deviceReadyForExport || libraryActive || playerActive || model.syncAndExportAction.status === "working"}
              onClick={() => dispatch({ type: "SyncAndExportRequested" })}
            >
              {renderButtonLabel(
                "Refresh Library + Sync Player",
                isCombinedRun ? "Refresh + Sync Active..." : "Refreshing + Syncing...",
                isCombinedRun || model.syncAndExportAction.status === "working"
              )}
            </button>,
            playerDisabledReason
          )}
          <button
            type="button"
            {...{ "box-": "round", "variant-": "warning" }}
            disabled={libraryActive || model.retryAction.status === "working"}
            onClick={() => dispatch({ type: "RetryRequested" })}
          >
            {renderButtonLabel(
              `Retry Cookie-Blocked (${cookieBlockedCount})`,
              isCookieRetryRun ? "Cookie Retry Active..." : "Retrying Cookie-Blocked...",
              isCookieRetryRun || model.retryAction.status === "working"
            )}
          </button>
        </div>
        {renderActionState(model.syncAction)}
        {renderActionState(model.syncAndExportAction)}
        {renderActionState(model.retryAction)}
        {renderRemoteError(model.data.error)}
      </section>

      <section className="card" {...{ "box-": "round" }}>
        <h2>Sync State</h2>
        <p className="mono">library: {syncState?.library.running ? "running" : "idle"}</p>
        <p className="mono">library run: {syncState?.library.runId ?? "n/a"}</p>
        <p className="mono">library scope: {syncState?.library.scope ?? "n/a"}</p>
        <p className="mono">library target: {syncState?.library.targetHandle ?? "all channels"}</p>
        <p className="mono">library started: {fmtDate(syncState?.library.startedAt ?? null)}</p>
        <p className="mono">player: {syncState?.player.running ? "running" : "idle"}</p>
        <p className="mono">player run: {syncState?.player.runId ?? "n/a"}</p>
        <p className="mono">player volume: {syncState?.player.targetVolume ?? "n/a"}</p>
        <p className="mono">player started: {fmtDate(syncState?.player.startedAt ?? null)}</p>
        <p className="mono">
          player progress: reconciled={syncState?.player.reconciled ?? 0} copied={syncState?.player.copied ?? 0} failed=
          {syncState?.player.failed ?? 0} remaining={syncState?.player.remaining ?? 0}
        </p>
        <p className="mono">player current: {syncState?.player.currentItemTitle ?? "idle"}</p>
      </section>

      <section className="card" {...{ "box-": "round" }}>
        <h2>MP3 Player Export</h2>
        <p className="small">
          Tracks ready to copy now: <strong>{pendingExportCount}</strong>
        </p>
        <p className="small">
          Device status:{" "}
          <strong>{deviceStatus?.connected ? `connected (${deviceStatus.volumeName})` : "not connected"}</strong>{" "}
          {deviceStatus?.mountPath ? <>at <code>{deviceStatus.mountPath}</code></> : null}
        </p>
        <p className="small">
          Disconnect status:{" "}
          <strong>
            {safeToDisconnect
              ? "Safe to disconnect"
              : syncState?.player.running
                ? "Do not disconnect during player sync"
                : "Not ready to disconnect"}
          </strong>
        </p>
        {deviceStatus?.reason ? <p className="small">Detection note: {deviceStatus.reason}</p> : null}
        <p className="small">
          Last device update: <strong>{payload?.latestDeviceSync ? fmtDate(payload.latestDeviceSync.created_at) : "never"}</strong>{" "}
          {payload?.latestDeviceSync ? `(tracks: ${payload.latestDeviceSync.item_count})` : ""}
        </p>
        {syncState?.player.lastSummary ? <p className="small">Last player sync summary: {syncState.player.lastSummary}</p> : null}
        <p className="small">
          Player sync: <strong>reconciled={syncState?.player.reconciled ?? 0}</strong>,{" "}
          <strong>copied={syncState?.player.copied ?? 0}</strong>, <strong>failed={syncState?.player.failed ?? 0}</strong>,{" "}
          <strong>remaining={syncState?.player.remaining ?? 0}</strong>
          {syncState?.player.currentItemTitle ? `, current=${syncState.player.currentItemTitle}` : ""}
        </p>
        <div className="actions">
          <div className="inline-form">
            <input
              {...{ "is-": "input" }}
              name="sync-player-note"
              type="text"
              placeholder="Optional note (e.g. auto-copied to AGP-A02T)"
              value={model.syncPlayerNote}
              onChange={(event) => dispatch({ type: "SyncPlayerNoteChanged", note: event.target.value })}
            />
            {wrapWithTooltip(
              <button
                type="button"
                {...{ "box-": "round", "variant-": "success" }}
                disabled={!deviceReadyForExport || playerActive || model.syncPlayerAction.status === "working"}
                onClick={() => dispatch({ type: "SyncPlayerRequested" })}
              >
                {renderButtonLabel(
                  "Sync Player Now",
                  isPlayerOnlyRun ? "Player Sync Active..." : "Syncing Player...",
                  isPlayerOnlyRun || model.syncPlayerAction.status === "working"
                )}
              </button>,
              playerDisabledReason
            )}
          </div>
          <div className="inline-form">
            <input
              {...{ "is-": "input" }}
              name="mark-pending-note"
              type="text"
              placeholder="Optional note (e.g. copied to SanDisk)"
              value={model.markPendingNote}
              onChange={(event) => dispatch({ type: "MarkPendingNoteChanged", note: event.target.value })}
            />
            <button
              type="button"
              {...{ "box-": "round", "variant-": "foreground1" }}
              disabled={model.markPendingAction.status === "working"}
              onClick={() => dispatch({ type: "MarkPendingRequested" })}
            >
              {renderButtonLabel(
                "Mark Pending As Exported",
                "Marking Pending...",
                model.markPendingAction.status === "working"
              )}
            </button>
          </div>
          <a className="button-link" href="/device-sync/pending-manifest.txt" {...{ "is-": "button", "box-": "round" }}>
            Download Pending Manifest
          </a>
        </div>
        {renderActionState(model.syncPlayerAction)}
        {renderActionState(model.markPendingAction)}
      </section>

      <section className="card" {...{ "box-": "round" }}>
        <h2>Pending Export Queue</h2>
        <p className="small">Newest local-only tracks are listed first so the player gets fresh audio before older backlog.</p>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Title</th>
              <th>Downloaded</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            {payload && payload.pendingExport.length > 0 ? (
              payload.pendingExport.map((video) => (
                <tr key={video.id}>
                  <td>{channelLabel(video.channel_handle)}</td>
                  <td>{video.title}</td>
                  <td>{fmtDate(video.downloaded_at)}</td>
                  <td className="mono small">{video.local_path}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>No pending tracks.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" {...{ "box-": "round" }}>
        <h2>Channels</h2>
        <table>
          <thead>
            <tr>
              <th>Handle</th>
              <th>Known</th>
              <th>On Player</th>
              <th>Local Only</th>
              <th>Needs Sync</th>
              <th>Failed</th>
              <th>Cookie blocked</th>
              <th>Newest upload</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {payload?.channels.map((channel) => (
              <tr key={channel.id}>
                <td>
                  <Link to={`/channels/${encodeURIComponent(channel.handle)}`}>{channelLabel(channel.handle)}</Link>
                </td>
                <td>{channel.known_videos}</td>
                <td>{channel.on_player_videos}</td>
                <td>{channel.local_only_videos}</td>
                <td>{channel.needs_sync_videos}</td>
                <td>{channel.failed_videos}</td>
                <td>{channel.cookie_blocked_videos}</td>
                <td>{channel.newest_upload ?? "n/a"}</td>
                <td>{fmtDate(channel.last_checked_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" {...{ "box-": "round" }}>
        <h2>Cookie-Blocked Videos</h2>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Title</th>
              <th>Video</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {payload && payload.cookieBlocked.length > 0 ? (
              payload.cookieBlocked.map((video) => (
                <tr key={video.id}>
                  <td>
                    <Link to={`/channels/${encodeURIComponent(video.channel_handle)}`}>{channelLabel(video.channel_handle)}</Link>
                  </td>
                  <td>{video.title}</td>
                  <td>
                    <a href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`}>{video.youtube_video_id}</a>
                  </td>
                  <td className="small">{video.failure_message ?? ""}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>No cookie/auth blocked videos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" {...{ "box-": "round" }}>
        <h2>Recent Runs</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Started</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Discovered</th>
              <th>Downloaded</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {payload?.runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/runs/${run.id}`}>{run.id}</Link>
                </td>
                <td>{fmtDate(run.started_at)}</td>
                <td>
                  {run.scope} {run.channel_handle ? `(${run.channel_handle})` : ""}
                </td>
                <td>
                  <span className={badgeClass(run.status)} {...badgeAttributes(run.status)}>{run.status}</span>
                </td>
                <td>{run.discovered_count}</td>
                <td>{run.downloaded_count}</td>
                <td>{run.failed_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" {...{ "box-": "round" }}>
        <h2>Live Activity</h2>
        <p className="small">Live updates stream over SSE while this page is open.</p>
        {renderRemoteError(model.live.error)}
        {renderTerminal(livePayload)}
      </section>

      {notification ? (
        <div className="sync-notification-backdrop" onClick={() => dispatch({ type: "NotificationDismissed", id: notification.id })}>
          <section
            className="sync-notification-modal card"
            {...{ "box-": "double" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-notification-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="sync-notification-close"
              aria-label="Dismiss notification"
              onClick={() => dispatch({ type: "NotificationDismissed", id: notification.id })}
            >
              x
            </button>
            <p
              className={
                notification.status === "success"
                  ? "sync-notification-title sync-notification-title-ok"
                  : notification.status === "failed"
                    ? "sync-notification-title sync-notification-title-bad"
                    : "sync-notification-title sync-notification-title-warn"
              }
              id="sync-notification-title"
            >
              {notification.title}
            </p>
            <p className="sync-notification-summary">{notification.summary}</p>
            <p className="small sync-notification-meta">{fmtDate(notification.createdAt)}</p>
            <ul className="sync-notification-list">
              {notification.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function renderChannelsScreen(model: ChannelsModel): ReactElement {
  const payload = model.data.data;
  const channelCount = payload?.channels.length ?? 0;
  const localOnlyCount = payload?.channels.reduce((sum, channel) => sum + channel.local_only_videos, 0) ?? 0;
  const syncNeededCount = payload?.channels.reduce((sum, channel) => sum + channel.needs_sync_videos, 0) ?? 0;
  const blockedCount = payload?.channels.reduce((sum, channel) => sum + channel.cookie_blocked_videos, 0) ?? 0;
  return (
    <>
      <section className="hero" {...{ "box-": "double" }}>
        <h1>Tracked Channels</h1>
        <p>Edit <code>channels.txt</code> to change what is tracked.</p>
        <div className="stat-grid stat-grid-compact">
          {statBlock("Channels", channelCount)}
          {statBlock("Local Only", localOnlyCount)}
          {statBlock("Needs Sync", syncNeededCount, syncNeededCount > 0 ? "warning" : undefined)}
          {statBlock("Cookie Blocked", blockedCount, blockedCount > 0 ? "danger" : undefined)}
        </div>
        {renderRemoteError(model.data.error)}
      </section>
      <section className="card" {...{ "box-": "round" }}>
        <div className="section-head">
          <h2>Channel Ledger</h2>
          <p className="small mono">Every row shows backlog pressure, last success, and whether that channel is drifting away from the player copy.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Handle</th>
              <th>URL</th>
              <th>Known videos</th>
              <th>On Player</th>
              <th>Local Only</th>
              <th>Needs Sync</th>
              <th>Cookie blocked</th>
              <th>Last success</th>
            </tr>
          </thead>
          <tbody>
            {payload?.channels.map((channel) => (
              <tr key={channel.id}>
                <td>
                  <Link to={`/channels/${encodeURIComponent(channel.handle)}`}>{channelLabel(channel.handle)}</Link>
                </td>
                <td>
                  <a href={channel.url}>{channel.url}</a>
                </td>
                <td>{channel.known_videos}</td>
                <td>{channel.on_player_videos}</td>
                <td>{channel.local_only_videos}</td>
                <td>{channel.needs_sync_videos}</td>
                <td>{channel.cookie_blocked_videos}</td>
                <td>{fmtDate(channel.last_success_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function renderChannelDetailScreen(model: ChannelDetailModel, dispatch: (msg: ChannelDetailMsg) => void): ReactElement {
  const payload = model.data.data;
  const handle = model.handle ?? payload?.channel.handle ?? "";
  const downloadedCount = payload?.videos.filter((video) => video.status === "downloaded").length ?? 0;
  const failedCount = payload?.videos.filter((video) => video.status === "failed").length ?? 0;
  const blockedCount = payload?.videos.filter((video) => video.status === "cookie_blocked").length ?? 0;
  const exportedCount = payload?.videos.filter((video) => Boolean(video.exported_at)).length ?? 0;
  if (!payload && model.data.status === "failure") {
    return (
      <section className="card" {...{ "box-": "round" }}>
        <h1>Unknown channel</h1>
        {renderRemoteError(model.data.error)}
      </section>
    );
  }
  return (
    <>
      <section className="hero" {...{ "box-": "double" }}>
        <h1>{payload ? channelLabel(payload.channel.handle) : channelLabel(handle)}</h1>
        <div className="detail-shell">
          <div className="detail-lead">
            <p>{payload?.channel.url ?? ""}</p>
            {payload ? (
              <div className="detail-meta">
                <p className="small mono">created {fmtDate(payload.channel.created_at)}</p>
                <p className="small mono">last checked {fmtDate(payload.channel.last_checked_at)}</p>
                <p className="small mono">last success {fmtDate(payload.channel.last_success_at)}</p>
                <p className="small mono">last error {fmtDate(payload.channel.last_error_at)}</p>
              </div>
            ) : null}
          </div>
          <div className="stat-grid stat-grid-compact">
            {statBlock("Known Videos", payload?.videos.length ?? 0)}
            {statBlock("Downloaded", downloadedCount, downloadedCount > 0 ? "success" : undefined)}
            {statBlock("On Player", exportedCount, exportedCount > 0 ? "success" : undefined)}
            {statBlock("Failed", failedCount, failedCount > 0 ? "danger" : undefined)}
            {statBlock("Cookie Blocked", blockedCount, blockedCount > 0 ? "danger" : undefined)}
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            {...{ "box-": "round", "variant-": "foreground0" }}
            disabled={!handle || model.syncAction.status === "working"}
            onClick={() => handle && dispatch({ type: "SyncRequested", handle })}
          >
            {renderButtonLabel("Sync This Channel", "Syncing Channel...", model.syncAction.status === "working")}
          </button>
        </div>
        {renderActionState(model.syncAction)}
        {renderRemoteError(model.data.error)}
      </section>
      <section className="card" {...{ "box-": "round" }}>
        <div className="section-head">
          <h2>Channel Inventory</h2>
          <p className="small mono">Newest metadata, device state, and file path health for every discovered video on this channel.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Upload</th>
              <th>Status</th>
              <th>Device State</th>
              <th>Exported</th>
              <th>Local path</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {payload?.videos.map((video) => (
              <tr key={video.id}>
                <td>
                  <a href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`}>{video.title}</a>
                </td>
                <td>{video.upload_date ?? "n/a"}</td>
                <td>
                  <span className={badgeClass(video.status)} {...badgeAttributes(video.status)}>{video.status}</span>
                </td>
                <td>{deviceStateBadge(video.status, video.exported_at)}</td>
                <td>{fmtDate(video.exported_at)}</td>
                <td className="mono small">{video.local_path ?? ""}</td>
                <td className="small">{video.failure_message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function renderRunsScreen(model: RunsModel): ReactElement {
  const payload = model.data.data;
  const runCount = payload?.runs.length ?? 0;
  const activeCount = payload?.runs.filter((run) => run.status === "running").length ?? 0;
  const failedCount = payload?.runs.filter((run) => run.failed_count > 0 || run.status === "failed").length ?? 0;
  const downloadedCount = payload?.runs.reduce((sum, run) => sum + run.downloaded_count, 0) ?? 0;
  return (
    <>
      <section className="hero" {...{ "box-": "double" }}>
        <h1>Sync Runs</h1>
        <div className="stat-grid stat-grid-compact">
          {statBlock("Runs", runCount)}
          {statBlock("Active", activeCount, activeCount > 0 ? "warning" : undefined)}
          {statBlock("Downloads", downloadedCount, downloadedCount > 0 ? "success" : undefined)}
          {statBlock("With Failures", failedCount, failedCount > 0 ? "danger" : undefined)}
        </div>
        {renderRemoteError(model.data.error)}
      </section>
      <section className="card" {...{ "box-": "round" }}>
        <div className="section-head">
          <h2>Run Ledger</h2>
          <p className="small mono">Recent library sweeps, channel-specific jobs, and their download/skip/failure balance.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Scope</th>
              <th>Status</th>
              <th>D/S/F</th>
            </tr>
          </thead>
          <tbody>
            {payload?.runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/runs/${run.id}`}>{run.id}</Link>
                </td>
                <td>{fmtDate(run.started_at)}</td>
                <td>{fmtDate(run.finished_at)}</td>
                <td>{summarizeRunScope(run.scope, run.channel_handle)}</td>
                <td>
                  <span className={badgeClass(run.status)} {...badgeAttributes(run.status)}>{run.status}</span>
                </td>
                <td>
                  {run.downloaded_count}/{run.skipped_count}/{run.failed_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function renderRunDetailScreen(model: RunDetailModel): ReactElement {
  const payload = model.data.data;
  const eventCount = payload?.events.length ?? 0;
  const warningCount = payload?.events.filter((event) => event.level === "warn").length ?? 0;
  const errorCount = payload?.events.filter((event) => event.level === "error").length ?? 0;
  if (!payload && model.data.status === "failure") {
    return (
      <section className="card" {...{ "box-": "round" }}>
        <h1>Run not found</h1>
        {renderRemoteError(model.data.error)}
      </section>
    );
  }
  return (
    <>
      <section className="hero" {...{ "box-": "double" }}>
        <h1>Run #{payload?.run.id ?? model.runId ?? "n/a"}</h1>
        {payload ? (
          <div className="detail-shell">
            <div className="detail-lead">
              <p>
                <span className={badgeClass(payload.run.status)} {...badgeAttributes(payload.run.status)}>{payload.run.status}</span> started{" "}
                {fmtDate(payload.run.started_at)}
              </p>
              <div className="detail-meta">
                <p className="small mono">finished {fmtDate(payload.run.finished_at)}</p>
                <p className="small mono">scope {summarizeRunScope(payload.run.scope, payload.run.channel_handle)}</p>
                <p className="small mono">discovered {payload.run.discovered_count}</p>
                <p className="small mono">skipped {payload.run.skipped_count}</p>
              </div>
            </div>
            <div className="stat-grid stat-grid-compact">
              {statBlock("Downloads", payload.run.downloaded_count, payload.run.downloaded_count > 0 ? "success" : undefined)}
              {statBlock("Skipped", payload.run.skipped_count)}
              {statBlock("Warnings", warningCount, warningCount > 0 ? "warning" : undefined)}
              {statBlock("Errors", errorCount, errorCount > 0 ? "danger" : undefined)}
              {statBlock("Events", eventCount)}
            </div>
          </div>
        ) : null}
        {renderRemoteError(model.data.error)}
      </section>
      <section className="card" {...{ "box-": "round" }}>
        <div className="section-head">
          <h2>Event Transcript</h2>
          <p className="small mono">Ordered run events with channel attribution and severity markers preserved.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Type</th>
              <th>Channel</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {payload?.events.map((event) => (
              <tr key={event.id}>
                <td>{fmtDate(event.created_at)}</td>
                <td>
                  <span className={badgeClass(event.level)} {...badgeAttributes(event.level)}>{event.level}</span>
                </td>
                <td className="mono">{event.event_type}</td>
                <td>{channelLabel(event.channel_handle)}</td>
                <td>{event.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
