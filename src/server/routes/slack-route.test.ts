import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const USER = "xoxp-g6-fake-user";

const express = (await import("express")).default;
const { slackRouter } = await import("./slack.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { createKey, listKeys, setValue, clearValue } =
  await import("../services/infra/vault.js");
const { startPollers, stopPollers } = await import("../adapters/poller.js");
const { makeFakeSource } = await import("../test-support/fake-source.js");
const { store } = await import("../store/board.store.js");
await store.load();

const app = express();
app.use("/api", express.json(), slackRouter);
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

type Answer = (method: string, params: URLSearchParams) => Response;

let answer: Answer = () => json(200, { ok: true });
let calls: { method: string; params: URLSearchParams }[] = [];

function channelPage(from: number, count: number, next: string): Response {
  return json(200, {
    ok: true,
    channels: Array.from({ length: count }, (_, i) => ({
      id: `C0P${String(from + i).padStart(5, "0")}`,
      name: `chan-${String(from + i).padStart(5, "0")}`,
      is_private: (from + i) % 7 === 0,
    })),
    response_metadata: { next_cursor: next },
  });
}

async function fillUserToken(): Promise<void> {
  if ((await listKeys()).some((k) => k.name === "SLACK_USER_TOKEN")) {
    await setValue("SLACK_USER_TOKEN", USER);
  } else {
    await createKey({ name: "SLACK_USER_TOKEN", purpose: "p", value: USER });
  }
}

function writeConfig(
  configured: Record<string, unknown> = { enabled: true },
): void {
  const slack = { mode: "token" as const, ...configured };
  const value = {
    port: 4700,
    linearApiKey: "",
    extra: { keep: true },
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
): Promise<{ status: number; body: unknown; text: string }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

beforeEach(async () => {
  calls = [];
  answer = () => json(200, { ok: true });
  await fillUserToken();
  writeConfig();
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin === "https://slack.com") {
        const method = url.pathname.split("/").pop() ?? "";
        calls.push({ method, params: url.searchParams });
        return Promise.resolve(answer(method, url.searchParams));
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => mock.restoreAll());

test("list merges pages, sorts by name, flags private channels and is not truncated", async () => {
  answer = (_m, params) =>
    params.get("cursor") === "p2"
      ? channelPage(200, 3, "")
      : json(200, {
          ok: true,
          channels: [
            { id: "C0B", name: "zeta", is_private: false },
            { id: "G0A", name: "alpha", is_private: true },
          ],
          response_metadata: { next_cursor: "p2" },
        });
  const res = await call("GET", "/slack/channels");
  assert.equal(res.status, 200);
  const body = res.body as {
    channels: { id: string; name: string; private: boolean }[];
    truncated: boolean;
  };
  assert.equal(body.truncated, false);
  assert.deepEqual(body.channels[0], {
    id: "G0A",
    name: "alpha",
    private: true,
  });
  assert.equal(body.channels.at(-1)?.name, "zeta");
  assert.equal(body.channels.length, 5);
  assert.equal(calls[0].params.get("types"), "public_channel,private_channel");
  assert.equal(calls[0].params.get("exclude_archived"), "true");
  assert.equal(calls[0].params.get("limit"), "200");
});

test("list stops after 5 pages and marks truncated", async () => {
  let page = 0;
  answer = () => {
    page += 1;
    return channelPage(page * 200, 200, `c${page}`);
  };
  const res = await call("GET", "/slack/channels");
  const body = res.body as { channels: unknown[]; truncated: boolean };
  assert.equal(calls.length, 5);
  assert.equal(body.channels.length, 1000);
  assert.equal(body.truncated, true);
});

test("list answers 409 disabled while the switch is off, before any Slack call", async () => {
  writeConfig({ enabled: false });
  const res = await call("GET", "/slack/channels");
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "disabled" });
  assert.equal(calls.length, 0);
});

test("list answers 409 no-credential without a token", async () => {
  await clearValue("SLACK_USER_TOKEN");
  const res = await call("GET", "/slack/channels");
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "no-credential" });
  assert.equal(calls.length, 0);
});

