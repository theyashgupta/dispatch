import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const { loadConfig } = await import("./config.js");
const { setOrchestrationConfig, setSlackChannels, setSourceEnabled } =
  await import("../services/infra/config-holder.js");

after(() => env.cleanup());

function write(value: unknown): void {
  fs.writeFileSync(configPath, JSON.stringify(value), { mode: 0o600 });
}

test("the Slack block parses enabled, interval and valid channels, dropping malformed entries", () => {
  write({
    linearApiKey: "",
    sources: {
      slack: {
        enabled: true,
        pollIntervalMs: 120000,
        channels: [
          { id: "C0G6ENG", name: "eng-platform" },
          { id: "G0G6SEC", name: "security" },
          { id: "D0G6DM1", name: "a dm" },
          { id: "C0G6GEN" },
          { id: "C0G6LNG", name: "x".repeat(81) },
          "C0G6STR",
          null,
        ],
      },
    },
  });
  const config = loadConfig();
  assert.deepEqual(config.sources?.slack, {
    enabled: true,
    pollIntervalMs: 120000,
    channels: [
      { id: "C0G6ENG", name: "eng-platform" },
      { id: "G0G6SEC", name: "security" },
    ],
  });
});

test("the Slack block keeps an mcp or token mode and drops any other value", () => {
  write({ linearApiKey: "", sources: { slack: { mode: "mcp" } } });
  assert.deepEqual(loadConfig().sources?.slack, { mode: "mcp" });
  write({ linearApiKey: "", sources: { slack: { mode: "token" } } });
  assert.deepEqual(loadConfig().sources?.slack, { mode: "token" });
  write({ linearApiKey: "", sources: { slack: { mode: "bogus" } } });
  assert.deepEqual(loadConfig().sources?.slack, {});
});

test("a malformed Slack block never throws and yields no settings", () => {
  write({
    linearApiKey: "",
    sources: { slack: { enabled: "yes", pollIntervalMs: -1, channels: "C1" } },
  });
  assert.deepEqual(loadConfig().sources?.slack, {});
  write({ linearApiKey: "", sources: { slack: [1, 2] } });
  assert.deepEqual(loadConfig().sources?.slack, {});
});

test("setSlackChannels writes only the channel list, keeps every other key and mode 0600", () => {
  write({
    linearApiKey: "",
    port: 4700,
    extra: { keep: true },
    sources: {
      linear: { apiKey: "", filters: { teams: ["keep"] } },
      slack: { enabled: true, pollIntervalMs: 90000 },
    },
  });
  setOrchestrationConfig(loadConfig());
  setSlackChannels([{ id: "C0G6ENG", name: "eng-platform" }]);
  const disk = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(disk.extra, { keep: true });
  assert.equal(disk.port, 4700);
  assert.deepEqual(disk.sources, {
    linear: { apiKey: "", filters: { teams: ["keep"] } },
    slack: {
      enabled: true,
      pollIntervalMs: 90000,
      channels: [{ id: "C0G6ENG", name: "eng-platform" }],
    },
  });
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.deepEqual(loadConfig().sources?.slack?.channels, [
    { id: "C0G6ENG", name: "eng-platform" },
  ]);
});

test("setSourceEnabled on slack keeps the saved channels", () => {
  write({
    linearApiKey: "",
    sources: {
      slack: {
        enabled: true,
        channels: [{ id: "C0G6ENG", name: "eng-platform" }],
      },
    },
  });
  setOrchestrationConfig(loadConfig());
  setSourceEnabled("slack", false);
  const disk = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources: { slack: Record<string, unknown> };
  };
  assert.equal(disk.sources.slack.enabled, false);
  assert.deepEqual(disk.sources.slack.channels, [
    { id: "C0G6ENG", name: "eng-platform" },
  ]);
});

test("boot keeps the first entry per channel id, trims names, and cuts the list at 200", () => {
  const many = Array.from({ length: 205 }, (_, i) => ({
    id: `C0G6${String(i).padStart(3, "0")}`,
    name: `ch-${i}`,
  }));
  write({
    linearApiKey: "",
    sources: {
      slack: {
        channels: [
          { id: "C0G6DUP", name: "  first  " },
          { id: "C0G6DUP", name: "second" },
          ...many,
        ],
      },
    },
  });
  const channels = loadConfig().sources?.slack?.channels ?? [];
  assert.equal(channels.length, 200);
  assert.deepEqual(channels[0], { id: "C0G6DUP", name: "first" });
  assert.equal(channels.filter((c) => c.id === "C0G6DUP").length, 1);
  assert.deepEqual(channels[199], { id: "C0G6198", name: "ch-198" });
});

test("the Slack block keeps mode, enabled and a positive integer mcpIntervalMinutes through a restart", () => {
  write({
    linearApiKey: "",
    sources: { slack: { mode: "mcp", enabled: true, mcpIntervalMinutes: 45 } },
  });
  assert.deepEqual(loadConfig().sources?.slack, {
    mode: "mcp",
    enabled: true,
    mcpIntervalMinutes: 45,
  });
  for (const bad of [0, -5, 2.5, "45", null]) {
    write({
      linearApiKey: "",
      sources: { slack: { mcpIntervalMinutes: bad } },
    });
    assert.deepEqual(loadConfig().sources?.slack, {}, String(bad));
  }
});
