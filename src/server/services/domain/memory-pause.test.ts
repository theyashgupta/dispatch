import test from "node:test";
import assert from "node:assert/strict";
import type { BoardKey, SystemMemory } from "../../../shared/types.js";
import {
  IDLE_RUN,
  decideAfterRestart,
  decideMemoryPause,
  type PauseCandidate,
  type PauseRun,
} from "./memory-pause.js";

const LOCAL = "LOCAL" as BoardKey;
const OTHER = "OTHER" as BoardKey;
const AT = "2026-10-13T10:00:00.000Z";

function reading(swapUsedMb: number, stale = false): SystemMemory {
  return {
    supported: true,
    stale,
    sample: {
      at: AT,
      freeMb: 4000,
      compressorMb: 1000,
      swapUsedMb,
      swapTotalMb: 16384,
      load1: 1,
    },
  };
}

function candidate(
  cardId: string,
  startedAt: string,
  over: Partial<PauseCandidate> = {},
): PauseCandidate {
  return {
    cardId,
    boardKey: LOCAL,
    startedAt,
    pausedBy: null,
    coolingDown: false,
    ...over,
  };
}

const OLD = candidate("old", "2026-10-13T08:00:00.000Z");
const NEW = candidate("new", "2026-10-13T09:00:00.000Z");
const CEILINGS = { [LOCAL]: 8192 };

function decide(
  swap: number,
  candidates: PauseCandidate[],
  run: PauseRun = IDLE_RUN,
  ceilings: Partial<Record<BoardKey, number>> = CEILINGS,
) {
  return decideMemoryPause({
    memory: reading(swap),
    candidates,
    ceilings,
    run,
  });
}

test("no candidates gives none and an idle run", () => {
  assert.deepEqual(decide(9000, []), {
    action: { kind: "none" },
    next: IDLE_RUN,
  });
});

test("swap equal to the ceiling does nothing", () => {
  assert.deepEqual(decide(8192, [OLD, NEW]), {
    action: { kind: "none" },
    next: IDLE_RUN,
  });
});

test("swap above the ceiling pauses the newest unpaused candidate with the exact reason", () => {
  assert.deepEqual(decide(9000, [OLD, NEW]), {
    action: {
      kind: "pause",
      cardId: "new",
      reason: "swap used 9000 MB is above the 8192 MB ceiling",
      swapMb: 9000,
    },
    next: { lastPauseSwapMb: 9000, lowReadings: 0 },
  });
});

test("a candidate already paused is skipped when picking the newest", () => {
  const paused = { ...NEW, pausedBy: "memory" as const };
  const { action } = decide(9000, [OLD, paused]);
  assert.equal(action.kind === "pause" && action.cardId, "old");
});

test("cascade guard: growth of 255 MB pauses nothing and 256 MB pauses the next newest", () => {
  const first = decide(9000, [OLD, NEW]);
  const held = { ...NEW, pausedBy: "memory" as const };
  const small = decide(9255, [OLD, held], first.next);
  assert.deepEqual(small, {
    action: { kind: "none" },
    next: { lastPauseSwapMb: 9000, lowReadings: 0 },
  });
  const grown = decide(9256, [OLD, held], first.next);
  assert.deepEqual(grown, {
    action: {
      kind: "pause",
      cardId: "old",
      reason: "swap used 9256 MB is above the 8192 MB ceiling",
      swapMb: 9256,
    },
    next: { lastPauseSwapMb: 9256, lowReadings: 0 },
  });
});

test("above the ceiling with nobody left to pause keeps the last pause swap", () => {
  const both = [
    { ...OLD, pausedBy: "memory" as const },
    { ...NEW, pausedBy: "memory" as const },
  ];
  assert.deepEqual(
    decide(9500, both, { lastPauseSwapMb: 9000, lowReadings: 1 }),
    {
      action: { kind: "none" },
      next: { lastPauseSwapMb: 9000, lowReadings: 0 },
    },
  );
});

