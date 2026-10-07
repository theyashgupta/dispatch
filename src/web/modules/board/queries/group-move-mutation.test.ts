import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { BoardSnapshot, Card, Column } from "../../../../shared/types.js";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../../../shared/board-key.js";
import { boardSnapshotKeys } from "@/queries/board-snapshot-queries";
import type { FailedMoveEvent } from "@/modules/board/domain/failed-move-notice";
import type { GroupMove } from "@/modules/board/domain/group-move";
import { groupMoveMutationOptions } from "./board-queries.js";

const realFetch = globalThis.fetch;
const realError = console.error;
const requests: { id: string; column: string }[] = [];
let errors: unknown[][] = [];
let failure: (id: string, column: string, attempt: number) => boolean;

const card = (id: string, column: Column): Card =>
  ({ id, title: id, column }) as unknown as Card;

function stubFetch(): void {
  const attempts = new Map<string, number>();
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    const path =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const id = decodeURIComponent(path.split("/")[3] ?? "");
    const { column } = JSON.parse(init?.body as string) as { column: string };
    requests.push({ id, column });
    const key = `${id}:${column}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    const status = failure(id, column, attempt) ? 409 : 200;
    return Promise.resolve(new Response("{}", { status, statusText: "x" }));
  };
}

beforeEach(() => {
  failure = () => false;
  errors = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  requests.length = 0;
  mock.timers.reset();
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

function supersede(client: QueryClient): void {
  void groupMoveMutationOptions(client).mutationFn({
    moves: [],
    column: "done",
  });
}

function seeded(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const snapshot: BoardSnapshot = {
    cards: [card("a", "todo"), card("b", "todo"), card("c", "todo")],
    boardKey: LOCAL,
    syncedAt: null,
  };
  client.setQueryData(boardSnapshotKeys.detail(LOCAL, 20), snapshot);
  return client;
}

function columns(client: QueryClient): string[] {
  return (
    client
      .getQueryData<BoardSnapshot>(boardSnapshotKeys.detail(LOCAL, 20))
      ?.cards.map((c) => c.column) ?? []
  );
}

const FROM_TODO: GroupMove[] = [
  { id: "a", from: "todo" },
  { id: "b", from: "todo" },
  { id: "c", from: "todo" },
];

function run(
  client: QueryClient,
  events: FailedMoveEvent[],
  extra: { signal?: AbortSignal; column?: Column; moves?: GroupMove[] } = {},
) {
  return new MutationObserver(client, groupMoveMutationOptions(client)).mutate({
    moves: extra.moves ?? FROM_TODO,
    column: extra.column ?? "done",
    onProgress: (event) => events.push(event),
    signal: extra.signal,
  });
}

test("every move succeeding keeps the target column and reports no failure", async () => {
  const client = seeded();
  const events: FailedMoveEvent[] = [];
  assert.equal(await run(client, events), "succeeded");
  assert.deepEqual(columns(client), ["done", "done", "done"]);
  assert.deepEqual(events, [{ type: "succeeded" }]);
  assert.equal(requests.length, 3);
  assert.deepEqual(errors, []);
});

test("the group write is visible before the requests resolve", async () => {
  const client = seeded();
  const releases: (() => void)[] = [];
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      releases.push(() => resolve(new Response("{}", { status: 200 })));
    });
  const pending = run(client, []);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(columns(client), ["done", "done", "done"]);
  assert.equal(releases.length, 3);
  for (const release of releases) release();
  assert.equal(await pending, "succeeded");
});

test("the group write lands before mutate returns", async () => {
  const client = seeded();
  const pending = run(client, []);
  assert.deepEqual(columns(client), ["done", "done", "done"]);
  assert.equal(requests.length, 0);
  assert.equal(await pending, "succeeded");
});

test("the run survives the options swap a re-render makes between onMutate and mutationFn", async () => {
  const client = seeded();
  const observer = new MutationObserver(
    client,
    groupMoveMutationOptions(client),
  );
  const pending = observer.mutate({ moves: FROM_TODO, column: "done" });
  observer.setOptions(groupMoveMutationOptions(client));
  assert.equal(await pending, "succeeded");
  assert.equal(requests.length, 3);
});

test("the run writes and sends only the planned moves", async () => {
  const client = seeded();
  const moves: GroupMove[] = [{ id: "b", from: "todo" }];
  assert.equal(await run(client, [], { moves }), "succeeded");
  assert.deepEqual(requests, [{ id: "b", column: "done" }]);
  assert.deepEqual(columns(client), ["todo", "done", "todo"]);
});

test("an older snapshot entry with a stale column for a card does not change the plan or its compensation", async () => {
  failure = (id, column) => id === "b" && column === "in_review";
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  client.setQueryData<BoardSnapshot>(boardSnapshotKeys.detail(LOCAL, 50), {
    cards: [card("a", "in_progress"), card("b", "todo")],
    boardKey: LOCAL,
    syncedAt: null,
  });
  client.setQueryData<BoardSnapshot>(boardSnapshotKeys.detail(LOCAL, 100), {
    cards: [card("a", "todo"), card("b", "todo")],
    boardKey: LOCAL,
    syncedAt: null,
  });
  const moves: GroupMove[] = [
    { id: "a", from: "todo" },
    { id: "b", from: "todo" },
  ];
  assert.equal(await run(client, [], { moves, column: "in_review" }), "failed");
  assert.deepEqual(
    requests.map((r) => `${r.id}:${r.column}`),
    ["a:in_review", "b:in_review", "a:todo"],
  );
  assert.deepEqual(
    client
      .getQueryData<BoardSnapshot>(boardSnapshotKeys.detail(LOCAL, 100))
      ?.cards.map((c) => c.column),
    ["todo", "todo"],
  );
});

test("one failure among three restores every card, reports failed with count 3, compensates the two that moved and settles", async () => {
  failure = (id, column) => id === "b" && column === "done";
  const client = seeded();
  const events: FailedMoveEvent[] = [];
  assert.equal(await run(client, events), "failed");
  assert.deepEqual(columns(client), ["todo", "todo", "todo"]);
  assert.equal(events[0]?.type, "failed");
  const id = (events[0] as { id: number }).id;
  assert.deepEqual(events, [
    { type: "failed", id, count: 3 },
    { type: "settled", id },
  ]);
  const compensation = requests.slice(3);
  assert.deepEqual(compensation.map((r) => `${r.id}:${r.column}`).sort(), [
    "a:todo",
    "c:todo",
  ]);
  assert.equal(errors.length, 1);
  assert.equal(
    errors[0]?.[0],
    "performGroupMove failed; restoring the previous columns",
  );
});

test("a failed compensation is retried once after 300 ms and then succeeds", async () => {
  failure = (id, column, attempt) =>
    (id === "b" && column === "done") ||
    (id === "a" && column === "todo" && attempt === 1);
  const client = seeded();
  const events: FailedMoveEvent[] = [];
  const startedAt = Date.now();
  await run(client, events);
  assert.ok(Date.now() - startedAt >= 290);
  assert.equal(
    requests.filter((r) => r.id === "a" && r.column === "todo").length,
    2,
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["failed", "settled"],
  );
  assert.equal(errors.length, 1);
});

test("a failed retry marks the notice stranded and still settles", async () => {
  failure = (id, column) =>
    (id === "b" && column === "done") || (id === "a" && column === "todo");
  const client = seeded();
  const events: FailedMoveEvent[] = [];
  await run(client, events);
  assert.equal(
    requests.filter((r) => r.id === "a" && r.column === "todo").length,
    2,
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["failed", "stranded", "settled"],
  );
  assert.equal(errors.length, 2);
  assert.equal(
    errors[1]?.[0],
    "performGroupMove compensation failed after one retry; card stranded",
  );
});

test("a card the allowlist cannot return is stranded at once and gets no compensation request", async () => {
  failure = (id) => id === "b";
  const client = seeded();
  client.setQueryData<BoardSnapshot>(boardSnapshotKeys.detail(LOCAL, 20), {
    cards: [card("a", "agent_done"), card("b", "todo"), card("c", "todo")],
    boardKey: LOCAL,
    syncedAt: null,
  });
  const events: FailedMoveEvent[] = [];
  await run(client, events, {
    moves: [
      { id: "a", from: "agent_done" },
      { id: "b", from: "todo" },
      { id: "c", from: "todo" },
    ],
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ["failed", "stranded", "settled"],
  );
  assert.deepEqual(
    requests.slice(3).map((r) => `${r.id}:${r.column}`),
    ["c:todo"],
  );
  assert.equal(
    errors[1]?.[0],
    "performGroupMove cannot compensate a move the manual allowlist refuses; cards stranded",
  );
});

test("a run superseded by a newer group move sends its moves, then stops with no events and no restore", async () => {
  failure = (_id, column, attempt) => column === "done" && attempt === 1;
  const client = seeded();
  const firstEvents: FailedMoveEvent[] = [];
  const first = run(client, firstEvents);
  const second = run(client, [], { column: "in_review" });
  assert.equal(await first, "superseded");
  assert.equal(await second, "succeeded");
  assert.equal(requests.length, 6);
  assert.deepEqual(firstEvents, []);
  assert.deepEqual(columns(client), ["in_review", "in_review", "in_review"]);
});

test("a run whose signal aborts in flight still finishes and reports nothing", async () => {
  const client = seeded();
  const controller = new AbortController();
  const events: FailedMoveEvent[] = [];
  const pending = run(client, events, { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, "succeeded");
  assert.equal(requests.length, 3);
  assert.deepEqual(events, []);
  assert.deepEqual(columns(client), ["done", "done", "done"]);
});

test("a run whose signal aborts before a request fails still restores and compensates, and reports nothing", async () => {
  failure = (id, column) => id === "b" && column === "done";
  const client = seeded();
  const controller = new AbortController();
  const events: FailedMoveEvent[] = [];
  const pending = run(client, events, { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, "failed");
  assert.deepEqual(columns(client), ["todo", "todo", "todo"]);
  assert.deepEqual(
    requests
      .slice(3)
      .map((r) => `${r.id}:${r.column}`)
      .sort(),
    ["a:todo", "c:todo"],
  );
  assert.deepEqual(events, []);
});

test("a run superseded after its restore write stops before compensating", async () => {
  failure = (id, column) => id === "b" && column === "done";
  const client = seeded();
  const events: FailedMoveEvent[] = [];
  const outcome = await new MutationObserver(
    client,
    groupMoveMutationOptions(client),
  ).mutate({
    moves: FROM_TODO,
    column: "done",
    onProgress: (event) => {
      events.push(event);
      if (event.type === "failed") supersede(client);
    },
  });
  assert.equal(outcome, "superseded");
  assert.deepEqual(columns(client), ["todo", "todo", "todo"]);
  assert.equal(requests.length, 3);
  assert.deepEqual(
    events.map((e) => e.type),
    ["failed"],
  );
});

test("a run superseded during the 300 ms compensation retry stops without the retry request", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  failure = (id, column, attempt) =>
    (id === "b" && column === "done") ||
    (id === "a" && column === "todo" && attempt === 1);
  const client = seeded();
  const events: FailedMoveEvent[] = [];
  const pending = run(client, events);
  await flush();
  supersede(client);
  mock.timers.tick(300);
  assert.equal(await pending, "superseded");
  assert.equal(
    requests.filter((r) => r.id === "a" && r.column === "todo").length,
    1,
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["failed"],
  );
});

test("an abort followed by a failed request still restores, compensates and retries silently", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  failure = (id, column, attempt) =>
    (id === "b" && column === "done") ||
    (id === "a" && column === "todo" && attempt === 1);
  const client = seeded();
  const controller = new AbortController();
  const events: FailedMoveEvent[] = [];
  const pending = run(client, events, { signal: controller.signal });
  controller.abort();
  await flush();
  mock.timers.tick(300);
  assert.equal(await pending, "failed");
  assert.deepEqual(columns(client), ["todo", "todo", "todo"]);
  assert.deepEqual(
    requests
      .slice(3)
      .map((r) => `${r.id}:${r.column}`)
      .sort(),
    ["a:todo", "a:todo", "c:todo"],
  );
  assert.deepEqual(events, []);
});

test("a stranded card is restored in the cache and the stranded ids and target column are logged", async () => {
  failure = (id) => id === "b";
  const client = seeded();
  client.setQueryData<BoardSnapshot>(boardSnapshotKeys.detail(LOCAL, 20), {
    cards: [card("a", "agent_done"), card("b", "todo"), card("c", "todo")],
    boardKey: LOCAL,
    syncedAt: null,
  });
  await run(client, [], {
    moves: [
      { id: "a", from: "agent_done" },
      { id: "b", from: "todo" },
      { id: "c", from: "todo" },
    ],
  });
  assert.deepEqual(columns(client), ["agent_done", "todo", "todo"]);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors[1]?.slice(1), [["a"], "done"]);
});
