import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  queueLinearFetch,
  restoreFetch,
} from "../test-support/linear-fetch.js";

const env = isolateEnv();
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { setupRouter } = await import("./setup.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), setupRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});
afterEach(() => {
  restoreFetch();
  setOrchestrationConfig({ linearApiKey: "" });
});

async function expectError(
  route: string,
  body: unknown,
  status: number,
  error: string,
): Promise<void> {
  const res = await fetch(base + route, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(res.status, status);
  assert.equal(await res.text(), JSON.stringify({ error }));
}

test("POST /setup/install with no body answers 400 not-installable", async () => {
  await expectError("/setup/install", undefined, 400, "not-installable");
});

test("POST /setup/install with an array body answers 400 not-installable", async () => {
  await expectError("/setup/install", [], 400, "not-installable");
});

test("POST /setup/install with a bad target answers 400 not-installable", async () => {
  for (const target of [undefined, 5, "", "rm", "claude", "../tmux", "TMUX"]) {
    await expectError("/setup/install", { target }, 400, "not-installable");
  }
});

test("POST /setup with a key already stored answers 409 already-configured", async () => {
  setOrchestrationConfig({ linearApiKey: "existing" });
  await expectError("/setup", { apiKey: "new" }, 409, "already-configured");
});

test("POST /setup with a key already stored answers 409 before it checks the body", async () => {
  setOrchestrationConfig({ linearApiKey: "existing" });
  await expectError("/setup", undefined, 409, "already-configured");
});

test("POST /setup with no body answers 400 apiKey is required", async () => {
  await expectError("/setup", undefined, 400, "apiKey is required");
});

test("POST /setup with an array body answers 400 apiKey is required", async () => {
  await expectError("/setup", [], 400, "apiKey is required");
});

test("POST /setup with a missing, non-text or blank apiKey answers 400 apiKey is required", async () => {
  for (const apiKey of [undefined, 5, null, "", "   "]) {
    await expectError("/setup", { apiKey }, 400, "apiKey is required");
  }
});

test("POST /setup answers 400 rejected when Linear rejects the key", async () => {
  queueLinearFetch([
    [
      401,
      {
        errors: [
          { message: "raw", extensions: { code: "AUTHENTICATION_ERROR" } },
        ],
      },
    ],
  ]);
  await expectError("/setup", { apiKey: "bad" }, 400, "rejected");
});

test("POST /setup answers 502 unreachable when the Linear check fails", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    return url.startsWith("http://127.0.0.1")
      ? real(input, init)
      : Promise.reject(new TypeError("fetch failed"));
  };
  await expectError("/setup", { apiKey: "k" }, 502, "unreachable");
});
