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
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { createKey } = await import("../services/infra/vault.js");

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await createKey({ name: "SENTRY_TOKEN", purpose: "p", value: TOKEN });

const app = express();
app.use("/api", express.json(), sentryRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

let answer: () => Response = () => json(200, {});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sentryItem(id: string): Item {
  return fakeItem(id, {
    id: `sentry:${id}`,
    source: "sentry",
    meta: { org: "acme" },
  });
}

async function call(
  method: string,
  route: string,
): Promise<{ status: number; text: string }> {
  const res = await realFetch(`${base}${route}`, { method });
  return { status: res.status, text: await res.text() };
}

beforeEach(async () => {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, sentry: { enabled: true } },
  });
  await store.upsertItems("sentry", [sentryItem("102")], { kind: "snapshot" });
  await store.setItemState("sentry:102", "unread");
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === "sentry.io" || url.hostname.endsWith(".sentry.io")) {
        return answer();
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  mock.restoreAll();
});

for (const [method, suffix] of [
  ["GET", ""],
  ["POST", "/resolve"],
] as const) {
  test(`${method} with a non-digit issue id answers 400 invalid issue`, async () => {
    for (const id of ["abc", "0", "12a", "01", "1".repeat(21)]) {
      const res = await call(method, `/sentry/issue/${id}${suffix}`);
      assert.equal(res.status, 400, id);
      assert.equal(res.text, '{"error":"invalid issue"}', id);
    }
  });

  test(`${method} with an id that has no item answers 404 unknown item`, async () => {
    const res = await call(method, `/sentry/issue/999${suffix}`);
    assert.equal(res.status, 404);
    assert.equal(res.text, '{"error":"unknown item"}');
  });

  test(`${method} on a disabled source answers 401 no-credential`, async () => {
    setOrchestrationConfig({
      linearApiKey: "",
      sources: { linear: { apiKey: "" }, sentry: { enabled: false } },
    });
    const res = await call(method, `/sentry/issue/102${suffix}`);
    assert.equal(res.status, 401);
    assert.equal(res.text, '{"error":"no-credential"}');
  });

  const failures: [string, () => Response, number, string][] = [
    ["401 rejected", () => json(401, {}), 401, '{"error":"rejected"}'],
    ["403 forbidden", () => json(403, {}), 403, '{"error":"forbidden"}'],
    ["404 not-found", () => json(404, {}), 404, '{"error":"not-found"}'],
    ["429 rate-limited", () => json(429, {}), 429, '{"error":"rate-limited"}'],
    ["502 unreachable", () => json(500, {}), 502, '{"error":"unreachable"}'],
    [
      "502 unreachable on a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
      502,
      '{"error":"unreachable"}',
    ],
  ];
  for (const [name, reply, status, body] of failures) {
    test(`${method} answers ${name} when Sentry answers it`, async () => {
      answer = reply;
      const res = await call(method, `/sentry/issue/102${suffix}`);
      assert.equal(res.status, status);
      assert.equal(res.text, body);
    });
  }
}
