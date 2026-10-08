import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMinutes, loopView } from "./loop-view.js";
import type {
  LoopGate,
  LoopPhase,
  LoopProgress,
  LoopUnit,
  LoopUnitStatus,
} from "./types.js";

const UTC = { timeZone: "UTC" };

function phases(total: number, passed: number): LoopPhase[] {
  return Array.from({ length: total }, (_, index) => ({
    number: index + 1,
    name: `P${index + 1}`,
    gate: index < passed ? ("pass" as const) : ("pending" as const),
    attempts: index < passed ? 1 : 0,
    passedAt: null,
  }));
}

function unit(
  number: number,
  status: LoopUnitStatus,
  phaseTotal: number | null = null,
  passed = 0,
): LoopUnit {
  return {
    number,
    ticket: null,
    title: `Title ${number}`,
    status,
    statusText: status,
    branch: null,
    commit: null,
    prdPath: null,
    phaseTotal,
    phases: phaseTotal === null ? [] : phases(phaseTotal, passed),
  };
}

function progress(
  units: LoopUnit[],
  extra: {
    completion?: LoopProgress["completion"];
    currentUnit?: number | null;
    currentPhase?: number | null;
    lastGate?: LoopGate | null;
  } = {},
): LoopProgress {
  const done = units.filter(
    (u) => u.status === "shipped" || u.status === "built, awaiting /ship",
  ).length;
  return {
    slug: "demo",
    roadmapFile: "ROADMAP.md",
    units,
    engine: null,
    completion: extra.completion ?? "running",
    summary: {
      unitsDone: done,
      unitsTotal: units.length,
      currentUnit: extra.currentUnit ?? null,
      currentPhase:
        extra.currentPhase == null
          ? null
          : { number: extra.currentPhase, name: "P" },
      lastGate: extra.lastGate ?? null,
    },
    warnings: [],
    readAt: "2026-10-07T12:00:00Z",
  };
}

test("percent counts the passed gates of the current unit as a fraction", () => {
  const view = loopView(
    progress(
      [
        unit(1, "shipped", 4, 4),
        unit(2, "in progress", 9, 3),
        unit(3, "not started", 5),
      ],
      { currentUnit: 2, currentPhase: 4 },
    ),
    UTC,
  );
  assert.equal(view.percent, 44);
  assert.equal(view.label, "Unit 2 of 3, phase 4 of 9");
});

test("percent falls back to whole units without a current phase count", () => {
  const view = loopView(
    progress(
      [unit(1, "shipped"), unit(2, "in progress"), unit(3, "not started")],
      {
        currentUnit: 2,
        currentPhase: 1,
      },
    ),
    UTC,
  );
  assert.equal(view.percent, 33);
  assert.equal(view.label, "Unit 2 of 3, phase 1");
});

test("phase count falls back to the phases list when phaseTotal is null", () => {
  const current = unit(1, "in progress");
  current.phases = phases(4, 2);
  const view = loopView(
    progress([current, unit(2, "not started")], {
      currentUnit: 1,
      currentPhase: 3,
    }),
    UTC,
  );
  assert.equal(view.percent, 25);
  assert.equal(view.label, "Unit 1 of 2, phase 3 of 4");
});

test("complete reads 100 and a shipped loop says shipped", () => {
  const shipped = loopView(
    progress([unit(1, "shipped"), unit(2, "shipped")], {
      completion: "complete",
    }),
    UTC,
  );
  assert.equal(shipped.percent, 100);
  assert.equal(shipped.label, "2 of 2 units shipped");
  const built = loopView(
    progress([unit(1, "shipped"), unit(2, "built, awaiting /ship")], {
      completion: "complete",
    }),
    UTC,
  );
  assert.equal(built.label, "2 of 2 units built, awaiting ship");
});

test("between units the label names the next unit", () => {
  const view = loopView(
    progress([
      unit(1, "built, awaiting /ship"),
      unit(2, "built, awaiting /ship"),
      unit(3, "built, awaiting /ship"),
      unit(4, "not started"),
    ]),
    UTC,
  );
  assert.equal(view.percent, 75);
  assert.equal(view.label, "3 of 4 units built, unit 4 not started");
});

