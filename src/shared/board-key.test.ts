import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BOARD_KEY,
  defaultBoardPolicy,
  identifierPrefix,
  isReservedBoardKey,
  parseBoardKey,
} from "./board-key.js";

void test("parseBoardKey accepts 2 to 6 capitals or digits that start with a letter", () => {
  for (const key of ["AB", "ACME", "A12345", "LOCAL", "GROUP"]) {
    assert.equal(parseBoardKey(key), key);
  }
  for (const key of ["A", "ab", "1AB", "ABCDEFG", "A-B", "", "Acme", " AB"]) {
    assert.equal(parseBoardKey(key), null, key);
  }
});

void test("LOCAL and GROUP are reserved, other keys are not", () => {
  assert.equal(isReservedBoardKey("LOCAL"), true);
  assert.equal(isReservedBoardKey("GROUP"), true);
  assert.equal(isReservedBoardKey("ACME"), false);
});

void test("identifierPrefix drops one numeric suffix and returns any other id whole", () => {
  const cases: [string, string][] = [
    ["ENG-12", "ENG"],
    ["A-B-12", "A-B"],
    ["NODASH", "NODASH"],
    ["ENG-", "ENG-"],
    ["ENG-12a", "ENG-12a"],
    ["ENG-1-2", "ENG-1"],
    ["", ""],
  ];
  for (const [id, prefix] of cases) {
    assert.equal(identifierPrefix(id), prefix, id);
  }
});

void test("the default policy has the D-6 values and the supervisor off only on LOCAL", () => {
  assert.deepEqual(defaultBoardPolicy(DEFAULT_BOARD_KEY), {
    roadmapApproval: "ask",
    concurrencyCap: 3,
    loopModel: null,
    orchestratorModel: "opus",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "wait",
    shipRights: "none",
    budgetPerGroup: null,
    supervisor: "off",
    groupPlaybook: null,
    wakeMinutes: 15,
  });
  const acme = parseBoardKey("ACME");
  assert.ok(acme);
  assert.equal(defaultBoardPolicy(acme).supervisor, "on");
});
