import type {
  ActionResponse,
  ChannelDetailDto,
  ChannelsDto,
  DashboardDto,
  LiveActivityDto,
  RunDetailDto,
  RunsDto,
  SyncAndExportActionResponse
} from "../api/contracts.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) {
      return body.message;
    }
  } catch {
    // Fall back to response text below.
  }

  const text = await response.text();
  return text || `Request failed with status ${response.status}`;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new HttpError(await readErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export function getDashboard(): Promise<DashboardDto> {
  return requestJson(`/api/dashboard?ts=${Date.now()}`, {
    cache: "no-store"
  });
}

export function getChannels(): Promise<ChannelsDto> {
  return requestJson("/api/channels");
}

export function getChannelDetail(handle: string): Promise<ChannelDetailDto> {
  return requestJson(`/api/channels/${encodeURIComponent(handle)}`);
}

export function getRuns(): Promise<RunsDto> {
  return requestJson("/api/runs");
}

export function getRunDetail(runId: number): Promise<RunDetailDto> {
  return requestJson(`/api/runs/${runId}`);
}

export function getLiveActivity(): Promise<LiveActivityDto> {
  return requestJson(`/api/live?ts=${Date.now()}`, {
    cache: "no-store"
  });
}

export function startSync(): Promise<ActionResponse> {
  return requestJson("/api/sync", {
    method: "POST"
  });
}

export function startSyncAndExport(): Promise<SyncAndExportActionResponse> {
  return requestJson("/api/sync-and-export", {
    method: "POST"
  });
}

export function retryCookieErrors(): Promise<ActionResponse> {
  return requestJson("/api/retry/cookie-errors", {
    method: "POST"
  });
}

export function startPlayerSync(note: string): Promise<ActionResponse> {
  return requestJson("/api/device-sync/sync-player", {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function markPendingAsExported(note: string): Promise<ActionResponse> {
  return requestJson("/api/device-sync/mark-pending", {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function startChannelSync(handle: string): Promise<ActionResponse> {
  return requestJson(`/api/channels/${encodeURIComponent(handle)}/sync`, {
    method: "POST"
  });
}
