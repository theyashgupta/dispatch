import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const { loadConfig } = await import("./config.js");

after(() => env.cleanup());

function write(value: unknown): void {
  fs.writeFileSync(configPath, JSON.stringify(value), { mode: 0o600 });
}

test("loadConfig reads a well-formed github block", () => {
  write({ sources: { github: { enabled: true, pollIntervalMs: 120000 } } });
  assert.deepEqual(loadConfig().sources?.github, {
    enabled: true,
    pollIntervalMs: 120000,
  });
});

test("loadConfig drops a non-boolean enabled and a non-positive interval", () => {
  write({ sources: { github: { enabled: "yes", pollIntervalMs: -5 } } });
  assert.deepEqual(loadConfig().sources?.github, {});
});

test("loadConfig ignores a github block that is not an object", () => {
  write({ sources: { github: ["enabled"] } });
  assert.deepEqual(loadConfig().sources?.github, {});
});
