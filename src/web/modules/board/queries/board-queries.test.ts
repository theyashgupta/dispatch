import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { BoardSnapshot, Card } from "../../../../shared/types.js";
import {
  boardSnapshotKeys,
  tunnelKeys,
} from "@/queries/board-snapshot-queries";
import {
  generateTicketDraft,
  getCard,
  getCardComments,
  startCard,
  startGroup,
  syncCardToLinear,
  unwindGroup,
} from "./board-api.js";
import { createLocalTicket } from "@/queries/cards-api";
import {
  boardKeys,
  cardCommentsQueryOptions,
  cardQueryOptions,
  moveCardMutationOptions,
} from "./board-queries.js";

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

test("boardKeys has the documented shape", () => {
  assert.deepEqual(boardKeys.all, ["board"]);
  assert.deepEqual(boardKeys.detail("c1"), ["board", "card", "c1"]);
  assert.deepEqual(boardKeys.comments("c1"), [
    "board",
    "card",
    "c1",
    "comments",
  ]);
});

test("cardQueryOptions keys on the card id and requests /api/cards/:id", async () => {
  const options = cardQueryOptions("a/b");
  assert.deepEqual(options.queryKey, ["board", "card", "a/b"]);
  reply(200, { card, members: [] });
  assert.deepEqual(await newClient().fetchQuery(options), {
    card,
    members: [],
  });
  assert.equal(calls[0]?.url, "/api/cards/a%2Fb");
});

test("cardCommentsQueryOptions keys on the card id and requests the comments route", async () => {
  const options = cardCommentsQueryOptions("c1");
  assert.deepEqual(options.queryKey, ["board", "card", "c1", "comments"]);
  reply(200, { comments: [] });
  assert.deepEqual(await newClient().fetchQuery(options), []);
  assert.equal(calls[0]?.url, "/api/cards/c1/comments");
});

test("startCard sends the fresh-start body with folder and repos", async () => {
  reply(202, { started: true });
  await startCard("c1", "go", "/work", [{ path: "/work/a", base: "main" }]);
  assert.equal(calls[0]?.url, "/api/cards/c1/start");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({
      extraDirection: "go",
      folder: "/work",
      repos: [{ path: "/work/a", base: "main" }],
    }),
  );
});

test("startCard sends only the direction on a restart", async () => {
  reply(202, { started: true });
  await startCard("c1", "again");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ extraDirection: "again" }),
  );
});

test("startCard resolves ok on a 202", async () => {
  reply(202, { started: true }, "Accepted");
  assert.deepEqual(await startCard("c1", "go"), { ok: true });
});

test("startCard maps a 400 body to error and variant", async () => {
  reply(400, { error: "no repo", variant: "config" }, "Bad Request");
  assert.deepEqual(await startCard("c1", "go"), {
    ok: false,
    error: "no repo",
    variant: "config",
  });
});

test("startCard falls back to Start failed. on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await startCard("c1", "go"), {
    ok: false,
    error: "Start failed.",
    variant: undefined,
  });
});

test("startCard falls back to Start failed. on a 400 with a non-JSON body", async () => {
  reply(400, "<html>", "Bad Request");
  assert.deepEqual(await startCard("c1", "go"), {
    ok: false,
    error: "Start failed.",
    variant: undefined,
  });
});

test("startCard throws on any other status", async () => {
  reply(500, { error: "boom" }, "Internal Server Error");
  await assert.rejects(
    startCard("c1", "go"),
    new Error("startCard failed: 500 Internal Server Error"),
  );
});

const groupInput = {
  title: "G",
  memberIds: ["a", "b"],
  folder: "/work",
  repos: [{ path: "/work/a", base: "main" }],
};

test("startGroup resolves the created card on a 202", async () => {
  reply(202, { card }, "Accepted");
  assert.deepEqual(await startGroup(groupInput), { ok: true, card });
  assert.equal(calls[0]?.url, "/api/cards/group");
  assert.equal(calls[0]?.init?.body, JSON.stringify(groupInput));
});

test("startGroup keeps the config variant on a 400", async () => {
  reply(400, { error: "no repo", variant: "config" }, "Bad Request");
  assert.deepEqual(await startGroup(groupInput), {
    ok: false,
    error: "no repo",
    variant: "config",
  });
});

test("startGroup keeps the playbook variant on a 400", async () => {
  reply(400, { error: "bad playbook", variant: "playbook" }, "Bad Request");
  assert.deepEqual(await startGroup(groupInput), {
    ok: false,
    error: "bad playbook",
    variant: "playbook",
  });
});

test("startGroup drops an unknown variant on a 400", async () => {
  reply(400, { error: "x", variant: "ineligible" }, "Bad Request");
  assert.deepEqual(await startGroup(groupInput), {
    ok: false,
    error: "x",
    variant: undefined,
  });
});

test("startGroup falls back to Start failed. on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await startGroup(groupInput), {
    ok: false,
    error: "Start failed.",
    variant: undefined,
  });
});

