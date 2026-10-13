import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LoopPhase,
  LoopProgress,
  LoopSummary,
  LoopUnit,
} from "../../../../shared/types.js";
import { trackNodes } from "./track-nodes.js";

const UTC = { timeZone: "UTC" };

function phase(
  number: number,
  gate: LoopPhase["gate"],
  passedAt: string | null = null,
): LoopPhase {
  return { number, name: `p${number}`, gate, attempts: 1, passedAt };
}

function unit(
  number: number,
  status: LoopUnit["status"],
  extra: Partial<LoopUnit> = {},
): LoopUnit {
  return {
    number,
    ticket: null,
    title: `Unit title ${number}`,
    status,
    statusText: "",
    branch: null,
    commit: null,
    prdPath: null,
    phaseTotal: null,
    phases: [],
    ...extra,
  };
}

function progress(
  units: LoopUnit[],
  summary: Partial<LoopSummary> = {},
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
      currentUnit: null,
      currentPhase: null,
      lastGate: null,
      ...summary,
    },
    warnings: [],
    readAt: "2026-10-07T12:00:00Z",
  };
}

test("a done unit reads Done with the time of its latest passed phase", () => {
  const track = trackNodes(
    progress([
      unit(1, "shipped"),
      unit(2, "shipped", {
        phases: [
          phase(1, "pass", "2026-10-07T09:05:00Z"),
          phase(2, "pass", "2026-10-07T11:40:00Z"),
          phase(3, "pass", "2026-10-07T10:00:00Z"),
        ],
      }),
    ]),
    UTC,
  );
  assert.deepEqual(
    track.map((n) => [n.state, n.stateLine, n.phase]),
    [
      ["done", "Done", null],
      ["done", "Done 11:40", null],
    ],
  );
});

test("a built unit awaiting ship is done", () => {
  const track = trackNodes(progress([unit(1, "built, awaiting /ship")]), UTC);
  assert.equal(track[0]?.state, "done");
});

test("the current unit reads Phase n of total and counts passed gates", () => {
  const track = trackNodes(
    progress(
      [
        unit(1, "in progress", {
          phaseTotal: 5,
          phases: [phase(1, "pass"), phase(2, "pass"), phase(3, "pending")],
        }),
      ],
      { currentUnit: 1, currentPhase: { number: 3, name: "p3" } },
    ),
    UTC,
  );
  assert.deepEqual(track[0], {
    unit: 1,
    name: "Unit title 1",
    state: "current",
    stateLine: "Phase 3 of 5",
    accessibleName: "Unit 1: Unit title 1, current",
    phase: { passed: 2, total: 5 },
  });
});

test("a null phaseTotal falls back to the phase count", () => {
  const track = trackNodes(
    progress(
      [
        unit(1, "in progress", {
          phases: [phase(1, "pass"), phase(2, "pending"), phase(3, "pending")],
        }),
      ],
      { currentUnit: 1, currentPhase: { number: 2, name: "p2" } },
    ),
    UTC,
  );
  assert.equal(track[0]?.stateLine, "Phase 2 of 3");
  assert.deepEqual(track[0]?.phase, { passed: 1, total: 3 });
});

test("the passed count caps at the total", () => {
  const track = trackNodes(
    progress(
      [
        unit(1, "in progress", {
          phaseTotal: 1,
          phases: [phase(1, "pass"), phase(2, "pass")],
        }),
      ],
      { currentUnit: 1, currentPhase: { number: 2, name: "p2" } },
    ),
    UTC,
  );
  assert.deepEqual(track[0]?.phase, { passed: 1, total: 1 });
});

test("the current unit with no phases reads Phase n and has a null phase", () => {
  const track = trackNodes(
    progress([unit(1, "in progress")], {
      currentUnit: 1,
      currentPhase: { number: 2, name: "p2" },
    }),
    UTC,
  );
  assert.equal(track[0]?.stateLine, "Phase 2");
  assert.equal(track[0]?.phase, null);
});

test("the current unit with no current phase reads In progress", () => {
  const track = trackNodes(
    progress([unit(1, "in progress", { phaseTotal: 4 })], { currentUnit: 1 }),
    UTC,
  );
  assert.equal(track[0]?.stateLine, "In progress");
  assert.deepEqual(track[0]?.phase, { passed: 0, total: 4 });
});

test("a blocked unit that is not the current unit is a blocked node with no phase bar", () => {
  const track = trackNodes(
    progress([unit(1, "blocked"), unit(2, "in progress")], {
      currentUnit: 2,
      currentPhase: { number: 1, name: "p1" },
    }),
    UTC,
  );
  assert.deepEqual(
    track.map((n) => [n.state, n.stateLine]),
    [
      ["blocked", "Blocked"],
      ["current", "Phase 1"],
    ],
  );
  assert.equal(track[0]?.phase, null);
});

test("a failed gate on the current unit reads Gate failed", () => {
  const track = trackNodes(
    progress([unit(1, "in progress", { phaseTotal: 3 })], {
      currentUnit: 1,
      currentPhase: { number: 1, name: "p1" },
      lastGate: {
        unit: 1,
        phase: 1,
        result: "fail",
        at: "2026-10-07T10:00:00Z",
      },
    }),
    UTC,
  );
  assert.deepEqual(
    [track[0]?.state, track[0]?.stateLine, track[0]?.phase],
    ["failed", "Gate failed", null],
  );
  assert.equal(track[0]?.accessibleName, "Unit 1: Unit title 1, failed gate");
});

test("the first pending unit is Next and the rest are Later", () => {
  const track = trackNodes(
    progress(
      [
        unit(1, "shipped"),
        unit(2, "not started"),
        unit(3, "not started"),
        unit(4, "unknown"),
      ],
      { unitsDone: 1 },
    ),
    UTC,
  );
  assert.deepEqual(
    track.map((n) => [n.state, n.stateLine]),
    [
      ["done", "Done"],
      ["next", "Next"],
      ["later", "Later"],
      ["later", "Later"],
    ],
  );
});

test("a loop with zero units has no nodes", () => {
  assert.deepEqual(trackNodes(progress([]), UTC), []);
});
