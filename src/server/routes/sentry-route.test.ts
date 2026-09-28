import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Item } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem } from "../test-support/fake-source.js";

const env = isolateEnv();
const TOKEN = ["g5", "fake", "sentry", "token"].join("-");

const express = (await import("express")).default;
const { store } = await import("../store/board.store.js");
const { sentryRouter } = await import("./sentry.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { createKey } = await import("../services/domain/vault.js");

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await createKey({ name: "SENTRY_TOKEN", purpose: "p", value: TOKEN });

const app = express();
app.use("/api", express.json(), sentryRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

interface SentryCall {
  method: string;
  url: URL;
  body: unknown;
  auth: string;
}

let calls: SentryCall[] = [];
let answer: (call: SentryCall) => Response = () => json(200, {});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const issue = {
  id: "101",
  title: "TypeError: cannot read id",
  culprit: "resolveUser(src/users)",
  permalink: "https://acme.sentry.io/issues/101/",
  shortId: "API-101",
  level: "fatal",
  count: "12",
  userCount: 3,
  firstSeen: "2026-09-20T09:00:00Z",
  lastSeen: "2026-09-25T09:00:00Z",
  status: "unresolved",
  project: { slug: "api" },
};

function detailAnswer(c: SentryCall): Response {
  if (c.url.pathname.endsWith("/events/latest/")) {
    return json(200, { entries: [], tags: [{ key: "env", value: "prod" }] });
  }
  return json(200, issue);
}

function sentryItem(id: string, regionUrl?: string): Item {
  return fakeItem(id, {
    id: `sentry:${id}`,
    source: "sentry",
    meta: { org: "acme", ...(regionUrl ? { regionUrl } : {}) },
  });
}

async function call(
  method: string,
  route: string,
): Promise<{ status: number; text: string }> {
  const res = await realFetch(`${base}${route}`, { method });
  return { status: res.status, text: await res.text() };
}

const itemState = (id: string) => store.getItem(`sentry:${id}`)?.state;

beforeEach(async () => {
  calls = [];
  answer = detailAnswer;
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, sentry: { enabled: true } },
  });
  await store.upsertItems(
    "sentry",
    [
      sentryItem("101", "https://de.sentry.io"),
      sentryItem("102"),
      sentryItem("103", "https://evil.example"),
    ],
    { kind: "snapshot" },
  );
  for (const id of ["101", "102", "103"]) {
    await store.setItemState(`sentry:${id}`, "unread");
  }
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (
        url.hostname.endsWith("sentry.io") ||
        url.hostname === "evil.example"
      ) {
        const record: SentryCall = {
          method: init?.method ?? "GET",
          url,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          auth: new Headers(init?.headers).get("authorization") ?? "",
        };
        calls.push(record);
        return answer(record);
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  mock.restoreAll();
});

test("a non-digit issue id answers 400 and an id with no item 404, before any Sentry call", async () => {
  for (const route of [
    "/sentry/issue/abc",
    "/sentry/issue/0",
    "/sentry/issue/12a",
    "/sentry/issue/abc/resolve",
  ]) {
    const method = route.endsWith("/resolve") ? "POST" : "GET";
    assert.equal((await call(method, route)).status, 400, route);
  }
  assert.equal((await call("GET", "/sentry/issue/999")).status, 404);
  assert.equal((await call("POST", "/sentry/issue/999/resolve")).status, 404);
  assert.equal(calls.length, 0);
});

test("the detail reads the issue and its latest event on the allowed region with the token in the header only", async () => {
  const res = await call("GET", "/sentry/issue/101");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text) as { count: unknown; tags: unknown };
  assert.equal(body.count, 12);
  assert.deepEqual(body.tags, [{ key: "env", value: "prod" }]);
  assert.deepEqual(
    calls.map((c) => `${c.url.origin}${c.url.pathname}`),
    [
      "https://de.sentry.io/api/0/organizations/acme/issues/101/",
      "https://de.sentry.io/api/0/organizations/acme/issues/101/events/latest/",
    ],
  );
  assert.equal(calls[0]?.auth, `Bearer ${TOKEN}`);
  assert.ok(!res.text.includes(TOKEN));
});