test("zero units reads No units and 0 percent", () => {
  const view = loopView(progress([]), UTC);
  assert.equal(view.percent, 0);
  assert.equal(view.label, "No units");
  assert.deepEqual(view.segments, []);
});

test("segments map statuses to states with accessible names", () => {
  const view = loopView(
    progress(
      [
        unit(1, "shipped"),
        unit(2, "built, awaiting /ship"),
        unit(3, "in progress", 3, 1),
        unit(4, "not started"),
        unit(5, "blocked"),
      ],
      { currentUnit: 3, currentPhase: 2 },
    ),
    UTC,
  );
  assert.deepEqual(
    view.segments.map((s) => s.state),
    ["done", "done", "current", "pending", "current"],
  );
  assert.equal(view.segments[2]?.accessibleName, "Unit 3: Title 3, current");
  assert.equal(view.segments[3]?.state, "pending");
});

test("a failing last gate on the current unit marks its segment failed gate", () => {
  const view = loopView(
    progress([unit(1, "shipped"), unit(2, "in progress", 4, 1)], {
      currentUnit: 2,
      currentPhase: 2,
      lastGate: {
        unit: 2,
        phase: 2,
        result: "fail",
        at: "2026-10-07T13:05:00Z",
      },
    }),
    UTC,
  );
  assert.equal(view.segments[1]?.state, "failed gate");
  assert.equal(
    view.segments[1]?.accessibleName,
    "Unit 2: Title 2, failed gate",
  );
  assert.equal(view.segments[0]?.state, "done");
});

test("last gate text covers pass, fail with a limit and fail without one", () => {
  const pass = loopView(
    progress([unit(1, "in progress", 4, 3)], {
      currentUnit: 1,
      currentPhase: 4,
      lastGate: {
        unit: 1,
        phase: 3,
        result: "pass",
        at: "2026-10-07T12:41:00Z",
      },
    }),
    UTC,
  );
  assert.equal(pass.lastGateText, "Phase 3 gate passed 12:41");

  const failing = unit(1, "in progress", 4, 3);
  const phase4 = failing.phases[3];
  assert.ok(phase4);
  phase4.gate = "fail";
  phase4.attempts = 1;
  const gate: LoopGate = {
    unit: 1,
    phase: 4,
    result: "fail",
    at: "2026-10-07T13:05:00Z",
  };
  const bare = loopView(
    progress([failing], { currentUnit: 1, currentPhase: 4, lastGate: gate }),
    UTC,
  );
  assert.equal(bare.lastGateText, "Phase 4 gate failed 13:05, attempt 1");
  phase4.retryBudget = 2;
  const limited = loopView(
    progress([failing], { currentUnit: 1, currentPhase: 4, lastGate: gate }),
    UTC,
  );
  assert.equal(
    limited.lastGateText,
    "Phase 4 gate failed 13:05, attempt 1 of 2",
  );
  assert.equal(loopView(progress([failing]), UTC).lastGateText, null);
});

test("formatMinutes writes minutes, whole hours and mixed", () => {
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(180), "3 h");
  assert.equal(formatMinutes(130), "2 h 10 min");
});

test("a garbage gate time never throws and the gate text drops the time", () => {
  const failing = unit(1, "in progress", 4, 3);
  const phase4 = failing.phases[3];
  assert.ok(phase4);
  phase4.attempts = 1;
  const gate = (result: LoopGate["result"]): LoopGate => ({
    unit: 1,
    phase: 4,
    result,
    at: "garbage",
  });
  const summary = (lastGate: LoopGate) => ({
    currentUnit: 1,
    currentPhase: 4,
    lastGate,
  });
  assert.equal(
    loopView(progress([failing], summary(gate("fail"))), UTC).lastGateText,
    "Phase 4 gate failed, attempt 1",
  );
  assert.equal(
    loopView(progress([failing], summary(gate("pass"))), UTC).lastGateText,
    "Phase 4 gate passed",
  );
});
