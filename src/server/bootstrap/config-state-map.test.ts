import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-state-map-"));
process.env.HOME = home;
const configPath = path.join(home, ".dispatch", "config.json");
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
const { loadConfig } = await import("./config.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

function stateMapFor(stateMap: unknown): unknown {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({ sources: { linear: { apiKey: "k", stateMap } } }),
  );
  return loadConfig().sources?.linear?.stateMap;
}

test("a stored state map loads, and an invalid one is dropped so defaults apply", () => {
  const map = { "team-eng": { todo: "st-todo", done: null } };
  assert.deepEqual(stateMapFor(map), map);
  assert.equal(
    stateMapFor({ "team-eng": { backlog: "st-backlog" } }),
    undefined,
  );
  assert.equal(stateMapFor(undefined), undefined);
});
