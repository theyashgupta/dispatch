import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Item } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem } from "../test-support/fake-source.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const USER = "xoxp-g6-fake-user";

const express = (await import("express")).default;
const { slackRouter } = await import("./slack.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { createKey, listKeys, setValue, clearValue } =
  await import("../services/infra/vault.js");
const { store } = await import("../store/board.store.js");
await store.load();

const app = express();
app.use("/api", express.json(), slackRouter);
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let answer: () => Response = () => json(200, { ok: true });

function slackItem(channel: string, ts: string, threadTs?: string): Item {
  return {
    id: `slack:${channel}:${ts}`,
    source: "slack",
    type: "mention",
    title: `ana in #eng-platform: ${ts}`,
    snippet: "look",
    createdAt: new Date(Number(ts) * 1000).toISOString(),
    priority: 75,
    state: "unread",
    meta: { channel, ts, ...(threadTs ? { threadTs } : {}) },
  };
}

const THREAD = slackItem("C0R1", "1700000100.000100", "1700000100.000100");
const NO_THREAD = slackItem("C0R2", "1700000200.000100");
const OTHER = fakeItem("thread", { meta: { channel: "C0R6", threadTs: "1" } });
await store.upsertItems("slack", [THREAD, NO_THREAD], { kind: "append" });
await store.upsertItems("fake", [OTHER], { kind: "append" });

function writeConfig(slack: Record<string, unknown> = { enabled: true }): void {
  const value = {
    port: 4700,
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, slack },
  };
  fs.writeFileSync(configPath, JSON.stringify(value), { mode: 0o600 });
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, slack },
  });
}

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

async function expectError(
  res: Promise<{ status: number; text: string }>,
  status: number,
  text: string,
): Promise<void> {
  const got = await res;
  assert.equal(got.status, status);
  assert.equal(got.text, text);
}

const resolve = (input: unknown) =>
  call("POST", "/slack/channels/resolve", { input });
const list = () => call("GET", "/slack/channels");
const thread = (id: string) =>
  call("GET", `/slack/thread/${encodeURIComponent(id)}`);
const save = (body?: unknown) => call("PUT", "/sources/slack/channels", body);

