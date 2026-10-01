import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type {
  ActivityEvent,
  BoardSnapshot,
  TunnelState,
} from "../../shared/types.js";
import { activityKeys } from "./activity-queries.js";
import { fetchBoardSnapshot } from "./board-snapshot-api.js";
import {
  applyActivityEvent,
  applyBoardSnapshot,
  applyTunnelState,
  boardSnapshotKeys,
  boardSnapshotQueryOptions,
  connectBoardStream,
  latestBoard,
  shouldPrefetchBoard,
  tunnelKeys,
  type ConnectBoardStreamOptions,
} from "./board-snapshot-queries.js";

type Handler = (event: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: Handler | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Handler[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Handler): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.(new Event("open"));
  }

  emitError(): void {
    this.onerror?.(new Event("error"));
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  emitNamed(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function snap(n: number): BoardSnapshot {
  return { cards: [], syncedAt: String(n) };
}

function ev(id: number, reason: string | null = null): ActivityEvent {
  return {
    id,
    cardId: null,
    type: "move_manual",
    fromCol: null,
    toCol: null,
    reason,
    source: null,
    ts: "t",
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  FakeEventSource.instances = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

function start(overrides: Partial<ConnectBoardStreamOptions> = {}) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const queryClient = newClient();
  let snapshotCalls = 0;
  const dispose = connectBoardStream({
    doneLimit: 50,
    queryClient,
    eventSource: FakeEventSource,
    fetchSnapshot: () => {
      snapshotCalls++;
      return Promise.resolve(snap(100 + snapshotCalls));
    },
    ...overrides,
  });
  return {
    queryClient,
    dispose,
    source: () => FakeEventSource.instances.at(-1) as FakeEventSource,
    snapshotCalls: () => snapshotCalls,
  };
}

test("boardSnapshotKeys and tunnelKeys have the documented shapes", () => {
  assert.deepEqual(boardSnapshotKeys.all, ["board-snapshot"]);
  assert.deepEqual(boardSnapshotKeys.detail(50), ["board-snapshot", 50]);
  assert.deepEqual(tunnelKeys.state, ["tunnel"]);
});

test("boardSnapshotQueryOptions has the snapshot key and requests the done limit", async () => {
  const urls: string[] = [];
  globalThis.fetch = (url: string | URL | Request) => {
    urls.push(typeof url === "string" ? url : "other");
    return Promise.resolve(new Response(JSON.stringify(snap(1))));
  };
  const options = boardSnapshotQueryOptions(75);
  assert.deepEqual(options.queryKey, ["board-snapshot", 75]);
  assert.deepEqual(await newClient().fetchQuery(options), snap(1));
  assert.deepEqual(urls, ["/api/board?doneLimit=75"]);
});

test("boardSnapshotQueryOptions rejects a failure status so the query errors", async () => {
  globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 503 }));
  await assert.rejects(
    newClient().fetchQuery(boardSnapshotQueryOptions(50)),
    /board snapshot failed: 503/,
  );
});

test("boardSnapshotQueryOptions rejects a 200 with a garbled body instead of caching null", async () => {
  globalThis.fetch = () => Promise.resolve(new Response("not json"));
  const client = newClient();
  await assert.rejects(
    client.fetchQuery(boardSnapshotQueryOptions(50)),
    /board snapshot failed: 200/,
  );
  assert.equal(client.getQueryData(boardSnapshotKeys.detail(50)), undefined);
});

test("boardSnapshotQueryOptions rejects a 200 with a null body instead of caching null", async () => {
  globalThis.fetch = () => Promise.resolve(new Response("null"));
  const client = newClient();
  await assert.rejects(
    client.fetchQuery(boardSnapshotQueryOptions(50)),
    /board snapshot failed: unreadable body/,
  );
  assert.equal(client.getQueryData(boardSnapshotKeys.detail(50)), undefined);
});

test("fetchBoardSnapshot rejects a 200 with a non-object body", async () => {
  globalThis.fetch = () => Promise.resolve(new Response("7"));
  await assert.rejects(
    fetchBoardSnapshot(50),
    new Error("board snapshot failed: unreadable body"),
  );
});

test("applyBoardSnapshot writes under the key for its done limit only", () => {
  const client = newClient();
  applyBoardSnapshot(client, 50, snap(1));
  assert.deepEqual(client.getQueryData(boardSnapshotKeys.detail(50)), snap(1));
  assert.equal(client.getQueryData(boardSnapshotKeys.detail(100)), undefined);
});

