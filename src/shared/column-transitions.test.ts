import test from "node:test";
import assert from "node:assert/strict";
import { COLUMNS } from "./types.js";
import type { Column } from "./types.js";
import {
  APPLY_MARKER_EXCLUDED_SOURCES,
  FLIP_BACK_CLEARS_LAST_MARKER,
  FLIP_BACK_SOURCES,
  MARKER_CONSUMED_SOURCES,
  isManualMoveAllowed,
} from "./column-transitions.js";

void test("parked sits between in_review and done in the render list", () => {
  const i = COLUMNS.indexOf("parked");
  assert.equal(COLUMNS[i - 1], "in_review");
  assert.equal(COLUMNS[i + 1], "done");
  assert.equal(COLUMNS.length, 7);
});

void test("parked flips back on a prompt without clearing the last marker", () => {
  assert.ok(FLIP_BACK_SOURCES.includes("parked"));
  assert.ok(!FLIP_BACK_CLEARS_LAST_MARKER.includes("parked"));
});

void test("parked consumes markers and is not an excluded source", () => {
  assert.deepEqual([...MARKER_CONSUMED_SOURCES], ["parked"]);
  assert.ok(!APPLY_MARKER_EXCLUDED_SOURCES.includes("parked"));
  for (const c of MARKER_CONSUMED_SOURCES) {
    assert.ok(
      !APPLY_MARKER_EXCLUDED_SOURCES.includes(c),
      `${c} cannot be both consumed and excluded`,
    );
  }
});

void test("every manual pair into and out of parked is allowed except the two BOARD-07 blocks", () => {
  const all: Column[] = [...COLUMNS, "inbox"];
  for (const from of all) {
    assert.equal(
      isManualMoveAllowed(from, "parked"),
      true,
      `${from} -> parked`,
    );
  }
  for (const to of all) {
    assert.equal(
      isManualMoveAllowed("parked", to),
      to !== "agent_done",
      `parked -> ${to}`,
    );
  }
  assert.equal(isManualMoveAllowed("todo", "in_progress"), false);
});
