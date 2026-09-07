import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULT_TERMINAL_APPEARANCE } from "../../shared/terminal-appearance.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-config-test-"));
process.env.HOME = home;
const configPath = path.join(home, ".dispatch", "config.json");
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(
  CONFIG_PATH.startsWith(home),
  `CONFIG_PATH ${CONFIG_PATH} escaped the temp HOME; refusing to touch a real config`,
);
const { loadConfig } = await import("./config.js");
const {
  updateClaudeArgs,
  updateCleanupDelayDays,
  updateLastUsedPlaybook,
  updateTerminalAppearance,
} = await import("../services/infra/config-holder.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

function writeConfig(extra: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({ sources: { linear: { apiKey: "k" } }, ...extra }),
  );
}

test("absent terminal block resolves to the default", () => {
  writeConfig({});
  assert.deepEqual(loadConfig().terminal, DEFAULT_TERMINAL_APPEARANCE);
});

test("a valid terminal block is honored", () => {
  const custom = { ...DEFAULT_TERMINAL_APPEARANCE, fontSize: 18 };
  writeConfig({ terminal: custom });
  assert.deepEqual(loadConfig().terminal, custom);
});

for (const [name, terminal] of [
  ["a string", "garbage"],
  ["a partial object", { fontSize: 18 }],
  ["a wrong type", { ...DEFAULT_TERMINAL_APPEARANCE, fontSize: "big" }],
] as const) {
  test(`${name} terminal block resolves to the default without throwing`, () => {
    writeConfig({ terminal });
    assert.deepEqual(loadConfig().terminal, DEFAULT_TERMINAL_APPEARANCE);
  });
}

test("updateTerminalAppearance writes only the terminal block, keeps other keys and mode 0600", () => {
  writeConfig({ cleanupDelayDays: 3, port: 4712 });
  const custom = { ...DEFAULT_TERMINAL_APPEARANCE, background: "#223344" };
  updateTerminalAppearance(custom);
  const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(written.terminal, custom);
  assert.equal(written.cleanupDelayDays, 3);
  assert.equal(written.port, 4712);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.deepEqual(loadConfig().terminal, custom);
});

test("updateTerminalAppearance refuses to write over a malformed config file", () => {
  fs.writeFileSync(configPath, "{not json");
  assert.throws(
    () => updateTerminalAppearance(DEFAULT_TERMINAL_APPEARANCE),
    /not valid JSON/,
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), "{not json");
});

test("the sibling flat-key writers each merge only their own key", () => {
  writeConfig({ terminal: DEFAULT_TERMINAL_APPEARANCE, port: 4712 });
  updateCleanupDelayDays(9);
  updateClaudeArgs("-p qa");
  updateLastUsedPlaybook("smoke");
  const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(written.cleanupDelayDays, 9);
  assert.equal(written.claudeArgs, "-p qa");
  assert.equal(written.lastUsedPlaybook, "smoke");
  assert.equal(written.port, 4712);
  assert.deepEqual(written.terminal, DEFAULT_TERMINAL_APPEARANCE);
});

test("loadConfig carries a stored activeClaudeAccountId through to the runtime config", () => {
  writeConfig({
    activeClaudeAccountId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(
    loadConfig().activeClaudeAccountId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("loadConfig leaves the pointer absent when the key is missing, empty, or not a string", () => {
  for (const value of [undefined, "", "   ", 7, null]) {
    writeConfig(value === undefined ? {} : { activeClaudeAccountId: value });
    assert.equal("activeClaudeAccountId" in loadConfig(), false, String(value));
  }
});
