import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { loadConfig } = await import("./config.js");
const configPath = path.join(env.dispatchDir, "config.json");

void test("loadConfig carries a stored activeClaudeAccountId through to the runtime config", () => {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      linearApiKey: "",
      port: 4700,
      activeClaudeAccountId: "11111111-1111-4111-8111-111111111111",
    }),
  );
  assert.equal(
    loadConfig().activeClaudeAccountId,
    "11111111-1111-4111-8111-111111111111",
  );
});

void test("loadConfig leaves the pointer absent when the key is missing, empty, or not a string", () => {
  for (const value of [undefined, "", "   ", 7, null]) {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        linearApiKey: "",
        port: 4700,
        ...(value === undefined ? {} : { activeClaudeAccountId: value }),
      }),
    );
    assert.equal("activeClaudeAccountId" in loadConfig(), false, String(value));
  }
});
