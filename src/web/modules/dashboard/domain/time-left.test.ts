import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LoopProgress,
  LoopUnit,
  LoopUnitStatus,
} from "../../../../shared/types.js";
import { timeLeft } from "./time-left.js";

const NOW = new Date("2026-10-07T18:00:00Z");

function unit(
  number: number,
  status: LoopUnitStatus,
  phaseTotal: number | null,
  passedAt: (string | null)[] = [],
): LoopUnit {
  return {
    number,
    ticket: null,
    title: `U${number}`,
    status,
    statusText: status,
    branch: null,
    commit: null,
    prdPath: null,
    phaseTotal,
    phases: passedAt.map((at, i) => ({
      number: i + 1,
      name: `P${i + 1}`,
      gate: at === null ? ("pending" as const) : ("pass" as const),
      attempts: at === null ? 0 : 1,
      passedAt: at,
    })),
  };
}

function progress(
  units: LoopUnit[],
  currentUnit: number | null,
  completion: LoopProgress["completion"] = "running",
): LoopProgress {
  return {
    slug: "demo",
    roadmapFile: "ROADMAP.md",
    units,
    engine: null,
    completion,
    summary: {
      unitsDone: 0,
      unitsTotal: units.length,
      currentUnit,
      currentPhase: null,
      lastGate: null,
    },
    warnings: [],
    readAt: NOW.toISOString(),
  };
}

const day = (time: string) => `2026-10-07T${time}:00Z`;

test("uses the median gap and not the mean", () => {
  const passed = ["10:00", "10:40", "11:30", "12:00", "17:30"].map(day);
  const result = timeLeft(
    progress([unit(1, "in progress", 9, passed)], 1),
    NOW,
  );
  assert.deepEqual(result, { text: "About 3 h left" });
  const meanEstimate = Math.round((112.5 * 4) / 10) * 10;
  assert.equal(meanEstimate, 450);
  assert.notEqual(result?.text, "About 7 h 30 min left");
});

test("a complete loop has no estimate", () => {
  assert.equal(
    timeLeft(progress([unit(1, "shipped", 2)], null, "complete"), NOW),
    null,
  );
});

test("fewer than two passed gates waits for an estimate", () => {
  const result = timeLeft(
    progress([unit(1, "in progress", 4, [day("10:00"), null])], 1),
    NOW,
  );
  assert.deepEqual(result, { text: "Estimate after 2 gates" });
});

test("later not-done units add their phases and an unknown count gives a lower bound", () => {
  const passed = [day("10:00"), day("10:30")];
  const known = timeLeft(
    progress([unit(1, "in progress", 4, passed), unit(2, "not started", 6)], 1),
    NOW,
  );
  assert.deepEqual(known, { text: "About 4 h left" });
  const unknown = timeLeft(
    progress(
      [unit(1, "in progress", 4, passed), unit(2, "not started", null)],
      1,
    ),
    NOW,
  );
  assert.deepEqual(unknown, { text: "At least 1 h left" });
});

test("gaps across units count and the estimate has a 10 minute floor", () => {
  const result = timeLeft(
    progress(
      [
        unit(1, "shipped", 1, [day("10:00")]),
        unit(2, "in progress", 2, [day("10:03"), day("10:06")]),
      ],
      2,
    ),
    NOW,
  );
  assert.deepEqual(result, { text: "About 10 min left" });
});
