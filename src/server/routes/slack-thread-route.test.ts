import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Item } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem } from "../test-support/fake-source.js";

const env = isolateEnv();
const USER = "xoxp-g6-fake-user";

const express = (await import("express")).default;
const { slackRouter } = await import("./slack.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { createKey, listKeys, setValue, clearValue } =
  await import("../services/infra/vault.js");
const { store } = await import("../store/board.store.js");
await store.load();

const app = express();
app.use("/api", express.json(), slackRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Answer = (method: string, params: URLSearchParams) => Response;

const users: Answer = (_m, params) =>
  json(200, {
    ok: true,
    user: {
      profile: {
        display_name: params.get("user") === "U0R1ANA" ? "ana" : "ben",
      },
    },
  });

let answer: Answer = () => json(200, { ok: true });
let calls: { method: string; params: URLSearchParams }[] = [];

function slackItem(channel: string, ts: string, threadTs?: string): Item {
  return {
    id: `slack:${channel}:${ts}`,
    source: "slack",
    type: "mention",
    title: `ana in #eng-platform: ${ts}`,
    snippet: "look",
    createdAt: new Date(Number(ts) * 1000).toISOString(),
    priority: 75,
    state: "unread",
    meta: { channel, ts, ...(threadTs ? { threadTs } : {}) },
  };
}

const PARENT = slackItem("C0R1", "1700000100.000100", "1700000100.000100");
const NO_THREAD = slackItem("C0R2", "1700000200.000100");
const AUTH = slackItem("C0R3", "1700000300.000100", "1700000300.000100");
const GONE = slackItem("C0R4", "1700000400.000100", "1700000400.000100");
const LIMITED = slackItem("C0R5", "1700000500.000100", "1700000500.000100");
const FLAKY = slackItem("C0R7", "1700000700.000100", "1700000700.000100");
const NO_CHANNEL = slackItem("C0RC", "1700001100.000100", "1700001100.000100");
const DOWN = slackItem("C0RD", "1700001200.000100", "1700001200.000100");
const OTHER = fakeItem("thread", { meta: { channel: "C0R6", threadTs: "1" } });

await store.upsertItems(
  "slack",
  [PARENT, NO_THREAD, AUTH, GONE, LIMITED, FLAKY, NO_CHANNEL, DOWN],
  { kind: "append" },
);
await store.upsertItems("fake", [OTHER], { kind: "append" });

function enable(slack: Record<string, unknown> = { enabled: true }): void {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, slack },
  });
}

