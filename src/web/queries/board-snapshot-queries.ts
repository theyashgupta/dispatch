import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ActivityEvent,
  BoardSnapshot,
  ConnectionStatus,
  TunnelState,
} from "../../shared/types.js";
import { activityKeys, mergeActivity } from "./activity-queries.js";
import { fetchBoardSnapshot } from "./board-snapshot-api.js";

export const boardSnapshotKeys = {
  all: ["board-snapshot"] as const,
  detail: (doneLimit: number) => ["board-snapshot", doneLimit] as const,
};

export const tunnelKeys = {
  state: ["tunnel"] as const,
};

/**
 * Build the query options for the board snapshot at a done limit.
 *
 * @remarks
 * A stream frame written during the fetch wins, so an older GET never rolls the board back.
 */
export function boardSnapshotQueryOptions(doneLimit: number) {
  return queryOptions({
    queryKey: boardSnapshotKeys.detail(doneLimit),
    queryFn: async ({ client, queryKey }) => {
      const startedAt = Date.now();
      const snapshot = await fetchBoardSnapshot(doneLimit);
      const state = client.getQueryState<BoardSnapshot>(queryKey);
      return state?.data !== undefined && state.dataUpdatedAt > startedAt
        ? state.data
        : snapshot;
    },
  });
}

/** Read the board snapshot at a done limit, keeping the previous snapshot while a new limit loads. */
export function useBoardSnapshotQuery(doneLimit: number) {
  return useQuery({
    ...boardSnapshotQueryOptions(doneLimit),
    placeholderData: keepPreviousData,
  });
}

/**
 * Read the board snapshot for a reader that mounts with a page, keeping a board on screen while a new limit loads.
 *
 * @remarks
 * The shell holds the always-mounted observer, so a page reader never refetches on mount and adds
 * no request when it opens. A reader that mounts during a done-limit fetch has no previous data, so
 * it starts from the newest cached board, as the legacy app-wide last board did.
 */
export function useBoardSnapshot(doneLimit: number): BoardSnapshot | null {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    ...boardSnapshotQueryOptions(doneLimit),
    placeholderData: (previous) => previous ?? newestBoardSnapshot(queryClient),
    refetchOnMount: false,
  });
  return data ?? null;
}

/** Return the most recently updated board snapshot in the cache, at any done limit. */
export function newestBoardSnapshot(
  queryClient: QueryClient,
): BoardSnapshot | undefined {
  let newest: { data: BoardSnapshot; at: number } | undefined;
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: boardSnapshotKeys.all })) {
    const { data, dataUpdatedAt } = query.state;
    if (data === undefined) continue;
    if (newest === undefined || dataUpdatedAt > newest.at)
      newest = { data: data as BoardSnapshot, at: dataUpdatedAt };
  }
  return newest?.data;
}

/**
 * Decide whether the root route should start the first board fetch.
 *
 * @remarks
 * Any cached data, in-flight fetch or error means the board already has an owner, so a prefetch would duplicate the GET or hide the error.
 */
export function shouldPrefetchBoard(
  queries: ReadonlyArray<{
    state: { data: unknown; status: string; fetchStatus: string };
  }>,
): boolean {
  return queries.every(
    (q) =>
      q.state.data === undefined &&
      q.state.fetchStatus !== "fetching" &&
      q.state.status !== "error",
  );
}

/**
 * Pick the board to render, keeping the previous snapshot while the current one is missing.
 *
 * @remarks
 * A done-limit change briefly has no data, and showing the last board avoids a blank flash.
 */
export function latestBoard(
  current: BoardSnapshot | undefined,
  previous: BoardSnapshot | null,
): BoardSnapshot | null {
  return current ?? previous;
}

export function applyBoardSnapshot(
  queryClient: QueryClient,
  doneLimit: number,
  snapshot: BoardSnapshot,
): void {
  queryClient.setQueryData(boardSnapshotKeys.detail(doneLimit), snapshot);
}

export function applyActivityEvent(
  queryClient: QueryClient,
  event: ActivityEvent,
): void {
  queryClient.setQueryData<ActivityEvent[]>(activityKeys.feed, (prev) =>
    mergeActivity([event], prev ?? []),
  );
}

export function applyTunnelState(
  queryClient: QueryClient,
  state: TunnelState,
): void {
  queryClient.setQueryData(tunnelKeys.state, state);
}

