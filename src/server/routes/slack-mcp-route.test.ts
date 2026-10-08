import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import type { Item } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { writeConnectorClaude } from "../test-support/stub-claude.js";

const env = isolateEnv();
const stubDir = path.join(env.root, "stub");
fs.mkdirSync(stubDir);
process.env.CONNECTOR_STUB_DIR = stubDir;
writeConnectorClaude(env.binDir);

const express = (await import("express")).default;
const { slackRouter } = await import("./slack.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { createKey } = await import("../services/infra/vault.js");
const { store } = await import("../store/board.store.js");
const { SLACK_HIDDEN_TOOLS, SLACK_READ_TOOLS, stopSlackRound } =
  await import("../services/orchestration/slack-round.js");
await store.load();

const app = express();
app.use("/api", express.json(), slackRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});

async function mode(): Promise<unknown> {
  const res = await fetch(`${base}/slack/mcp`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { mode: string };
  assert.equal(typeof (body as { running?: unknown }).running, "boolean");
  return { mode: body.mode };
}

test("GET /slack/mcp answers mcp with no Slack config and an empty Vault", async () => {
  setOrchestrationConfig({ linearApiKey: "" });
  assert.deepEqual(await mode(), { mode: "mcp" });
});

test("GET /slack/mcp answers token once the Vault holds a Slack token", async () => {
  await createKey({
    name: "SLACK_USER_TOKEN",
    purpose: "p",
    value: "xoxp-g6-fake-user",
  });
  assert.deepEqual(await mode(), { mode: "token" });
});

test("GET /slack/mcp answers the configured mode over the Vault token", async () => {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { slack: { mode: "mcp" } },
  });
  assert.deepEqual(await mode(), { mode: "mcp" });
});

const CONNECTED =
  "plugin:design:slack: https://mcp.slack.example/mcp (HTTP) - ! Needs authentication\nclaude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected\n";
const NEEDS_AUTH =
  "claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication\n";
const THREAD_TOOL = "mcp__claude_ai_Slack__slack_read_thread";
const CHANNELS_TOOL = "mcp__claude_ai_Slack__slack_list_user_channels";
const FORBID_LINE =
  "Read only with the Slack tools. Never send, post, reply, react, edit, delete, schedule, draft or upload anything in Slack.";

const envelope = (body: unknown): string =>
  JSON.stringify({
    type: "result",
    is_error: false,
    result: JSON.stringify(body),
  });

function threadItem(channel: string, ts: string): Item {
  return {
    id: `slack:${channel}:${ts}`,
    source: "slack",
    type: "mention",
    title: `ana in #dispatch-test-a: ${ts}`,
    snippet: "look",
    createdAt: new Date(Number(ts) * 1000).toISOString(),
    priority: 75,
    state: "unread",
    meta: { channel, ts, threadTs: ts },
  };
}

