import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem as item } from "../test-support/fake-source.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { itemsRouter } = await import("./items.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });
await store.load();

const app = express();
app.use("/api", express.json(), itemsRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

await store.upsertItems("fake", [item("a"), item("promoted")], {
  kind: "snapshot",
});

interface Reply {
  status: number;
  text: string;
}

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function expectError(
  reply: Promise<Reply>,
  status: number,
  text: string,
  label = "",
): Promise<void> {
  const got = await reply;
  assert.equal(got.status, status, label);
  assert.equal(got.text, text, label);
}

const future = () => new Date(Date.now() + 3_600_000).toISOString();

test("GET /items answers 400 invalid state for a bad or repeated state", async () => {
  const text = '{"error":"invalid state"}';
  for (const query of [
    "?state=bogus",
    "?state=",
    "?state=Read",
    "?state=read&state=done",
    "?state=bogus&source=a&source=b",
  ]) {
    await expectError(call("GET", `/items${query}`), 400, text, query);
  }
});

test("GET /items answers 400 invalid source for a repeated source", async () => {
  const text = '{"error":"invalid source"}';
  for (const query of ["?source=a&source=b", "?state=read&source=a&source=b"]) {
    await expectError(call("GET", `/items${query}`), 400, text, query);
  }
});

test("POST /items/:id/state answers 400 invalid state for a bad body", async () => {
  const bad: unknown[] = [
    undefined,
    [],
    {},
    { state: "snoozed" },
    { state: "gone" },
    { state: 5 },
    { state: null },
    { state: ["read"] },
  ];
  for (const body of bad) {
    await expectError(
      call("POST", "/items/fake:a/state", body),
      400,
      '{"error":"invalid state"}',
      JSON.stringify(body),
    );
  }
});

test("POST /items/:id/snooze answers 400 for a missing, malformed, past or too far time", async () => {
  const text = '{"error":"until must be a future ISO time"}';
  const bad: unknown[] = [
    undefined,
    [],
    {},
    { until: 5 },
    { until: null },
    { until: "soon" },
    { until: "99999" },
    { until: new Date(Date.now() - 60_000).toISOString() },
    { until: "10000-01-01T00:00:00.000Z" },
  ];
  for (const body of bad) {
    await expectError(
      call("POST", "/items/fake:a/snooze", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
});

test("POST /items/:id/promote answers 400 invalid context for a non-string or long context", async () => {
  const bad: unknown[] = [
    { context: 5 },
    { context: null },
    { context: ["x"] },
    { context: "x".repeat(8001) },
  ];
  for (const body of bad) {
    await expectError(
      call("POST", "/items/fake:a/promote", body),
      400,
      '{"error":"invalid context"}',
      JSON.stringify(body).slice(0, 40),
    );
  }
});

test("state, snooze and promote answer 404 unknown item for an id with no item", async () => {
  const text = '{"error":"unknown item"}';
  await expectError(
    call("POST", "/items/fake:nope/state", { state: "read" }),
    404,
    text,
  );
  await expectError(
    call("POST", "/items/fake:nope/snooze", { until: future() }),
    404,
    text,
  );
  for (const body of [undefined, [], {}, { context: "x".repeat(8000) }]) {
    await expectError(
      call("POST", "/items/fake:nope/promote", body),
      404,
      text,
      JSON.stringify(body)?.slice(0, 40),
    );
  }
});

test("state and snooze answer 409 item is promoted for a promoted item", async () => {
  assert.equal(
    (await call("POST", "/items/fake:promoted/promote")).status,
    201,
  );
  const text = '{"error":"item is promoted"}';
  await expectError(
    call("POST", "/items/fake:promoted/state", { state: "unread" }),
    409,
    text,
  );
  await expectError(
    call("POST", "/items/fake:promoted/snooze", { until: future() }),
    409,
    text,
  );
});
