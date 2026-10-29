import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { CROSS_SESSION_INBOUND_VALUES } from "../../../shared/types.js";

const env = isolateEnv();
const { hookSettingsJson, writeLoopSettings } =
  await import("./hook-settings.js");
const { hookSettingsPath, VAULT_VALUES_PATH } = await import("./paths.js");
after(() => env.cleanup());

interface Parsed {
  crossSessionInbound: string;
  hooks: unknown;
  idleCompaction?: boolean;
  permissions: { deny: string[] };
  promptSuggestionEnabled?: boolean;
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

void test("hookSettingsPath names the orchestrator file of its value", () => {
  for (const value of CROSS_SESSION_INBOUND_VALUES) {
    assert.ok(
      hookSettingsPath(value, true).endsWith(
        `hook-settings-${value}-orchestrator.json`,
      ),
    );
  }
});

void test("every loop settings file turns idle compaction and prompt suggestions off", () => {
  for (const value of CROSS_SESSION_INBOUND_VALUES) {
    assert.equal(parse(hookSettingsJson(value)).idleCompaction, false);
    assert.equal(parse(hookSettingsJson(value)).promptSuggestionEnabled, false);
  }
});

void test("every orchestrator settings file leaves both loop keys out and keeps the rest", () => {
  for (const value of CROSS_SESSION_INBOUND_VALUES) {
    const loop = parse(hookSettingsJson(value));
    const orchestrator = parse(hookSettingsJson(value, true));
    assert.equal("idleCompaction" in orchestrator, false);
    assert.equal("promptSuggestionEnabled" in orchestrator, false);
    assert.deepEqual(Object.keys(orchestrator), [
      "permissions",
      "crossSessionInbound",
      "hooks",
    ]);
    assert.deepEqual(orchestrator.hooks, loop.hooks);
    assert.deepEqual(orchestrator.permissions, loop.permissions);
    assert.equal(orchestrator.crossSessionInbound, loop.crossSessionInbound);
  }
});

/**
 * Make an empty config dir under the test root and return its path.
 */
function freshDir(name: string): string {
  const dir = path.join(env.root, name);
  fs.mkdirSync(dir);
  return dir;
}

const readSettings = (dir: string) =>
  JSON.parse(
    fs.readFileSync(path.join(dir, "settings.json"), "utf8"),
  ) as Record<string, unknown>;

void test("writeLoopSettings creates settings.json with both keys in a new config dir", async () => {
  const dir = freshDir("new-dir");
  await writeLoopSettings(dir);
  assert.deepEqual(readSettings(dir), {
    idleCompaction: false,
    promptSuggestionEnabled: false,
  });
});

void test("writeLoopSettings keeps the other keys and overrides a true value", async () => {
  const dir = freshDir("existing-dir");
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({
      theme: "dark",
      hooks: { Stop: [] },
      idleCompaction: true,
    }),
  );
  await writeLoopSettings(dir);
  assert.deepEqual(readSettings(dir), {
    theme: "dark",
    hooks: { Stop: [] },
    idleCompaction: false,
    promptSuggestionEnabled: false,
  });
});

void test("writeLoopSettings is idempotent and leaves a settled file untouched", async () => {
  const dir = freshDir("idempotent-dir");
  fs.writeFileSync(path.join(dir, "settings.json"), '{"model":"opus"}');
  await writeLoopSettings(dir);
  const once = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
  const mtime = fs.statSync(path.join(dir, "settings.json")).mtimeMs;
  await writeLoopSettings(dir);
  assert.equal(fs.readFileSync(path.join(dir, "settings.json"), "utf8"), once);
  assert.equal(fs.statSync(path.join(dir, "settings.json")).mtimeMs, mtime);
});

void test("writeLoopSettings writes through a settings.json link and keeps the link", async () => {
  const target = path.join(freshDir("link-home"), "settings.json");
  fs.writeFileSync(target, '{"theme":"light"}');
  const dir = freshDir("link-dir");
  fs.symlinkSync(target, path.join(dir, "settings.json"));
  await writeLoopSettings(dir);
  assert.equal(
    fs.lstatSync(path.join(dir, "settings.json")).isSymbolicLink(),
    true,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), {
    theme: "light",
    idleCompaction: false,
    promptSuggestionEnabled: false,
  });
});

void test("writeLoopSettings leaves a file that is not a JSON object as it is", async () => {
  for (const [i, raw] of ["{ not json", "[1,2]", "null"].entries()) {
    const dir = freshDir(`bad-${i}`);
    fs.writeFileSync(path.join(dir, "settings.json"), raw);
    await writeLoopSettings(dir);
    assert.equal(fs.readFileSync(path.join(dir, "settings.json"), "utf8"), raw);
  }
});
