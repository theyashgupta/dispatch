import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import type { Config } from "../../../shared/types.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-linear-key-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("./paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
const { clearLinearApiKey, getOrchestrationConfig, setOrchestrationConfig } =
  await import("./config-holder.js");

const FILTERS = { currentCycle: true, includeActive: false, teams: ["t1"] };

function writeConfig(value: unknown): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<
    string,
    unknown
  >;
}

const sha = () =>
  createHash("sha256").update(fs.readFileSync(CONFIG_PATH)).digest("hex");

beforeEach(() => {
  setOrchestrationConfig({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", filters: FILTERS } },
  } as Config);
});

after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

test("removes only the key and keeps filters, enabled, pollIntervalMs and every other top-level key", () => {
  writeConfig({
    port: 4799,
    claudeArgs: "model sonnet",
    sources: {
      linear: {
        apiKey: "k",
        filters: FILTERS,
        enabled: true,
        pollIntervalMs: 90000,
      },
    },
  });
  clearLinearApiKey();
  assert.deepEqual(readConfig(), {
    port: 4799,
    claudeArgs: "model sonnet",
    sources: {
      linear: { filters: FILTERS, enabled: true, pollIntervalMs: 90000 },
    },
  });
  assert.equal(fs.statSync(CONFIG_PATH).mode & 0o777, 0o600);
});

test("clears the held config to the typed empty key", () => {
  writeConfig({ sources: { linear: { apiKey: "k" } } });
  clearLinearApiKey();
  const held = getOrchestrationConfig()!;
  assert.equal(held.linearApiKey, "");
  assert.equal(held.sources?.linear?.apiKey, "");
  assert.deepEqual(held.sources?.linear?.filters, FILTERS);
});

test("removes a legacy flat linearApiKey too", () => {
  writeConfig({ linearApiKey: "k", port: 4799 });
  clearLinearApiKey();
  assert.deepEqual(readConfig(), { port: 4799 });
});

test("a config with no stored key is left byte-identical", () => {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ port: 4799, sources: { linear: { filters: FILTERS } } }),
    { mode: 0o600 },
  );
  const before = sha();
  clearLinearApiKey();
  assert.equal(sha(), before);
  assert.equal(getOrchestrationConfig()!.linearApiKey, "");
});

test("removes both the nested and the legacy flat key when both are present", () => {
  writeConfig({
    linearApiKey: "old",
    port: 4799,
    sources: { linear: { apiKey: "k", filters: FILTERS } },
  });
  clearLinearApiKey();
  assert.deepEqual(readConfig(), {
    port: 4799,
    sources: { linear: { filters: FILTERS } },
  });
});

test("a missing config file throws and creates nothing", () => {
  fs.rmSync(CONFIG_PATH, { force: true });
  assert.throws(() => clearLinearApiKey(), /ENOENT/);
  assert.equal(fs.existsSync(CONFIG_PATH), false);
});