test("applyActivityEvent merges into an existing feed, newest id first", () => {
  const client = newClient();
  client.setQueryData(activityKeys.feed, [ev(3), ev(1)]);
  applyActivityEvent(client, ev(2));
  applyActivityEvent(client, ev(3, "replayed"));
  assert.deepEqual(client.getQueryData(activityKeys.feed), [
    ev(3),
    ev(2),
    ev(1),
  ]);
});

test("applyActivityEvent creates the feed entry when missing", () => {
  const client = newClient();
  applyActivityEvent(client, ev(7));
  assert.deepEqual(client.getQueryData(activityKeys.feed), [ev(7)]);
});

test("applyActivityEvent drops the oldest event at the 201st", () => {
  const client = newClient();
  for (let id = 1; id <= 201; id++) applyActivityEvent(client, ev(id));
  const feed = client.getQueryData<ActivityEvent[]>(activityKeys.feed) ?? [];
  assert.equal(feed.length, 200);
  assert.equal(feed[0]?.id, 201);
  assert.equal(feed.at(-1)?.id, 2);
});

test("applyTunnelState writes the tunnel key", () => {
  const client = newClient();
  const state: TunnelState = { status: "starting" };
  applyTunnelState(client, state);
  assert.deepEqual(client.getQueryData(tunnelKeys.state), state);
});

test("a default message reaches onBoardUpdate before the cache, then the cache", () => {
  const seen: unknown[] = [];
  const holder: { client?: QueryClient } = {};
  const h = start({
    onBoardUpdate: () => {
      seen.push(holder.client?.getQueryData(boardSnapshotKeys.detail(50)));
    },
  });
  holder.client = h.queryClient;
  h.source().emitMessage(snap(9));
  assert.deepEqual(seen, [undefined]);
  assert.deepEqual(
    h.queryClient.getQueryData(boardSnapshotKeys.detail(50)),
    snap(9),
  );
  h.dispose();
});

test("activity and tunnel frames route to their callbacks and cache keys", () => {
  const activity: ActivityEvent[] = [];
  const tunnels: TunnelState[] = [];
  const h = start({
    onActivity: (event) => activity.push(event),
    onTunnelState: (state) => tunnels.push(state),
  });
  h.source().emitNamed("activity", ev(4));
  h.source().emitNamed("tunnel", { status: "off" });
  assert.deepEqual(activity, [ev(4)]);
  assert.deepEqual(tunnels, [{ status: "off" }]);
  assert.deepEqual(h.queryClient.getQueryData(activityKeys.feed), [ev(4)]);
  assert.deepEqual(h.queryClient.getQueryData(tunnelKeys.state), {
    status: "off",
  });
  h.dispose();
});

test("ping changes no cache entry and reports connected", () => {
  const statuses: string[] = [];
  const h = start({
    fetchSnapshot: () => new Promise<BoardSnapshot>(() => {}),
    onConnection: (status) => statuses.push(status),
  });
  h.source().emitNamed("ping");
  assert.equal(h.queryClient.getQueryCache().getAll().length, 0);
  assert.deepEqual(statuses, ["connected"]);
  h.dispose();
});

test("a reopen does not refetch an observed board query and the next frame writes the cache", async () => {
  const h = start();
  let fetches = 0;
  const observer = new QueryObserver(h.queryClient, {
    ...boardSnapshotQueryOptions(50),
    queryFn: () => {
      fetches++;
      return Promise.resolve(snap(1));
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await flush();
  assert.equal(fetches, 1);
  h.source().emitOpen();
  h.source().emitError();
  mock.timers.tick(1_000);
  assert.equal(FakeEventSource.instances.length, 2);
  h.source().emitOpen();
  await flush();
  assert.equal(fetches, 1);
  h.source().emitMessage(snap(7));
  assert.deepEqual(
    h.queryClient.getQueryData(boardSnapshotKeys.detail(50)),
    snap(7),
  );
  unsubscribe();
  h.dispose();
});

test("a stream frame written during the fetch survives an older GET result", async () => {
  mock.timers.enable({ apis: ["Date"] });
  const client = newClient();
  let resolveGet: (response: Response) => void = () => undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });
  const pending = client.fetchQuery(boardSnapshotQueryOptions(50));
  mock.timers.tick(10);
  applyBoardSnapshot(client, 50, snap(9));
  mock.timers.tick(10);
  resolveGet(new Response(JSON.stringify(snap(1))));
  assert.deepEqual(await pending, snap(9));
  assert.deepEqual(client.getQueryData(boardSnapshotKeys.detail(50)), snap(9));
});

test("connectBoardStream reuses a fresh cached snapshot for its first fetch and forces the poll fallback", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, staleTime: 30_000 } },
  });
  let gets = 0;
  globalThis.fetch = () => {
    gets++;
    return Promise.resolve(new Response(JSON.stringify(snap(gets))));
  };
  await client.prefetchQuery(boardSnapshotQueryOptions(50));
  const dispose = connectBoardStream({
    doneLimit: 50,
    queryClient: client,
    eventSource: FakeEventSource,
  });
  await flush();
  assert.equal(gets, 1);
  mock.timers.tick(7_000);
  await flush();
  assert.equal(gets, 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(client.getQueryData(boardSnapshotKeys.detail(50)), snap(2));
  dispose();
});

