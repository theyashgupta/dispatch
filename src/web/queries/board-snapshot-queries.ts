import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import { withBoard } from "../../shared/board-select.js";
import type {
  ActivityEvent,
  BoardKey,
  BoardSnapshot,
  ConnectionStatus,
  TunnelState,
} from "../../shared/types.js";
import { activityKeys, mergeActivity } from "./activity-queries.js";
import { orchestrationKey } from "./attention-actions-queries.js";
import { fetchBoardSnapshot } from "./board-snapshot-api.js";

export const boardSnapshotKeys = {
  all: ["board-snapshot"] as const,
  board: (board: BoardKey) => ["board-snapshot", board] as const,
  detail: (board: BoardKey, doneLimit: number) =>
    ["board-snapshot", board, doneLimit] as const,
};

export const tunnelKeys = {
  state: ["tunnel"] as const,
};

/**
 * Build the query options for the snapshot of a board at a done limit.
 *
 * @remarks
 * A stream frame written during the fetch wins, so an older GET never rolls the board back.
 */
export function boardSnapshotQueryOptions(board: BoardKey, doneLimit: number) {
  return queryOptions({
    queryKey: boardSnapshotKeys.detail(board, doneLimit),
    queryFn: async ({ client, queryKey }) => {
      const startedAt = Date.now();
      const snapshot = await fetchBoardSnapshot(board, doneLimit);
      const state = client.getQueryState<BoardSnapshot>(queryKey);
      return state?.data !== undefined && state.dataUpdatedAt > startedAt
        ? state.data
        : snapshot;
    },
  });
}

/**
 * Read the snapshot of a board at a done limit, keeping the previous snapshot while a new limit loads.
 *
 * @remarks The previous snapshot is kept only when it is of the same board, so a board change never
 * shows the cards of the board the user left.
 */