async function send(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

function log(name: string): string[] {
  try {
    return fs
      .readFileSync(path.join(stubDir, name), "utf8")
      .split("\n")
      .filter((l) => l !== "");
  } catch {
    return [];
  }
}

const modelCalls = (): number =>
  log("calls.log").filter((l) => l === "call").length;

/** The value after a flag in the nth model call, read from the argv log. */
function flagValue(n: number, flag: string): string | undefined {
  const calls = log("argv.log").join("\n").split("@@").slice(0, -1);
  const lines = (calls[n] ?? "").split("\n").filter((l) => l !== "");
  return lines[lines.indexOf(flag) + 1];
}

const allowedTools = (n: number): string | undefined =>
  flagValue(n, "--allowedTools");

function assertOtherToolsHidden(n: number, allowed: string): void {
  assert.deepEqual(
    flagValue(n, "--disallowedTools")?.split(","),
    [...SLACK_READ_TOOLS, ...SLACK_HIDDEN_TOOLS].filter((t) => t !== allowed),
  );
  assert.equal(flagValue(n, "--permission-mode"), "dontAsk");
  assert.equal(flagValue(n, "--permission-prompts"), "none");
}

/**
 * Put the fake in a known state: a recent round cursor (no boot round), the PUT that drops the
 * connector and channel caches, then empty logs.
 */
async function setup(
  list: string,
  reply = "{}",
  fakeMode = "reply",
): Promise<void> {
  await stopSlackRound();
  fs.writeFileSync(path.join(stubDir, "mcp-list.txt"), list);
  fs.writeFileSync(path.join(stubDir, "reply.json"), reply);
  fs.writeFileSync(path.join(stubDir, "mode"), fakeMode);
  const at = new Date().toISOString();
  await store.setSourceCursors("slack", { mcp: { cursor: at, polledAt: at } });
  assert.equal(
    (await send("PUT", "/slack/mcp", { mode: "mcp", enabled: true })).status,
    200,
  );
  for (const f of ["calls.log", "argv.log", "stdin.log", "claude.pid"]) {
    fs.rmSync(path.join(stubDir, f), { force: true });
  }
}

test("T1 run answers 202 and a second run at once answers 409 running", async () => {
  await setup(CONNECTED, "{}", "sleep");
  try {
    const first = await send("POST", "/slack/mcp/run");
    assert.deepEqual(first, { status: 202, body: { running: true } });
    const second = await send("POST", "/slack/mcp/run");
    assert.deepEqual(second, { status: 409, body: { error: "running" } });
    for (let i = 0; i < 100 && modelCalls() === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(modelCalls(), 1);
    const status = (await send("GET", "/slack/mcp")).body as {
      running: boolean;
    };
    assert.equal(status.running, true);
  } finally {
    await stopSlackRound();
  }
});

test("T2 a needs auth list answers 409 not-connected and makes no model call", async () => {
  await setup(NEEDS_AUTH);
  const res = await send("POST", "/slack/mcp/run");
  assert.deepEqual(res, { status: 409, body: { error: "not-connected" } });
  assert.equal(modelCalls(), 0);
  const status = (await send("GET", "/slack/mcp")).body as Record<
    string,
    unknown
  >;
  assert.equal(status.lastError, "needs-auth");
});

test("T3 run answers 409 disabled when Slack is off and in token mode", async () => {
  await setup(CONNECTED);
  await send("PUT", "/slack/mcp", { enabled: false });
  assert.deepEqual(await send("POST", "/slack/mcp/run"), {
    status: 409,
    body: { error: "disabled" },
  });
  await send("PUT", "/slack/mcp", { mode: "token", enabled: true });
  assert.deepEqual(await send("POST", "/slack/mcp/run"), {
    status: 409,
    body: { error: "disabled" },
  });
  assert.equal(modelCalls(), 0);
});

test("T4 PUT writes the mode to config.json and rejects a bad body", async () => {
  await setup(CONNECTED);
  const put = await send("PUT", "/slack/mcp", { mode: "token" });
  assert.equal(put.status, 200);
  const disk = JSON.parse(
    fs.readFileSync(path.join(env.dispatchDir, "config.json"), "utf8"),
  ) as { sources: { slack: { mode: string; enabled: boolean } } };
  assert.equal(disk.sources.slack.mode, "token");
  assert.equal(disk.sources.slack.enabled, true);
  assert.equal(
    ((await send("GET", "/slack/mcp")).body as { mode: string }).mode,
    "token",
  );
  for (const bad of [
    { mode: "x" },
    {},
    { enabled: "yes" },
    { mode: "mcp", extra: 1 },
  ]) {
    const res = await send("PUT", "/slack/mcp", bad);
    assert.deepEqual(
      res,
      { status: 400, body: { error: "invalid-settings" } },
      JSON.stringify(bad),
    );
  }
});

test("T5 a thread loads with one call, the thread tool only, and a second load uses the cache", async () => {
  const item = threadItem("C0TESTAAA", "1790000100.000200");
  await store.upsertItems("slack", [item], { kind: "append" });
  await setup(
    CONNECTED,
    envelope({
      messages: [
        {
          author: "Ana",
          ts: "1790000100.000200",
          text: "look <@U1|bo> &amp; <#C1|dev>",
        },
        { author: "Bo", ts: "1790000101.000200", text: "ok" },
      ],
    }),
  );
  const first = await send(
    "GET",
    `/slack/thread/${encodeURIComponent(item.id)}`,
  );
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    messages: [
      {
        author: "Ana",
        time: "2026-09-21T14:15:00.000Z",
        text: "look @bo & #dev",
      },
      { author: "Bo", time: "2026-09-21T14:15:01.000Z", text: "ok" },
    ],
    truncated: false,
  });
  const second = await send(
    "GET",
    `/slack/thread/${encodeURIComponent(item.id)}`,
  );
  assert.deepEqual(second, first);
  assert.equal(modelCalls(), 1);
  assert.equal(allowedTools(0), THREAD_TOOL);
  assertOtherToolsHidden(0, THREAD_TOOL);
  const threadHidden = flagValue(0, "--disallowedTools")?.split(",") ?? [];
  assert.ok(threadHidden.includes(CHANNELS_TOOL));
  assert.equal(threadHidden.includes(THREAD_TOOL), false);
  assert.match(log("stdin.log").join("\n"), /C0TESTAAA/);
  assert.ok(log("stdin.log").includes(FORBID_LINE));
});

