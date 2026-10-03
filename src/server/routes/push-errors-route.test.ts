import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { Server } from "node:http";
import { after, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { VAPID_KEYS_PATH } = await import("../services/infra/paths.js");
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { pushRouter } = await import("./push.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), pushRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}/api`;

after(() => {
  server.close();
  env.cleanup();
});

const ENDPOINT = "https://push.example.com/abc";
const KEYS = { p256dh: "p", auth: "a" };

async function post(
  route: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(base + route, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function expectError(
  route: string,
  body: unknown,
  status: number,
  error: string,
): Promise<void> {
  const res = await post(route, body);
  assert.equal(res.status, status);
  assert.equal(res.text, JSON.stringify({ error }));
}

test("GET /push/public-key answers 500 push-key-read-failed when the key file is corrupt", async (t) => {
  t.mock.method(console, "error", () => undefined);
  fs.writeFileSync(VAPID_KEYS_PATH, "not json");
  const res = await fetch(`${base}/push/public-key`);
  assert.equal(res.status, 500);
  assert.equal(await res.text(), '{"error":"push-key-read-failed"}');
  fs.rmSync(VAPID_KEYS_PATH);
});

for (const route of ["/push/subscribe", "/push/unsubscribe"]) {
  test(`POST ${route} with no body answers 400 invalid-endpoint`, async () => {
    await expectError(route, undefined, 400, "invalid-endpoint");
  });

  test(`POST ${route} with an array body answers 400 invalid-endpoint`, async () => {
    await expectError(route, [], 400, "invalid-endpoint");
  });

  test(`POST ${route} with a bad endpoint answers 400 invalid-endpoint`, async () => {
    const bad: unknown[] = [
      undefined,
      5,
      "",
      "http://push.example.com/abc",
      "https://",
      "https://exa mple.com/x",
      `https://${"a".repeat(2041)}`,
    ];
    for (const endpoint of bad) {
      await expectError(
        route,
        { endpoint, keys: KEYS },
        400,
        "invalid-endpoint",
      );
    }
  });
}

test("POST /push/subscribe with no keys answers 400 invalid-keys", async () => {
  await expectError(
    "/push/subscribe",
    { endpoint: ENDPOINT },
    400,
    "invalid-keys",
  );
});

test("POST /push/subscribe with bad keys answers 400 invalid-keys", async () => {
  const long = "k".repeat(513);
  const bad: unknown[] = [
    "keys",
    5,
    [],
    {},
    { p256dh: "p" },
    { auth: "a" },
    { p256dh: "", auth: "a" },
    { p256dh: "p", auth: "" },
    { p256dh: 1, auth: "a" },
    { p256dh: "p", auth: 1 },
    { p256dh: long, auth: "a" },
    { p256dh: "p", auth: long },
  ];
  for (const keys of bad) {
    await expectError(
      "/push/subscribe",
      { endpoint: ENDPOINT, keys },
      400,
      "invalid-keys",
    );
  }
});

test("POST /push/subscribe reports the endpoint failure before the keys failure", async () => {
  await expectError(
    "/push/subscribe",
    { endpoint: "nope", keys: "bad" },
    400,
    "invalid-endpoint",
  );
});

function postWithHost(
  host: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/push/subscribe",
        method: "POST",
        headers: { "Content-Type": "application/json", Host: host },
      },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("POST /push/subscribe from a non-loopback host with no known public host answers 400 unknown-origin", async () => {
  const res = await postWithHost("evil.example", {
    endpoint: ENDPOINT,
    keys: KEYS,
  });
  assert.equal(res.status, 400);
  assert.equal(res.text, '{"error":"unknown-origin"}');
});

test("POST /push/subscribe reports the keys failure before the origin failure", async () => {
  const res = await postWithHost("evil.example", { endpoint: ENDPOINT });
  assert.equal(res.status, 400);
  assert.equal(res.text, '{"error":"invalid-keys"}');
});

test("POST /push/subscribe answers 500 push-subscribe-failed when the store is not open", async (t) => {
  t.mock.method(console, "error", () => undefined);
  await expectError(
    "/push/subscribe",
    { endpoint: ENDPOINT, keys: KEYS },
    500,
    "push-subscribe-failed",
  );
});

test("POST /push/unsubscribe answers 500 push-unsubscribe-failed when the store is not open", async (t) => {
  t.mock.method(console, "error", () => undefined);
  await expectError(
    "/push/unsubscribe",
    { endpoint: ENDPOINT },
    500,
    "push-unsubscribe-failed",
  );
});

test("POST /push/subscribe answers 400 too-many-subscriptions when the store refuses the row", async (t) => {
  await store.load();
  t.mock.method(store, "addPushSubscription", () => false);
  await expectError(
    "/push/subscribe",
    { endpoint: ENDPOINT, keys: KEYS },
    400,
    "too-many-subscriptions",
  );
});
