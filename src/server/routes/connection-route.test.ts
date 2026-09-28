import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Config } from "../../shared/types.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-connection-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });

const express = (await import("express")).default;
const { connectionRouter } = await import("./connection.route.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources, sourceState } =
  await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");

const STORED = "lin_api_stored_key_value";
const NEW_KEY = "lin_api_new_key_value";
const FILTERS = { currentCycle: false, includeActive: true };
const realFetch = globalThis.fetch;

const app = express();
app.use("/api", express.json(), connectionRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/sources`;

type LinearReply = { status: number; body: unknown } | { throws: Error };

let linearCalls = 0;

function linearAnswers(reply: LinearReply): void {
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith("https://api.linear.app/")) {
        return realFetch(input, init);
      }
      linearCalls += 1;
      if ("throws" in reply) return Promise.reject(reply.throws);
      return Promise.resolve(
        new Response(JSON.stringify(reply.body), { status: reply.status }),
      );
    },
  );
}

const VIEWER = {
  status: 200,
  body: { data: { viewer: { id: "u1", name: "Ada", email: "ada@x.dev" } } },
};
const REJECTED = {
  status: 400,
  body: {
    errors: [{ message: "bad", extensions: { code: "AUTHENTICATION_ERROR" } }],
  },
};
const OUTAGE = { throws: new TypeError("fetch failed") };

function seed(withKey: boolean): void {
  const linear = withKey
    ? { apiKey: STORED, filters: FILTERS }
    : { filters: FILTERS };
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ port: 4799, sources: { linear } }, null, 2) + "\n",
    { mode: 0o600 },
  );
  const config = {
    linearApiKey: withKey ? STORED : "",
    port: 4799,
    sources: { linear: { apiKey: withKey ? STORED : "", filters: FILTERS } },
  } as Config;
  setOrchestrationConfig(config);
  rebuildSources(config);
}

const sha = () =>
  createHash("sha256").update(fs.readFileSync(CONFIG_PATH)).digest("hex");

function onDisk(): { apiKey?: string; filters?: unknown } {
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
    sources: { linear: { apiKey?: string; filters?: unknown } };
  };
  return parsed.sources.linear;
}

async function call(
  method: string,
  pathName: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await realFetch(`${base}${pathName}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  linearCalls = 0;
});

afterEach(() => {
  mock.restoreAll();
  stopPollers();
});

after(() => {
  stopPollers();
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("GET with no stored key reports unconfigured and never calls Linear", async () => {
  seed(false);
  linearAnswers(VIEWER);
  const res = await call("GET", "/linear/connection");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), {
    configured: false,
    connected: false,
  });
  assert.equal(linearCalls, 0);
});

test("GET with a valid stored key reports connected with the account", async () => {
  seed(true);
  linearAnswers(VIEWER);
  const res = await call("GET", "/linear/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: true,
    account: "Ada (ada@x.dev)",
  });
  assert.ok(!res.text.includes(STORED));
});

test("GET with a rejected stored key reports error rejected and keeps configured", async () => {
  seed(true);
  linearAnswers(REJECTED);
  const res = await call("GET", "/linear/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: false,
    error: "rejected",
  });
});

test("GET while Linear is unreachable reports error unreachable", async () => {
  seed(true);
  linearAnswers(OUTAGE);
  const res = await call("GET", "/linear/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: false,
    error: "unreachable",
  });
});

test("PUT with a missing or blank key answers 400 and writes nothing", async () => {
  seed(true);
  linearAnswers(VIEWER);
  const before = sha();
  for (const body of [{}, { apiKey: "   " }, { apiKey: 42 }]) {
    const res = await call("PUT", "/linear/key", body);
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.text), { error: "apiKey is required" });
  }
  assert.equal(sha(), before);
  assert.equal(linearCalls, 0);
});

test("PUT with a key Linear rejects answers 400 and leaves the file byte-identical", async () => {
  seed(true);
  linearAnswers(REJECTED);
  const before = sha();
  const res = await call("PUT", "/linear/key", { apiKey: NEW_KEY });
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.text), { error: "rejected" });
  assert.equal(sha(), before);
  assert.equal(getOrchestrationConfig()!.linearApiKey, STORED);
  assert.ok(!res.text.includes(NEW_KEY));
});

test("PUT while Linear is unreachable answers 502 and leaves the file byte-identical", async () => {
  seed(true);
  linearAnswers(OUTAGE);
  const before = sha();
  const res = await call("PUT", "/linear/key", { apiKey: NEW_KEY });
  assert.equal(res.status, 502);
  assert.deepEqual(JSON.parse(res.text), { error: "unreachable" });
  assert.equal(sha(), before);
});

test("PUT with a valid key persists it trimmed, keeps the filters and returns only the account", async () => {
  seed(false);
  linearAnswers(VIEWER);
  const res = await call("PUT", "/linear/key", { apiKey: `  ${NEW_KEY}  ` });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { account: "Ada (ada@x.dev)" });
  assert.ok(!res.text.includes(NEW_KEY));
  assert.deepEqual(onDisk(), { apiKey: NEW_KEY, filters: FILTERS });
  assert.equal(getOrchestrationConfig()!.linearApiKey, NEW_KEY);
});

