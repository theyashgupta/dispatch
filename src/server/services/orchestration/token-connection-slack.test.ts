import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const { TOKEN_SOURCES, saveTokenSourceKey, disconnectTokenSource } =
  await import("./token-connection.js");
const { createKey, listKeys, readCurrent, clearValue, setValue } =
  await import("../infra/vault.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");

after(() => env.cleanup());

let calls = 0;
const slack = TOKEN_SOURCES.slack;
const github = TOKEN_SOURCES.github;

beforeEach(async () => {
  calls = 0;
  for (const name of ["SLACK_USER_TOKEN", "SLACK_BOT_TOKEN"]) {
    if ((await listKeys()).some((k) => k.name === name)) await clearValue(name);
  }
  fs.writeFileSync(
    configPath,
    JSON.stringify({ port: 4700, sources: { linear: { apiKey: "" } } }),
    { mode: 0o600 },
  );
  setOrchestrationConfig({ linearApiKey: "", sources: {} });
  mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
    calls += 1;
    const token = (
      new Headers(init?.headers).get("authorization") ?? ""
    ).replace("Bearer ", "");
    const body = token.startsWith("xoxp-g6-fake-revoked")
      ? { ok: false, error: "token_revoked" }
      : { ok: true, url: "https://acme.slack.com/", team: "Acme", user: "u" };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => mock.restoreAll());

async function fill(name: string, value: string): Promise<void> {
  if ((await listKeys()).some((k) => k.name === name)) {
    await setValue(name, value);
  } else {
    await createKey({ name, purpose: "p", value });
  }
}

test("keyFor routes each prefix to its key and the key is created with its own purpose", async () => {
  assert.equal(slack.keyFor?.("xoxp-a"), "SLACK_USER_TOKEN");
  assert.equal(slack.keyFor?.("xoxb-a"), "SLACK_BOT_TOKEN");
  const saved = await saveTokenSourceKey(slack, "xoxb-g6-fake-bot", () => true);
  assert.ok(saved.ok);
  const key = (await listKeys()).find((k) => k.name === "SLACK_BOT_TOKEN");
  assert.match(key?.purpose ?? "", /used only when SLACK_USER_TOKEN is empty/);
  const saved2 = await saveTokenSourceKey(
    slack,
    "xoxp-g6-fake-user",
    () => true,
  );
  assert.ok(saved2.ok);
  const user = (await listKeys()).find((k) => k.name === "SLACK_USER_TOKEN");
  assert.match(user?.purpose ?? "", /Preferred/);
});

test("an xoxc token is refused with no fetch and no write", async () => {
  const before = fs.readFileSync(configPath, "utf8");
  const saved = await saveTokenSourceKey(
    slack,
    "xoxc-g6-fake-session",
    () => true,
  );
  assert.deepEqual(saved, { ok: false, failure: { error: "rejected" } });
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
});

test("a Slack rejection carries the provider code", async () => {
  const saved = await saveTokenSourceKey(
    slack,
    "xoxp-g6-fake-revoked",
    () => true,
  );
  assert.deepEqual(saved, {
    ok: false,
    failure: { error: "rejected", providerError: "token_revoked" },
  });
});

test("disconnect clears every Slack key, filled or not", async () => {
  await fill("SLACK_BOT_TOKEN", "xoxb-b");
  assert.ok(await disconnectTokenSource(slack));
  const bot = await readCurrent("SLACK_BOT_TOKEN");
  assert.ok(!bot.ok || bot.value === "");
  await fill("SLACK_USER_TOKEN", "xoxp-u");
  await fill("SLACK_BOT_TOKEN", "xoxb-b");
  assert.ok(await disconnectTokenSource(slack));
  for (const name of ["SLACK_USER_TOKEN", "SLACK_BOT_TOKEN"]) {
    const read = await readCurrent(name);
    assert.ok(!read.ok || read.value === "");
  }
});

test("GitHub's definition keeps one key and no prefix routing", () => {
  assert.equal(github.keyFor, undefined);
  assert.equal(github.extraKeys, undefined);
  assert.equal(github.vaultKey, "GITHUB_TOKEN");
});