export function useBoardSnapshotQuery(board: BoardKey, doneLimit: number) {
  return useQuery({
    ...boardSnapshotQueryOptions(board, doneLimit),
    placeholderData: (previous) =>
      sameBoard(previous, board) ? keepPreviousData(previous) : undefined,
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
export function useBoardSnapshot(
  board: BoardKey,
  doneLimit: number,
): BoardSnapshot | null {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    ...boardSnapshotQueryOptions(board, doneLimit),
    placeholderData: (previous) =>
      (sameBoard(previous, board) ? previous : undefined) ??
      newestBoardSnapshot(queryClient, board),
    refetchOnMount: false,
  });
  return data ?? null;
}

/** True when a snapshot belongs to a board; a snapshot with no board key is the default board. */
export function sameBoard(
  snapshot: BoardSnapshot | undefined,
  board: BoardKey,
): snapshot is BoardSnapshot {
  return (
    snapshot !== undefined && (snapshot.boardKey ?? DEFAULT_BOARD_KEY) === board
  );
}

/** Return the most recently updated snapshot of a board in the cache, at any done limit. */
export function newestBoardSnapshot(
  queryClient: QueryClient,
  board: BoardKey,
): BoardSnapshot | undefined {
  let newest: { data: BoardSnapshot; at: number } | undefined;
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: boardSnapshotKeys.board(board) })) {
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
 * Pick the board to render, keeping the previous snapshot of the same board while the current one is missing.
 *
 * @remarks
 * A done-limit change briefly has no data, and showing the last board avoids a blank flash. A
 * board change drops the previous snapshot, because it shows the cards of another board.
 */
export function latestBoard(
  current: BoardSnapshot | undefined,
  previous: BoardSnapshot | null,
  board: BoardKey,
): BoardSnapshot | null {
  if (sameBoard(current, board)) return current;
  return sameBoard(previous ?? undefined, board) ? previous : null;
}

export function applyBoardSnapshot(
  queryClient: QueryClient,
  board: BoardKey,
  doneLimit: number,
  snapshot: BoardSnapshot,
): void {
  queryClient.setQueryData(
    boardSnapshotKeys.detail(board, doneLimit),
    snapshot,
  );
}

export function applyActivityEvent(
  queryClient: QueryClient,
  board: BoardKey,
  event: ActivityEvent,
): void {
  queryClient.setQueryData<ActivityEvent[]>(activityKeys.feed(board), (prev) =>
    mergeActivity([event], prev ?? []),
  );
}

export function applyTunnelState(
  queryClient: QueryClient,
  state: TunnelState,
): void {
  queryClient.setQueryData(tunnelKeys.state, state);
}

/** The orchestration query prefix of the board named in an `orchestration` frame, or null for an unreadable frame. */
export function orchestrationKeyOf(
  data: string,
): ReturnType<typeof orchestrationKey> | null {
  try {
    const { boardKey } = JSON.parse(data) as { boardKey?: unknown };
    return typeof boardKey === "string" ? orchestrationKey(boardKey) : null;
  } catch {
    return null;
  }
}

interface StreamSource {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface BoardStreamCallbacks {
  onBoardUpdate?: (snapshot: BoardSnapshot, fresh: boolean) => void;
  onActivity?: (event: ActivityEvent) => void;
  onTunnelState?: (state: TunnelState) => void;
}

export interface ConnectBoardStreamOptions extends BoardStreamCallbacks {
  board: BoardKey;
  doneLimit: number;
  queryClient: QueryClient;
  eventSource?: new (url: string) => StreamSource;
  fetchSnapshot?: (force: boolean) => Promise<BoardSnapshot>;
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
 * Own the single `/api/stream` connection for a board and a done limit and write every frame into the query cache.
 *
 * @remarks
 * It opens one source at a time and the returned dispose closes it and clears the timers it holds, so a remount leaks nothing (T-01-04c).
 */
export function connectBoardStream(
  options: ConnectBoardStreamOptions,
): () => void {
  const { board, doneLimit, queryClient } = options;
  const Source = options.eventSource ?? EventSource;
  const fetchSnapshot =
    options.fetchSnapshot ??
    ((force: boolean) =>
      queryClient.fetchQuery({
        ...boardSnapshotQueryOptions(board, doneLimit),
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
  let missedFrames = false;

  const refreshOrchestration = () =>
    void queryClient.invalidateQueries({ queryKey: orchestrationKey(board) });

  const publishSnapshot = (snapshot: BoardSnapshot, fresh: boolean) => {
    options.onBoardUpdate?.(snapshot, fresh);
    applyBoardSnapshot(queryClient, board, doneLimit, snapshot);
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    if (es != null) {
      es.close();
      es = null;
    }
    setConnection("disconnected");
    missedFrames = true;
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
      const snap = await fetchSnapshot(force);
      if (!disposed && gen === boardGen && !sseHealthy) {
        publishSnapshot(snap, force);
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
        if (ok) refreshOrchestration();
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
    const src = new Source(
      withBoard(`/api/stream?doneLimit=${doneLimit}`, board),
    );
    es = src;

    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!sseHealthy && !disposed) startPolling();
    }, SSE_IDLE_MS);

    src.onopen = () => {
      lastEventAt = Date.now();
      if (missedFrames) {
        missedFrames = false;
        refreshOrchestration();
      }
      setConnection("connected");
    };
    src.onmessage = (e) => {
      lastEventAt = Date.now();
      const snapshot = JSON.parse(e.data as string) as BoardSnapshot;
      if (!sameBoard(snapshot, board)) return;
      backoffMs = BACKOFF_START_MS;
      sseHealthy = true;
      boardGen++;
      if (idleTimer != null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      stopPolling();
      publishSnapshot(snapshot, true);
      setConnection("connected");
    };
    src.addEventListener("ping", () => {
      lastEventAt = Date.now();
      setConnection("connected");
    });
    src.addEventListener("activity", (e) => {
      lastEventAt = Date.now();
      const event = JSON.parse(e.data as string) as ActivityEvent;
      if ((event.boardKey ?? DEFAULT_BOARD_KEY) !== board) return;
      options.onActivity?.(event);
      applyActivityEvent(queryClient, board, event);
    });
    src.addEventListener("tunnel", (e) => {
      lastEventAt = Date.now();
      const state = JSON.parse(e.data as string) as TunnelState;
      options.onTunnelState?.(state);
      applyTunnelState(queryClient, state);
    });
    src.addEventListener("orchestration", (e) => {
      lastEventAt = Date.now();
      const queryKey = orchestrationKeyOf(e.data as string);
      if (queryKey) void queryClient.invalidateQueries({ queryKey });
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
 * Keep the query cache in step with the live stream of a board and report the connection state.
 *
 * @remarks
 * Callbacks are read from refs refreshed every render, so only the board, `doneLimit` or the client reopens the connection.
 */
export function useBoardLiveUpdates(
  board: BoardKey,
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
        board,
        doneLimit,
        queryClient,
        onConnection: setConnection,
        onBoardUpdate: (snapshot, fresh) =>
          callbacksRef.current.onBoardUpdate?.(snapshot, fresh),
        onActivity: (event) => callbacksRef.current.onActivity?.(event),
        onTunnelState: (state) => callbacksRef.current.onTunnelState?.(state),
      }),
    [board, doneLimit, queryClient],
  );

  return { connection };
}
