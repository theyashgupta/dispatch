import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { CROSS_SESSION_INBOUND_VALUES } from "../../../shared/types.js";

const env = isolateEnv();
const { hookSettingsJson } = await import("./hook-settings.js");
const { hookSettingsPath, VAULT_VALUES_PATH } = await import("./paths.js");
after(() => env.cleanup());

interface Parsed {
  crossSessionInbound: string;
  hooks: unknown;
  permissions: { deny: string[] };
}

const parse = (json: string) => JSON.parse(json) as Parsed;

void test("every value carries its own crossSessionInbound and the same hooks and deny rule", () => {
  const base = parse(hookSettingsJson("accept"));
  for (const value of CROSS_SESSION_INBOUND_VALUES) {
    const settings = parse(hookSettingsJson(value));
    assert.equal(settings.crossSessionInbound, value);
    assert.deepEqual(settings.hooks, base.hooks);
    assert.deepEqual(settings.permissions, base.permissions);
  }
  assert.deepEqual(base.permissions.deny, [
    `Read(//${VAULT_VALUES_PATH.slice(1)})`,
  ]);
});

void test("hookSettingsPath names the file of its value", () => {
  for (const value of CROSS_SESSION_INBOUND_VALUES) {
    assert.ok(hookSettingsPath(value).endsWith(`hook-settings-${value}.json`));
  }
});
