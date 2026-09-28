import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { RateLimited } from "../ticket.source.js";
import { slackAuthTest, slackGet, type SlackReadMethod } from "./slack-api.js";

const TOKEN = "xoxp-g6-fake-user";

interface Seen {
  url: URL;
  headers: Record<string, string>;
}

function stubFetch(answer: (url: URL) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  mock.method(globalThis, "fetch", (input: URL, init?: RequestInit) => {
    const url = new URL(input);
    seen.push({ url, headers: init?.headers as Record<string, string> });
    return Promise.resolve(answer(url));
  });
  return seen;
}

const json = (status: number, body: unknown, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

afterEach(() => mock.restoreAll());

test("slackGet sends GET to the method path with params and the token only in the header", async () => {
  const seen = stubFetch(() => json(200, { ok: true }));
  await slackGet(TOKEN, "users.conversations", {
    types: "public_channel",
    limit: 200,
    cursor: undefined,
  });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.pathname.endsWith("/users.conversations"));
  assert.equal(seen[0].url.searchParams.get("types"), "public_channel");
  assert.equal(seen[0].url.searchParams.get("limit"), "200");
  assert.equal(seen[0].url.searchParams.has("cursor"), false);
  assert.equal(seen[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(seen[0].headers["User-Agent"], "dispatch");
  assert.equal(seen[0].url.toString().includes(TOKEN), false);
});

test("slackGet refuses a method outside the read allowlist before any fetch", async () => {
  const seen = stubFetch(() => json(200, { ok: true }));
  await assert.rejects(
    slackGet(TOKEN, "admin.users.list" as unknown as SlackReadMethod),
    /not a Slack read method/,
  );
  assert.equal(seen.length, 0);
});

test("auth.test ok with a user token gives the account, user id and team url", async () => {
  stubFetch(() =>
    json(200, {
      ok: true,
      url: "https://acme.slack.com/",
      team: "Acme",
      user: "g6-tester",
      user_id: "U0G6USER",
      team_id: "T0G6",
    }),
  );
  assert.deepEqual(await slackAuthTest(TOKEN), {
    account: "g6-tester @ Acme",
    userId: "U0G6USER",
    teamUrl: "https://acme.slack.com/",
  });
});

test("auth.test ok with a bot token carries the bot id", async () => {
  stubFetch(() =>
    json(200, {
      ok: true,
      url: "https://acme.slack.com/",
      team: "Acme",
      user: "dispatch-bot",
      user_id: "U0G6BOT",
      bot_id: "B0G6",
    }),
  );
  const auth = await slackAuthTest("xoxb-g6-fake-bot");
  assert.ok("botId" in auth);
  assert.equal(auth.botId, "B0G6");
  assert.equal(auth.account, "dispatch-bot @ Acme");
});

for (const code of ["invalid_auth", "token_revoked", "account_inactive"]) {
  test(`auth.test ok false with ${code} is a rejection carrying the code`, async () => {
    stubFetch(() => json(200, { ok: false, error: code }));
    assert.deepEqual(await slackAuthTest(TOKEN), { rejected: code });
  });
}

test("auth.test HTTP 429 throws RateLimited", async () => {
  stubFetch(() => json(429, { ok: false }, { "Retry-After": "1" }));
  await assert.rejects(slackAuthTest(TOKEN), RateLimited);
});

test("auth.test HTTP 502 throws and never reads as a rejection", async () => {
  stubFetch(() => json(502, {}));
  await assert.rejects(slackAuthTest(TOKEN), /Slack answered HTTP 502/);
});

test("a 200 body that is not JSON throws without quoting the body", async () => {
  stubFetch(() => new Response("<html><body>proxy error</body></html>"));
  await assert.rejects(slackAuthTest(TOKEN), (err: Error) => {
    assert.equal(err.message, "Slack answered a body that is not JSON");
    return true;
  });
});

test("a body read that fails mid-stream keeps its own error", async () => {
  const broken = new ReadableStream({
    start(controller) {
      controller.error(new TypeError("terminated"));
    },
  });
  stubFetch(() => new Response(broken));
  await assert.rejects(slackAuthTest(TOKEN), /terminated/);
});

test("a network failure throws and never reads as a rejection", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new TypeError("fetch failed")),
  );
  await assert.rejects(slackAuthTest(TOKEN), TypeError);
});

test("a timeout throws", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new DOMException("timed out", "TimeoutError")),
  );
  await assert.rejects(slackAuthTest(TOKEN), /timed out/);
});
