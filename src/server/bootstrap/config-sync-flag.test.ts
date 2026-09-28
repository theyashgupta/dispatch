import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-sync-flag-"));
process.env.HOME = home;
const configPath = path.join(home, ".dispatch", "config.json");
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
const { loadConfig } = await import("./config.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

function flagFor(value: unknown): boolean | undefined {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const body: Record<string, unknown> = {
    sources: { linear: { apiKey: "k" } },
  };
  if (value !== undefined) body.linearSyncViaClaude = value;
  fs.writeFileSync(configPath, JSON.stringify(body));
  return loadConfig().linearSyncViaClaude;
}

test("linearSyncViaClaude is true only for the literal true", () => {
  assert.equal(flagFor(true), true);
  for (const value of [undefined, false, "true", 1, null, {}]) {
    assert.equal(flagFor(value), false, `value ${JSON.stringify(value)}`);
  }
});
