import type {
  ActionResponse,
  AddSourceResponse,
  ChannelDetailDto,
  ChannelsDto,
  DashboardDto,
  LiveActivityDto,
  RemoveSourceResponse,
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

export function addSource(source: string): Promise<AddSourceResponse> {
  return requestJson("/api/sources", {
    method: "POST",
    body: JSON.stringify({ source })
  });
}

export function removeSource(key: string): Promise<RemoveSourceResponse> {
  return requestJson(`/api/sources/${encodeURIComponent(key)}`, {
    method: "DELETE"
  });
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

export function openLiveEvents(
  onLive: (payload: LiveActivityDto) => void,
  onError?: (message: string) => void
): EventSource {
  const source = new EventSource("/api/events");

  source.addEventListener("live", (event) => {
    try {
      onLive(JSON.parse((event as MessageEvent<string>).data) as LiveActivityDto);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  });

  source.onerror = () => {
    onError?.("Live update stream disconnected.");
  };

  return source;
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

export function startPlayerSync(): Promise<ActionResponse> {
  return requestJson("/api/device-sync/sync-player", {
    method: "POST"
  });
}

export function startChannelSync(handle: string): Promise<ActionResponse> {
  return requestJson(`/api/channels/${encodeURIComponent(handle)}/sync`, {
    method: "POST"
  });
}
