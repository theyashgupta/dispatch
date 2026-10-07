import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { BoardSnapshot, Card } from "../../../../shared/types.js";
import {
  boardSnapshotKeys,
  tunnelKeys,
} from "@/queries/board-snapshot-queries";
import { getCard, unwindGroup } from "@/queries/cards-api";
import { moveCardMutationOptions } from "./board-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown, statusText = ""): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(
      new Response(status === 204 ? null : text, { status, statusText }),
    );
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

const card = { id: "c1", title: "A card" };

test("getCard resolves the card and members on a 200", async () => {
  reply(200, { card, members: [{ id: "m1" }] }, "OK");
  assert.deepEqual(await getCard("c1"), { card, members: [{ id: "m1" }] });
});

test("getCard resolves null on a 400", async () => {
  reply(400, { error: "unknown card" }, "Bad Request");
  assert.equal(await getCard("c1"), null);
});

test("getCard throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getCard("c1"),
    new Error("getCard failed: 500 Internal Server Error"),
  );
});

const archived = { id: "g1", members: [] };

test("unwindGroup resolves the archive summary on a 200", async () => {
  reply(200, { archived }, "OK");
  assert.deepEqual(await unwindGroup("c1", "todo"), { ok: true, archived });
  assert.equal(calls[0]?.url, "/api/cards/c1/unwind");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ to: "todo" }));
});

for (const [status, statusText] of [
  [400, "Bad Request"],
  [404, "Not Found"],
  [409, "Conflict"],
] as const) {
  test(`unwindGroup carries the server reason on a ${status}`, async () => {
    reply(status, { error: "reason" }, statusText);
    assert.deepEqual(await unwindGroup("c1", "inbox"), {
      ok: false,
      status,
      error: "reason",
    });
  });
}

test("unwindGroup falls back to the unwind copy when the body has no error", async () => {
  reply(409, {}, "Conflict");
  assert.deepEqual(await unwindGroup("c1", "inbox"), {
    ok: false,
    status: 409,
    error: "Couldn't unwind this group.",
  });
});

test("unwindGroup throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    unwindGroup("c1", "todo"),
    new Error("unwindGroup failed: 500 Internal Server Error"),
  );
});

const movedCard = {
  id: "c1",
  title: "A card",
  column: "todo",
} as unknown as Card;

function snapshotOf(column: string): BoardSnapshot {
  return {
    cards: [{ ...movedCard, column } as Card],
    syncedAt: null,
  };
}

function seededClient(): QueryClient {
  const client = newClient();
  client.setQueryData(boardSnapshotKeys.detail(20), snapshotOf("todo"));
  client.setQueryData(boardSnapshotKeys.detail(40), snapshotOf("todo"));
  client.setQueryData(tunnelKeys.state, { state: "up" });
  return client;
}

function columnIn(client: QueryClient, doneLimit: number): string | undefined {
  return client.getQueryData<BoardSnapshot>(boardSnapshotKeys.detail(doneLimit))
    ?.cards[0]?.column;
}

function moveWith(client: QueryClient, column = "in_progress") {
  return new MutationObserver(client, moveCardMutationOptions(client)).mutate({
    id: "c1",
    column: column as Card["column"],
  });
}

test("a 200 move keeps the new column in every snapshot entry and leaves the tunnel alone", async () => {
  const client = seededClient();
  reply(200, {}, "OK");
  await moveWith(client);
  assert.equal(columnIn(client, 20), "in_progress");
  assert.equal(columnIn(client, 40), "in_progress");
  assert.deepEqual(client.getQueryData(tunnelKeys.state), { state: "up" });
  assert.equal(calls[0]?.url, "/api/cards/c1/move");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ column: "in_progress" }));
});

test("the optimistic write is visible before the request resolves", async () => {
  const client = seededClient();
  let release: (res: Response) => void = () => undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  const pending = moveWith(client);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(columnIn(client, 20), "in_progress");
  assert.equal(columnIn(client, 40), "in_progress");
  release(new Response("{}", { status: 200 }));
  await pending;
});