test("the run ends only below the floor, so a rise from inside the band is still guarded", () => {
  const first = decide(9000, [OLD, NEW]);
  const held = { ...NEW, pausedBy: "memory" as const };
  const band = decide(8100, [OLD, held], first.next);
  assert.deepEqual(band.next, { lastPauseSwapMb: 9000, lowReadings: 0 });
  assert.deepEqual(decide(8300, [OLD, held], band.next).action, {
    kind: "none",
  });
  const below = decide(7000, [OLD, held], band.next);
  assert.deepEqual(below.next, { lastPauseSwapMb: null, lowReadings: 1 });
  assert.equal(decide(8300, [OLD, held], below.next).action.kind, "pause");
});

test("the resume floor is never below half the ceiling", () => {
  const held = candidate("held", "2026-10-13T08:00:00.000Z", {
    pausedBy: "memory",
  });
  const ceilings = { [LOCAL]: 512 };
  const first = decide(200, [held], IDLE_RUN, ceilings);
  assert.deepEqual(first.action, { kind: "none" });
  assert.deepEqual(decide(200, [held], first.next, ceilings).action, {
    kind: "resume",
    cardId: "held",
    reason: "swap used 200 MB is below 256 MB",
  });
});

test("a cooling-down newest candidate is skipped for the pause target but still sets the ceiling", () => {
  const cooling = { ...NEW, coolingDown: true };
  const { action } = decide(9000, [OLD, cooling]);
  assert.equal(action.kind === "pause" && action.cardId, "old");
  const alone = candidate("alone", "2026-10-13T09:00:00.000Z", {
    boardKey: OTHER,
    coolingDown: true,
  });
  const lone = decide(5000, [alone, OLD], IDLE_RUN, {
    [LOCAL]: 8192,
    [OTHER]: 4096,
  });
  assert.deepEqual(lone.action, {
    kind: "pause",
    cardId: "old",
    reason: "swap used 5000 MB is above the 4096 MB ceiling",
    swapMb: 5000,
  });
  const held = candidate("held", "2026-10-13T07:00:00.000Z", {
    pausedBy: "memory",
    coolingDown: true,
  });
  const second = decide(7000, [held, OLD]);
  assert.deepEqual(decide(7000, [held, OLD], second.next).action, {
    kind: "none",
  });
});

test("the lowest ceiling across two boards wins", () => {
  const other = candidate("other", "2026-10-13T07:00:00.000Z", {
    boardKey: OTHER,
  });
  const { action } = decide(5000, [OLD, other], IDLE_RUN, {
    [LOCAL]: 8192,
    [OTHER]: 4096,
  });
  assert.deepEqual(action, {
    kind: "pause",
    cardId: "old",
    reason: "swap used 5000 MB is above the 4096 MB ceiling",
    swapMb: 5000,
  });
});

test("a user-paused card's board does not set the ceiling", () => {
  const userPaused = candidate("user", "2026-10-13T07:00:00.000Z", {
    boardKey: OTHER,
    pausedBy: "user",
  });
  const { action } = decide(5000, [OLD, userPaused], IDLE_RUN, {
    [LOCAL]: 8192,
    [OTHER]: 4096,
  });
  assert.deepEqual(action, { kind: "none" });
});

test("one reading below ceiling minus 1024 resumes nothing and the second resumes the oldest memory-paused candidate", () => {
  const cards = [
    { ...NEW, pausedBy: "memory" as const },
    { ...OLD, pausedBy: "memory" as const },
  ];
  const first = decide(7000, cards);
  assert.deepEqual(first, {
    action: { kind: "none" },
    next: { lastPauseSwapMb: null, lowReadings: 1 },
  });
  assert.deepEqual(decide(7000, cards, first.next), {
    action: {
      kind: "resume",
      cardId: "old",
      reason: "swap used 7000 MB is below 7168 MB",
    },
    next: IDLE_RUN,
  });
});

test("a reading between ceiling minus 1024 and the ceiling resets the low count", () => {
  const cards = [{ ...OLD, pausedBy: "memory" as const }];
  const low = decide(7000, cards);
  const mid = decide(7500, cards, low.next);
  assert.deepEqual(mid, {
    action: { kind: "none" },
    next: { lastPauseSwapMb: null, lowReadings: 0 },
  });
  assert.equal(decide(7000, cards, mid.next).action.kind, "none");
});

test("a user-paused candidate is never resumed", () => {
  const cards = [
    { ...OLD, pausedBy: "user" as const },
    { ...NEW, pausedBy: "memory" as const },
  ];
  const first = decide(1000, cards);
  const action = decide(1000, cards, first.next).action;
  assert.equal(action.kind === "resume" && action.cardId, "new");
});

