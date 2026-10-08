import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config, SlackSourceConfig } from "../../shared/types.js";
import { buildRegistry, getSource, isSourceEnabled } from "./registry.js";

function config(slack?: unknown): Config {
  return {
    linearApiKey: "k",
    sources: {
      linear: { apiKey: "k" },
      ...(slack === undefined ? {} : { slack: slack as SlackSourceConfig }),
    },
  };
}

test("Slack is enabled only when sources.slack.enabled is exactly true", () => {
  buildRegistry(config({ enabled: true }));
  assert.equal(isSourceEnabled("slack"), true);
  for (const slack of [
    { enabled: false },
    {},
    { enabled: "true" },
    undefined,
  ]) {
    buildRegistry(config(slack));
    assert.equal(isSourceEnabled("slack"), false, JSON.stringify(slack));
  }
});

test("Slack polls every 120000 ms unless sources.slack.pollIntervalMs is set", () => {
  buildRegistry(config({ enabled: true }));
  assert.equal(getSource("slack")?.pollIntervalMs, 120_000);
  buildRegistry({ ...config({ enabled: true }), pollIntervalMs: 20_000 });
  assert.equal(getSource("slack")?.pollIntervalMs, 120_000);
  buildRegistry(config({ enabled: true, pollIntervalMs: 30_000 }));
  assert.equal(getSource("slack")?.pollIntervalMs, 30_000);
});

test("Slack stays enabled in mcp mode, so the page and nav stay visible", () => {
  buildRegistry(config({ enabled: true, mode: "mcp" }));
  assert.equal(isSourceEnabled("slack"), true);
});

test("the registry passes the configured mode, so an mcp setup polls nothing and a token setup needs a credential", async () => {
  buildRegistry(config({ enabled: true, mode: "mcp" }));
  const mcp = await getSource("slack")?.fetch({});
  assert.deepEqual(mcp?.items, []);
  assert.equal(mcp && "cursors" in mcp ? mcp.cursors : undefined, undefined);
  buildRegistry(config({ enabled: true, mode: "token" }));
  await assert.rejects(
    async () => getSource("slack")?.fetch({}),
    /no Slack credential/,
  );
});
