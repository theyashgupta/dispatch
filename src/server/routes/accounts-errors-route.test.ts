import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configHolder = await import("../services/infra/config-holder.js");
const { accountsRouter } = await import("./accounts.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const express = (await import("express")).default;

configHolder.setOrchestrationConfig({ linearApiKey: "", port: 4700 });

const app = express();
app.use("/api", express.json(), accountsRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

const UNKNOWN_ID = "33333333-3333-4333-8333-333333333333";
const configPath = path.join(env.dispatchDir, "config.json");
const registryPath = path.join(
  env.dispatchDir,
  "claude-accounts",
  "accounts.json",
);

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function expectError(
  method: string,
  route: string,
  body: unknown,
  status: number,
  error: string,
): Promise<void> {
  const res = await call(method, route, body);
  assert.equal(
    res.status,
    status,
    `${method} ${route} ${JSON.stringify(body)}`,
  );
  assert.equal(res.text, JSON.stringify({ error }));
}

function withCorruptRegistry<T>(run: () => Promise<T>): Promise<T> {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, '{"accounts":[{"nope":1}]}');
  return run().finally(() => fs.rmSync(registryPath, { force: true }));
}

test("GET /accounts answers 500 accounts-read-failed on a malformed registry", async () => {
  await withCorruptRegistry(() =>
    expectError("GET", "/accounts", undefined, 500, "accounts-read-failed"),
  );
});

test("PUT /accounts/active answers 400 invalid-id for a missing or bad id", async () => {
  const bad: unknown[] = [undefined, {}, [], { id: null }, { id: 5 }];
  for (const body of bad) {
    await expectError("PUT", "/accounts/active", body, 400, "invalid-id");
  }
  for (const id of ["", "../etc", "x", "DEFAULT", "1111"]) {
    await expectError("PUT", "/accounts/active", { id }, 400, "invalid-id");
  }
});

test("PUT /accounts/active answers 404 not-found for an unregistered id", async () => {
  await expectError(
    "PUT",
    "/accounts/active",
    { id: UNKNOWN_ID },
    404,
    "not-found",
  );
});

test("PUT /accounts/active answers 500 accounts-write-failed when the config is corrupt", async () => {
  const before = fs.readFileSync(configPath, "utf8");
  fs.writeFileSync(configPath, "not json");
  try {
    await expectError(
      "PUT",
      "/accounts/active",
      { id: "default" },
      500,
      "accounts-write-failed",
    );
  } finally {
    fs.writeFileSync(configPath, before);
  }
});

test("POST /accounts/login answers 400 invalid-id for a bad accountId", async () => {
  for (const accountId of ["x", "", null, 5, "default", "../etc", []]) {
    await expectError(
      "POST",
      "/accounts/login",
      { accountId },
      400,
      "invalid-id",
    );
  }
});

test("POST /accounts/login answers 404 not-found for an unregistered accountId", async () => {
  await expectError(
    "POST",
    "/accounts/login",
    { accountId: UNKNOWN_ID },
    404,
    "not-found",
  );
});

test("POST /accounts/login answers 500 login-start-failed on a malformed registry", async () => {
  await withCorruptRegistry(() =>
    expectError(
      "POST",
      "/accounts/login",
      { accountId: UNKNOWN_ID },
      500,
      "login-start-failed",
    ),
  );
});

test("POST /accounts/login/code answers 400 invalid-code for a missing or bad code", async () => {
  const bad: unknown[] = [
    undefined,
    {},
    [],
    { code: null },
    { code: 5 },
    { code: "" },
    { code: "   " },
    { code: "ab\ncd" },
    { code: "ab\rcd" },
    { code: "x".repeat(513) },
  ];
  for (const body of bad) {
    await expectError(
      "POST",
      "/accounts/login/code",
      body,
      400,
      "invalid-code",
    );
  }
});

test("POST /accounts/login/code answers 409 not-awaiting when no login waits", async () => {
  await expectError(
    "POST",
    "/accounts/login/code",
    { code: "x" },
    409,
    "not-awaiting",
  );
  await expectError(
    "POST",
    "/accounts/login/code",
    { code: "x".repeat(512) },
    409,
    "not-awaiting",
  );
});

test("POST /accounts/login answers 409 in-flight while a login runs", async () => {
  const started = await call("POST", "/accounts/login", {});
  assert.equal(started.status, 202);
  await expectError("POST", "/accounts/login", {}, 409, "in-flight");
  await expectError("POST", "/accounts/login", undefined, 409, "in-flight");
  const cancelled = await call("DELETE", "/accounts/login");
  assert.equal(cancelled.status, 200);
});

test("POST /accounts/login accepts an array body as no accountId", async () => {
  const started = await call("POST", "/accounts/login", []);
  assert.equal(started.status, 202);
  await call("DELETE", "/accounts/login");
});

test("POST /accounts/:id/usage/refresh answers 400, 404 and 500", async () => {
  await expectError(
    "POST",
    "/accounts/nope/usage/refresh",
    undefined,
    400,
    "invalid-id",
  );
  await expectError(
    "POST",
    `/accounts/${UNKNOWN_ID}/usage/refresh`,
    undefined,
    404,
    "not-found",
  );
  await withCorruptRegistry(() =>
    expectError(
      "POST",
      `/accounts/${UNKNOWN_ID}/usage/refresh`,
      undefined,
      500,
      "usage-refresh-failed",
    ),
  );
});

test("POST /accounts/default/usage/refresh answers 429 too-soon on the second call", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (new URL(url).hostname !== "api.anthropic.com") {
      return realFetch(input, init);
    }
    return Promise.resolve(new Response(JSON.stringify({ limits: [] })));
  };
  try {
    const first = await call("POST", "/accounts/default/usage/refresh");
    assert.equal(first.status, 200);
    await expectError(
      "POST",
      "/accounts/default/usage/refresh",
      undefined,
      429,
      "too-soon",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("DELETE /accounts/:id answers 400 invalid-id and default-account", async () => {
  await expectError("DELETE", "/accounts/nope", undefined, 400, "invalid-id");
  await expectError(
    "DELETE",
    "/accounts/default",
    undefined,
    400,
    "default-account",
  );
});

test("DELETE /accounts/:id answers 404 not-found and 500 accounts-write-failed", async () => {
  await expectError(
    "DELETE",
    `/accounts/${UNKNOWN_ID}`,
    undefined,
    404,
    "not-found",
  );
  await withCorruptRegistry(() =>
    expectError(
      "DELETE",
      `/accounts/${UNKNOWN_ID}`,
      undefined,
      500,
      "accounts-write-failed",
    ),
  );
});
