import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTurnState } from "../../../../shared/types.js";
import {
  DEFAULT_APPLY_CHOICE,
  resultNotice,
  switchCounts,
} from "./switch-counts.js";

test("the switch dialog starts on all running sessions", () => {
  assert.equal(DEFAULT_APPLY_CHOICE, "all");
});

const TURNS: SessionTurnState[] = ["idle", "limit", "busy", "unknown"];

test("an empty session list counts zero for every choice", () => {
  assert.deepEqual(switchCounts([], "b"), { none: 0, idle: 0, all: 0 });
});

test("each turn state counts under the choices that change it", () => {
  const expected: Record<SessionTurnState, [number, number]> = {
    idle: [1, 1],
    limit: [1, 1],
    busy: [0, 1],
    unknown: [0, 1],
  };
  for (const turn of TURNS) {
    const counts = switchCounts([{ accountId: "a", turn }], "b");
    assert.deepEqual(
      [counts.idle, counts.all],
      expected[turn],
      `turn ${turn} on another account`,
    );
    assert.equal(counts.none, 0);
  }
});

test("a session already on the target never counts", () => {
  for (const turn of TURNS) {
    assert.deepEqual(switchCounts([{ accountId: "b", turn }], "b"), {
      none: 0,
      idle: 0,
      all: 0,
    });
  }
});

test("a mixed list counts each session once", () => {
  const sessions = [
    { accountId: "default", turn: "idle" },
    { accountId: "default", turn: "limit" },
    { accountId: "default", turn: "busy" },
    { accountId: "b", turn: "idle" },
    { accountId: "c", turn: "unknown" },
  ] as const;
  assert.deepEqual(switchCounts(sessions, "b"), { none: 0, idle: 2, all: 4 });
  assert.deepEqual(switchCounts(sessions, "default"), {
    none: 0,
    idle: 1,
    all: 2,
  });
});

test("resultNotice lists moved and queued, and skipped only when it is above zero", () => {
  assert.equal(resultNotice(2, 0, 0), "Moved 2, queued 0.");
  assert.equal(resultNotice(0, 3, 0), "Moved 0, queued 3.");
  assert.equal(resultNotice(0, 0, 4), "Moved 0, queued 0, skipped 4.");
  assert.equal(resultNotice(1, 2, 3), "Moved 1, queued 2, skipped 3.");
  assert.equal(resultNotice(0, 0, 0), "Moved 0, queued 0.");
});
