import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { installCalendarStubs } from "../test-support/calendar-stubs.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const stubs = installCalendarStubs(env);
stubs.useHelper();

const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { getOrchestrationConfig, setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");
const { invalidatePermission } =
  await import("../services/orchestration/calendar.js");
const { calendarRouter } = await import("./calendar.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const config: import("../../shared/types.js").Config = {
  linearApiKey: "",
  sources: { linear: { apiKey: "" }, calendar: { mode: "macos" } },
};
setOrchestrationConfig(config);
rebuildSources(config);
await store.load();

const app = express();
app.use("/api", express.json(), calendarRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  stopPollers();
  server.close();
  env.cleanup();
});

beforeEach(() => {
  invalidatePermission();
  stubs.reset();
  stubs.helperReply({ status: 3 }, "status");
  stubs.helperReply({ status: 3 }, "request");
});

function check(): Promise<Response> {
  return fetch(`${base}/calendar/access/check`, { method: "POST" });
}

test("R1: POST access/check answers 200 with the permission state", async () => {
  const res = await check();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.permission, "granted");
  assert.deepEqual(body.missingCalendars, []);
  assert.equal(stubs.calls("open", "request"), 1);
});

test("R2: two concurrent checks start one request and share the answer", async () => {
  stubs.helperDelay("request", 1);
  const [a, b] = await Promise.all([check(), check()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(stubs.calls("open", "request"), 1);
});

test("R3: a request that gets no answer answers 200 with prompt-timeout", async () => {
  stubs.helperReply({ status: 0, timedOut: true }, "request");
  const res = await check();
  assert.equal(res.status, 200);
  assert.equal(
    ((await res.json()) as { permission: string }).permission,
    "prompt-timeout",
  );
  const status = (await (await fetch(`${base}/calendar/status`)).json()) as {
    permission: string;
  };
  assert.equal(status.permission, "prompt-timeout");
});

test("R4: a request that fails answers 200 with unknown instead of a 500", async () => {
  stubs.helperMode("fail");
  const res = await check();
  assert.equal(res.status, 200);
  assert.equal(
    ((await res.json()) as { permission: string }).permission,
    "unknown",
  );
});

test("R5: a status read that fails answers 200 with unknown and caches it", async () => {
  stubs.helperMode("fail");
  const first = await fetch(`${base}/calendar/status`);
  assert.equal(first.status, 200);
  assert.equal(
    ((await first.json()) as { permission: string }).permission,
    "unknown",
  );
  assert.equal(stubs.calls("open", "status"), 1);
  const second = await fetch(`${base}/calendar/status`);
  assert.equal(second.status, 200);
  assert.equal(
    ((await second.json()) as { permission: string }).permission,
    "unknown",
  );
  assert.equal(stubs.calls("open", "status"), 1);
});

test("R6: a check that rejects answers 500 with the check-failed error", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const saved = getOrchestrationConfig();
  setOrchestrationConfig({
    linearApiKey: "",
    get sources(): never {
      throw new Error("config unreadable\nsecond line");
    },
  });
  try {
    const res = await check();
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "check-failed" });
  } finally {
    setOrchestrationConfig(saved ?? config);
  }
  assert.deepEqual(warn.mock.calls[0]?.arguments, [
    "[calendar/access-check] failed:",
    "config unreadable",
  ]);
});
