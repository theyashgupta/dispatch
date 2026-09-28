import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const USER = "xoxp-g6-fake-user";
const BOT = "xoxb-g6-fake-bot";
const REVOKED = "xoxp-g6-fake-revoked";
const SESSION = "xoxc-g6-fake-session";

const express = (await import("express")).default;
const { connectionRouter } = await import("./connection.route.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");
const { createKey, listKeys, readCurrent, clearValue, setValue } =
  await import("../services/domain/vault.js");

const app = express();
app.use("/api", express.json(), connectionRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

type SlackAnswer = (token: string) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const authBody = (token: string): unknown => {
  if (token === USER) {
    return {
      ok: true,
      url: "https://acme.slack.com/",
      team: "Acme",
      user: "g6-tester",
      user_id: "U0G6USER",
    };
  }
  if (token === BOT) {
    return {
      ok: true,
      url: "https://acme.slack.com/",
      team: "Acme",
      user: "dispatch-bot",
      user_id: "U0G6BOT",
      bot_id: "B0G6",
    };
  }
  if (token === REVOKED) return { ok: false, error: "token_revoked" };
  return { ok: false, error: "invalid_auth" };
};

let slackAnswer: SlackAnswer = (token) => json(200, authBody(token));
let slackCalls = 0;

function writeConfig(slack?: Record<string, unknown>): void {
  const value = {
    port: 4700,
    sources: {
      linear: { apiKey: "", filters: { teams: ["keep"] } },
      ...(slack ? { slack } : {}),
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(value), { mode: 0o600 });
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, ...(slack ? { slack } : {}) },
  });
  rebuildSources(getOrchestrationConfig()!);
}

function slackEnabledOnDisk(): unknown {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources?: { slack?: { enabled?: unknown } };
  };
  return parsed.sources?.slack?.enabled;
}

async function vaultSnapshot(): Promise<string> {
  const keys = await listKeys();
  const values = await Promise.all(keys.map((k) => readCurrent(k.name)));
  return JSON.stringify({
    keys: keys.map((k) => [k.name, k.purpose, k.filled]),
    values,
  });
}

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

async function fill(name: string, value: string): Promise<void> {
  if ((await listKeys()).some((k) => k.name === name)) {
    await setValue(name, value);
  } else {
    await createKey({ name, purpose: "p", value });
  }
}

const noToken = (text: string) =>
  [USER, BOT, REVOKED, SESSION].every((t) => !text.includes(t));

