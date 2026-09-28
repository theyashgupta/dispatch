import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { RateLimited } from "../ticket.source.js";
import { fetchSlackThread } from "./slack-thread.js";

const TOKEN = "xoxp-g6-fake-user";

afterEach(() => mock.restoreAll());

type Answer = (params: URLSearchParams) => {
  status?: number;
  body: Record<string, unknown>;
};

interface Call {
  method: string;
  params: URLSearchParams;
  url: string;
  auth: string | null;
}

function stubSlack(handlers: Record<string, Answer>): Call[] {
  const calls: Call[] = [];
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const method = url.pathname.split("/").pop() ?? "";
      calls.push({
        method,
        params: url.searchParams,
        url: url.toString(),
        auth: new Headers(init?.headers).get("authorization"),
      });
      const handler = handlers[method];
      const { status = 200, body } = handler
        ? handler(url.searchParams)
        : { body: { ok: false, error: "unknown_method" } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );
  return calls;
}

const users: Answer = (p) => {
  const id = p.get("user") ?? "";
  return {
    body: {
      ok: true,
      user: { name: id, profile: { display_name: id.slice(4).toLowerCase() } },
    },
  };
};

const replies =
  (messages: unknown[], extra: Record<string, unknown> = {}): Answer =>
  () => ({ body: { ok: true, messages, ...extra } });

const iso = (ts: string) => new Date(Number(ts) * 1000).toISOString();

test("replies map to author, ISO time and rendered text in Slack's order, parent first", async () => {
  const calls = stubSlack({
    "users.info": users,
    "conversations.replies": replies([
      { ts: "1700000100.000100", user: "U0T1ANA", text: "deploy is red" },
      {
        ts: "1700000160.000200",
        user: "U0T1BEN",
        text: "on it <@U0T1ANA> &amp; <#C0G6ENG|eng-platform>",
      },
      { ts: "1700000220.000300", user: "U0T1ANA", text: "thanks" },
    ]),
  });
  const result = await fetchSlackThread(
    TOKEN,
    "C0T1",
    "1700000100.000100",
    new Map(),
  );
  assert.deepEqual(result, {
    ok: true,
    messages: [
      {
        author: "ana",
        time: iso("1700000100.000100"),
        text: "deploy is red",
      },
      {
        author: "ben",
        time: iso("1700000160.000200"),
        text: "on it @ana & #eng-platform",
      },
      { author: "ana", time: iso("1700000220.000300"), text: "thanks" },
    ],
    truncated: false,
  });
  assert.equal(
    result.ok && result.messages[0].time,
    "2023-11-14T22:15:00.000Z",
  );
  const read = calls.find((c) => c.method === "conversations.replies");
  assert.equal(read?.params.get("channel"), "C0T1");
  assert.equal(read?.params.get("ts"), "1700000100.000100");
});

test("a user mentioned before any message of theirs is looked up and rendered by name", async () => {
  const calls = stubSlack({
    "users.info": users,
    "conversations.replies": replies([
      {
        ts: "1700001000.000100",
        user: "U0T9IVY",
        text: "<@U0T9GIL> and <@U0T9HAL|hal> please look",
      },
    ]),
  });
  const result = await fetchSlackThread(
    TOKEN,
    "C0T9",
    "1700001000.000100",
    new Map(),
  );
  assert.ok(result.ok);
  assert.equal(result.messages[0].text, "@gil and @hal please look");
  assert.deepEqual(
    calls
      .filter((c) => c.method === "users.info")
      .map((c) => c.params.get("user")),
    ["U0T9IVY", "U0T9GIL", "U0T9HAL"],
  );
});

test("a bot message stays in the thread, named by its username or else its bot id", async () => {
  const calls = stubSlack({
    "users.info": users,
    "conversations.replies": replies([
      { ts: "1700000300.000100", user: "U0T2CAT", text: "ship it?" },
      {
        ts: "1700000301.000100",
        bot_id: "B0T2DEP",
        username: "deploy-bot",
        text: "build 42 passed",
      },
      { ts: "1700000302.000100", bot_id: "B0T2CI", text: "lint ok" },
    ]),
  });
  const result = await fetchSlackThread(
    TOKEN,
    "C0T2",
    "1700000300.000100",
    new Map(),
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.messages.map((m) => m.author),
    ["cat", "deploy-bot", "B0T2CI"],
  );
  assert.equal(calls.filter((c) => c.method === "users.info").length, 1);
});

