import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULT_FILTERS } from "../../../shared/types.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-holder-test-"));
process.env.HOME = home;
const configPath = path.join(home, ".dispatch", "config.json");
const { CONFIG_PATH } = await import("./paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
const { updateLinearApiKey, updateSourceFilters } =
  await import("./config-holder.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

function writeConfig(): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: 4700,
      sources: {
        linear: { apiKey: "k", enabled: false, pollIntervalMs: 15000 },
      },
    }),
  );
}

function readLinear(): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources: { linear: Record<string, unknown> };
  };
  return parsed.sources.linear;
}

test("updateSourceFilters keeps enabled and pollIntervalMs on disk", () => {
  writeConfig();
  updateSourceFilters("linear", { ...DEFAULT_FILTERS, teams: ["t1"] });
  const linear = readLinear();
  assert.equal(linear.enabled, false);
  assert.equal(linear.pollIntervalMs, 15000);
  assert.deepEqual((linear.filters as { teams: string[] }).teams, ["t1"]);
});

test("updateLinearApiKey keeps enabled and pollIntervalMs on disk", () => {
  writeConfig();
  updateLinearApiKey("k2");
  const linear = readLinear();
  assert.equal(linear.apiKey, "k2");
  assert.equal(linear.enabled, false);
  assert.equal(linear.pollIntervalMs, 15000);
});

test("updateSourceFilters refuses an unknown source", () => {
  writeConfig();
  assert.throws(
    () => updateSourceFilters("slack", DEFAULT_FILTERS),
    /unknown source/,
  );
});