beforeEach(async () => {
  slackCalls = 0;
  slackAnswer = (token) => json(200, authBody(token));
  for (const name of ["SLACK_USER_TOKEN", "SLACK_BOT_TOKEN"]) {
    if ((await listKeys()).some((k) => k.name === name)) await clearValue(name);
  }
  writeConfig();
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (new URL(url).hostname === "slack.com") {
        slackCalls += 1;
        const token = (
          new Headers(init?.headers).get("authorization") ?? ""
        ).replace("Bearer ", "");
        return Promise.resolve(slackAnswer(token));
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

test("GET with no Slack token answers unconfigured and calls nobody", async () => {
  const res = await call("GET", "/sources/slack/connection");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), {
    configured: false,
    connected: false,
    enabled: false,
  });
  assert.equal(slackCalls, 0);
});

test("PUT a user token stores it under SLACK_USER_TOKEN, enables, and GET names the account", async () => {
  const put = await call("PUT", "/sources/slack/key", { apiKey: USER });
  assert.equal(put.status, 200);
  assert.equal(
    (JSON.parse(put.text) as { account?: string }).account,
    "g6-tester @ Acme",
  );
  const stored = await readCurrent("SLACK_USER_TOKEN");
  assert.ok(stored.ok && stored.value === USER);
  assert.equal(slackEnabledOnDisk(), true);
  const get = await call("GET", "/sources/slack/connection");
  assert.deepEqual(JSON.parse(get.text), {
    configured: true,
    connected: true,
    enabled: true,
    via: "vault",
    tokenKind: "user",
    account: "g6-tester @ Acme",
  });
  assert.ok(noToken(put.text + get.text));
});

test("PUT a bot token stores it under SLACK_BOT_TOKEN and reports tokenKind bot", async () => {
  const put = await call("PUT", "/sources/slack/key", { apiKey: BOT });
  assert.equal(put.status, 200);
  const stored = await readCurrent("SLACK_BOT_TOKEN");
  assert.ok(stored.ok && stored.value === BOT);
  const user = await readCurrent("SLACK_USER_TOKEN");
  assert.ok(!user.ok || user.value === "");
  const get = await call("GET", "/sources/slack/connection");
  assert.equal(
    (JSON.parse(get.text) as { tokenKind?: string }).tokenKind,
    "bot",
  );
});

test("PUT a revoked token answers rejected with Slack's code and changes nothing", async () => {
  const beforeVault = await vaultSnapshot();
  const beforeConfig = fs.readFileSync(configPath, "utf8");
  const put = await call("PUT", "/sources/slack/key", { apiKey: REVOKED });
  assert.equal(put.status, 400);
  assert.deepEqual(JSON.parse(put.text), {
    error: "rejected",
    providerError: "token_revoked",
  });
  assert.equal(await vaultSnapshot(), beforeVault);
  assert.equal(fs.readFileSync(configPath, "utf8"), beforeConfig);
});

test("PUT a session token is refused before any Slack call", async () => {
  const beforeConfig = fs.readFileSync(configPath, "utf8");
  const put = await call("PUT", "/sources/slack/key", { apiKey: SESSION });
  assert.equal(put.status, 400);
  assert.deepEqual(JSON.parse(put.text), { error: "rejected" });
  assert.equal(slackCalls, 0);
  assert.equal(fs.readFileSync(configPath, "utf8"), beforeConfig);
});

test("PUT a blank key answers 400 with no Slack call", async () => {
  const put = await call("PUT", "/sources/slack/key", { apiKey: "  " });
  assert.equal(put.status, 400);
  assert.equal(slackCalls, 0);
});

test("PUT during an outage answers 502 and changes nothing", async () => {
  slackAnswer = () => json(502, {});
  const beforeVault = await vaultSnapshot();
  const beforeConfig = fs.readFileSync(configPath, "utf8");
  const put = await call("PUT", "/sources/slack/key", { apiKey: USER });
  assert.equal(put.status, 502);
  assert.deepEqual(JSON.parse(put.text), { error: "unreachable" });
  assert.equal(await vaultSnapshot(), beforeVault);
  assert.equal(fs.readFileSync(configPath, "utf8"), beforeConfig);
});

test("GET with a stored revoked token reports rejected with Slack's code", async () => {
  await fill("SLACK_USER_TOKEN", REVOKED);
  writeConfig({ enabled: true });
  const get = await call("GET", "/sources/slack/connection");
  assert.deepEqual(JSON.parse(get.text), {
    configured: true,
    connected: false,
    enabled: true,
    via: "vault",
    tokenKind: "user",
    error: "rejected",
    providerError: "token_revoked",
  });
});

test("an ok false code that is not a token code reads as unreachable and is not passed on", async () => {
  for (const error of ["<script>", "service_unavailable", ""]) {
    slackAnswer = () => json(200, { ok: false, error });
    const before = await vaultSnapshot();
    const put = await call("PUT", "/sources/slack/key", { apiKey: USER });
    assert.equal(put.status, 502);
    assert.deepEqual(JSON.parse(put.text), { error: "unreachable" });
    assert.equal(await vaultSnapshot(), before);
  }
  await fill("SLACK_USER_TOKEN", USER);
  slackAnswer = () => json(200, { ok: false, error: "fatal_error" });
  const get = JSON.parse(
    (await call("GET", "/sources/slack/connection")).text,
  ) as { error?: string; providerError?: string };
  assert.equal(get.error, "unreachable");
  assert.equal(get.providerError, undefined);
});

test("POST connect with a stored token enables; without one answers no-credential", async () => {
  const none = await call("POST", "/sources/slack/connect");
  assert.equal(none.status, 400);
  assert.deepEqual(JSON.parse(none.text), { error: "no-credential" });
  assert.notEqual(slackEnabledOnDisk(), true);
  await fill("SLACK_USER_TOKEN", USER);
  const ok = await call("POST", "/sources/slack/connect");
  assert.equal(ok.status, 200);
  assert.equal(slackEnabledOnDisk(), true);
});

test("POST disable turns polling off and keeps the token", async () => {
  await call("PUT", "/sources/slack/key", { apiKey: USER });
  const before = await vaultSnapshot();
  const off = await call("POST", "/sources/slack/disable");
  assert.equal(off.status, 204);
  assert.equal(slackEnabledOnDisk(), false);
  assert.equal(await vaultSnapshot(), before);
  const get = await call("GET", "/sources/slack/connection");
  assert.equal(
    (JSON.parse(get.text) as { connected?: boolean }).connected,
    false,
  );
});

test("a disable that lands while a connect is checking the token wins", async () => {
  await fill("SLACK_USER_TOKEN", USER);
  let release: () => void = () => undefined;
  slackAnswer = (token) =>
    new Promise((resolve) => {
      release = () => resolve(json(200, authBody(token)));
    });
  const connecting = call("POST", "/sources/slack/connect");
  while (slackCalls === 0) await new Promise((r) => setTimeout(r, 5));
  const off = await call("POST", "/sources/slack/disable");
  assert.equal(off.status, 204);
  release();
  const connected = await connecting;
  assert.equal(connected.status, 409);
  assert.equal(slackEnabledOnDisk(), false);
});

test("disable answers 500 save-failed when the config cannot be written", async () => {
  writeConfig({ enabled: true });
  fs.writeFileSync(configPath, "not json", { mode: 0o600 });
  const off = await call("POST", "/sources/slack/disable");
  assert.equal(off.status, 500);
  assert.deepEqual(JSON.parse(off.text), { error: "save-failed" });
});

test("disable answers 404 for linear and unknown sources", async () => {
  assert.equal((await call("POST", "/sources/linear/disable")).status, 404);
  assert.equal((await call("POST", "/sources/nope/disable")).status, 404);
});

test("PUT a bot token over a stored revoked user token clears the user key and GET uses the bot", async () => {
  await fill("SLACK_USER_TOKEN", REVOKED);
  const put = await call("PUT", "/sources/slack/key", { apiKey: BOT });
  assert.equal(put.status, 200);
  const user = await readCurrent("SLACK_USER_TOKEN");
  assert.ok(!user.ok || user.value === "");
  const get = JSON.parse(
    (await call("GET", "/sources/slack/connection")).text,
  ) as { tokenKind?: string; connected?: boolean; account?: string };
  assert.equal(get.tokenKind, "bot");
  assert.equal(get.connected, true);
  assert.equal(get.account, "dispatch-bot @ Acme");
});

test("DELETE clears both Slack keys, keeps both key names, and disables", async () => {
  await fill("SLACK_USER_TOKEN", USER);
  await fill("SLACK_BOT_TOKEN", BOT);
  writeConfig({ enabled: true });
  const del = await call("DELETE", "/sources/slack/key");
  assert.equal(del.status, 204);
  for (const name of ["SLACK_USER_TOKEN", "SLACK_BOT_TOKEN"]) {
    const read = await readCurrent(name);
    assert.ok(!read.ok || read.value === "");
  }
  const names = (await listKeys()).map((k) => k.name);
  assert.ok(names.includes("SLACK_USER_TOKEN"));
  assert.ok(names.includes("SLACK_BOT_TOKEN"));
  assert.equal(slackEnabledOnDisk(), false);
  const get = JSON.parse(
    (await call("GET", "/sources/slack/connection")).text,
  ) as { configured?: boolean };
  assert.equal(get.configured, false);
});

test("PUT a user token over a stored bot token clears the bot key", async () => {
  await fill("SLACK_BOT_TOKEN", BOT);
  const put = await call("PUT", "/sources/slack/key", { apiKey: USER });
  assert.equal(put.status, 200);
  const bot = await readCurrent("SLACK_BOT_TOKEN");
  assert.ok(!bot.ok || bot.value === "");
  const user = await readCurrent("SLACK_USER_TOKEN");
  assert.ok(user.ok && user.value === USER);
});

test("a DELETE whose Vault write fails answers 500, and a retry clears both keys", async () => {
  await fill("SLACK_USER_TOKEN", USER);
  await fill("SLACK_BOT_TOKEN", BOT);
  writeConfig({ enabled: true });
  const values = path.join(env.dispatchDir, "vault", "values.env");
  fs.renameSync(values, `${values}.kept`);
  fs.mkdirSync(values);
  let failed: { status: number; text: string };
  try {
    failed = await call("DELETE", "/sources/slack/key");
  } finally {
    fs.rmdirSync(values);
    fs.renameSync(`${values}.kept`, values);
  }
  assert.equal(failed.status, 500);
  assert.equal(slackEnabledOnDisk(), false);
  const retry = await call("DELETE", "/sources/slack/key");
  assert.equal(retry.status, 204);
  for (const name of ["SLACK_USER_TOKEN", "SLACK_BOT_TOKEN"]) {
    const read = await readCurrent(name);
    assert.ok(!read.ok || read.value === "");
  }
});

test("a PUT whose Vault store fails answers 500 save-failed and restores the switch", async () => {
  writeConfig({ enabled: false });
  await fill("SLACK_BOT_TOKEN", BOT);
  await clearValue("SLACK_BOT_TOKEN");
  const values = path.join(env.dispatchDir, "vault", "values.env");
  fs.renameSync(values, `${values}.kept`);
  fs.mkdirSync(values);
  let put: { status: number; text: string };
  try {
    put = await call("PUT", "/sources/slack/key", { apiKey: USER });
  } finally {
    fs.rmdirSync(values);
    fs.renameSync(`${values}.kept`, values);
  }
  assert.equal(put.status, 500);
  assert.deepEqual(JSON.parse(put.text), { error: "save-failed" });
  assert.equal(slackEnabledOnDisk(), false);
  const user = await readCurrent("SLACK_USER_TOKEN");
  assert.ok(!user.ok || user.value === "");
});

test("a DELETE that lands while a PUT is checking the token wins and nothing is stored", async () => {
  let release: () => void = () => undefined;
  slackAnswer = (token) =>
    new Promise((resolve) => {
      release = () => resolve(json(200, authBody(token)));
    });
  const saving = call("PUT", "/sources/slack/key", { apiKey: USER });
  while (slackCalls === 0) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await call("DELETE", "/sources/slack/key")).status, 204);
  release();
  const saved = await saving;
  assert.equal(saved.status, 409);
  assert.deepEqual(JSON.parse(saved.text), { error: "superseded" });
  const user = await readCurrent("SLACK_USER_TOKEN");
  assert.ok(!user.ok || user.value === "");
  assert.notEqual(slackEnabledOnDisk(), true);
});