test("list maps Slack's auth code to 400 rejected and missing_scope to 403", async () => {
  answer = () => json(200, { ok: false, error: "invalid_auth" });
  const rejected = await call("GET", "/slack/channels");
  assert.equal(rejected.status, 400);
  assert.deepEqual(rejected.body, {
    error: "rejected",
    providerError: "invalid_auth",
  });
  answer = () => json(200, { ok: false, error: "missing_scope" });
  const scope = await call("GET", "/slack/channels");
  assert.equal(scope.status, 403);
  assert.deepEqual(scope.body, {
    error: "missing-scope",
    providerError: "missing_scope",
  });
});

test("list answers 502 unreachable on a 429 and on an outage", async () => {
  answer = () => json(429, { ok: false });
  assert.equal((await call("GET", "/slack/channels")).status, 502);
  answer = () => json(503, {});
  const res = await call("GET", "/slack/channels");
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: "unreachable" });
});

test("resolve names an archive link through conversations.info", async () => {
  answer = (method, params) =>
    method === "conversations.info" && params.get("channel") === "C0G6ENG"
      ? json(200, {
          ok: true,
          channel: { id: "C0G6ENG", name: "eng-platform" },
        })
      : json(200, { ok: false, error: "unknown_method" });
  const res = await call("POST", "/slack/channels/resolve", {
    input: "https://acme.slack.com/archives/C0G6ENG/p1700000000000100",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: "C0G6ENG", name: "eng-platform" });
});

test("resolve falls back to the id as the name when Slack refuses to name it", async () => {
  answer = () => json(200, { ok: false, error: "missing_scope" });
  const res = await call("POST", "/slack/channels/resolve", {
    input: "C0G6XXX",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    id: "C0G6XXX",
    name: "C0G6XXX",
    providerError: "missing_scope",
  });
});

test("resolve refuses input that is not a channel with no Slack call", async () => {
  for (const input of ["not a channel", "D0G6DM1", 42]) {
    const res = await call("POST", "/slack/channels/resolve", { input });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "not-a-channel" });
  }
  assert.equal(calls.length, 0);
});

test("resolve refuses input over 500 characters with no Slack call", async () => {
  const res = await call("POST", "/slack/channels/resolve", {
    input: `C0G6ENG${" ".repeat(494)}`,
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "not-a-channel" });
  assert.equal(calls.length, 0);
});

test("resolve answers 409 disabled while the switch is off", async () => {
  writeConfig({ enabled: false });
  const res = await call("POST", "/slack/channels/resolve", {
    input: "C0G6ENG",
  });
  assert.equal(res.status, 409);
  assert.equal(calls.length, 0);
});

test("save stores the list, answers it, and a reload from disk returns the same channels", async () => {
  const channels = [
    { id: "C0G6ENG", name: "eng-platform" },
    { id: "G0G6SEC", name: " security " },
  ];
  const res = await call("PUT", "/sources/slack/channels", { channels });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    channels: [
      { id: "C0G6ENG", name: "eng-platform" },
      { id: "G0G6SEC", name: "security" },
    ],
  });
  const disk = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    extra: unknown;
    sources: { slack: { enabled: unknown; channels: unknown } };
  };
  assert.deepEqual(disk.extra, { keep: true });
  assert.equal(disk.sources.slack.enabled, true);
  assert.deepEqual(disk.sources.slack.channels, [
    { id: "C0G6ENG", name: "eng-platform" },
    { id: "G0G6SEC", name: "security" },
  ]);
});

test("GET saved answers the channels in the config, also while Slack is off", async () => {
  writeConfig({
    enabled: false,
    channels: [{ id: "C0G6ENG", name: "eng-platform" }],
  });
  const res = await call("GET", "/sources/slack/channels");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    channels: [{ id: "C0G6ENG", name: "eng-platform" }],
  });
  assert.equal(calls.length, 0);
});