interface StreamSource {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface BoardStreamCallbacks {
  onBoardUpdate?: (snapshot: BoardSnapshot) => void;
  onActivity?: (event: ActivityEvent) => void;
  onTunnelState?: (state: TunnelState) => void;
}

export interface ConnectBoardStreamOptions extends BoardStreamCallbacks {
  doneLimit: number;
  queryClient: QueryClient;
  eventSource?: new (url: string) => StreamSource;
  fetchSnapshot?: (doneLimit: number, force: boolean) => Promise<BoardSnapshot>;
  onConnection?: (status: ConnectionStatus) => void;
}

const HEARTBEAT_MS = 15_000;
const WATCHDOG_MS = HEARTBEAT_MS * 3;
const WATCHDOG_TICK_MS = 5_000;

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 5_000;

const SSE_IDLE_MS = 7_000;
const POLL_MS = 4_000;
const POLL_MAX_MS = 30_000;

/**
 * Own the single `/api/stream` connection for a done limit and write every frame into the query cache.
 *
 * @remarks
 * It opens one source at a time and the returned dispose closes it and clears the timers it holds, so a remount leaks nothing (T-01-04c).
 */
export function connectBoardStream(
  options: ConnectBoardStreamOptions,
): () => void {
  const { doneLimit, queryClient } = options;
  const Source = options.eventSource ?? EventSource;
  const fetchSnapshot =
    options.fetchSnapshot ??
    ((limit: number, force: boolean) =>
      queryClient.fetchQuery({
        ...boardSnapshotQueryOptions(limit),
        ...(force && { staleTime: 0 }),
      }));
  const setConnection = (status: ConnectionStatus) =>
    options.onConnection?.(status);

  let es: StreamSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let backoffMs = BACKOFF_START_MS;
  let lastEventAt = Date.now();
  let disposed = false;
  let sseHealthy = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollFailures = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let boardGen = 0;

  const publishSnapshot = (snapshot: BoardSnapshot) => {
    options.onBoardUpdate?.(snapshot);
    applyBoardSnapshot(queryClient, doneLimit, snapshot);
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    if (es != null) {
      es.close();
      es = null;
    }
    setConnection("disconnected");
    if (reconnectTimer != null) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const fetchBoard = async (force: boolean): Promise<boolean> => {
    const gen = ++boardGen;
    try {
      const snap = await fetchSnapshot(doneLimit, force);
      if (!disposed && gen === boardGen && !sseHealthy) {
        publishSnapshot(snap);
        setConnection("connected");
      }
      return true;
    } catch {
      return false;
    }
  };

  const stopPolling = () => {
    if (pollTimer != null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollFailures = 0;
  };

  const scheduleNextPoll = (delay: number) => {
    pollTimer = setTimeout(() => {
      void (async () => {
        const ok = await fetchBoard(true);
        if (disposed || pollTimer == null) return;
        pollFailures = ok ? 0 : pollFailures + 1;
        scheduleNextPoll(
          ok ? POLL_MS : Math.min(POLL_MS * 2 ** pollFailures, POLL_MAX_MS),
        );
      })();
    }, delay);
  };

  const startPolling = () => {
    if (disposed || pollTimer != null) return;
    scheduleNextPoll(0);
  };

  const connect = () => {
    if (disposed) return;
    lastEventAt = Date.now();
    sseHealthy = false;
    const src = new Source(`/api/stream?doneLimit=${doneLimit}`);
    es = src;

    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!sseHealthy && !disposed) startPolling();
    }, SSE_IDLE_MS);

    src.onopen = () => {
      lastEventAt = Date.now();
      setConnection("connected");
    };
    src.onmessage = (e) => {
      lastEventAt = Date.now();
      backoffMs = BACKOFF_START_MS;
      sseHealthy = true;
      boardGen++;
      if (idleTimer != null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      stopPolling();
      publishSnapshot(JSON.parse(e.data as string) as BoardSnapshot);
      setConnection("connected");
    };
    src.addEventListener("ping", () => {
      lastEventAt = Date.now();
      setConnection("connected");
    });
    src.addEventListener("activity", (e) => {
      lastEventAt = Date.now();
      const event = JSON.parse(e.data as string) as ActivityEvent;
      options.onActivity?.(event);
      applyActivityEvent(queryClient, event);
    });
    src.addEventListener("tunnel", (e) => {
      lastEventAt = Date.now();
      const state = JSON.parse(e.data as string) as TunnelState;
      options.onTunnelState?.(state);
      applyTunnelState(queryClient, state);
    });
    src.onerror = () => {
      if (es === src) {
        sseHealthy = false;
        startPolling();
        scheduleReconnect();
      }
    };
  };

  void fetchBoard(false);
  connect();

  watchdog = setInterval(() => {
    if (disposed) return;
    if (Date.now() - lastEventAt > WATCHDOG_MS) scheduleReconnect();
  }, WATCHDOG_TICK_MS);

  return () => {
    disposed = true;
    if (reconnectTimer != null) clearTimeout(reconnectTimer);
    if (watchdog != null) clearInterval(watchdog);
    if (idleTimer != null) clearTimeout(idleTimer);
    stopPolling();
    if (es != null) es.close();
  };
}

/**
 * Keep the query cache in step with the live stream for a done limit and report the connection state.
 *
 * @remarks
 * Callbacks are read from refs refreshed every render, so only `doneLimit` or the client reopens the connection.
 */
export function useBoardLiveUpdates(
  doneLimit: number,
  callbacks: BoardStreamCallbacks = {},
): { connection: ConnectionStatus } {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(
    () =>
      connectBoardStream({
        doneLimit,
        queryClient,
        onConnection: setConnection,
        onBoardUpdate: (snapshot) =>
          callbacksRef.current.onBoardUpdate?.(snapshot),
        onActivity: (event) => callbacksRef.current.onActivity?.(event),
        onTunnelState: (state) => callbacksRef.current.onTunnelState?.(state),
      }),
    [doneLimit, queryClient],
  );

  return { connection };
}
