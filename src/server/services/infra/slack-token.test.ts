import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { createKey, listKeys, clearValue } = await import("./vault.js");
const { resolveSlackToken, slackKeyFor } = await import("./slack-token.js");

after(() => env.cleanup());

beforeEach(async () => {
  for (const name of ["SLACK_USER_TOKEN", "SLACK_BOT_TOKEN"]) {
    if ((await listKeys()).some((k) => k.name === name)) await clearValue(name);
  }
});

async function fill(name: string, value: string): Promise<void> {
  const exists = (await listKeys()).some((k) => k.name === name);
  if (exists) {
    const { setValue } = await import("./vault.js");
    await setValue(name, value);
  } else {
    await createKey({ name, purpose: "p", value });
  }
}

test("neither key filled resolves to null", async () => {
  assert.equal(await resolveSlackToken(), null);
});

test("the user token wins over the bot token", async () => {
  await fill("SLACK_BOT_TOKEN", "xoxb-g6-fake-bot");
  await fill("SLACK_USER_TOKEN", "xoxp-g6-fake-user");
  assert.deepEqual(await resolveSlackToken(), {
    token: "xoxp-g6-fake-user",
    via: "vault",
    key: "SLACK_USER_TOKEN",
    kind: "user",
  });
});

test("the bot token is used when the user token is empty", async () => {
  await fill("SLACK_BOT_TOKEN", "xoxb-g6-fake-bot");
  assert.deepEqual(await resolveSlackToken(), {
    token: "xoxb-g6-fake-bot",
    via: "vault",
    key: "SLACK_BOT_TOKEN",
    kind: "bot",
  });
});

test("a user value that is not printable ASCII is skipped for the bot token", async () => {
  await fill("SLACK_USER_TOKEN", "xoxp-g6 fake");
  await fill("SLACK_BOT_TOKEN", "xoxb-g6-fake-bot");
  assert.equal((await resolveSlackToken())?.key, "SLACK_BOT_TOKEN");
});

test("resolving never writes the token to the console", async () => {
  await fill("SLACK_USER_TOKEN", "xoxp-g6-fake-user");
  const lines: string[] = [];
  for (const method of ["log", "warn", "error", "info"] as const) {
    mock.method(console, method, (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  await resolveSlackToken();
  mock.restoreAll();
  assert.ok(lines.every((l) => !l.includes("xoxp-g6-fake-user")));
});

test("slackKeyFor maps xoxp and xoxb and refuses every other prefix", () => {
  assert.equal(slackKeyFor("xoxp-1"), "SLACK_USER_TOKEN");
  assert.equal(slackKeyFor("xoxb-1"), "SLACK_BOT_TOKEN");
  assert.equal(slackKeyFor("xoxc-1"), null);
  assert.equal(slackKeyFor("xoxe-1"), null);
  assert.equal(slackKeyFor("ghp_x"), null);
});
