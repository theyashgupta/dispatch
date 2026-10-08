import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { writeStubClaude } from "../test-support/stub-claude.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
writeStubClaude(env.binDir);
const pidFile = path.join(env.root, "stub.pid");
const stdinFile = path.join(env.root, "stub.stdin");
const argvFile = path.join(env.root, "stub.argv");
process.env.ASK_STUB_PID = pidFile;
process.env.ASK_STUB_STDIN = stdinFile;
process.env.ASK_STUB_ARGV = argvFile;

const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { askRouter } = await import("./ask.route.js");
const { askClaude, AskError } =
  await import("../services/orchestration/ask.js");

await store.load();
await store.createLocalCard(DEFAULT_BOARD_KEY, "Fix the flaky login test", "");
const app = express();
app.use("/api", express.json({ limit: "5mb" }), askRouter);
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
  fs.rmSync(stdinFile, { force: true });
});

function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

async function captureErrors<T>(fn: () => Promise<T>): Promise<string> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

void test("a valid question answers 200 with the stub answer and the prompt carries the board and the prior turn", async () => {
  process.env.ASK_STUB_MODE = "answer";
  const res = await post({
    question: "which of those is older?",
    history: [
      { role: "user", text: "what needs me right now" },
      { role: "assistant", text: "prior answer zq81" },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { answer: "Stub answer: LOCAL-921" });
  const prompt = fs.readFileSync(stdinFile, "utf8");
  assert.ok(prompt.includes("Fix the flaky login test"));
  assert.ok(prompt.includes("Assistant: prior answer zq81"));
  assert.ok(prompt.endsWith("User: which of those is older?"));
  const argv = fs.readFileSync(argvFile, "utf8").trim().split("\n");
  assert.deepEqual(argv, [
    "-p",
    "--output-format",
    "text",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--settings",
    '{"disableAllHooks":true}',
  ]);
});

void test("a second request while one runs answers 409 and starts no subprocess", async () => {
  process.env.ASK_STUB_MODE = "sleep";
  const controller = new AbortController();
  const first = post(
    { question: "first", history: [] },
    controller.signal,
  ).catch(() => null);
  assert.ok(await waitFor(() => fs.existsSync(pidFile), 5000));
  const firstPid = fs.readFileSync(pidFile, "utf8").trim();
  const second = await post({ question: "second", history: [] });
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: "ask-in-progress" });
  assert.equal(fs.readFileSync(pidFile, "utf8").trim(), firstPid);
  controller.abort();
  await first;
  assert.ok(await waitFor(() => !alive(Number(firstPid)), 6000));
  await new Promise((r) => setTimeout(r, 300));
});

void test("aborting the request kills the child within 6 s and the next question is accepted", async () => {
  process.env.ASK_STUB_MODE = "sleep";
  const controller = new AbortController();
  const pending = post(
    { question: "slow", history: [] },
    controller.signal,
  ).catch(() => null);
  assert.ok(await waitFor(() => fs.existsSync(pidFile), 5000));
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  assert.ok(alive(pid));
  controller.abort();
  await pending;
  assert.ok(await waitFor(() => !alive(pid), 6000), "stub still running");
  process.env.ASK_STUB_MODE = "answer";
  let status = 0;
  for (let i = 0; i < 20 && status !== 200; i++) {
    status = (await post({ question: "after cancel", history: [] })).status;
    if (status === 409) await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(status, 200);
});

void test("a failing CLI answers 502 and the log names the failure kind, never the question", async () => {
  process.env.ASK_STUB_MODE = "fail";
  let res: Response | undefined;
  const log = await captureErrors(async () => {
    res = await post({ question: "secret question zqxw7", history: [] });
  });
  assert.equal(res?.status, 502);
  assert.deepEqual(await res?.json(), { error: "ask-failed" });
  assert.ok(log.includes("[ask] failed"));
  assert.ok(!log.includes("zqxw7"));
  assert.ok(!log.includes("stub failure"));
});

void test("an empty answer answers 502", async () => {
  process.env.ASK_STUB_MODE = "empty";
  const res = await post({ question: "anything", history: [] });
  assert.equal(res.status, 502);
});

const INVALID: [string, unknown][] = [
  ["an empty question", { question: "   ", history: [] }],
  ["a 2001 character question", { question: "q".repeat(2001), history: [] }],
  [
    "21 turns",
    {
      question: "q",
      history: Array.from({ length: 21 }, () => ({ role: "user", text: "t" })),
    },
  ],
  ["a bad role", { question: "q", history: [{ role: "system", text: "t" }] }],
  [
    "an 8001 character turn",
    { question: "q", history: [{ role: "user", text: "t".repeat(8001) }] },
  ],
  ["a missing history", { question: "q" }],
  ["a non-string question", { question: 7, history: [] }],
];

for (const [name, body] of INVALID) {
  void test(`${name} answers 400 and starts no subprocess`, async () => {
    process.env.ASK_STUB_MODE = "answer";
    const res = await post(body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "invalid ask" });
    assert.equal(fs.existsSync(pidFile), false);
  });
}

void test("a 150 KB valid body is accepted", async () => {
  process.env.ASK_STUB_MODE = "answer";
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: "h".repeat(7500),
  }));
  const body = { question: "q".repeat(2000), history };
  assert.ok(JSON.stringify(body).length > 150_000);
  const res = await post(body);
  assert.equal(res.status, 200);
});

void test("askClaude reports a timeout when the CLI outlives its limit", async () => {
  process.env.ASK_STUB_MODE = "sleep";
  await assert.rejects(
    askClaude("prompt", new AbortController().signal, 1000),
    (err: unknown) => err instanceof AskError && err.kind === "timeout",
  );
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  assert.ok(await waitFor(() => !alive(pid), 6000));
});

void test("an aborted child that ignores SIGTERM is killed by the escalation", async () => {
  process.env.ASK_STUB_MODE = "ignoreterm";
  const controller = new AbortController();
  const pending = post(
    { question: "stubborn", history: [] },
    controller.signal,
  ).catch(() => null);
  assert.ok(await waitFor(() => fs.existsSync(pidFile), 5000));
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  controller.abort();
  await pending;
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(pid), "SIGTERM alone should not end this child");
  assert.ok(await waitFor(() => !alive(pid), 15000), "SIGKILL never came");
});
