import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { installHookArtifacts } = await import("./hook-setup.js");

void test.after(() => env.cleanup());

void test("the generated hook settings register StopFailure with the same entry as Stop", async () => {
  await installHookArtifacts();
  const settings = JSON.parse(
    fs.readFileSync(path.join(env.dispatchDir, "hook-settings.json"), "utf8"),
  ) as { hooks: Record<string, unknown> };
  assert.ok(Array.isArray(settings.hooks.Stop));
  assert.deepEqual(settings.hooks.StopFailure, settings.hooks.Stop);
  const [entry] = settings.hooks.StopFailure as {
    hooks: { type: string; command: string; timeout: number }[];
  }[];
  assert.equal(entry.hooks[0].type, "command");
  assert.equal(entry.hooks[0].command, path.join(env.dispatchDir, "hook.sh"));
  assert.equal(entry.hooks[0].timeout, 5);
});