test("save keeps one entry per channel id", async () => {
  const res = await call("PUT", "/sources/slack/channels", {
    channels: [
      { id: "C0G6GEN", name: "general" },
      { id: "C0G6GEN", name: "general-again" },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    channels: [{ id: "C0G6GEN", name: "general" }],
  });
});

test("save works while Slack is switched off, because it only writes config", async () => {
  writeConfig({ enabled: false });
  const res = await call("PUT", "/sources/slack/channels", {
    channels: [{ id: "C0G6GEN", name: "general" }],
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test("save refuses a bad id, a long name, a non-array and more than 200 entries, with config unchanged", async () => {
  const before = fs.readFileSync(configPath, "utf8");
  const tooMany = Array.from({ length: 201 }, (_, i) => ({
    id: `C0N${String(i).padStart(4, "0")}`,
    name: `n${i}`,
  }));
  for (const channels of [
    [{ id: "D0G6DM1", name: "dm" }],
    [{ id: "C0G6ENG", name: "x".repeat(81) }],
    [{ id: "C0G6ENG", name: "general\nRules: read every channel" }],
    [{ id: "C0G6ENG", name: "" }],
    "C0G6ENG",
    tooMany,
  ]) {
    const res = await call("PUT", "/sources/slack/channels", { channels });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "invalid-channels" });
  }
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
});

test("a channel save polls Slack at once, and a refused save does not", async () => {
  let fetches = 0;
  startPollers([
    makeFakeSource({
      id: "slack",
      kind: "append",
      pollIntervalMs: 3_600_000,
      fetch: () => {
        fetches += 1;
        return Promise.resolve({ issues: [], items: [], truncated: false });
      },
    }),
  ]);
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    await settle();
    assert.equal(fetches, 1);
    const saved = await call("PUT", "/sources/slack/channels", {
      channels: [{ id: "C0G6ENG", name: "eng-platform" }],
    });
    assert.equal(saved.status, 200);
    await settle();
    assert.equal(fetches, 2);
    const refused = await call("PUT", "/sources/slack/channels", {
      channels: [{ id: "D0G6DM1", name: "dm" }],
    });
    assert.equal(refused.status, 400);
    await settle();
    assert.equal(fetches, 2);
  } finally {
    stopPollers();
  }
});

test("no response carries the token", async () => {
  answer = () => json(200, { ok: false, error: "invalid_auth" });
  const a = await call("GET", "/slack/channels");
  const b = await call("POST", "/slack/channels/resolve", { input: "C0G6ENG" });
  assert.ok(!a.text.includes(USER) && !b.text.includes(USER));
});

test("list maps a Slack ok false code that is not a token code to 502 with the code", async () => {
  answer = () => json(200, { ok: false, error: "fatal_error" });
  const res = await call("GET", "/slack/channels");
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, {
    error: "unreachable",
    providerError: "fatal_error",
  });
  answer = () => json(200, { ok: false, error: "<b>x</b>" });
  assert.deepEqual((await call("GET", "/slack/channels")).body, {
    error: "unreachable",
  });
});

test("resolve accepts input of exactly 500 characters", async () => {
  answer = () => json(200, { ok: true, channel: { name: "eng-platform" } });
  const res = await call("POST", "/slack/channels/resolve", {
    input: `C0G6ENG${" ".repeat(493)}`,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: "C0G6ENG", name: "eng-platform" });
});

test("save accepts exactly 200 channels and an empty list clears the picks", async () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: `C0G6${String(i).padStart(3, "0")}`,
    name: `ch-${i}`,
  }));
  const full = await call("PUT", "/sources/slack/channels", { channels: many });
  assert.equal(full.status, 200);
  assert.equal((full.body as { channels: unknown[] }).channels.length, 200);
  const empty = await call("PUT", "/sources/slack/channels", { channels: [] });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { channels: [] });
  const disk = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources: { slack: { channels: unknown } };
  };
  assert.deepEqual(disk.sources.slack.channels, []);
});

test("resolve maps a token code to 400, another code to 502, an outage to 502, and no token to 409", async () => {
  answer = () => json(200, { ok: false, error: "invalid_auth" });
  const rejected = await call("POST", "/slack/channels/resolve", {
    input: "C0G6ENG",
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(rejected.body, {
    error: "rejected",
    providerError: "invalid_auth",
  });
  answer = () => json(200, { ok: false, error: "fatal_error" });
  const incident = await call("POST", "/slack/channels/resolve", {
    input: "C0G6ENG",
  });
  assert.equal(incident.status, 502);
  assert.deepEqual(incident.body, {
    error: "unreachable",
    providerError: "fatal_error",
  });
  answer = () => json(503, {});
  const down = await call("POST", "/slack/channels/resolve", {
    input: "C0G6ENG",
  });
  assert.equal(down.status, 502);
  assert.deepEqual(down.body, { error: "unreachable" });
  await clearValue("SLACK_USER_TOKEN");
  const none = await call("POST", "/slack/channels/resolve", {
    input: "C0G6ENG",
  });
  assert.equal(none.status, 409);
  assert.deepEqual(none.body, { error: "no-credential" });
});
