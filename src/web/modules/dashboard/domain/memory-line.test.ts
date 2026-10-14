import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Card, SystemMemory } from "../../../../shared/types.js";
import { memoryLine, pausedLoopCount, STALE_SUFFIX } from "./memory-line.js";

function reading(
  stale: boolean,
  freeMb = 2048,
  swapUsedMb = 512,
): SystemMemory {
  return {
    supported: true,
    sample: {
      at: "2026-10-14T00:00:00.000Z",
      freeMb,
      compressorMb: 0,
      swapUsedMb,
      swapTotalMb: 4096,
      load1: 1,
    },
    stale,
  };
}

function card(extra: Partial<Card>): Card {
  return {
    id: "c1",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "c1",
    identifier: "LOCAL-1",
    title: "A card",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...extra,
  };
}

const mark = {
  at: "2026-10-14T00:00:00.000Z",
  by: "memory" as const,
  sessionId: "s1",
  pids: [1],
};

test("a fresh supported reading reads as the memory line", () => {
  assert.deepEqual(memoryLine(reading(false), 0), {
    text: "Memory: 2048 MB free, swap 512 of 4096 MB",
    stale: false,
  });
});

test("a stale reading keeps its text and sets the flag", () => {
  assert.equal(memoryLine(reading(true), 0)?.stale, true);
  assert.equal(STALE_SUFFIX, " (stale)");
});

test("the paused count shows from 1 and not at 0", () => {
  assert.equal(
    memoryLine(reading(false), 2)?.text,
    "Memory: 2048 MB free, swap 512 of 4096 MB, 2 paused",
  );
  assert.equal(
    memoryLine(reading(false), 1)?.text,
    "Memory: 2048 MB free, swap 512 of 4096 MB, 1 paused",
  );
});

test("numbers round to whole megabytes", () => {
  assert.equal(
    memoryLine(reading(false, 811.6, 99.4), 0)?.text,
    "Memory: 812 MB free, swap 99 of 4096 MB",
  );
});

test("an unsupported or missing reading hides the line", () => {
  assert.equal(memoryLine({ supported: false }, 3), null);
  assert.equal(memoryLine(undefined, 3), null);
});

test("only paused loop cards count", () => {
  assert.equal(
    pausedLoopCount([
      card({ id: "a", source: "group", paused: mark }),
      card({ id: "b", launch: { direction: "go" }, paused: mark }),
      card({ id: "c", paused: mark }),
      card({ id: "d", source: "group" }),
      card({ id: "e", source: "group", paused: null }),
    ]),
    2,
  );
  assert.equal(pausedLoopCount([]), 0);
});