test("T5b an invalid thread output answers 502 unreachable and is asked again", async () => {
  const item = threadItem("C0TESTAAA", "1790000300.000200");
  await store.upsertItems("slack", [item], { kind: "append" });
  await setup(CONNECTED, envelope({ messages: [{ author: "Ana" }] }));
  const route = `/slack/thread/${encodeURIComponent(item.id)}`;
  assert.deepEqual(await send("GET", route), {
    status: 502,
    body: { error: "unreachable" },
  });
  await send("GET", route);
  assert.equal(modelCalls(), 2);
});

test("T6 channels list with one call, the list tool only, and a second list uses the cache", async () => {
  await setup(
    CONNECTED,
    envelope({
      channels: [
        { id: "C0TESTAAA", name: "dispatch-test-a" },
        { id: "G0TESTPRV", name: "secret", private: true },
        { id: "C0TESTAAA", name: "duplicate" },
      ],
    }),
  );
  const first = await send("GET", "/slack/channels");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    channels: [
      { id: "C0TESTAAA", name: "dispatch-test-a", private: false },
      { id: "G0TESTPRV", name: "secret", private: true },
    ],
    truncated: false,
  });
  assert.deepEqual(await send("GET", "/slack/channels"), first);
  assert.equal(modelCalls(), 1);
  assert.equal(allowedTools(0), CHANNELS_TOOL);
  assertOtherToolsHidden(0, CHANNELS_TOOL);
  const channelsHidden = flagValue(0, "--disallowedTools")?.split(",") ?? [];
  assert.ok(channelsHidden.includes(THREAD_TOOL));
  assert.equal(channelsHidden.includes(CHANNELS_TOOL), false);
  assert.ok(log("stdin.log").includes(FORBID_LINE));
  const resolved = await send("POST", "/slack/channels/resolve", {
    input: "https://dispatch-test.slack.com/archives/C0TESTAAA",
  });
  assert.deepEqual(resolved, {
    status: 200,
    body: { id: "C0TESTAAA", name: "dispatch-test-a" },
  });
  assert.equal(modelCalls(), 1);
});

test("T6b thread and channel calls without a Slack tool answer 502 unreachable", async () => {
  const item = threadItem("C0TESTAAA", "1790000400.000200");
  await store.upsertItems("slack", [item], { kind: "append" });
  await setup(CONNECTED, envelope({ messages: [], channels: [] }), "notools");
  const unreachable = { status: 502, body: { error: "unreachable" } };
  assert.deepEqual(
    await send("GET", `/slack/thread/${encodeURIComponent(item.id)}`),
    unreachable,
  );
  assert.deepEqual(await send("GET", "/slack/channels"), unreachable);
  assert.equal(modelCalls(), 2);
});

for (const fake of ["toolerror"]) {
  test(`T6c thread and channel calls in ${fake} mode answer 502 unreachable`, async () => {
    const item = threadItem("C0TESTAAA", "1790000500.000200");
    await store.upsertItems("slack", [item], { kind: "append" });
    await setup(CONNECTED, envelope({ messages: [], channels: [] }), fake);
    const unreachable = { status: 502, body: { error: "unreachable" } };
    assert.deepEqual(
      await send("GET", `/slack/thread/${encodeURIComponent(item.id)}`),
      unreachable,
    );
    assert.deepEqual(await send("GET", "/slack/channels"), unreachable);
    assert.equal(modelCalls(), 2);
  });
}

test("T7 a pasted link resolves with no claude process at all", async () => {
  await setup(CONNECTED);
  const res = await send("POST", "/slack/channels/resolve", {
    input: "https://dispatch-test.slack.com/archives/C0TESTAAA",
  });
  assert.deepEqual(res, {
    status: 200,
    body: { id: "C0TESTAAA", name: "C0TESTAAA" },
  });
  assert.equal(fs.existsSync(path.join(stubDir, "calls.log")), false);
  assert.deepEqual(
    await send("POST", "/slack/channels/resolve", { input: "nope" }),
    {
      status: 400,
      body: { error: "not-a-channel" },
    },
  );
});

test("T8 thread and channels answer 409 not-connected with a needs auth list and make no call", async () => {
  const item = threadItem("C0TESTAAA", "1790000200.000200");
  await store.upsertItems("slack", [item], { kind: "append" });
  await setup(NEEDS_AUTH);
  assert.deepEqual(
    await send("GET", `/slack/thread/${encodeURIComponent(item.id)}`),
    {
      status: 409,
      body: { error: "not-connected" },
    },
  );
  assert.deepEqual(await send("GET", "/slack/channels"), {
    status: 409,
    body: { error: "not-connected" },
  });
  assert.equal(modelCalls(), 0);
});