beforeEach(async () => {
  answer = () => json(200, { ok: true });
  if ((await listKeys()).some((k) => k.name === "SLACK_USER_TOKEN")) {
    await setValue("SLACK_USER_TOKEN", USER);
  } else {
    await createKey({ name: "SLACK_USER_TOKEN", purpose: "p", value: USER });
  }
  writeConfig();
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin === "https://slack.com") {
        return Promise.resolve(answer());
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => mock.restoreAll());

const slackFail = (error: string) => () => json(200, { ok: false, error });

test("resolve answers 400 not-a-channel for a non-string input, no body and an input over 500 characters", async () => {
  const text = '{"error":"not-a-channel"}';
  await expectError(resolve(42), 400, text);
  await expectError(resolve(undefined), 400, text);
  await expectError(call("POST", "/slack/channels/resolve", {}), 400, text);
  await expectError(resolve("C".repeat(501)), 400, text);
});

test("resolve answers 400 not-a-channel when the input is not a channel reference", async () => {
  await expectError(resolve("not a channel"), 400, '{"error":"not-a-channel"}');
  await expectError(resolve("D0G6DM1"), 400, '{"error":"not-a-channel"}');
});

test("resolve answers 409 disabled and 409 no-credential", async () => {
  writeConfig({ enabled: false });
  await expectError(resolve("C0G6ENG"), 409, '{"error":"disabled"}');
  writeConfig();
  await clearValue("SLACK_USER_TOKEN");
  await expectError(resolve("C0G6ENG"), 409, '{"error":"no-credential"}');
});

test("resolve answers 400 rejected with the provider code, 502 unreachable with and without one", async () => {
  answer = slackFail("invalid_auth");
  await expectError(
    resolve("C0G6ENG"),
    400,
    '{"error":"rejected","providerError":"invalid_auth"}',
  );
  answer = slackFail("fatal_error");
  await expectError(
    resolve("C0G6ENG"),
    502,
    '{"error":"unreachable","providerError":"fatal_error"}',
  );
  answer = slackFail("<b>x</b>");
  await expectError(resolve("C0G6ENG"), 502, '{"error":"unreachable"}');
  answer = () => json(503, {});
  await expectError(resolve("C0G6ENG"), 502, '{"error":"unreachable"}');
});

test("list answers 409 disabled and 409 no-credential", async () => {
  writeConfig({ enabled: false });
  await expectError(list(), 409, '{"error":"disabled"}');
  writeConfig();
  await clearValue("SLACK_USER_TOKEN");
  await expectError(list(), 409, '{"error":"no-credential"}');
});

test("list answers 400 rejected, 403 missing-scope and 502 unreachable with the provider code", async () => {
  answer = slackFail("invalid_auth");
  await expectError(
    list(),
    400,
    '{"error":"rejected","providerError":"invalid_auth"}',
  );
  answer = slackFail("missing_scope");
  await expectError(
    list(),
    403,
    '{"error":"missing-scope","providerError":"missing_scope"}',
  );
  answer = slackFail("fatal_error");
  await expectError(
    list(),
    502,
    '{"error":"unreachable","providerError":"fatal_error"}',
  );
});

test("list answers 502 unreachable on a 429, an outage and a network failure", async () => {
  const text = '{"error":"unreachable"}';
  answer = () => json(429, { ok: false });
  await expectError(list(), 502, text);
  answer = () => json(503, {});
  await expectError(list(), 502, text);
  answer = () => {
    throw new TypeError("fetch failed");
  };
  await expectError(list(), 502, text);
  await expectError(resolve("C0G6ENG"), 502, text);
  await expectError(thread(THREAD.id), 502, text);
});

test("save answers 400 invalid-channels for a bad body, list, entry or size", async () => {
  const text = '{"error":"invalid-channels"}';
  const tooMany = Array.from({ length: 201 }, (_, i) => ({
    id: `C0N${String(i).padStart(4, "0")}`,
    name: `n${i}`,
  }));
  const bad: unknown[] = [
    undefined,
    {},
    { channels: "C0G6ENG" },
    { channels: null },
    { channels: [{ id: "D0G6DM1", name: "dm" }] },
    { channels: [{ id: "C0G6ENG", name: "x".repeat(81) }] },
    { channels: [{ id: "C0G6ENG" }] },
    { channels: [null] },
    { channels: tooMany },
  ];
  const before = fs.readFileSync(configPath, "utf8");
  for (const body of bad) await expectError(save(body), 400, text);
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
});

test("save answers 500 save-failed when the config file cannot be read", async () => {
  fs.rmSync(configPath);
  await expectError(
    save({ channels: [{ id: "C0G6GEN", name: "general" }] }),
    500,
    '{"error":"save-failed"}',
  );
});

test("thread answers 404 not-found for an unknown item, a non-Slack item and an item without a thread", async () => {
  const text = '{"error":"not-found"}';
  for (const id of ["slack:C0R9:1700000900.000100", OTHER.id, NO_THREAD.id]) {
    await expectError(thread(id), 404, text);
  }
});

test("thread answers 409 disabled and 409 no-credential", async () => {
  writeConfig({ enabled: false });
  await expectError(thread(THREAD.id), 409, '{"error":"disabled"}');
  writeConfig();
  await clearValue("SLACK_USER_TOKEN");
  await expectError(thread(THREAD.id), 409, '{"error":"no-credential"}');
});

test("thread answers 401 rejected with the provider code", async () => {
  answer = slackFail("invalid_auth");
  await expectError(
    thread(THREAD.id),
    401,
    '{"error":"rejected","providerError":"invalid_auth"}',
  );
});

test("thread answers 404 not-found when Slack cannot find the thread or channel", async () => {
  answer = slackFail("thread_not_found");
  await expectError(thread(THREAD.id), 404, '{"error":"not-found"}');
  answer = slackFail("channel_not_found");
  await expectError(thread(THREAD.id), 404, '{"error":"not-found"}');
});

test("thread answers 429 rate-limited on a Slack 429", async () => {
  answer = () => json(429, { ok: false, error: "ratelimited" });
  await expectError(thread(THREAD.id), 429, '{"error":"rate-limited"}');
});

test("thread answers 502 unreachable on an outage and on another Slack error", async () => {
  answer = () => json(503, {});
  await expectError(thread(THREAD.id), 502, '{"error":"unreachable"}');
  answer = slackFail("fatal_error");
  await expectError(thread(THREAD.id), 502, '{"error":"unreachable"}');
});
