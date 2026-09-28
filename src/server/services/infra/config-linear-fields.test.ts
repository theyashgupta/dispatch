import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULT_FILTERS } from "../../../shared/types.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-linear-fields-"));
process.env.HOME = home;
const configPath = path.join(home, ".dispatch", "config.json");
const { CONFIG_PATH } = await import("./paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
const { updateLinearApiKey, updateLinearStateMap, updateSourceFilters } =
  await import("./config-holder.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

test("the state map, filters and API key writers keep each other's fields", () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({ port: 4700, sources: { linear: { apiKey: "old" } } }),
  );
  const stateMap = { "team-eng": { done: null } };
  updateLinearStateMap(stateMap);
  updateSourceFilters("linear", DEFAULT_FILTERS);
  updateLinearApiKey("new");
  const linear = (
    JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      sources: { linear: Record<string, unknown> };
    }
  ).sources.linear;
  assert.deepEqual(linear.stateMap, stateMap);
  assert.deepEqual(linear.filters, DEFAULT_FILTERS);
  assert.equal(linear.apiKey, "new");
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
});