async function load(
  id: string,
): Promise<{ status: number; body: unknown; text: string }> {
  const res = await realFetch(`${base}/slack/thread/${encodeURIComponent(id)}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

const repliesCalls = () =>
  calls.filter((c) => c.method === "conversations.replies").length;

beforeEach(async () => {
  calls = [];
  answer = () => json(200, { ok: true });
  if ((await listKeys()).some((k) => k.name === "SLACK_USER_TOKEN")) {
    await setValue("SLACK_USER_TOKEN", USER);
  } else {
    await createKey({ name: "SLACK_USER_TOKEN", purpose: "p", value: USER });
  }
  enable();
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin === "https://slack.com") {
        const method = url.pathname.split("/").pop() ?? "";
        calls.push({ method, params: url.searchParams });
        return Promise.resolve(answer(method, url.searchParams));
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => mock.restoreAll());

test("an unknown item, a non-Slack item and a Slack item without a thread answer 404 with no Slack call", async () => {
  for (const id of ["slack:C0R9:1700000900.000100", OTHER.id, NO_THREAD.id]) {
    const res = await load(id);
    assert.equal(res.status, 404, id);
    assert.deepEqual(res.body, { error: "not-found" });
  }
  assert.equal(calls.length, 0);
});

test("the route answers 409 disabled while the Slack switch is not on, with no Slack call", async () => {
  for (const slack of [{ enabled: false }, {}]) {
    enable(slack);
    const res = await load(PARENT.id);
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "disabled" });
  }
  assert.equal(calls.length, 0);
});

test("the route answers 409 no-credential without a token, with no Slack call", async () => {
  await clearValue("SLACK_USER_TOKEN");
  const res = await load(PARENT.id);
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "no-credential" });
  assert.equal(calls.length, 0);
});

test("a thread parent answers 200 with the thread, and a second load within 10 minutes asks Slack nothing", async () => {
  answer = (method, params) =>
    method === "users.info"
      ? users(method, params)
      : json(200, {
          ok: true,
          messages: [
            { ts: "1700000100.000100", user: "U0R1ANA", text: "deploy is red" },
            { ts: "1700000160.000100", user: "U0R1BEN", text: "on it" },
          ],
          has_more: false,
        });
  const first = await load(PARENT.id);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    messages: [
      {
        author: "ana",
        time: "2023-11-14T22:15:00.000Z",
        text: "deploy is red",
      },
      { author: "ben", time: "2023-11-14T22:16:00.000Z", text: "on it" },
    ],
    truncated: false,
  });
  const read = calls.find((c) => c.method === "conversations.replies");
  assert.equal(read?.params.get("channel"), "C0R1");
  assert.equal(read?.params.get("ts"), "1700000100.000100");
  const second = await load(PARENT.id);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(repliesCalls(), 1);
});

test("switching Slack off blocks a thread that is still cached", async () => {
  const cached = await load(PARENT.id);
  assert.equal(cached.status, 200);
  const before = repliesCalls();
  enable({ enabled: false });
  try {
    const off = await load(PARENT.id);
    assert.equal(off.status, 409);
    assert.deepEqual(off.body, { error: "disabled" });
    assert.equal(repliesCalls(), before);
  } finally {
    enable();
  }
});

test("a thread and its names cached under one Slack token are asked again under another", async () => {
  answer = (method, params) =>
    method === "users.info"
      ? users(method, params)
      : json(200, {
          ok: true,
          messages: [
            { ts: "1700000100.000100", user: "U0R1ANA", text: "deploy is red" },
          ],
          has_more: false,
        });
  const cached = await load(PARENT.id);
  assert.equal(cached.status, 200);
  const before = repliesCalls();
  const namesBefore = calls.filter((c) => c.method === "users.info").length;
  await setValue("SLACK_USER_TOKEN", "xoxp-g6-fake-other");
  const other = await load(PARENT.id);
  assert.equal(other.status, 200);
  assert.equal(repliesCalls(), before + 1);
  assert.ok(
    calls.filter((c) => c.method === "users.info").length > namesBefore,
    "the other token starts with an empty name cache",
  );
});

test("a token code answers 401 rejected with the provider code", async () => {
  answer = () => json(200, { ok: false, error: "invalid_auth" });
  const res = await load(AUTH.id);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, {
    error: "rejected",
    providerError: "invalid_auth",
  });
});

test("thread_not_found answers 404 not-found", async () => {
  answer = () => json(200, { ok: false, error: "thread_not_found" });
  const res = await load(GONE.id);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "not-found" });
});

test("channel_not_found answers 404 and a Slack 503 answers 502 unreachable", async () => {
  answer = () => json(200, { ok: false, error: "channel_not_found" });
  const missing = await load(NO_CHANNEL.id);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: "not-found" });
  answer = () => json(503, {});
  const down = await load(DOWN.id);
  assert.equal(down.status, 502);
  assert.deepEqual(down.body, { error: "unreachable" });
});

test("a Slack 429 answers 429 rate-limited", async () => {
  answer = () => json(429, { ok: false, error: "ratelimited" });
  const res = await load(LIMITED.id);
  assert.equal(res.status, 429);
  assert.deepEqual(res.body, { error: "rate-limited" });
});

test("a Slack error is never cached, so the next load asks Slack again", async () => {
  answer = () => json(200, { ok: false, error: "fatal_error" });
  const failed = await load(FLAKY.id);
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.body, { error: "unreachable" });
  answer = (method, params) =>
    method === "users.info"
      ? users(method, params)
      : json(200, {
          ok: true,
          messages: [{ ts: "1700000700.000100", user: "U0R1ANA", text: "hi" }],
        });
  assert.equal((await load(FLAKY.id)).status, 200);
  assert.equal((await load(FLAKY.id)).status, 200);
  assert.equal(repliesCalls(), 2);
});

test("no thread response carries the token", async () => {
  const bodies: string[] = [];
  for (const [status, body] of [
    [200, { ok: false, error: "invalid_auth" }],
    [200, { ok: false, error: "thread_not_found" }],
    [200, { ok: false, error: "fatal_error" }],
    [429, { ok: false }],
    [503, {}],
  ] as const) {
    answer = () => json(status, body);
    bodies.push((await load(AUTH.id)).text);
  }
  bodies.push((await load(PARENT.id)).text);
  assert.ok(bodies.every((text) => !text.includes(USER)));
});
