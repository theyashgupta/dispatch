import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolateEnv } from "../test-support/fixtures.js";
import { CROSS_SESSION_INBOUND_VALUES } from "../../shared/types.js";

const env = isolateEnv();
const { installHookArtifacts } = await import("./hook-setup.js");
const { HOOK_SETTINGS_PATH, hookSettingsPath } =
  await import("../services/infra/paths.js");
after(() => env.cleanup());

interface Settings {
  crossSessionInbound?: unknown;
  hooks: Record<string, { matcher?: string; hooks: { timeout: number }[] }[]>;
  permissions: { deny: string[] };
}

const read = (file: string) =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Settings;

void test("the default settings file holds the config value", async () => {
  await installHookArtifacts("accept");
  assert.equal(read(HOOK_SETTINGS_PATH).crossSessionInbound, "accept");
  await installHookArtifacts("hold");
  assert.equal(read(HOOK_SETTINGS_PATH).crossSessionInbound, "hold");
});

void test("each value file exists with its own value", async () => {
  await installHookArtifacts("accept");
  for (const value of CROSS_SESSION_INBOUND_VALUES) {
    assert.equal(read(hookSettingsPath(value)).crossSessionInbound, value);
  }
});

void test("all four settings files keep the hooks and the deny rule", async () => {
  await installHookArtifacts("refuse");
  const files = [
    HOOK_SETTINGS_PATH,
    ...CROSS_SESSION_INBOUND_VALUES.map(hookSettingsPath),
  ];
  for (const file of files) {
    const settings = read(file);
    assert.equal(settings.hooks.SessionStart?.[0]?.hooks[0]?.timeout, 5, file);
    const matchers = settings.hooks.PreToolUse?.map((e) => e.matcher);
    assert.deepEqual(matchers, ["AskUserQuestion|ExitPlanMode", "Bash"], file);
    assert.equal(settings.permissions.deny.length, 1, file);
  }
});