test("the request asks for 40 messages and has_more true marks the thread truncated", async () => {
  const calls = stubSlack({
    "users.info": users,
    "conversations.replies": replies(
      [{ ts: "1700000400.000100", user: "U0T3DAN", text: "first" }],
      { has_more: true },
    ),
  });
  const result = await fetchSlackThread(
    TOKEN,
    "C0T3",
    "1700000400.000100",
    new Map(),
  );
  assert.ok(result.ok);
  assert.equal(result.truncated, true);
  const read = calls.find((c) => c.method === "conversations.replies");
  assert.equal(read?.params.get("limit"), "40");
});

test("a Slack refusal answers ok false with Slack's code", async () => {
  stubSlack({
    "conversations.replies": () => ({
      body: { ok: false, error: "thread_not_found" },
    }),
  });
  assert.deepEqual(
    await fetchSlackThread(TOKEN, "C0T4", "1700000500.000100", new Map()),
    {
      ok: false,
      code: "thread_not_found",
    },
  );
});

test("an HTTP 429 throws RateLimited", async () => {
  stubSlack({
    "conversations.replies": () => ({ status: 429, body: { ok: false } }),
  });
  await assert.rejects(
    fetchSlackThread(TOKEN, "C0T5", "1700000600.000100", new Map()),
    RateLimited,
  );
});

test("a malformed row is dropped and the rest of the thread stays", async () => {
  stubSlack({
    "users.info": users,
    "conversations.replies": replies([
      { ts: "1700000700.000100", user: "U0T6EVE", text: "parent" },
      { ts: "not-a-ts", user: "U0T6EVE", text: "bad ts" },
      { ts: "1700000701.000100", user: 42, text: "bad user" },
      null,
      { ts: "1700000702.000100", user: "U0T6EVE", text: "reply" },
    ]),
  });
  const result = await fetchSlackThread(
    TOKEN,
    "C0T6",
    "1700000700.000100",
    new Map(),
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ["parent", "reply"],
  );
});

test("the token rides only the Authorization header, never a URL", async () => {
  const calls = stubSlack({
    "users.info": users,
    "conversations.replies": replies([
      { ts: "1700000800.000100", user: "U0T7FAY", text: "hi" },
    ]),
  });
  await fetchSlackThread(TOKEN, "C0T7", "1700000800.000100", new Map());
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.auth, `Bearer ${TOKEN}`);
    assert.equal(call.url.includes(TOKEN), false);
  }
});

test("one call makes at most 20 users.info lookups and falls back to the user id", async () => {
  const authors = Array.from(
    { length: 25 },
    (_, i) => `U0T8${String(i).padStart(3, "0")}`,
  );
  const calls = stubSlack({
    "users.info": users,
    "conversations.replies": replies(
      authors.map((user, i) => ({
        ts: `17000009${String(i).padStart(2, "0")}.000100`,
        user,
        text: "msg",
      })),
    ),
  });
  const result = await fetchSlackThread(
    TOKEN,
    "C0T8",
    "1700000900.000100",
    new Map(),
  );
  assert.ok(result.ok);
  assert.equal(calls.filter((c) => c.method === "users.info").length, 20);
  assert.equal(result.messages.length, 25);
  assert.equal(result.messages[19].author, "019");
  assert.equal(result.messages[20].author, "U0T8020");
  assert.equal(result.messages[24].author, "U0T8024");
});

test("a users.info lookup that fails in transport keeps the thread and names the author by id", async () => {
  stubSlack({
    "conversations.replies": () => ({
      body: {
        ok: true,
        messages: [
          {
            ts: "1700002000.000100",
            user: "U0TFLAKY",
            text: "<@U0TMENT> ping",
          },
        ],
      },
    }),
    "users.info": () => ({ status: 503, body: { ok: false } }),
  });
  const result = await fetchSlackThread(
    TOKEN,
    "C0TX",
    "1700002000.000100",
    new Map(),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.messages, [
    {
      author: "U0TFLAKY",
      time: "2023-11-14T22:46:40.000Z",
      text: "@U0TMENT ping",
    },
  ]);
});