test("a 409 rejects and restores the moved card's column without touching other cards", async () => {
  const client = seededClient();
  const other = { id: "c2", title: "Other", column: "todo" } as unknown as Card;
  let release: (res: Response) => void = () => undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  const pending = moveWith(client);
  const settled = assert.rejects(
    pending,
    new Error("moveCard failed: 409 Conflict"),
  );
  await new Promise((resolve) => setImmediate(resolve));
  client.setQueryData<BoardSnapshot>(
    boardSnapshotKeys.detail(20),
    (old) =>
      old && {
        ...old,
        cards: [...old.cards, { ...other, column: "in_review" }],
      },
  );
  release(new Response("{}", { status: 409, statusText: "Conflict" }));
  await settled;
  const after = client.getQueryData<BoardSnapshot>(
    boardSnapshotKeys.detail(20),
  );
  assert.equal(after?.cards.find((c) => c.id === "c1")?.column, "todo");
  assert.equal(after?.cards.find((c) => c.id === "c2")?.column, "in_review");
  assert.equal(columnIn(client, 40), "todo");
});

test("a 409 rollback leaves a snapshot entry without the card exactly as it was", async () => {
  const client = seededClient();
  const other = { id: "c2", title: "Other", column: "in_review" } as Card;
  const withoutCard: BoardSnapshot = { cards: [other], syncedAt: "s" };
  client.setQueryData(boardSnapshotKeys.detail(40), withoutCard);
  reply(409, {}, "Conflict");
  await moveWith(client).catch(() => undefined);
  assert.equal(columnIn(client, 20), "todo");
  assert.deepEqual(
    client.getQueryData(boardSnapshotKeys.detail(40)),
    withoutCard,
  );
});

test("a 409 rollback does not touch a card that reached an entry after the move began", async () => {
  const client = seededClient();
  const late = { id: "c1", title: "A card", column: "in_review" } as Card;
  client.setQueryData(boardSnapshotKeys.detail(40), {
    cards: [],
    syncedAt: null,
  });
  let release: (res: Response) => void = () => undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  const settled = assert.rejects(
    moveWith(client),
    new Error("moveCard failed: 409 Conflict"),
  );
  await new Promise((resolve) => setImmediate(resolve));
  client.setQueryData<BoardSnapshot>(boardSnapshotKeys.detail(40), {
    cards: [late],
    syncedAt: null,
  });
  release(new Response("{}", { status: 409, statusText: "Conflict" }));
  await settled;
  assert.equal(columnIn(client, 40), "in_review");
  assert.equal(columnIn(client, 20), "todo");
});

test("a move with no snapshot entries cached is a no-op that still settles", async () => {
  const client = newClient();
  client.setQueryData(tunnelKeys.state, { state: "up" });
  reply(200, {}, "OK");
  await moveWith(client);
  assert.equal(calls[0]?.url, "/api/cards/c1/move");
  assert.equal(client.getQueryCache().getAll().length, 1);
  assert.deepEqual(client.getQueryData(tunnelKeys.state), { state: "up" });
});

test("a failed move with no snapshot entries cached rejects and creates no entry", async () => {
  const client = newClient();
  reply(409, {}, "Conflict");
  await assert.rejects(
    moveWith(client),
    new Error("moveCard failed: 409 Conflict"),
  );
  assert.equal(client.getQueryCache().getAll().length, 0);
});

for (const status of [200, 409] as const) {
  test(`a ${status} move leaves the snapshot queries not invalidated`, async () => {
    const client = seededClient();
    reply(status, {}, "x");
    await moveWith(client).catch(() => undefined);
    for (const limit of [20, 40]) {
      assert.equal(
        client.getQueryState(boardSnapshotKeys.detail(limit))?.isInvalidated,
        false,
      );
    }
    assert.equal(client.getQueryState(tunnelKeys.state)?.isInvalidated, false);
  });
}

test("the move cancels snapshot queries before it sends the request", async () => {
  const client = seededClient();
  const order: string[] = [];
  const cancel = client.cancelQueries.bind(client);
  const cancelArgs: unknown[] = [];
  client.cancelQueries = (filters, options) => {
    order.push("cancel");
    cancelArgs.push(filters);
    return cancel(filters, options);
  };
  globalThis.fetch = () => {
    order.push("fetch");
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  await moveWith(client);
  assert.deepEqual(order, ["cancel", "fetch"]);
  assert.deepEqual(cancelArgs[0], { queryKey: ["board-snapshot"] });
});