test("onerror reconnects with a doubling backoff capped at 5 seconds", () => {
  const h = start();
  h.source().emitError();
  assert.equal(FakeEventSource.instances[0]?.closed, true);
  mock.timers.tick(999);
  assert.equal(FakeEventSource.instances.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeEventSource.instances.length, 2);
  h.source().emitError();
  mock.timers.tick(1_999);
  assert.equal(FakeEventSource.instances.length, 2);
  mock.timers.tick(1);
  assert.equal(FakeEventSource.instances.length, 3);
  h.source().emitError();
  mock.timers.tick(4_000);
  assert.equal(FakeEventSource.instances.length, 4);
  h.source().emitError();
  mock.timers.tick(4_999);
  assert.equal(FakeEventSource.instances.length, 4);
  mock.timers.tick(1);
  assert.equal(FakeEventSource.instances.length, 5);
  h.dispose();
});

test("a silent stream past 45 seconds is reconnected by the watchdog", () => {
  const h = start();
  h.source().emitOpen();
  mock.timers.tick(50_000);
  assert.equal(FakeEventSource.instances[0]?.closed, true);
  mock.timers.tick(1_000);
  assert.equal(FakeEventSource.instances.length, 2);
  h.dispose();
});

test("the idle timer starts polling through fetchSnapshot and feeds the cache", async () => {
  const updates: BoardSnapshot[] = [];
  const h = start({ onBoardUpdate: (s) => updates.push(s) });
  assert.equal(h.snapshotCalls(), 1);
  await flush();
  mock.timers.tick(7_000);
  await flush();
  assert.equal(h.snapshotCalls(), 2);
  assert.deepEqual(
    h.queryClient.getQueryData(boardSnapshotKeys.detail(50)),
    snap(102),
  );
  assert.deepEqual(updates, [snap(101), snap(102)]);
  h.dispose();
});

test("a stream message stops polling and discards an older polled snapshot", async () => {
  const h = start();
  h.source().emitMessage(snap(9));
  await flush();
  mock.timers.tick(60_000);
  await flush();
  assert.equal(h.snapshotCalls(), 1);
  assert.deepEqual(
    h.queryClient.getQueryData(boardSnapshotKeys.detail(50)),
    snap(9),
  );
  h.dispose();
});

test("a poll that resolves after a stream frame and a later error does not overwrite the frame", async () => {
  const resolvers: Array<(snapshot: BoardSnapshot) => void> = [];
  const h = start({
    fetchSnapshot: () =>
      new Promise<BoardSnapshot>((resolve) => {
        resolvers.push(resolve);
      }),
  });
  resolvers[0]?.(snap(1));
  await flush();
  h.source().emitError();
  mock.timers.tick(1);
  await flush();
  assert.equal(resolvers.length, 2);
  mock.timers.tick(1_000);
  h.source().emitMessage(snap(9));
  h.source().emitError();
  resolvers[1]?.(snap(2));
  await flush();
  assert.deepEqual(
    h.queryClient.getQueryData(boardSnapshotKeys.detail(50)),
    snap(9),
  );
  h.dispose();
});

test("dispose closes the source and no timer fires afterwards", async () => {
  const h = start();
  h.source().emitError();
  mock.timers.tick(1_000);
  await flush();
  const instances = FakeEventSource.instances.length;
  const calls = h.snapshotCalls();
  h.dispose();
  assert.equal(h.source().closed, true);
  mock.timers.tick(600_000);
  await flush();
  assert.equal(FakeEventSource.instances.length, instances);
  assert.equal(h.snapshotCalls(), calls);
});

test("dispose during the initial snapshot fetch leaves the callback and the cache untouched", async () => {
  let resolveFetch: (snapshot: BoardSnapshot) => void = () => undefined;
  const updates: BoardSnapshot[] = [];
  const statuses: string[] = [];
  const h = start({
    fetchSnapshot: () =>
      new Promise<BoardSnapshot>((resolve) => {
        resolveFetch = resolve;
      }),
    onBoardUpdate: (s) => updates.push(s),
    onConnection: (status) => statuses.push(status),
  });
  h.dispose();
  resolveFetch(snap(5));
  await flush();
  assert.deepEqual(updates, []);
  assert.deepEqual(statuses, []);
  assert.equal(h.queryClient.getQueryCache().getAll().length, 0);
  assert.equal(
    h.queryClient.getQueryData(boardSnapshotKeys.detail(50)),
    undefined,
  );
});

