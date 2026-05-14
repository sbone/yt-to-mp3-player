import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Link, useLocation, useNavigate } from "react-router-dom";
import type { ActionResponse, SyncAndExportActionResponse } from "../api/contracts.js";
import {
  getChannelDetail,
  getChannels,
  getDashboard,
  getLiveActivity,
  getRunDetail,
  getRuns,
  openLiveEvents,
  retryCookieErrors,
  startChannelSync,
  startPlayerSync,
  startSync,
  startSyncAndExport
} from "./api.js";
import { hrefForRoute, parseRoute, type Route } from "./routes.js";
import {
  type ChannelDetailMsg,
  type ChannelDetailModel,
  type ChannelsMsg,
  type ChannelsModel,
  type Cmd,
  type DashboardMsg,
  type DashboardModel,
  type RunDetailMsg,
  type RunDetailModel,
  type RunsMsg,
  type RunsModel,
  initChannelDetailModel,
  initChannelsModel,
  initDashboardModel,
  initRunDetailModel,
  initRunsModel,
  renderChannelDetailScreen,
  renderChannelsScreen,
  renderDashboardScreen,
  renderRunDetailScreen,
  renderRunsScreen,
  updateChannelDetailModel,
  updateChannelsModel,
  updateDashboardModel,
  updateRunDetailModel,
  updateRunsModel
} from "./screens.js";

interface AppModel {
  route: Route;
  dashboard: DashboardModel;
  channels: ChannelsModel;
  channelDetail: ChannelDetailModel;
  runs: RunsModel;
  runDetail: RunDetailModel;
}

type AppMsg =
  | { type: "UrlChanged"; route: Route }
  | { type: "NavigateRequested"; path: string }
  | { type: "DashboardMsg"; msg: DashboardMsg }
  | { type: "ChannelsMsg"; msg: ChannelsMsg }
  | { type: "ChannelDetailMsg"; msg: ChannelDetailMsg }
  | { type: "RunsMsg"; msg: RunsMsg }
  | { type: "RunDetailMsg"; msg: RunDetailMsg };

function initAppModel(route: Route): AppModel {
  return {
    route,
    dashboard: initDashboardModel(),
    channels: initChannelsModel(),
    channelDetail: initChannelDetailModel(),
    runs: initRunsModel(),
    runDetail: initRunDetailModel()
  };
}

function activateRoute(model: AppModel, route: Route): [AppModel, Cmd[]] {
  const nextModel = { ...model, route };
  switch (route.kind) {
    case "dashboard": {
      const [dashboard, dashboardCmds] = updateDashboardModel(nextModel.dashboard, { type: "LoadRequested" });
      const [, liveCmds] = updateDashboardModel(dashboard, { type: "LiveRequested" });
      return [{ ...nextModel, dashboard }, [...dashboardCmds, ...liveCmds]];
    }
    case "channels": {
      const [channels, cmds] = updateChannelsModel(nextModel.channels, { type: "LoadRequested" });
      return [{ ...nextModel, channels }, cmds];
    }
    case "channel-detail": {
      const [channelDetail, cmds] = updateChannelDetailModel(nextModel.channelDetail, {
        type: "LoadRequested",
        handle: route.handle
      });
      return [{ ...nextModel, channelDetail }, cmds];
    }
    case "runs": {
      const [runs, cmds] = updateRunsModel(nextModel.runs, { type: "LoadRequested" });
      return [{ ...nextModel, runs }, cmds];
    }
    case "run-detail": {
      const [runDetail, cmds] = updateRunDetailModel(nextModel.runDetail, {
        type: "LoadRequested",
        runId: route.runId
      });
      return [{ ...nextModel, runDetail }, cmds];
    }
    case "not-found":
      return [nextModel, []];
  }
}

function updateApp(model: AppModel, msg: AppMsg): [AppModel, Cmd[]] {
  switch (msg.type) {
    case "UrlChanged":
      return activateRoute(model, msg.route);
    case "NavigateRequested":
      return [model, [{ type: "Navigate", path: msg.path }]];
    case "DashboardMsg": {
      const [dashboard, cmds] = updateDashboardModel(model.dashboard, msg.msg);
      return [{ ...model, dashboard }, cmds];
    }
    case "ChannelsMsg": {
      const [channels, cmds] = updateChannelsModel(model.channels, msg.msg);
      return [{ ...model, channels }, cmds];
    }
    case "ChannelDetailMsg": {
      const [channelDetail, cmds] = updateChannelDetailModel(model.channelDetail, msg.msg);
      return [{ ...model, channelDetail }, cmds];
    }
    case "RunsMsg": {
      const [runs, cmds] = updateRunsModel(model.runs, msg.msg);
      return [{ ...model, runs }, cmds];
    }
    case "RunDetailMsg": {
      const [runDetail, cmds] = updateRunDetailModel(model.runDetail, msg.msg);
      return [{ ...model, runDetail }, cmds];
    }
  }
}

function commandFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellTitle(route: Route): string {
  switch (route.kind) {
    case "dashboard":
      return "Dashboard";
    case "channels":
      return "Channels";
    case "channel-detail":
      return `Channel ${route.handle}`;
    case "runs":
      return "Runs";
    case "run-detail":
      return `Run ${route.runId}`;
    case "not-found":
      return "Not Found";
  }
}

function AppProgram(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const initialRoute = parseRoute(location.pathname);
  const initialStateRef = useRef<{ model: AppModel; cmds: Cmd[] } | null>(null);
  if (initialStateRef.current === null) {
    const initial = activateRoute(initAppModel(initialRoute), initialRoute);
    initialStateRef.current = {
      model: initial[0],
      cmds: initial[1]
    };
  }
  const commandQueueRef = useRef<Cmd[]>(initialStateRef.current.cmds);
  const [program, setProgram] = useState<{ model: AppModel; seq: number }>({
    model: initialStateRef.current.model,
    seq: 0
  });

  function dispatch(msg: AppMsg): void {
    setProgram((previous) => {
      const [model, cmds] = updateApp(previous.model, msg);
      if (cmds.length > 0) {
        commandQueueRef.current.push(...cmds);
      }
      return {
        model,
        seq: previous.seq + 1
      };
    });
  }

  useEffect(() => {
    const nextRoute = parseRoute(location.pathname);
    dispatch({ type: "UrlChanged", route: nextRoute });
  }, [location.pathname]);

  useEffect(() => {
    const pending = [...commandQueueRef.current];
    commandQueueRef.current = [];
    for (const cmd of pending) {
      switch (cmd.type) {
        case "FetchDashboard":
          void getDashboard()
            .then((data) => dispatch({ type: "DashboardMsg", msg: { type: "Loaded", data } }))
            .catch((error) =>
              dispatch({ type: "DashboardMsg", msg: { type: "LoadFailed", error: commandFailureMessage(error) } })
            );
          break;
        case "FetchChannels":
          void getChannels()
            .then((data) => dispatch({ type: "ChannelsMsg", msg: { type: "Loaded", data } }))
            .catch((error) =>
              dispatch({ type: "ChannelsMsg", msg: { type: "LoadFailed", error: commandFailureMessage(error) } })
            );
          break;
        case "FetchChannelDetail":
          void getChannelDetail(cmd.handle)
            .then((data) => dispatch({ type: "ChannelDetailMsg", msg: { type: "Loaded", handle: cmd.handle, data } }))
            .catch((error) =>
              dispatch({
                type: "ChannelDetailMsg",
                msg: { type: "LoadFailed", handle: cmd.handle, error: commandFailureMessage(error) }
              })
            );
          break;
        case "FetchRuns":
          void getRuns()
            .then((data) => dispatch({ type: "RunsMsg", msg: { type: "Loaded", data } }))
            .catch((error) =>
              dispatch({ type: "RunsMsg", msg: { type: "LoadFailed", error: commandFailureMessage(error) } })
            );
          break;
        case "FetchRunDetail":
          void getRunDetail(cmd.runId)
            .then((data) => dispatch({ type: "RunDetailMsg", msg: { type: "Loaded", runId: cmd.runId, data } }))
            .catch((error) =>
              dispatch({
                type: "RunDetailMsg",
                msg: { type: "LoadFailed", runId: cmd.runId, error: commandFailureMessage(error) }
              })
            );
          break;
        case "FetchLiveActivity":
          void getLiveActivity()
            .then((data) => dispatch({ type: "DashboardMsg", msg: { type: "LiveLoaded", data } }))
            .catch((error) =>
              dispatch({ type: "DashboardMsg", msg: { type: "LiveFailed", error: commandFailureMessage(error) } })
            );
          break;
        case "StartSync":
          void startSync()
            .then((result: ActionResponse) => dispatch({ type: "DashboardMsg", msg: { type: "SyncFinished", result } }))
            .catch((error) =>
              dispatch({
                type: "DashboardMsg",
                msg: { type: "SyncFinished", result: { started: false, reason: commandFailureMessage(error), message: "Library refresh failed." } }
              })
            );
          break;
        case "StartSyncAndExport":
          void startSyncAndExport()
            .then((result: SyncAndExportActionResponse) =>
              dispatch({ type: "DashboardMsg", msg: { type: "SyncAndExportFinished", result } })
            )
            .catch((error) =>
              dispatch({
                type: "DashboardMsg",
                msg: {
                  type: "SyncAndExportFinished",
                  result: {
                    started: false,
                    libraryStarted: false,
                    playerStarted: false,
                    reason: commandFailureMessage(error),
                    message: "Refresh + sync player failed."
                  }
                }
              })
            );
          break;
        case "RetryCookieErrors":
          void retryCookieErrors()
            .then((result: ActionResponse) => dispatch({ type: "DashboardMsg", msg: { type: "RetryFinished", result } }))
            .catch((error) =>
              dispatch({
                type: "DashboardMsg",
                msg: {
                  type: "RetryFinished",
                  result: { started: false, reason: commandFailureMessage(error), message: "Cookie retry failed." }
                }
              })
            );
          break;
        case "StartPlayerSync":
          void startPlayerSync()
            .then((result: ActionResponse) => dispatch({ type: "DashboardMsg", msg: { type: "SyncPlayerFinished", result } }))
            .catch((error) =>
              dispatch({
                type: "DashboardMsg",
                msg: {
                  type: "SyncPlayerFinished",
                  result: { started: false, reason: commandFailureMessage(error), message: "Player sync failed." }
                }
              })
            );
          break;
        case "StartChannelSync":
          void startChannelSync(cmd.handle)
            .then((result: ActionResponse) =>
              dispatch({ type: "ChannelDetailMsg", msg: { type: "SyncFinished", handle: cmd.handle, result } })
            )
            .catch((error) =>
              dispatch({
                type: "ChannelDetailMsg",
                msg: {
                  type: "SyncFinished",
                  handle: cmd.handle,
                  result: { started: false, reason: commandFailureMessage(error), message: "Channel refresh failed." }
                }
              })
            );
          break;
        case "Navigate":
          navigate(cmd.path);
          break;
      }
    }
  }, [program.seq, navigate]);

  useEffect(() => {
    if (program.model.route.kind !== "dashboard") {
      return;
    }

    const source = openLiveEvents(
      (data) => dispatch({ type: "DashboardMsg", msg: { type: "LiveLoaded", data } }),
      (message) => dispatch({ type: "DashboardMsg", msg: { type: "LiveFailed", error: message } })
    );

    return () => {
      source.close();
    };
  }, [program.model.route.kind]);

  useEffect(() => {
    document.title = `${shellTitle(program.model.route)} · yt-to-audio`;
  }, [program.model.route]);

  const route = program.model.route;
  const topNavSection =
    route.kind === "dashboard"
      ? "dashboard"
      : route.kind === "channels" || route.kind === "channel-detail"
        ? "channels"
        : route.kind === "runs" || route.kind === "run-detail"
          ? "runs"
          : null;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-mark">yt-to-audio</span>
            <span className="brand-subtitle">Channel sync dashboard</span>
          </Link>
          <nav className="nav">
            <Link className={topNavSection === "dashboard" ? "nav-link nav-link-active" : "nav-link"} to="/">
              Dashboard
            </Link>
            <Link className={topNavSection === "channels" ? "nav-link nav-link-active" : "nav-link"} to="/channels">
              Channels
            </Link>
            <Link className={topNavSection === "runs" ? "nav-link nav-link-active" : "nav-link"} to="/runs">
              Runs
            </Link>
          </nav>
        </div>
      </header>
      <main className="layout">
        {route.kind === "dashboard" ? renderDashboardScreen(program.model.dashboard, (msg) => dispatch({ type: "DashboardMsg", msg })) : null}
        {route.kind === "channels" ? renderChannelsScreen(program.model.channels) : null}
        {route.kind === "channel-detail"
          ? renderChannelDetailScreen(program.model.channelDetail, (msg) => dispatch({ type: "ChannelDetailMsg", msg }))
          : null}
        {route.kind === "runs" ? renderRunsScreen(program.model.runs) : null}
        {route.kind === "run-detail" ? renderRunDetailScreen(program.model.runDetail) : null}
        {route.kind === "not-found" ? (
          <section className="card" {...{ "box-": "round" }}>
            <h1>Not Found</h1>
            <p className="small mono">Unknown route: {hrefForRoute(route)}</p>
          </section>
        ) : null}
      </main>
    </>
  );
}

export function App(): ReactElement {
  return (
    <BrowserRouter>
      <AppProgram />
    </BrowserRouter>
  );
}
