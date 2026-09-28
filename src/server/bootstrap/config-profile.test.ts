import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-config-profile-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
const { loadConfig } = await import("./config.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

function writeConfig(extra: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ sources: { linear: { apiKey: "k" } }, ...extra }),
  );
}

test("a valid profile loads normalized", () => {
  writeConfig({ profile: { name: " Ada ", handles: ["@ada", "@ada"] } });
  assert.deepEqual(loadConfig().profile, { name: "Ada", handles: ["@ada"] });
});

test("a malformed, empty or absent profile loads as absent and still boots", () => {
  for (const profile of [
    "Ada",
    [],
    { handles: "@ada" },
    { name: "a".repeat(201) },
    {},
    undefined,
  ]) {
    writeConfig(profile === undefined ? {} : { profile });
    const config = loadConfig();
    assert.equal(config.profile, undefined, JSON.stringify(profile));
    assert.equal(config.linearApiKey, "k");
  }
});