test("poll failures back off 8, 16 then 30 seconds and a success resets the interval to 4 seconds", async () => {
  const times: number[] = [];
  const h = start({
    fetchSnapshot: () => {
      const call = times.push(Date.now());
      return call <= 6
        ? Promise.reject(new Error("down"))
        : Promise.resolve(snap(call));
    },
  });
  for (let second = 0; second < 129; second++) {
    mock.timers.tick(1_000);
    await flush();
  }
  assert.deepEqual(
    times,
    [0, 7_000, 15_000, 31_000, 61_000, 91_000, 121_000, 125_000, 129_000],
  );
  h.dispose();
});

test("an error on a replaced source does not close the live source or schedule another reconnect", () => {
  const statuses: string[] = [];
  const h = start({ onConnection: (status) => statuses.push(status) });
  const stale = h.source();
  stale.emitError();
  mock.timers.tick(1_000);
  assert.equal(FakeEventSource.instances.length, 2);
  const live = h.source();
  assert.notEqual(live, stale);
  stale.emitError();
  assert.equal(live.closed, false);
  mock.timers.tick(10_000);
  assert.equal(FakeEventSource.instances.length, 2);
  assert.equal(live.closed, false);
  assert.deepEqual(statuses, ["disconnected"]);
  h.dispose();
});

test("ping frames every 10 seconds keep the watchdog from reconnecting for 120 seconds", () => {
  const h = start({
    fetchSnapshot: () => new Promise<BoardSnapshot>(() => {}),
  });
  const source = h.source();
  for (let i = 0; i < 12; i++) {
    mock.timers.tick(10_000);
    source.emitNamed("ping");
  }
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(source.closed, false);
  h.dispose();
});

test("a default message resets the backoff so the next error reconnects after 1 second", () => {
  const h = start();
  h.source().emitError();
  mock.timers.tick(1_000);
  h.source().emitError();
  mock.timers.tick(2_000);
  assert.equal(FakeEventSource.instances.length, 3);
  h.source().emitMessage(snap(1));
  h.source().emitError();
  mock.timers.tick(999);
  assert.equal(FakeEventSource.instances.length, 3);
  mock.timers.tick(1);
  assert.equal(FakeEventSource.instances.length, 4);
  h.dispose();
});

test("onerror starts polling without waiting for the 7 second idle timer", async () => {
  const h = start();
  await flush();
  mock.timers.tick(1_000);
  await flush();
  assert.equal(h.snapshotCalls(), 1);
  h.source().emitError();
  mock.timers.tick(0);
  await flush();
  assert.equal(h.snapshotCalls(), 2);
  assert.deepEqual(
    h.queryClient.getQueryData(boardSnapshotKeys.detail(50)),
    snap(102),
  );
  h.dispose();
});

const pendingState = {
  data: undefined,
  status: "pending",
  fetchStatus: "idle",
};

test("shouldPrefetchBoard is true for an empty cache", () => {
  assert.equal(shouldPrefetchBoard([]), true);
});

test("shouldPrefetchBoard is false when a query has data", () => {
  assert.equal(
    shouldPrefetchBoard([
      { state: { ...pendingState, data: {}, status: "success" } },
    ]),
    false,
  );
});

test("shouldPrefetchBoard is false when a query is fetching", () => {
  assert.equal(
    shouldPrefetchBoard([
      { state: { ...pendingState, fetchStatus: "fetching" } },
    ]),
    false,
  );
});

test("shouldPrefetchBoard is false when a query errored", () => {
  assert.equal(
    shouldPrefetchBoard([{ state: { ...pendingState, status: "error" } }]),
    false,
  );
});

test("shouldPrefetchBoard is true for an idle pending query without data", () => {
  assert.equal(shouldPrefetchBoard([{ state: pendingState }]), true);
});

test("latestBoard prefers the current snapshot", () => {
  const current = { cards: [] } as unknown as BoardSnapshot;
  const previous = { cards: [] } as unknown as BoardSnapshot;
  assert.equal(latestBoard(current, previous), current);
});

test("latestBoard keeps the previous snapshot when current is undefined", () => {
  const previous = { cards: [] } as unknown as BoardSnapshot;
  assert.equal(latestBoard(undefined, previous), previous);
});

test("latestBoard is null when both are empty", () => {
  assert.equal(latestBoard(undefined, null), null);
});
