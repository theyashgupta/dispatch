import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { installHookArtifacts } = await import("./hook-setup.js");
const { HOOK_SETTINGS_PATH } = await import("../services/infra/paths.js");
after(() => env.cleanup());

void test("the session hook settings refuse cross-session inbound messages", async () => {
  await installHookArtifacts();
  const settings = JSON.parse(fs.readFileSync(HOOK_SETTINGS_PATH, "utf8")) as {
    crossSessionInbound?: unknown;
    hooks?: unknown;
  };
  assert.equal(settings.crossSessionInbound, "refuse");
  assert.ok(settings.hooks);
});
