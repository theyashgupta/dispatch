import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { writeStubClaude } from "../test-support/stub-claude.js";

const env = isolateEnv();
writeStubClaude(env.binDir);
const pidFile = path.join(env.root, "stub.pid");
process.env.ASK_STUB_PID = pidFile;

const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { askRouter } = await import("./ask.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { AskError } = await import("../services/orchestration/ask.js");

await store.load();
const app = express();
app.use("/api", express.json({ limit: "5mb" }), askRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ask`;
after(() => {
  server.close();
  env.cleanup();
});

beforeEach(() => {
  fs.rmSync(pidFile, { force: true });
});

function post(body?: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

const turns = (n: number) =>
  Array.from({ length: n }, () => ({ role: "user", text: "t" }));

const INVALID: [string, unknown][] = [
  ["no body", undefined],
  ["an array body", []],
  ["an empty object", {}],
  ["an empty question", { question: "   ", history: [] }],
  ["a 2001 character question", { question: "q".repeat(2001), history: [] }],
  ["a non-string question", { question: 7, history: [] }],
  ["a missing history", { question: "q" }],
  ["a non-array history", { question: "q", history: "h" }],
  ["21 turns", { question: "q", history: turns(21) }],
  ["a bad role", { question: "q", history: [{ role: "system", text: "t" }] }],
  ["a missing role", { question: "q", history: [{ text: "t" }] }],
  [
    "a non-string turn text",
    { question: "q", history: [{ role: "user", text: 5 }] },
  ],
  [
    "an 8001 character turn",
    { question: "q", history: [{ role: "user", text: "t".repeat(8001) }] },
  ],
  ["a null turn", { question: "q", history: [null] }],
  ["a string turn", { question: "q", history: ["t"] }],
];

for (const [name, body] of INVALID) {
  test(`${name} answers 400 invalid ask and starts no subprocess`, async () => {
    process.env.ASK_STUB_MODE = "answer";
    const res = await post(body);
    assert.equal(res.status, 400);
    assert.equal(await res.text(), '{"error":"invalid ask"}');
    assert.equal(fs.existsSync(pidFile), false);
  });
}

test("a second request while one runs answers 409 ask-in-progress", async () => {
  process.env.ASK_STUB_MODE = "sleep";
  const controller = new AbortController();
  const first = post(
    { question: "first", history: [] },
    controller.signal,
  ).catch(() => null);
  assert.ok(await waitFor(() => fs.existsSync(pidFile), 5000));
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  const second = await post({ question: "second", history: [] });
  assert.equal(second.status, 409);
  assert.equal(await second.text(), '{"error":"ask-in-progress"}');
  controller.abort();
  await first;
  assert.ok(await waitFor(() => !alive(pid), 6000));
  await new Promise((r) => setTimeout(r, 300));
});

test("a failing CLI and an empty answer answer 502 ask-failed", async (t) => {
  t.mock.method(console, "error", () => undefined);
  for (const mode of ["fail", "empty"]) {
    process.env.ASK_STUB_MODE = mode;
    const res = await post({ question: "q", history: [] });
    assert.equal(res.status, 502, mode);
    assert.equal(await res.text(), '{"error":"ask-failed"}', mode);
  }
});

test("a failure that is not an AskError answers 502 ask-failed", async (t) => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(store, "snapshot", () => {
    throw new Error("snapshot broke");
  });
  const res = await post({ question: "q", history: [] });
  assert.equal(res.status, 502);
  assert.equal(await res.text(), '{"error":"ask-failed"}');
});

test("an Ask timeout answers 504 ask-timeout", async (t) => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(store, "snapshot", () => {
    throw new AskError("timeout");
  });
  const res = await post({ question: "q", history: [] });
  assert.equal(res.status, 504);
  assert.equal(await res.text(), '{"error":"ask-timeout"}');
});

test("the route accepts a new question after a failure", async () => {
  process.env.ASK_STUB_MODE = "answer";
  const res = await post({ question: "q", history: [] });
  assert.equal(res.status, 200);
});
