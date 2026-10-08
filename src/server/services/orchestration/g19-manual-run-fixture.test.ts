import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { buildAttentionQueue } from "../../../shared/attention-queue.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { loopView } from "../../../shared/loop-view.js";
import type { Card, LoopGate } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { materializeLoopFixture } from "../../test-support/loop-fixtures.js";

isolateEnv();
const { readLoopProgress } = await import("./loop-progress-reader.js");

const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

interface Expected {
  group: string;
  slug: string;
  completion: "complete" | "running";
  unitsDone: number;
  unitsTotal: number;
  currentUnit: number | null;
  currentPhase: number | null;
  lastGate: LoopGate;
  gateUnitPhases: number;
  engineClosed: boolean;
}

const CASES: Expected[] = [
  {
    group: "group-14",
    slug: "g13-modules-b",
    completion: "complete",
    unitsDone: 4,
    unitsTotal: 4,
    currentUnit: null,
    currentPhase: null,
    lastGate: {
      unit: 4,
      phase: 1,
      result: "pass",
      at: "2026-10-07T10:20:14Z",
    },
    gateUnitPhases: 9,
    engineClosed: true,
  },
  {
    group: "group-15",
    slug: "g15-accounts-connections",
    completion: "running",
    unitsDone: 3,
    unitsTotal: 5,
    currentUnit: 3,
    currentPhase: 6,
    lastGate: {
      unit: 3,
      phase: 8,
      result: "pass",
      at: "2026-10-06T19:36:47Z",
    },
    gateUnitPhases: 9,
    engineClosed: false,
  },
  {
    group: "group-17",
    slug: "g17-boards",
    completion: "complete",
    unitsDone: 3,
    unitsTotal: 3,
    currentUnit: null,
    currentPhase: null,
    lastGate: {
      unit: 3,
      phase: 6,
      result: "pass",
      at: "2026-10-07T17:01:45Z",
    },
    gateUnitPhases: 6,
    engineClosed: true,
  },
  {
    group: "group-18",
    slug: "g18-orch-runtime",
    completion: "running",
    unitsDone: 3,
    unitsTotal: 4,
    currentUnit: null,
    currentPhase: null,
    lastGate: {
      unit: 3,
      phase: 11,
      result: "pass",
      at: "2026-10-07T11:22:44Z",
    },
    gateUnitPhases: 11,
    engineClosed: false,
  },
];

for (const expected of CASES) {
  test(`g19 manual run ${expected.group} reads to the recorded model`, async () => {
    const root = materializeLoopFixture(`g19-manual-run/${expected.group}`);
    temps.push(root);
    const model = await readLoopProgress(root);
    assert.notEqual(model, null);
    if (model === null) return;

    assert.equal(model.slug, expected.slug);
    assert.equal(model.completion, expected.completion);
    assert.equal(model.summary.unitsDone, expected.unitsDone);
    assert.equal(model.summary.unitsTotal, expected.unitsTotal);
    assert.equal(model.units.length, expected.unitsTotal);
    assert.equal(model.summary.currentUnit, expected.currentUnit);
    assert.equal(
      model.summary.currentPhase?.number ?? null,
      expected.currentPhase,
    );
    assert.deepEqual(model.summary.lastGate, expected.lastGate);
    assert.equal(
      model.units.find((unit) => unit.number === expected.lastGate.unit)?.phases
        .length,
      expected.gateUnitPhases,
    );
    assert.equal(model.engine?.closed, expected.engineClosed);
    assert.deepEqual(model.warnings, []);
    const budgets = model.units.flatMap((unit) =>
      unit.phases.map((phase) => phase.retryBudget),
    );
    assert.ok(budgets.length > 0);
    assert.ok(
      budgets.every(
        (budget) => typeof budget === "number" && budget >= 1 && budget <= 5,
      ),
    );
  });
}

test("g19 manual run group-18 holds the parked unit at its gate with every phase pending", async () => {
  const root = materializeLoopFixture("g19-manual-run/group-18");
  temps.push(root);
  const model = await readLoopProgress(root);
  const parked = model?.units.find((unit) => unit.number === 4);
  assert.equal(parked?.status, "not started");
  assert.equal(parked?.phases.length, 10);
  assert.ok(parked?.phases.every((phase) => phase.gate === "pending"));
});

type SegmentState = "done" | "current" | "pending" | "failed gate";

const VIEWS: {
  group: string;
  identifier: string;
  percent: number;
  label: string;
  segments: SegmentState[];
  lastGateText: string;
}[] = [
  {
    group: "group-14",
    identifier: "GROUP-14",
    percent: 100,
    label: "4 of 4 units built, awaiting ship",
    segments: ["done", "done", "done", "done"],
    lastGateText: "Phase 1 gate passed 10:20",
  },
  {
    group: "group-15",
    identifier: "GROUP-15",
    percent: 75,
    label: "Unit 3 of 5, phase 6 of 9",
    segments: ["done", "done", "current", "pending", "done"],
    lastGateText: "Phase 8 gate passed 19:36",
  },
  {
    group: "group-17",
    identifier: "GROUP-17",
    percent: 100,
    label: "3 of 3 units built, awaiting ship",
    segments: ["done", "done", "done"],
    lastGateText: "Phase 6 gate passed 17:01",
  },
  {
    group: "group-18",
    identifier: "GROUP-18",
    percent: 75,
    label: "3 of 4 units built, unit 4 not started",
    segments: ["done", "done", "done", "pending"],
    lastGateText: "Phase 11 gate passed 11:22",
  },
];

for (const expected of VIEWS) {
  test(`g19 manual run ${expected.group} renders the recorded dashboard row`, async () => {
    const root = materializeLoopFixture(`g19-manual-run/${expected.group}`);
    temps.push(root);
    const loopProgress = (await readLoopProgress(root)) ?? undefined;
    assert.ok(loopProgress);
    const card = {
      id: expected.group,
      identifier: expected.identifier,
      source: "group",
      boardKey: DEFAULT_BOARD_KEY,
      loopProgress,
    } as Card;

    const view = loopView(loopProgress, { timeZone: "UTC" });
    assert.equal(view.percent, expected.percent);
    assert.equal(view.label, expected.label);
    assert.deepEqual(
      view.segments.map((segment) => segment.state),
      expected.segments,
    );
    assert.equal(view.lastGateText, expected.lastGateText);

    const queue = buildAttentionQueue({
      boardKey: DEFAULT_BOARD_KEY,
      cards: [card],
      decisions: [],
      now: new Date("2026-10-08T00:00:00Z"),
    });
    assert.deepEqual(
      queue.filter((item) => item.kind === "failed_gate"),
      [],
    );
  });
}