test("a stored region that is not allowed falls back to the base URL", async () => {
  assert.equal((await call("GET", "/sentry/issue/103")).status, 200);
  assert.ok(calls.length > 0);
  for (const c of calls) assert.equal(c.url.origin, "https://sentry.io");
});

test("a disabled source answers no-credential without calling Sentry", async () => {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, sentry: { enabled: false } },
  });
  const res = await call("GET", "/sentry/issue/101");
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.text), { error: "no-credential" });
  assert.equal(calls.length, 0);
});

test("resolve sends status resolved and marks the item done", async () => {
  const res = await call("POST", "/sentry/issue/102/resolve");
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "PUT");
  assert.equal(
    calls[0]?.url.href,
    "https://sentry.io/api/0/organizations/acme/issues/102/",
  );
  assert.deepEqual(calls[0]?.body, { status: "resolved" });
  assert.equal(itemState("102"), "done");
});

test("a refused resolve leaves the item untouched", async () => {
  answer = () => json(500, { detail: TOKEN });
  const res = await call("POST", "/sentry/issue/102/resolve");
  assert.equal(res.status, 502);
  assert.equal(calls.length, 1);
  assert.equal(itemState("102"), "unread");
});

test("Sentry failures map to error kinds without the token or the raw body", async () => {
  const cases: [Response, number, Record<string, unknown>][] = [
    [json(401, { detail: TOKEN }), 401, { error: "rejected" }],
    [json(403, { detail: TOKEN }), 403, { error: "forbidden" }],
    [json(404, { detail: "Not found" }), 404, { error: "not-found" }],
    [json(429, { detail: "slow" }), 429, { error: "rate-limited" }],
    [json(500, { detail: TOKEN }), 502, { error: "unreachable" }],
  ];
  for (const [response, status, body] of cases) {
    answer = () => response.clone();
    const res = await call("GET", "/sentry/issue/101");
    assert.equal(res.status, status);
    assert.deepEqual(JSON.parse(res.text), body);
    assert.ok(!res.text.includes(TOKEN));
  }
  answer = () => {
    throw new TypeError("fetch failed");
  };
  const thrown = await call("POST", "/sentry/issue/102/resolve");
  assert.equal(thrown.status, 502);
  assert.equal(itemState("102"), "unread");
});

test("a latest event Sentry refuses still answers the issue without its event", async () => {
  answer = (c) =>
    c.url.pathname.endsWith("/events/latest/")
      ? json(404, { detail: "no events" })
      : json(200, issue);
  const res = await call("GET", "/sentry/issue/101");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text) as {
    exception: unknown;
    frames: unknown[];
    count: number;
  };
  assert.equal(body.exception, null);
  assert.deepEqual(body.frames, []);
  assert.equal(body.count, 12);
});

test("a rejected token on the latest event still fails the read", async () => {
  answer = (c) =>
    c.url.pathname.endsWith("/events/latest/")
      ? json(401, {})
      : json(200, issue);
  const res = await call("GET", "/sentry/issue/101");
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.text), { error: "rejected" });
});

test("a network failure on the latest event still answers the issue without its event", async () => {
  answer = (c) => {
    if (c.url.pathname.endsWith("/events/latest/")) {
      throw new TypeError("fetch failed");
    }
    return json(200, issue);
  };
  const res = await call("GET", "/sentry/issue/101");
  assert.equal(res.status, 200);
  assert.equal(
    (JSON.parse(res.text) as { exception: unknown }).exception,
    null,
  );
});

test("a resolve Sentry refuses with 401, 403 or 429 leaves the item unread", async () => {
  for (const status of [401, 403, 429]) {
    answer = () => json(status, { detail: "no" });
    const res = await call("POST", "/sentry/issue/102/resolve");
    assert.equal(res.status, status, String(status));
    assert.equal(itemState("102"), "unread", String(status));
  }
});

test("resolve on a stored region that is not allowed goes to the base URL", async () => {
  const res = await call("POST", "/sentry/issue/103/resolve");
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url.origin, "https://sentry.io");
  assert.equal(itemState("103"), "done");
});
