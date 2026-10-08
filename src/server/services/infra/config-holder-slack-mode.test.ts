import assert from "node:assert/strict";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { slackMode, setOrchestrationConfig } =
  await import("./config-holder.js");
const { resolveSlackMode } = await import("../../../shared/slack-mode.js");
const { createKey } = await import("./vault.js");

after(() => env.cleanup());

test("M1: resolveSlackMode reads a valid configured mode, else the Vault token", () => {
  assert.equal(resolveSlackMode(undefined, false), "mcp");
  assert.equal(resolveSlackMode(undefined, true), "token");
  assert.equal(resolveSlackMode("mcp", true), "mcp");
  assert.equal(resolveSlackMode("token", false), "token");
  assert.equal(resolveSlackMode("bogus", true), "token");
  assert.equal(resolveSlackMode(42, false), "mcp");
});

test("M2: no sources.slack and an empty Vault resolve to mcp", async () => {
  setOrchestrationConfig({ linearApiKey: "" });
  assert.equal(await slackMode(), "mcp");
});

test("M3: a Vault token and no mode resolve to token", async () => {
  await createKey({
    name: "SLACK_USER_TOKEN",
    purpose: "p",
    value: "xoxp-g6-fake-user",
  });
  setOrchestrationConfig({ linearApiKey: "", sources: { slack: {} } });
  assert.equal(await slackMode(), "token");
});

test("M4: a configured mode wins over the Vault token", async () => {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { slack: { mode: "mcp" } },
  });
  assert.equal(await slackMode(), "mcp");
});