test("DELETE removes the key, keeps the filters, and answers 204 again when nothing is stored", async () => {
  seed(true);
  linearAnswers(VIEWER);
  const first = await call("DELETE", "/linear/key");
  assert.equal(first.status, 204);
  assert.equal(first.text, "");
  assert.deepEqual(onDisk(), { filters: FILTERS });
  assert.equal(getOrchestrationConfig()!.linearApiKey, "");
  const before = sha();
  const second = await call("DELETE", "/linear/key");
  assert.equal(second.status, 204);
  assert.equal(sha(), before);
  const status = await call("GET", "/linear/connection");
  assert.deepEqual(JSON.parse(status.text), {
    configured: false,
    connected: false,
  });
});

test("a saved key enables the Linear source and a disconnect disables it again", async () => {
  seed(false);
  assert.equal(sourceState("linear"), "disabled");
  linearAnswers(VIEWER);
  assert.equal(
    (await call("PUT", "/linear/key", { apiKey: NEW_KEY })).status,
    200,
  );
  assert.equal(sourceState("linear"), "enabled");
  assert.equal((await call("DELETE", "/linear/key")).status, 204);
  assert.equal(sourceState("linear"), "disabled");
});

test("every route answers 404 for a source the registry does not serve", async () => {
  seed(true);
  linearAnswers(VIEWER);
  const before = sha();
  assert.equal((await call("GET", "/slack/connection")).status, 404);
  assert.equal(
    (await call("PUT", "/slack/key", { apiKey: NEW_KEY })).status,
    404,
  );
  assert.equal((await call("DELETE", "/slack/key")).status, 404);
  assert.equal(sha(), before);
  assert.equal(linearCalls, 0);
});

test("PUT with a key holding a control character answers 400 rejected without calling Linear", async () => {
  seed(true);
  linearAnswers(VIEWER);
  const before = sha();
  const res = await call("PUT", "/linear/key", { apiKey: "lin_api_x\ny" });
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.text), { error: "rejected" });
  assert.equal(linearCalls, 0);
  assert.equal(sha(), before);
});

test("a config that cannot be written answers 500 save-failed on PUT and DELETE, never the key", async () => {
  seed(true);
  linearAnswers(VIEWER);
  fs.writeFileSync(CONFIG_PATH, "{ not json", { mode: 0o600 });
  const put = await call("PUT", "/linear/key", { apiKey: NEW_KEY });
  assert.equal(put.status, 500);
  assert.deepEqual(JSON.parse(put.text), { error: "save-failed" });
  assert.ok(!put.text.includes(NEW_KEY));
  const del = await call("DELETE", "/linear/key");
  assert.equal(del.status, 500);
  assert.deepEqual(JSON.parse(del.text), { error: "save-failed" });
});

test("a DELETE that lands while a PUT is checking its key wins: the PUT answers 409 and writes nothing", async () => {
  seed(true);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith("https://api.linear.app/")) {
        return realFetch(input, init);
      }
      await gate;
      return new Response(JSON.stringify(VIEWER.body), { status: 200 });
    },
  );
  const pending = call("PUT", "/linear/key", { apiKey: NEW_KEY });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const del = await call("DELETE", "/linear/key");
  assert.equal(del.status, 204);
  release();
  const put = await pending;
  assert.equal(put.status, 409);
  assert.deepEqual(JSON.parse(put.text), { error: "superseded" });
  assert.equal(onDisk().apiKey, undefined);
  assert.equal(getOrchestrationConfig()!.linearApiKey, "");
});

test("a DELETE that fails to write does not discard a PUT checking its key at the same time", async () => {
  seed(true);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith("https://api.linear.app/")) {
        return realFetch(input, init);
      }
      await gate;
      return new Response(JSON.stringify(VIEWER.body), { status: 200 });
    },
  );
  const pending = call("PUT", "/linear/key", { apiKey: NEW_KEY });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const good = fs.readFileSync(CONFIG_PATH, "utf8");
  fs.writeFileSync(CONFIG_PATH, "{ not json", { mode: 0o600 });
  const del = await call("DELETE", "/linear/key");
  assert.equal(del.status, 500);
  fs.writeFileSync(CONFIG_PATH, good, { mode: 0o600 });
  release();
  const put = await pending;
  assert.equal(put.status, 200);
  assert.equal(onDisk().apiKey, NEW_KEY);
});

test("two replaces checking at the same time both save; neither is reported as superseded", async () => {
  seed(true);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith("https://api.linear.app/")) {
        return realFetch(input, init);
      }
      await gate;
      return new Response(JSON.stringify(VIEWER.body), { status: 200 });
    },
  );
  const first = call("PUT", "/linear/key", { apiKey: NEW_KEY });
  const second = call("PUT", "/linear/key", { apiKey: `${NEW_KEY}_2` });
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.ok([NEW_KEY, `${NEW_KEY}_2`].includes(onDisk().apiKey ?? ""));
});
