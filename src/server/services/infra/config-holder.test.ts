import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULT_FILTERS } from "../../../shared/types.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-holder-test-"));
process.env.HOME = home;
const configPath = path.join(home, ".dispatch", "config.json");
const { CONFIG_PATH } = await import("./paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
const {
  getClaudeAccountsSettings,
  getOrchestrationConfig,
  patchSourceConfig,
  setOrchestrationConfig,
  updateClaudeAccountsSettings,
  updateLinearApiKey,
  updateSourceFilters,
} = await import("./config-holder.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

function writeConfig(): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: 4700,
      sources: {
        linear: { apiKey: "k", enabled: false, pollIntervalMs: 15000 },
      },
    }),
  );
}

function readLinear(): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources: { linear: Record<string, unknown> };
  };
  return parsed.sources.linear;
}

test("updateSourceFilters keeps enabled and pollIntervalMs on disk", () => {
  writeConfig();
  updateSourceFilters("linear", { ...DEFAULT_FILTERS, teams: ["t1"] });
  const linear = readLinear();
  assert.equal(linear.enabled, false);
  assert.equal(linear.pollIntervalMs, 15000);
  assert.deepEqual((linear.filters as { teams: string[] }).teams, ["t1"]);
});

test("updateLinearApiKey keeps enabled and pollIntervalMs on disk", () => {
  writeConfig();
  updateLinearApiKey("k2");
  const linear = readLinear();
  assert.equal(linear.apiKey, "k2");
  assert.equal(linear.enabled, false);
  assert.equal(linear.pollIntervalMs, 15000);
});

test("updateSourceFilters refuses an unknown source", () => {
  writeConfig();
  assert.throws(
    () => updateSourceFilters("slack", DEFAULT_FILTERS),
    /unknown source/,
  );
});

test("patchSourceConfig writes only sources.meeting, keeps the Linear block and mode 0600", () => {
  writeConfig();
  updateSourceFilters("linear", { ...DEFAULT_FILTERS, teams: ["t1"] });
  setOrchestrationConfig({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k" }, meeting: { windowHours: 48 } },
  });
  patchSourceConfig("meeting", { enabled: true });
  patchSourceConfig("meeting", { windowHours: 168 });
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    port: number;
    sources: Record<string, Record<string, unknown>>;
  };
  assert.equal(parsed.port, 4700);
  assert.deepEqual(parsed.sources.meeting, { enabled: true, windowHours: 168 });
  const linear = parsed.sources.linear;
  assert.equal(linear.apiKey, "k");
  assert.equal(linear.pollIntervalMs, 15000);
  assert.deepEqual((linear.filters as { teams: string[] }).teams, ["t1"]);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.deepEqual(getOrchestrationConfig()?.sources?.meeting, {
    enabled: true,
    windowHours: 168,
  });
  assert.equal(getOrchestrationConfig()?.sources?.linear?.apiKey, "k");
});

test("claude accounts settings default when the key is absent", () => {
  writeConfig();
  setOrchestrationConfig({ linearApiKey: "", port: 4700 });
  assert.deepEqual(getClaudeAccountsSettings(), {
    autoMove: false,
    thresholdPercent: 100,
    minDwellMinutes: 15,
  });
});

test("claude accounts settings merge partial keys over the defaults", () => {
  setOrchestrationConfig({
    linearApiKey: "",
    port: 4700,
    claudeAccounts: { autoMove: true, minDwellMinutes: 30 },
  });
  assert.deepEqual(getClaudeAccountsSettings(), {
    autoMove: true,
    thresholdPercent: 100,
    minDwellMinutes: 30,
  });
});

test("updateClaudeAccountsSettings writes only the claudeAccounts key and keeps stored keys", () => {
  writeConfig();
  setOrchestrationConfig({ linearApiKey: "", port: 4700 });
  const before = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  updateClaudeAccountsSettings({ thresholdPercent: 80 });
  updateClaudeAccountsSettings({ autoMove: true });
  const after = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(after, {
    ...before,
    claudeAccounts: { thresholdPercent: 80, autoMove: true },
  });
  assert.deepEqual(getClaudeAccountsSettings(), {
    autoMove: true,
    thresholdPercent: 80,
    minDwellMinutes: 15,
  });
});

test("updateClaudeAccountsSettings with an empty patch leaves config.json byte-identical", () => {
  writeConfig();
  setOrchestrationConfig({ linearApiKey: "", port: 4700 });
  const before = fs.readFileSync(configPath, "utf8");
  updateClaudeAccountsSettings({});
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
});

test("updateClaudeAccountsSettings never makes a wrong-typed stored key live", () => {
  writeConfig();
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  fs.writeFileSync(
    configPath,
    JSON.stringify({ ...raw, claudeAccounts: { thresholdPercent: "90" } }),
  );
  setOrchestrationConfig({ linearApiKey: "", port: 4700, claudeAccounts: {} });
  updateClaudeAccountsSettings({ minDwellMinutes: 5 });
  assert.deepEqual(getClaudeAccountsSettings(), {
    autoMove: false,
    thresholdPercent: 100,
    minDwellMinutes: 5,
  });
});
