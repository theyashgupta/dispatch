import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { checkScope } from "./orchestrator-scope.js";

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
const sbxToken = { boardKey: SBX, orchestratorId: "orc-1" };

void test("a target on the token board is in scope", () => {
  assert.deepEqual(checkScope(sbxToken, { boardKey: SBX }), { ok: true });
});

void test("a target on another board is refused as other-board", () => {
  assert.deepEqual(checkScope(sbxToken, { boardKey: OTH }), {
    ok: false,
    reason: "other-board",
  });
});

void test("a target with no board is treated as the default board", () => {
  const local = { boardKey: DEFAULT_BOARD_KEY, orchestratorId: "orc-1" };
  assert.deepEqual(checkScope(local, {}), { ok: true });
  assert.deepEqual(checkScope(local, { boardKey: null }), { ok: true });
  assert.deepEqual(checkScope(sbxToken, {}), {
    ok: false,
    reason: "other-board",
  });
});