test("startGroup reports the ineligible ids on a 409", async () => {
  reply(409, { error: "moved on", ineligibleIds: ["b"] }, "Conflict");
  assert.deepEqual(await startGroup(groupInput), {
    ok: false,
    error: "moved on",
    variant: "ineligible",
    ineligibleIds: ["b"],
  });
});

test("startGroup falls back to the eligibility copy and an empty id list on a 409", async () => {
  reply(409, {}, "Conflict");
  assert.deepEqual(await startGroup(groupInput), {
    ok: false,
    error: "Some selected tickets are no longer eligible.",
    variant: "ineligible",
    ineligibleIds: [],
  });
});

test("startGroup throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    startGroup(groupInput),
    new Error("startGroup failed: 500 Internal Server Error"),
  );
});

test("startGroup throws on a 2xx that is not a 202", async () => {
  reply(200, { card }, "OK");
  await assert.rejects(
    startGroup(groupInput),
    /^Error: startGroup failed: 200/,
  );
});

test("syncCardToLinear resolves the adopted card on a 200", async () => {
  reply(200, card, "OK");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: true,
    card,
  });
  assert.equal(calls[0]?.url, "/api/cards/c1/sync-linear");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ teamId: "t" }));
});

test("syncCardToLinear carries the server copy on a 400", async () => {
  reply(400, { error: "bad team" }, "Bad Request");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: "bad team",
  });
});

test("syncCardToLinear carries the server copy on a 409", async () => {
  reply(409, { error: "already synced" }, "Conflict");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: "already synced",
  });
});

test("syncCardToLinear answers a null error on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: null,
  });
});

test("syncCardToLinear answers a null error on any other status", async () => {
  reply(502, { error: "upstream" }, "Bad Gateway");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: null,
  });
});

test("syncCardToLinear answers a null error on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: null,
  });
});

test("generateTicketDraft resolves the draft on a 200", async () => {
  reply(200, { title: "T", description: "D" }, "OK");
  const signal = new AbortController().signal;
  assert.deepEqual(await generateTicketDraft("do it", signal, ["img"]), {
    ok: true,
    title: "T",
    description: "D",
  });
  assert.equal(calls[0]?.url, "/api/cards/draft");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ direction: "do it", images: ["img"] }),
  );
  assert.equal(calls[0]?.init?.signal, signal);
});

for (const [status, statusText] of [
  [400, "Bad Request"],
  [409, "Conflict"],
  [502, "Bad Gateway"],
] as const) {
  test(`generateTicketDraft resolves not ok on a ${status}`, async () => {
    reply(status, { error: "x" }, statusText);
    assert.deepEqual(
      await generateTicketDraft("do it", new AbortController().signal),
      { ok: false },
    );
  });
}

test("generateTicketDraft rejects on a network failure", async () => {
  const failure = new TypeError("Failed to fetch");
  globalThis.fetch = () => Promise.reject(failure);
  await assert.rejects(
    generateTicketDraft("do it", new AbortController().signal),
    (err) => err === failure,
  );
});

test("createLocalTicket resolves the created card on a 201", async () => {
  reply(201, card, "Created");
  assert.deepEqual(await createLocalTicket("T", "D"), { ok: true, card });
  assert.equal(calls[0]?.url, "/api/cards");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ title: "T", description: "D", images: [] }),
  );
});

test("createLocalTicket returns the error code on a 400", async () => {
  reply(400, { error: "title-required" }, "Bad Request");
  assert.deepEqual(await createLocalTicket("", "D"), {
    ok: false,
    error: "title-required",
  });
});

test("createLocalTicket answers a null error on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await createLocalTicket("", "D"), {
    ok: false,
    error: null,
  });
});

test("createLocalTicket answers a null error on any other status", async () => {
  reply(500, { error: "boom" }, "Internal Server Error");
  assert.deepEqual(await createLocalTicket("T", "D"), {
    ok: false,
    error: null,
  });
});

test("createLocalTicket answers a null error on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await createLocalTicket("T", "D"), {
    ok: false,
    error: null,
  });
});

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

test("getCardComments resolves the comments array on a 200", async () => {
  reply(200, { comments: [{ id: "k1" }] }, "OK");
  assert.deepEqual(await getCardComments("c1"), [{ id: "k1" }]);
});

test("getCardComments throws on a failure status", async () => {
  reply(404, {}, "Not Found");
  await assert.rejects(
    getCardComments("c1"),
    new Error("getCardComments failed: 404 Not Found"),
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
  test(`a ${status} move marks the snapshot queries invalidated`, async () => {
    const client = seededClient();
    reply(status, {}, "x");
    await moveWith(client).catch(() => undefined);
    for (const limit of [20, 40]) {
      assert.equal(
        client.getQueryState(boardSnapshotKeys.detail(limit))?.isInvalidated,
        true,
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
