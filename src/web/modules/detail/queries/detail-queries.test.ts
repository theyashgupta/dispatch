import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  assignCardToMe,
  ensureTerminal,
  getCardComments,
  postCardComment,
  runClaude,
  setCardLinearState,
} from "./detail-api.js";
import { openEditor, switchSession } from "@/queries/cards-api";
import {
  cardCommentsQueryOptions,
  cardEventsQueryOptions,
  detailKeys,
} from "./detail-queries.js";

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

test("detailKeys has the documented shape", () => {
  assert.deepEqual(detailKeys.all, ["detail"]);
  assert.deepEqual(detailKeys.comments("c1", 2, "k2"), [
    "detail",
    "card",
    "c1",
    "comments",
    2,
    "k2",
  ]);
});

test("a new comment on a full card changes the key through the last comment id", () => {
  assert.notDeepEqual(
    cardCommentsQueryOptions("c1", 5, "k5").queryKey,
    cardCommentsQueryOptions("c1", 5, "k6").queryKey,
  );
  assert.notDeepEqual(
    cardCommentsQueryOptions("c1", 5, "k5").queryKey,
    cardCommentsQueryOptions("c2", 5, "k5").queryKey,
  );
});

test("the comments placeholder keeps the list for the same card only", async () => {
  const first = [{ id: "k1", body: "hi", createdAt: "t", author: "me" }];
  reply(200, { comments: first });
  const client = newClient();
  const observer = new QueryObserver(
    client,
    cardCommentsQueryOptions("c1", 1, "k1"),
  );
  const unsubscribe = observer.subscribe(() => {});
  await client.fetchQuery(cardCommentsQueryOptions("c1", 1, "k1"));
  globalThis.fetch = () => new Promise<Response>(() => {});
  observer.setOptions(cardCommentsQueryOptions("c1", 2, "k2"));
  assert.deepEqual(observer.getCurrentResult().data, first);
  assert.equal(observer.getCurrentResult().isPlaceholderData, true);
  observer.setOptions(cardCommentsQueryOptions("c2", 1, "x1"));
  assert.deepEqual(observer.getCurrentResult().data, []);
  unsubscribe();
});

test("cardCommentsQueryOptions requests the comments route and resolves the list", async () => {
  const options = cardCommentsQueryOptions("a/b", 1, "k1");
  const comments = [{ id: "k1", body: "hi", createdAt: "t", author: "me" }];
  reply(200, { comments });
  assert.deepEqual(await newClient().fetchQuery(options), comments);
  assert.equal(calls[0]?.url, "/api/cards/a%2Fb/comments");
});

test("cardEventsQueryOptions requests one card's events and refetches on every mount", async () => {
  const options = cardEventsQueryOptions("c1");
  assert.deepEqual(options.queryKey, ["detail", "card", "c1", "events"]);
  assert.equal(options.staleTime, 0);
  reply(200, { events: [{ id: 3 }] });
  assert.deepEqual(await newClient().fetchQuery(options), [{ id: 3 }]);
  assert.equal(calls[0]?.url, "/api/events?cardId=c1");
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

test("ensureTerminal posts to the terminal route and resolves on a 202", async () => {
  reply(202, {}, "Accepted");
  await ensureTerminal("c1");
  assert.equal(calls[0]?.url, "/api/cards/c1/terminal");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("ensureTerminal throws on a failure status", async () => {
  reply(502, {}, "Bad Gateway");
  await assert.rejects(
    ensureTerminal("c1"),
    new Error("ensureTerminal failed: 502 Bad Gateway"),
  );
});

test("runClaude posts to the run-claude route and resolves on a 202", async () => {
  reply(202, {}, "Accepted");
  await runClaude("c1");
  assert.equal(calls[0]?.url, "/api/cards/c1/run-claude");
});

test("runClaude throws on a 409", async () => {
  reply(409, {}, "Conflict");
  await assert.rejects(
    runClaude("c1"),
    new Error("runClaude failed: 409 Conflict"),
  );
});

test("switchSession posts the session id and resolves on a 2xx", async () => {
  reply(200, {}, "OK");
  await switchSession("c1", "s2");
  assert.equal(calls[0]?.url, "/api/cards/c1/session");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ sessionId: "s2" }));
});

test("switchSession throws on a 400", async () => {
  reply(400, {}, "Bad Request");
  await assert.rejects(
    switchSession("c1", "s2"),
    new Error("switchSession failed: 400 Bad Request"),
  );
});

test("openEditor posts only the editor and resolves on a 204", async () => {
  reply(204, "", "No Content");
  await openEditor("c1", "cursor");
  assert.equal(calls[0]?.url, "/api/cards/c1/open-editor");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ editor: "cursor" }));
});

test("openEditor throws on a 409", async () => {
  reply(409, {}, "Conflict");
  await assert.rejects(
    openEditor("c1", "code"),
    new Error("openEditor failed: 409 Conflict"),
  );
});

test("postCardComment resolves ok on a 2xx and sends the body", async () => {
  reply(200, {}, "OK");
  assert.deepEqual(await postCardComment("c1", "hello"), { ok: true });
  assert.equal(calls[0]?.url, "/api/cards/c1/comment");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ body: "hello" }));
});

for (const [status, statusText] of [
  [400, "Bad Request"],
  [409, "Conflict"],
  [502, "Bad Gateway"],
] as const) {
  test(`postCardComment keeps a ${status} as typed data`, async () => {
    reply(status, { error: "reason" }, statusText);
    assert.deepEqual(await postCardComment("c1", "hello"), {
      ok: false,
      status,
      error: "reason",
    });
  });

  test(`assignCardToMe keeps a ${status} as typed data`, async () => {
    reply(status, { error: "reason" }, statusText);
    assert.deepEqual(await assignCardToMe("c1"), {
      ok: false,
      status,
      error: "reason",
    });
    assert.equal(calls[0]?.url, "/api/cards/c1/assign-me");
    assert.equal(calls[0]?.init?.body, undefined);
    assert.equal(calls[0]?.init?.headers, undefined);
  });

  test(`setCardLinearState keeps a ${status} as typed data`, async () => {
    reply(status, { error: "reason" }, statusText);
    assert.deepEqual(await setCardLinearState("c1", "st1"), {
      ok: false,
      status,
      error: "reason",
    });
    assert.equal(calls[0]?.url, "/api/cards/c1/linear-state");
    assert.equal(calls[0]?.init?.body, JSON.stringify({ stateId: "st1" }));
  });
}

test("a failure with no error field carries a null error", async () => {
  reply(502, {}, "Bad Gateway");
  assert.deepEqual(await postCardComment("c1", "hello"), {
    ok: false,
    status: 502,
    error: null,
  });
});

test("a network failure resolves as status 0 for the typed functions", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("offline"));
  const failed = { ok: false, status: 0, error: null };
  assert.deepEqual(await postCardComment("c1", "hello"), failed);
  assert.deepEqual(await assignCardToMe("c1"), failed);
  assert.deepEqual(await setCardLinearState("c1", "st1"), failed);
});

test("assignCardToMe and setCardLinearState resolve ok on a 2xx", async () => {
  reply(200, {}, "OK");
  assert.deepEqual(await assignCardToMe("c1"), { ok: true });
  assert.deepEqual(await setCardLinearState("c1", "st1"), { ok: true });
});
