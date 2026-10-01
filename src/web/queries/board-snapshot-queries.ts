import { useEffect, useRef, useState } from "react";
import {
  queryOptions,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ActivityEvent,
  BoardSnapshot,
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

export function boardSnapshotQueryOptions(doneLimit: number) {
  return queryOptions({
    queryKey: boardSnapshotKeys.detail(doneLimit),
    queryFn: () => fetchBoardSnapshot(doneLimit),
  });
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

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

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
  fetchSnapshot?: (doneLimit: number) => Promise<BoardSnapshot>;
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
 * It opens one source at a time and the returned dispose closes it and clears the timers it holds, so a remount leaks nothing (T-01-04c). An open after the first one invalidates `boardSnapshotKeys.all`, because frames missed while disconnected are not replayed.
 */
export function connectBoardStream(
  options: ConnectBoardStreamOptions,
): () => void {
  const { doneLimit, queryClient } = options;
  const Source = options.eventSource ?? EventSource;
  const fetchSnapshot = options.fetchSnapshot ?? fetchBoardSnapshot;
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
  let hasOpened = false;

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

  const fetchBoard = async (): Promise<boolean> => {
    const gen = ++boardGen;
    try {
      const snap = await fetchSnapshot(doneLimit);
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
        const ok = await fetchBoard();
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
      if (hasOpened) {
        void queryClient.invalidateQueries({ queryKey: boardSnapshotKeys.all });
      }
      hasOpened = true;
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

  void fetchBoard();
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
