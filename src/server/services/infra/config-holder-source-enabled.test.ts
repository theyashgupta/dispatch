import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const { setSourceEnabled, setOrchestrationConfig, getOrchestrationConfig } =
  await import("./config-holder.js");

after(() => env.cleanup());

function write(value: unknown): void {
  fs.writeFileSync(configPath, JSON.stringify(value), { mode: 0o644 });
}

function read(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
}

test("setSourceEnabled writes only sources.github.enabled and keeps every other key", () => {
  write({
    port: 4700,
    custom: { nested: true },
    sources: {
      linear: { apiKey: "k", filters: { teams: ["t"] } },
      github: { pollIntervalMs: 90000 },
    },
  });
  setSourceEnabled("github", true);
  const next = read();
  assert.equal(next.port, 4700);
  assert.deepEqual(next.custom, { nested: true });
  assert.deepEqual(next.sources, {
    linear: { apiKey: "k", filters: { teams: ["t"] } },
    github: { pollIntervalMs: 90000, enabled: true },
  });
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
});

test("setSourceEnabled creates the sources block when it is missing", () => {
  write({ port: 4700 });
  setSourceEnabled("github", false);
  assert.deepEqual(read().sources, { github: { enabled: false } });
});

test("setSourceEnabled updates the held config in place", () => {
  write({ port: 4700 });
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, github: { pollIntervalMs: 5000 } },
  });
  setSourceEnabled("github", true);
  assert.deepEqual(getOrchestrationConfig()?.sources?.github, {
    pollIntervalMs: 5000,
    enabled: true,
  });
  assert.deepEqual(getOrchestrationConfig()?.sources?.linear, { apiKey: "" });
});