test("a stale reading and an unsupported reading give none and an idle run", () => {
  const busy = { lastPauseSwapMb: 9000, lowReadings: 1 };
  for (const memory of [reading(9000, true), { supported: false } as const]) {
    assert.deepEqual(
      decideMemoryPause({
        memory,
        candidates: [OLD, NEW],
        ceilings: CEILINGS,
        run: busy,
      }),
      { action: { kind: "none" }, next: IDLE_RUN },
    );
  }
});

test("one MB above the ceiling pauses, and a reading at the floor is not a low reading", () => {
  assert.equal(decide(8193, [OLD, NEW]).action.kind, "pause");
  const held = candidate("held", "2026-10-13T07:00:00.000Z", {
    pausedBy: "memory",
  });
  assert.equal(decide(7168, [held, OLD]).next.lowReadings, 0);
  assert.equal(decide(7167, [held, OLD]).next.lowReadings, 1);
});

test("the floor is half the ceiling up to a 2048 MB ceiling and the ceiling minus 1024 above it", () => {
  const held = candidate("held", "2026-10-13T07:00:00.000Z", {
    pausedBy: "memory",
  });
  const floorOf = (ceiling: number, swap: number) =>
    decide(
      swap,
      [held],
      { lastPauseSwapMb: null, lowReadings: 1 },
      {
        [LOCAL]: ceiling,
      },
    ).action;
  assert.deepEqual(floorOf(2048, 1023), {
    kind: "resume",
    cardId: "held",
    reason: "swap used 1023 MB is below 1024 MB",
  });
  assert.equal(floorOf(2048, 1024).kind, "none");
  assert.deepEqual(floorOf(3000, 1975), {
    kind: "resume",
    cardId: "held",
    reason: "swap used 1975 MB is below 1976 MB",
  });
  assert.equal(floorOf(1025, 512).kind, "none");
  assert.equal(floorOf(1025, 511).kind, "resume");
});

function restart(swap: number, candidates: PauseCandidate[], stale = false) {
  return decideAfterRestart({
    memory: reading(swap, stale),
    candidates,
    ceilings: CEILINGS,
  });
}

const HELD_OLD = { ...OLD, pausedBy: "memory" as const, pausedSwapMb: 9000 };
const USER_NEW = { ...NEW, pausedBy: "user" as const };

test("after a restart, swap at the ceiling resumes the oldest governor-paused loop at once", () => {
  const held = candidate("held", "2026-10-13T10:00:00.000Z", {
    pausedBy: "memory",
    pausedSwapMb: 9500,
  });
  assert.deepEqual(restart(8192, [held, USER_NEW, HELD_OLD]), {
    action: {
      kind: "resume",
      cardId: "old",
      reason:
        "swap used 8192 MB is not above the 8192 MB ceiling after a restart",
    },
    next: IDLE_RUN,
  });
});

test("after a restart, swap over the ceiling continues the run from the highest persisted reading", () => {
  const held = candidate("held", "2026-10-13T07:00:00.000Z", {
    pausedBy: "memory",
    pausedSwapMb: 9200,
  });
  const fresh = candidate("fresh", "2026-10-13T11:00:00.000Z");
  assert.deepEqual(restart(9455, [held, HELD_OLD, fresh]), {
    action: { kind: "none" },
    next: { lastPauseSwapMb: 9200, lowReadings: 0 },
  });
  assert.deepEqual(restart(9456, [held, HELD_OLD, fresh])?.action, {
    kind: "pause",
    cardId: "fresh",
    reason: "swap used 9456 MB is above the 8192 MB ceiling",
    swapMb: 9456,
  });
});

test("after a restart, a mark with no persisted reading anchors the run at the current reading", () => {
  const legacy = { ...OLD, pausedBy: "memory" as const };
  assert.deepEqual(restart(12000, [legacy, NEW]), {
    action: { kind: "none" },
    next: { lastPauseSwapMb: 12000, lowReadings: 0 },
  });
});

test("the restart rebuild is skipped with no governor mark or a stale reading", () => {
  assert.equal(restart(1000, [OLD, USER_NEW]), null);
  assert.equal(restart(1000, [HELD_OLD], true), null);
});
