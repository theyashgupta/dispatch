import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  LoopPhase,
  LoopProgress,
  LoopUnit,
} from "../../../shared/types.js";
import { buildLoopProgress, unitFilePaths } from "../domain/loop-progress.js";
import { materializeLoopFixture } from "../../test-support/loop-fixtures.js";

const READ_AT = "2026-10-06T12:00:00.000Z";
const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function readIfPresent(root: string, relative: string): string | null {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function loadFixture(folder: string, slug: string): LoopProgress {
  const root = materializeLoopFixture(folder);
  temps.push(root);
  const roadmapText = readFileSync(join(root, "ROADMAP.md"), "utf8");
  const { paths, warnings } = unitFilePaths(roadmapText, slug);
  const files = new Map<string, string | null>(
    paths.map((path) => [path, readIfPresent(root, path)]),
  );
  const live = readIfPresent(root, ".claude/ralph-loop.local.md");
  const done = readIfPresent(root, ".claude/ralph-loop.local.md.done");
  const engine =
    live !== null
      ? { text: live, closed: false }
      : done !== null
        ? { text: done, closed: true }
        : null;
  return buildLoopProgress({
    slug,
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText,
    progressText: readIfPresent(root, `.roadmap/${slug}/progress.md`),
    engine,
    files,
    refused: new Set(),
    warnings,
  });
}

function phase(
  number: number,
  name: string,
  gate: LoopPhase["gate"],
  attempts: number,
  passedAt: string | null,
): LoopPhase {
  return { number, name, gate, attempts, passedAt, retryBudget: null };
}

function pending(number: number, name: string): LoopPhase {
  return phase(number, name, "pending", 0, null);
}

const UNIT_1_PHASES: LoopPhase[] = [
  phase(
    1,
    "Branch, origin/main merge and re-verify",
    "pass",
    0,
    "2026-10-01T05:56:24Z",
  ),
  phase(
    2,
    "Parity build and legacy behaviour record",
    "pass",
    1,
    "2026-10-05T20:43:03Z",
  ),
  phase(
    3,
    "Shared pure helpers, NEW-24 path and shared card queries",
    "pass",
    0,
    "2026-10-01T15:19:42Z",
  ),
  phase(4, "Inbox module", "pass", 2, "2026-10-01T20:00:31Z"),
  phase(5, "Today module", "pass", 0, "2026-10-01T20:44:23Z"),
  phase(6, "Ask module", "pass", 0, "2026-10-01T21:41:21Z"),
  phase(7, "Activity module", "pass", 5, "2026-10-02T01:10:52Z"),
  phase(8, "Flow module", "pass", 1, "2026-10-02T02:13:41Z"),
  phase(
    9,
    "Card action dialogs except Start",
    "pass",
    5,
    "2026-10-02T12:11:39Z",
  ),
  phase(
    10,
    "G12 Unit 1 merge, Start dialog and legacy deletion",
    "pass",
    1,
    "2026-10-02T16:45:33Z",
  ),
  phase(11, "Gap Analysis", "pass", 0, "2026-10-03T05:46:48Z"),
  phase(
    12,
    "Test Suite + Real E2E Workflows",
    "pass",
    0,
    "2026-10-05T20:19:21Z",
  ),
];

const UNIT_3_PHASES: LoopPhase[] = [
  pending(1, "Branch, G12 merge, re-verify, parity build and legacy record"),
  pending(2, "Helper moves and detail queries"),
  pending(3, "Sessions module"),
  pending(4, "Workspace module"),
  pending(5, "Detail module, panel frame and terminal region (no-budget)"),
  pending(6, "Legacy deletion, Modal decision and docs"),
  pending(7, "Gap Analysis"),
  pending(8, "Test Suite + Real E2E Workflows"),
];

const UNIT_2_NAMES = [
  "Start gate, origin/main merge, re-verify and parity build",
  "App store and root composition (no-budget)",
  "Legacy relocation and deletion",
  "Global lint scope, dependency rules and agent hook",
  "Invariant retirement (no-budget)",
  "Playwright screenshot suite, baselines and CI job",
  "Docs for the module tree",
  "Gap Analysis",
  "Test Suite + Real E2E Workflows",
];

const G14_UNITS: LoopUnit[] = [
  {
    number: 1,
    ticket: "LOCAL-74",
    title: "Inbox, Today, Ask, Activity, Flow and card action modules",
    status: "built, awaiting /ship",
    statusText: "built, awaiting /ship",
    branch: "feat/LOCAL-74-unit-1-daily-pages",
    commit: "27c26d4",
    prdPath: "dispatch/.planning/prds/g13-modules-b-unit-1.md",
    phaseTotal: 12,
    phases: UNIT_1_PHASES,
  },
  {
    number: 2,
    ticket: "LOCAL-77",
    title: "Cutover, legacy deletion, global lint scope and screenshot suite",
    status: "in progress",
    statusText: "in progress",
    branch: "feat/LOCAL-77-unit-4-cutover",
    commit: null,
    prdPath: "dispatch/.planning/prds/g13-modules-b-unit-2.md",
    phaseTotal: 9,
    phases: [
      phase(1, UNIT_2_NAMES[0], "pass", 0, "2026-10-02T08:00:00Z"),
      phase(2, UNIT_2_NAMES[1], "pass", 1, "2026-10-02T10:00:00Z"),
      phase(3, UNIT_2_NAMES[2], "pass", 0, "2026-10-02T12:00:00Z"),
      phase(4, UNIT_2_NAMES[3], "pass", 0, "2026-10-02T14:00:00Z"),
      pending(5, UNIT_2_NAMES[4]),
      pending(6, UNIT_2_NAMES[5]),
      pending(7, UNIT_2_NAMES[6]),
      pending(8, UNIT_2_NAMES[7]),
      pending(9, UNIT_2_NAMES[8]),
    ],
  },
  {
    number: 3,
    ticket: "LOCAL-76",
    title: "Detail panel, Sessions and Workspace modules",
    status: "not started",
    statusText: "not started",
    branch: "feat/LOCAL-76-unit-3-detail-sessions-workspace",
    commit: null,
    prdPath: "dispatch/.planning/prds/g13-modules-b-unit-3.md",
    phaseTotal: 8,
    phases: UNIT_3_PHASES,
  },
];

const G14_ENGINE = {
  active: true,
  iteration: 38,
  sessionId: "16578a12-fbec-4493-bf15-9d84d04dc16c",
  handoffPending: false,
  startedAt: "2026-10-01T05:51:13Z",
  closed: false,
};

void test("g14-partial parses to the exact model", () => {
  const expected: LoopProgress = {
    slug: "g13-modules-b",
    roadmapFile: "ROADMAP.md",
    units: G14_UNITS,
    engine: G14_ENGINE,
    completion: "running",
    summary: {
      unitsDone: 1,
      unitsTotal: 3,
      currentUnit: 2,
      currentPhase: { number: 5, name: "Invariant retirement (no-budget)" },
      lastGate: {
        unit: 2,
        phase: 4,
        result: "pass",
        at: "2026-10-02T14:00:00Z",
      },
    },
    warnings: [],
    readAt: READ_AT,
  };
  assert.deepEqual(loadFixture("g14-partial", "g13-modules-b"), expected);
});

void test("g14-missing-state reads phase 2 as fail and warns once", () => {
  const result = loadFixture("g14-missing-state", "g13-modules-b");
  assert.equal(result.units.length, 3);
  const unit2 = result.units[1];
  assert.deepEqual(
    unit2.phases.map((p) => [p.number, p.gate, p.attempts, p.passedAt]),
    UNIT_2_NAMES.map((_, index) =>
      index === 1 ? [2, "fail", 1, null] : [index + 1, "pending", 0, null],
    ),
  );
  assert.deepEqual(result.warnings, [
    "dispatch/.planning/g13-modules-b-unit-2/state.md: missing",
  ]);
  assert.equal(result.summary.currentPhase?.number, 1);
  assert.deepEqual(result.summary.lastGate, {
    unit: 2,
    phase: 2,
    result: "fail",
    at: "2026-10-02T09:30:00Z",
  });
});

void test("g11-complete is complete with a closed engine", () => {
  const result = loadFixture("g11-complete", "g14-backend");
  assert.equal(result.completion, "complete");
  assert.equal(result.engine?.closed, true);
  assert.equal(result.summary.unitsDone, 2);
  assert.equal(result.summary.currentUnit, null);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.units[0]?.commit, "5b19bb0");
  assert.equal(
    result.units[0]?.branch,
    "feat/LOCAL-78-unit-1-route-boundaries",
  );
  assert.equal(result.units[0]?.ticket, "LOCAL-78");
  assert.equal(result.summary.lastGate?.unit, 2);
});

void test("g15-layout reads the Ticket Branch Status columns by name", () => {
  const result = loadFixture("g15-layout", "g15-accounts-connections");
  const first = result.units[0];
  assert.equal(first.branch, "feat/LOCAL-80-unit-1-account-switch");
  assert.equal(first.ticket, "LOCAL-80");
  assert.equal(first.commit, "15e2eba");
  assert.equal(result.units[1]?.status, "in progress");
  assert.equal(result.completion, "running");
});

void test("g16-no-engine has a null engine and no engine warning", () => {
  const result = loadFixture("g16-no-engine", "g16-orch-design");
  assert.equal(result.engine, null);
  assert.equal(
    result.warnings.some((w) => w.includes("ralph-loop")),
    false,
  );
  assert.equal(result.units[0]?.status, "built, awaiting /ship");
  assert.equal(result.units[0]?.phaseTotal, 9);
});
