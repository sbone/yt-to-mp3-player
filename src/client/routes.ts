export type Route =
  | { kind: "dashboard" }
  | { kind: "channels" }
  | { kind: "channel-detail"; handle: string }
  | { kind: "runs" }
  | { kind: "run-detail"; runId: number }
  | { kind: "not-found"; path: string };

export function parseRoute(pathname: string): Route {
  if (pathname === "/") {
    return { kind: "dashboard" };
  }
  if (pathname === "/channels") {
    return { kind: "channels" };
  }
  if (pathname.startsWith("/channels/")) {
    const handle = pathname.slice("/channels/".length).trim();
    return handle ? { kind: "channel-detail", handle: decodeURIComponent(handle) } : { kind: "not-found", path: pathname };
  }
  if (pathname === "/runs") {
    return { kind: "runs" };
  }
  if (pathname.startsWith("/runs/")) {
    const rawRunId = pathname.slice("/runs/".length).trim();
    const runId = Number(rawRunId);
    return Number.isFinite(runId) ? { kind: "run-detail", runId } : { kind: "not-found", path: pathname };
  }
  return { kind: "not-found", path: pathname };
}

export function hrefForRoute(route: Route): string {
  switch (route.kind) {
    case "dashboard":
      return "/";
    case "channels":
      return "/channels";
    case "channel-detail":
      return `/channels/${encodeURIComponent(route.handle)}`;
    case "runs":
      return "/runs";
    case "run-detail":
      return `/runs/${route.runId}`;
    case "not-found":
      return route.path;
  }
}
