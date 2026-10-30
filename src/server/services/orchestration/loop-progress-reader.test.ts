import test, { after, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs, {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type {
  ActivityEvent,
  Card,
  Column,
  LoopProgress,
} from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import { materializeLoopFixture } from "../../test-support/loop-fixtures.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { readLoopProgress, refreshLoopProgress, startLoopProgressReader } =
  await import("./loop-progress-reader.js");

const temps: string[] = [];
const UNIT_2_DIR = "dispatch/.planning/g13-modules-b-unit-2";
const UNIT_2_STATE = `${UNIT_2_DIR}/state.md`;
const UNIT_1_PRD = "dispatch/.planning/prds/g13-modules-b-unit-1.md";
const UNIT_2_PRD = "dispatch/.planning/prds/g13-modules-b-unit-2.md";
const UNIT_3_PRD = "dispatch/.planning/prds/g13-modules-b-unit-3.md";

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  setBoardRepository(store);
});

function partialRoot(): string {
  const root = materializeLoopFixture("g14-partial");
  temps.push(root);
  return root;
}

function emptyTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "loop-reader-"));
  temps.push(dir);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await sleep(10);
  }
}

function groupCard(root: string, column: Column, source = "group"): Card {
  return {
    id: "card-1",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "card-1",
    identifier: "GROUP-1",
    title: "Group",
    description: null,
    priority: 0,
    column,
    updatedAt: "2026-10-06T00:00:00Z",
    source,
    workspacePath: root,
  };
}

interface Recorded {
  at: number;
  cardId: string;
  progress: LoopProgress;
  force: boolean;
}

const activity = new EventEmitter();

function installRepo(
  getCard: () => Card,
  recorded: Recorded[],
  onSet?: () => Promise<void>,
): void {
  setBoardRepository(
    fakeBoardRepository({
      listBoards: () => [{ key: "board-1" }] as never,
      snapshot: () => ({
        boardKey: DEFAULT_BOARD_KEY,
        cards: [getCard()],
        syncedAt: null,
      }),
      getCard: () => {
        const stored = recorded.at(-1)?.progress;
        return stored ? { ...getCard(), loopProgress: stored } : getCard();
      },
      on: activity.on.bind(activity),
      off: activity.off.bind(activity),
      setLoopProgress: async (cardId, progress, force = false) => {
        recorded.push({ at: Date.now(), cardId, progress, force });
        await onSet?.();
      },
    }),
  );
}

function gates(progress: LoopProgress, unit: number): string[] {
  const found = progress.units.find((candidate) => candidate.number === unit);
  return (found?.phases ?? []).map((phase) => phase.gate);
}

void test("a full read of g14-partial gives the exact model", async () => {
  const progress = await readLoopProgress(partialRoot());
  assert.ok(progress);
  assert.equal(progress.slug, "g13-modules-b");
  assert.equal(progress.roadmapFile, "ROADMAP.md");
  assert.equal(progress.completion, "running");
  assert.deepEqual(progress.warnings, []);
  assert.deepEqual(progress.engine, {
    active: true,
    iteration: 38,
    sessionId: "16578a12-fbec-4493-bf15-9d84d04dc16c",
    handoffPending: false,
    startedAt: "2026-10-01T05:51:13Z",
    closed: false,
  });
  assert.deepEqual(progress.summary, {
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
  });
  assert.deepEqual(
    progress.units.map((unit) => [
      unit.number,
      unit.ticket,
      unit.status,
      unit.branch,
      unit.commit,
      unit.prdPath,
      unit.phaseTotal,
    ]),
    [
      [
        1,
        "LOCAL-74",
        "built, awaiting /ship",
        "feat/LOCAL-74-unit-1-daily-pages",
        "27c26d4",
        UNIT_1_PRD,
        12,
      ],
      [
        2,
        "LOCAL-77",
        "in progress",
        "feat/LOCAL-77-unit-4-cutover",
        null,
        UNIT_2_PRD,
        9,
      ],
      [
        3,
        "LOCAL-76",
        "not started",
        "feat/LOCAL-76-unit-3-detail-sessions-workspace",
        null,
        UNIT_3_PRD,
        8,
      ],
    ],
  );
  assert.deepEqual(
    progress.units[0]?.phases.map((phase) => [phase.gate, phase.attempts]),
    [0, 1, 0, 2, 0, 0, 5, 1, 5, 1, 0, 0].map((attempts) => ["pass", attempts]),
  );
  assert.deepEqual(
    progress.units[1]?.phases.map((phase) => [
      phase.number,
      phase.gate,
      phase.attempts,
      phase.passedAt,
    ]),
    [
      [1, "pass", 0, "2026-10-02T08:00:00Z"],
      [2, "pass", 1, "2026-10-02T10:00:00Z"],
      [3, "pass", 0, "2026-10-02T12:00:00Z"],
      [4, "pass", 0, "2026-10-02T14:00:00Z"],
      [5, "pending", 0, null],
      [6, "pending", 0, null],
      [7, "pending", 0, null],
      [8, "pending", 0, null],
      [9, "pending", 0, null],
    ],
  );
  assert.deepEqual(gates(progress, 3), Array<string>(8).fill("pending"));
});

void test("a missing phase state file reads as no pass and warns", async () => {
  const root = partialRoot();
  rmSync(join(root, UNIT_2_STATE));
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  const phases = progress.units[1]?.phases ?? [];
  assert.equal(phases.length, 9);
  assert.equal(
    phases.some((phase) => phase.gate === "pass"),
    false,
  );
  assert.ok(progress.warnings.includes(`${UNIT_2_STATE}: missing`));
});

void test("a PRD path that escapes the root is skipped with a warning", async () => {
  const root = partialRoot();
  const roadmap = join(root, "ROADMAP.md");
  writeFileSync(
    roadmap,
    readFileSync(roadmap, "utf8").replace(UNIT_1_PRD, "../../etc/passwd"),
  );
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  assert.ok(
    progress.warnings.includes("../../etc/passwd: outside the session root"),
  );
});

void test("a symlink that leaves the root is skipped with a warning", async () => {
  const root = partialRoot();
  const outside = emptyTemp();
  writeFileSync(join(outside, "secret.md"), "### Phase 1: Secret\n");
  rmSync(join(root, UNIT_2_PRD));
  symlinkSync(join(outside, "secret.md"), join(root, UNIT_2_PRD));
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  assert.ok(
    progress.warnings.includes(`${UNIT_2_PRD}: outside the session root`),
  );
  assert.ok(!progress.warnings.includes(`${UNIT_2_PRD}: missing`));
});

void test("a file above 1 MiB is skipped with a warning", async () => {
  const root = partialRoot();
  writeFileSync(join(root, UNIT_3_PRD), "a".repeat(2 * 1024 * 1024));
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  assert.ok(progress.warnings.includes(`${UNIT_3_PRD}: larger than 1 MiB`));
  assert.ok(!progress.warnings.includes(`${UNIT_3_PRD}: missing`));
});

void test("a folder with no roadmap files reads as null", async () => {
  assert.equal(await readLoopProgress(emptyTemp()), null);
});

void test("a file change in a watched folder gives one debounced store call", async () => {
  const root = partialRoot();
  const recorded: Recorded[] = [];
  installRepo(() => groupCard(root, "in_progress"), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 300 });
  try {
    await waitFor(() => recorded.length >= 1);
    await sleep(700);
    recorded.length = 0;
    const state = join(root, UNIT_2_STATE);
    appendFileSync(
      state,
      "phase 5 Invariant retirement (no-budget) GREEN 2026-10-02T16:00:00Z gate=pass\n",
    );
    await sleep(50);
    appendFileSync(
      state,
      "phase 6 Playwright screenshot suite, baselines and CI job GREEN 2026-10-02T17:00:00Z gate=pass\n",
    );
    await sleep(1000);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.progress?.summary.currentPhase?.number, 7);
  } finally {
    stop();
  }
});

void test("the timer re-sync adds a watch for a folder that appeared", async () => {
  const root = partialRoot();
  const unitDir = join(root, UNIT_2_DIR);
  const savedState = readFileSync(join(unitDir, "state.md"), "utf8");
  rmSync(unitDir, { recursive: true });
  const recorded: Recorded[] = [];
  installRepo(() => groupCard(root, "in_progress"), recorded);
  const startedAt = Date.now();
  const stop = startLoopProgressReader({ intervalMs: 600, debounceMs: 50 });
  try {
    await waitFor(() => recorded.length >= 1);
    mkdirSync(unitDir);
    writeFileSync(join(unitDir, "state.md"), savedState);
    await sleep(Math.max(0, startedAt + 900 - Date.now()));
    const writtenAt = Date.now();
    appendFileSync(
      join(unitDir, "state.md"),
      "phase 5 Invariant retirement (no-budget) GREEN 2026-10-02T16:00:00Z gate=pass\n",
    );
    await sleep(250);
    const reads = recorded.filter(
      (entry) => entry.at >= writtenAt && entry.at < startedAt + 1150,
    );
    assert.ok(reads.length >= 1);
    assert.equal(reads.at(-1)?.progress?.summary.currentPhase?.number, 6);
  } finally {
    stop();
  }
});

void test("a card that moves to Done gets no further reads or watches", async () => {
  const root = partialRoot();
  const recorded: Recorded[] = [];
  let column: Column = "in_progress";
  installRepo(() => groupCard(root, column), recorded);
  const stop = startLoopProgressReader({ intervalMs: 150, debounceMs: 50 });
  try {
    await waitFor(() => recorded.length >= 1);
    column = "done";
    await sleep(400);
    recorded.length = 0;
    appendFileSync(
      join(root, UNIT_2_STATE),
      "phase 5 Invariant retirement (no-budget) GREEN 2026-10-02T16:00:00Z gate=pass\n",
    );
    await sleep(500);
    assert.equal(recorded.length, 0);
  } finally {
    stop();
  }
});

void test("a failing store call does not escape or leave an unhandled rejection", async () => {
  const root = partialRoot();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  const originalWarn = console.warn;
  console.warn = (): void => undefined;
  try {
    const recorded: Recorded[] = [];
    installRepo(
      () => groupCard(root, "in_progress"),
      recorded,
      () => Promise.reject(new Error("store down")),
    );
    await refreshLoopProgress("card-1");
    setBoardRepository(
      fakeBoardRepository({
        getCard: () => {
          throw new Error("repo down");
        },
      }),
    );
    await refreshLoopProgress("card-1");
    await sleep(50);
    assert.equal(recorded.length, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    console.warn = originalWarn;
    process.off("unhandledRejection", onUnhandled);
  }
});

void test("a non group card is not read", async () => {
  const root = partialRoot();
  const recorded: Recorded[] = [];
  installRepo(() => groupCard(root, "in_progress", "linear"), recorded);
  await refreshLoopProgress("card-1");
  assert.equal(recorded.length, 0);
});

void test("a null read keeps the last stored value", async () => {
  const recorded: Recorded[] = [];
  installRepo(() => groupCard(emptyTemp(), "in_progress"), recorded);
  await refreshLoopProgress("card-1");
  assert.equal(recorded.length, 0);
});

void test("calls during one in-flight read queue exactly one more read", async () => {
  const root = partialRoot();
  const recorded: Recorded[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  installRepo(
    () => groupCard(root, "in_progress"),
    recorded,
    () => gate,
  );
  const first = refreshLoopProgress("card-1");
  await waitFor(() => recorded.length === 1);
  const second = refreshLoopProgress("card-1");
  const third = refreshLoopProgress("card-1");
  const fourth = refreshLoopProgress("card-1");
  assert.equal(second, first);
  assert.equal(third, first);
  assert.equal(fourth, first);
  release();
  await first;
  assert.equal(recorded.length, 2);
});

void test("a done engine file alone gives a closed engine", async () => {
  const root = partialRoot();
  renameSync(
    join(root, ".claude/ralph-loop.local.md"),
    join(root, ".claude/ralph-loop.local.md.done"),
  );
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  assert.equal(progress.engine?.closed, true);
  assert.deepEqual(progress.warnings, []);
});

void test("an oversize roadmap file reads as null so the store keeps its last value", async () => {
  const root = partialRoot();
  writeFileSync(join(root, "ROADMAP.md"), "a".repeat(2 * 1024 * 1024));
  assert.equal(await readLoopProgress(root), null);
});

void test("a blank roadmap file reads as null", async () => {
  const root = partialRoot();
  writeFileSync(join(root, "ROADMAP.md"), "  \n\n");
  assert.equal(await readLoopProgress(root), null);
});

void test("an oversize live engine file is not replaced by the done file", async () => {
  const root = partialRoot();
  const engine = join(root, ".claude/ralph-loop.local.md");
  const saved = readFileSync(engine, "utf8");
  writeFileSync(engine, "a".repeat(2 * 1024 * 1024));
  writeFileSync(`${engine}.done`, saved);
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  assert.equal(progress.engine, null);
  assert.ok(
    progress.warnings.includes(
      ".claude/ralph-loop.local.md: larger than 1 MiB",
    ),
  );
});

const LOOP_DIR = ".roadmap/g13-modules-b";
const SEVERAL_FOLDERS = ".roadmap: several loop folders, using";
const SEVERAL_ROADMAPS = "session root: several ROADMAP files, using";
const UNIT_3_DIR = "dispatch/.planning/g13-modules-b-unit-3";
const runningAsRoot = process.getuid?.() === 0;

function touch(file: string, seconds: number): void {
  utimesSync(file, seconds, seconds);
}

function warned(progress: LoopProgress, prefix: string): string | undefined {
  return progress.warnings.find((warning) => warning.startsWith(prefix));
}

void test("the engine slug hint beats a newer sibling loop folder, with sentence punctuation after it", async () => {
  const root = partialRoot();
  assert.match(
    readFileSync(join(root, ".claude/ralph-loop.local.md"), "utf8"),
    /slug g13-modules-b\./,
  );
  cpSync(join(root, LOOP_DIR), join(root, ".roadmap/aa-newer"), {
    recursive: true,
  });
  touch(join(root, LOOP_DIR, "progress.md"), 1_000_000);
  touch(join(root, ".roadmap/aa-newer/progress.md"), 2_000_000);
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  assert.equal(progress.slug, "g13-modules-b");
  assert.equal(warned(progress, SEVERAL_FOLDERS), undefined);
});

void test("without a hint the newest loop folder wins and a warning names it", async () => {
  const root = partialRoot();
  rmSync(join(root, ".claude/ralph-loop.local.md"));
  cpSync(join(root, LOOP_DIR), join(root, ".roadmap/zz-newer"), {
    recursive: true,
  });
  touch(join(root, LOOP_DIR, "progress.md"), 1_000_000);
  touch(join(root, ".roadmap/zz-newer/progress.md"), 2_000_000);
  const newer = await readLoopProgress(root);
  assert.ok(newer);
  assert.equal(newer.slug, "zz-newer");
  assert.equal(warned(newer, SEVERAL_FOLDERS), `${SEVERAL_FOLDERS} zz-newer`);
  touch(join(root, LOOP_DIR, "progress.md"), 3_000_000);
  const older = await readLoopProgress(root);
  assert.ok(older);
  assert.equal(older.slug, "g13-modules-b");
  assert.equal(
    warned(older, SEVERAL_FOLDERS),
    `${SEVERAL_FOLDERS} g13-modules-b`,
  );
});

void test("a ledger line naming a missing file falls back to the only roadmap file", async (t) => {
  if (runningAsRoot) return t.skip("root ignores file modes");
  const root = partialRoot();
  renameSync(join(root, "ROADMAP.md"), join(root, "ROADMAP-main.md"));
  const ledger = join(root, LOOP_DIR, "progress.md");
  writeFileSync(
    ledger,
    readFileSync(ledger, "utf8").replace(
      /^Roadmap: .*$/m,
      "Roadmap: /gone/ROADMAP.md",
    ),
  );
  const progress = await readLoopProgress(root);
  assert.ok(progress);
  assert.equal(progress.roadmapFile, "ROADMAP-main.md");
  assert.equal(warned(progress, SEVERAL_ROADMAPS), undefined);
});

void test("two roadmap files with no usable ledger line pick the newest and warn", async (t) => {
  if (runningAsRoot) return t.skip("root ignores file modes");
  const root = partialRoot();
  cpSync(join(root, "ROADMAP.md"), join(root, "ROADMAP-b.md"));
  const ledger = join(root, LOOP_DIR, "progress.md");
  writeFileSync(
    ledger,
    readFileSync(ledger, "utf8").replace(/^Roadmap: .*$/m, "# Ledger"),
  );
  touch(join(root, "ROADMAP.md"), 1_000_000);
  touch(join(root, "ROADMAP-b.md"), 2_000_000);
  const newer = await readLoopProgress(root);
  assert.ok(newer);
  assert.equal(newer.roadmapFile, "ROADMAP-b.md");
  assert.equal(
    warned(newer, SEVERAL_ROADMAPS),
    `${SEVERAL_ROADMAPS} ROADMAP-b.md`,
  );
  touch(join(root, "ROADMAP.md"), 3_000_000);
  const older = await readLoopProgress(root);
  assert.ok(older);
  assert.equal(older.roadmapFile, "ROADMAP.md");
  assert.equal(
    warned(older, SEVERAL_ROADMAPS),
    `${SEVERAL_ROADMAPS} ROADMAP.md`,
  );
});

void test("an unreadable roadmap file reads as null", async (t) => {
  if (runningAsRoot) return t.skip("root ignores file modes");
  const root = partialRoot();
  const roadmap = join(root, "ROADMAP.md");
  chmodSync(roadmap, 0o000);
  try {
    assert.equal(await readLoopProgress(root), null);
  } finally {
    chmodSync(roadmap, 0o644);
  }
});

void test("the watch set follows the current unit across a unit boundary", async () => {
  const root = partialRoot();
  const recorded: Recorded[] = [];
  installRepo(() => groupCard(root, "in_progress"), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 50 });
  try {
    await waitFor(() => recorded.length >= 1);
    assert.equal(recorded[0]?.progress.summary.currentUnit, 2);
    await sleep(300);

    mkdirSync(join(root, UNIT_3_DIR), { recursive: true });
    writeFileSync(join(root, UNIT_3_DIR, "state.md"), "");
    const roadmap = join(root, "ROADMAP.md");
    writeFileSync(
      roadmap,
      readFileSync(roadmap, "utf8")
        .replace(
          "- **Status:** in progress",
          "- **Status:** built, awaiting /ship",
        )
        .replace("- **Status:** not started", "- **Status:** in progress"),
    );
    await waitFor(() => recorded.at(-1)?.progress.summary.currentUnit === 3);
    await sleep(500);

    const beforeOld = recorded.length;
    appendFileSync(
      join(root, UNIT_2_STATE),
      "phase 5 Invariant retirement (no-budget) GREEN 2026-10-02T16:00:00Z gate=pass\n",
    );
    await sleep(1000);
    assert.equal(recorded.length, beforeOld);

    appendFileSync(
      join(root, UNIT_3_DIR, "state.md"),
      "phase 1 Start gate GREEN 2026-10-02T18:00:00Z gate=pass\n",
    );
    await waitFor(() => recorded.length > beforeOld, 1000);
    assert.equal(recorded.at(-1)?.progress.units[2]?.phases[0]?.gate, "pass");
  } finally {
    stop();
  }
});

const SINGLE_PRD = "repo/.planning/prds/demo.md";
const SINGLE_DIR = "repo/.planning/demo-feature";

function singleRoot(prdPath?: string): string {
  const root = emptyTemp();
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "repo/.planning/prds"), { recursive: true });
  mkdirSync(join(root, SINGLE_DIR), { recursive: true });
  writeFileSync(
    join(root, ".claude/ralph-loop.local.md"),
    `---\nactive: true\niteration: 2\nsession_id: abc\ncompletion_promise: "RALPH COMPLETE demo-feature"\n---\nExecute the PRD at ${prdPath ?? join(root, SINGLE_PRD)} per the ralph-loop skill.\n`,
  );
  writeFileSync(
    join(root, SINGLE_PRD),
    "# Demo feature\n\n### Phase 1: One\n\n### Phase 2: Two\n\n### Phase 3: Three\n",
  );
  writeFileSync(
    join(root, SINGLE_DIR, "state.md"),
    "phase 1 One GREEN 2026-10-11T04:00:00Z gate=pass\n",
  );
  writeFileSync(
    join(root, SINGLE_DIR, "attempts.md"),
    "phase 2 RED attempt 1 2026-10-11T05:00:00Z\n",
  );
  return root;
}

function launchedCard(root: string, launch: boolean): Card {
  const card = groupCard(root, "in_progress", "linear");
  return launch ? { ...card, launch: { direction: "x" } } : card;
}

void test("a single read gives one unit from the engine PRD", async () => {
  const root = singleRoot();
  const progress = await readLoopProgress(root, { single: true });
  assert.ok(progress);
  assert.equal(progress.prdFile, SINGLE_PRD);
  assert.equal(progress.slug, "demo-feature");
  assert.equal(progress.units.length, 1);
  assert.deepEqual(
    progress.units[0]?.phases.map((phase) => phase.gate),
    ["pass", "fail", "pending"],
  );
  assert.equal(progress.engine?.active, true);
  assert.deepEqual(progress.warnings, []);
});

void test("a single read keeps the PRD after the engine file is gone", async () => {
  const root = singleRoot();
  const first = await readLoopProgress(root, { single: true });
  assert.ok(first);
  const aside = emptyTemp();
  renameSync(
    join(root, ".claude/ralph-loop.local.md"),
    join(aside, "engine.md"),
  );
  appendFileSync(
    join(root, SINGLE_DIR, "state.md"),
    "phase 2 Two GREEN 2026-10-11T06:00:00Z gate=pass\n",
  );
  const second = await readLoopProgress(root, {
    single: true,
    previous: first,
  });
  assert.ok(second);
  assert.deepEqual(
    second.units[0]?.phases.map((phase) => phase.gate),
    ["pass", "pass", "pending"],
  );
  assert.equal(second.engine?.active, true);
  assert.equal(second.engine?.closed, false);
  assert.equal(second.prdFile, SINGLE_PRD);
});

void test("a single read of a closed loop reads the renamed .done engine file", async () => {
  const root = singleRoot();
  appendFileSync(
    join(root, SINGLE_DIR, "state.md"),
    "phase 2 Two GREEN 2026-10-11T06:00:00Z gate=pass\nphase 3 Three GREEN 2026-10-11T07:00:00Z gate=pass\n",
  );
  renameSync(
    join(root, ".claude/ralph-loop.local.md"),
    join(root, ".claude/ralph-loop.local.md.done"),
  );
  const progress = await readLoopProgress(root, { single: true });
  assert.ok(progress);
  assert.equal(progress.prdFile, SINGLE_PRD);
  assert.equal(progress.engine?.closed, true);
  assert.deepEqual(
    progress.units[0]?.phases.map((phase) => phase.gate),
    ["pass", "pass", "pass"],
  );
  assert.equal(progress.units[0]?.statusText, "built, awaiting /ship");
  assert.deepEqual(progress.warnings, []);
});

void test("a single read of a closed loop with no PRD path reads complete", async () => {
  const root = emptyTemp();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude/ralph-loop.local.md.done"),
    '---\nactive: true\niteration: 1\nsession_id: x\ncompletion_promise: "RALPH COMPLETE local-159"\nclosed_reason: promise\n---\nExecute LOCAL-159 per the ralph-loop skill. Unit A: PRD .planning/prds/local-159-unit-a.md. When done output the phrase RALPH COMPLETE local-159 wrapped in promise tags.\n',
  );
  const progress = await readLoopProgress(root, { single: true });
  assert.ok(progress);
  assert.equal(progress.slug, "local-159");
  assert.equal(progress.engine?.closed, true);
  assert.equal(progress.engine?.closedReason, "promise");
  assert.equal(progress.completion, "complete");
  assert.equal(progress.summary.unitsDone, 1);
  assert.equal(progress.summary.unitsTotal, 1);
});

void test("a read without single stays null for a root with no ledger", async () => {
  assert.equal(await readLoopProgress(singleRoot()), null);
});

void test("an engine PRD path outside the root warns and reads no phases", async () => {
  const root = singleRoot("/elsewhere/repo/.planning/prds/demo.md");
  const progress = await readLoopProgress(root, { single: true });
  assert.ok(progress);
  assert.deepEqual(progress.warnings, [
    "/elsewhere/repo/.planning/prds/demo.md: outside the session root",
  ]);
  assert.deepEqual(progress.units[0]?.phases, []);
  assert.equal(
    progress.units[0]?.prdPath,
    "/elsewhere/repo/.planning/prds/demo.md",
  );
  assert.equal(progress.prdFile, undefined);
});

void test("a relative engine PRD path reads like the absolute one", async () => {
  const relative = await readLoopProgress(singleRoot(SINGLE_PRD), {
    single: true,
  });
  const absolute = await readLoopProgress(singleRoot(), { single: true });
  assert.ok(relative && absolute);
  assert.equal(relative.prdFile, SINGLE_PRD);
  assert.deepEqual(relative.units, absolute.units);
  assert.deepEqual(relative.summary, absolute.summary);
  assert.deepEqual(relative.warnings, []);
});

void test("a PRD above 1 MiB gives the size warning and no phases", async () => {
  const root = singleRoot();
  writeFileSync(join(root, SINGLE_PRD), "a".repeat(2 * 1024 * 1024));
  const progress = await readLoopProgress(root, { single: true });
  assert.ok(progress);
  assert.deepEqual(progress.warnings, [`${SINGLE_PRD}: larger than 1 MiB`]);
  assert.deepEqual(progress.units[0]?.phases, []);
  assert.equal(progress.units[0]?.phaseTotal, null);
});

void test("an engine with a new slug and no PRD line does not borrow the previous PRD", async () => {
  const root = singleRoot();
  const first = await readLoopProgress(root, { single: true });
  assert.ok(first);
  writeFileSync(
    join(root, ".claude/ralph-loop.local.md"),
    '---\nactive: true\niteration: 1\nsession_id: abc\ncompletion_promise: "RALPH COMPLETE other-feature"\n---\nhello\n',
  );
  const second = await readLoopProgress(root, {
    single: true,
    previous: first,
  });
  assert.ok(second);
  assert.equal(second.slug, "other-feature");
  assert.deepEqual(second.units[0]?.phases, []);
  assert.equal(second.prdFile, undefined);
  assert.deepEqual(second.warnings, [
    ".claude/ralph-loop.local.md: no PRD path in the loop prompt",
  ]);
});

void test("a launched ticket card stores the one unit progress", async () => {
  const root = singleRoot();
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, true), recorded);
  await refreshLoopProgress("card-1");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.progress.units.length, 1);
  assert.equal(recorded[0]?.progress.prdFile, SINGLE_PRD);
});

void test("a launched card drops the previous PRD phases when the engine names a new slug", async () => {
  const root = singleRoot();
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, true), recorded);
  await refreshLoopProgress("card-1");
  writeFileSync(
    join(root, ".claude/ralph-loop.local.md"),
    '---\nactive: true\niteration: 1\nsession_id: abc\ncompletion_promise: "RALPH COMPLETE other-feature"\n---\nhello\n',
  );
  await refreshLoopProgress("card-1");
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1]?.progress.slug, "other-feature");
  assert.deepEqual(recorded[1]?.progress.units[0]?.phases, []);
});

void test("a ticket card with no launch stores nothing", async () => {
  const root = singleRoot();
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, false), recorded);
  await refreshLoopProgress("card-1");
  assert.equal(recorded.length, 0);
});

let nextEventId = 1;

function doneEvent(cardId: string): ActivityEvent {
  return {
    id: nextEventId++,
    cardId,
    type: "status_agent_done",
    fromCol: null,
    toCol: null,
    reason: null,
    source: null,
    ts: new Date().toISOString(),
  };
}

void test("a DONE marker on a loop card forces a write with a newer readAt and the same files", async () => {
  const root = singleRoot();
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, true), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 50 });
  try {
    await waitFor(() => recorded.length >= 1);
    const first = recorded[0];
    assert.equal(first?.force, false);
    const firstReadAt = first?.progress.readAt ?? "";
    await waitFor(() => new Date().toISOString() > firstReadAt);
    const emittedAt = new Date().toISOString();
    activity.emit("activity", doneEvent("card-1"));
    await waitFor(() => recorded.some((entry) => entry.force));
    const forced = recorded.find((entry) => entry.force);
    assert.ok((forced?.progress.readAt ?? "") >= emittedAt);
    assert.ok((forced?.progress.readAt ?? "") > firstReadAt);
    assert.deepEqual(forced?.progress.units, first?.progress.units);
  } finally {
    stop();
  }
});

void test("a DONE marker on a card that is not a loop card stores nothing", async () => {
  const root = singleRoot();
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, false), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 50 });
  try {
    activity.emit("activity", doneEvent("card-1"));
    await sleep(300);
    assert.equal(recorded.length, 0);
  } finally {
    stop();
  }
});

void test("after the stop function a DONE marker triggers no read", async () => {
  const root = singleRoot();
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, true), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 50 });
  await waitFor(() => recorded.length >= 1);
  stop();
  const count = recorded.length;
  activity.emit("activity", doneEvent("card-1"));
  await sleep(300);
  assert.equal(recorded.length, count);
});

void test("a gate line in a single PRD loop updates the phase gate and readAt", async () => {
  const root = singleRoot();
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, true), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 50 });
  try {
    await waitFor(() => recorded.length >= 1);
    await sleep(200);
    const before = recorded.length;
    appendFileSync(
      join(root, SINGLE_DIR, "state.md"),
      "phase 2 Two GREEN 2026-10-11T06:00:00Z gate=pass\n",
    );
    await waitFor(() => recorded.length > before);
    const first = recorded[0]?.progress;
    const last = recorded.at(-1)?.progress;
    assert.deepEqual(
      last?.units[0]?.phases.map((phase) => phase.gate),
      ["pass", "pass", "pending"],
    );
    assert.ok((last?.readAt ?? "") > (first?.readAt ?? ""));
  } finally {
    stop();
  }
});

void test("a unit state folder under the card identifier slug reads its gate lines", async () => {
  const root = partialRoot();
  const expected = await readLoopProgress(root);
  assert.ok(expected);
  assert.ok(gates(expected, 2).includes("pass"));
  renameSync(
    join(root, UNIT_2_DIR),
    join(root, "dispatch/.planning/group-1-unit-2"),
  );
  const missing = await readLoopProgress(root);
  assert.ok(missing?.warnings.includes(`${UNIT_2_STATE}: missing`));
  const progress = await readLoopProgress(root, { identifier: "GROUP-1" });
  assert.ok(progress);
  assert.deepEqual(gates(progress, 2), gates(expected, 2));
  assert.ok(!progress.warnings.includes(`${UNIT_2_STATE}: missing`));
});

void test("a refresh of a group card reads the unit state under its identifier slug", async () => {
  const root = partialRoot();
  renameSync(
    join(root, UNIT_2_DIR),
    join(root, "dispatch/.planning/group-1-unit-2"),
  );
  const recorded: Recorded[] = [];
  installRepo(() => groupCard(root, "in_progress"), recorded);
  await refreshLoopProgress("card-1");
  const progress = recorded.at(-1)?.progress;
  assert.ok(progress);
  assert.ok(gates(progress, 2).includes("pass"));
  assert.ok(!progress.warnings.includes(`${UNIT_2_STATE}: missing`));
});

interface FakeWatch {
  dir: string;
  fire: () => void;
}

/**
 * Replaces `fs.watch` with a fake that records each watched folder, and returns the records and the restore function.
 *
 * @remarks The reader imports `watch` as a named binding, so `syncBuiltinESMExports` must push the mock into that binding and back.
 */
function fakeWatcher(t: TestContext): {
  watches: FakeWatch[];
  restore: () => void;
} {
  const watches: FakeWatch[] = [];
  const watchMock = t.mock.method(
    fs,
    "watch",
    (dir: string, _options: unknown, listener: () => void) => {
      watches.push({ dir, fire: listener });
      return Object.assign(new EventEmitter(), { close: () => undefined });
    },
  );
  syncBuiltinESMExports();
  return {
    watches,
    restore: () => {
      watchMock.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

async function fireAndWaitForRead(
  watches: FakeWatch[],
  dir: string,
  recorded: Recorded[],
): Promise<void> {
  const watch = watches.find((candidate) => candidate.dir === dir);
  assert.ok(watch, `no watch on ${dir}`);
  const before = recorded.length;
  watch.fire();
  await waitFor(() => recorded.length > before, 1000);
}

void test("a write in the identifier unit folder and in the roadmap slug folder each trigger a refresh", async (t) => {
  const root = partialRoot();
  const aliasDir = join(root, "dispatch/.planning/group-1-unit-2");
  cpSync(join(root, UNIT_2_DIR), aliasDir, { recursive: true });
  const fake = fakeWatcher(t);
  const recorded: Recorded[] = [];
  installRepo(() => groupCard(root, "in_progress"), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 20 });
  try {
    await waitFor(() =>
      fake.watches.some((candidate) => candidate.dir === aliasDir),
    );
    await fireAndWaitForRead(fake.watches, aliasDir, recorded);
    await fireAndWaitForRead(fake.watches, join(root, UNIT_2_DIR), recorded);
  } finally {
    stop();
    fake.restore();
  }
});

void test("a single PRD card adds no identifier folder watch", async (t) => {
  const root = singleRoot();
  mkdirSync(join(root, "repo/.planning/group-1-unit-1"), { recursive: true });
  const fake = fakeWatcher(t);
  const recorded: Recorded[] = [];
  installRepo(() => launchedCard(root, true), recorded);
  const stop = startLoopProgressReader({ intervalMs: 60_000, debounceMs: 20 });
  try {
    const stateDir = join(root, SINGLE_DIR);
    await waitFor(() =>
      fake.watches.some((candidate) => candidate.dir === stateDir),
    );
    assert.ok(
      !fake.watches.some((candidate) => candidate.dir.includes("group-1")),
    );
    await fireAndWaitForRead(fake.watches, stateDir, recorded);
  } finally {
    stop();
    fake.restore();
  }
});

const ENGINE_REL = ".claude/ralph-loop.local.md";

async function singleRead(
  root: string,
  previous: LoopProgress,
): Promise<LoopProgress> {
  const progress = await readLoopProgress(root, { single: true, previous });
  assert.ok(progress);
  return progress;
}

async function firstSingleRead(root: string): Promise<LoopProgress> {
  const first = await readLoopProgress(root, { single: true });
  assert.ok(first?.engine);
  return first;
}

function writeDone(root: string, slug: string, session: string): void {
  writeFileSync(
    join(root, `${ENGINE_REL}.done`),
    `---\nactive: false\nsession_id: ${session}\ncompletion_promise: "RALPH COMPLETE ${slug}"\nclosed_reason: promise\n---\nold\n`,
  );
}

void test("a done file of another slug is not read as this loop's close", async () => {
  const root = singleRoot();
  const first = await firstSingleRead(root);
  rmSync(join(root, ENGINE_REL));
  writeDone(root, "old-loop", "abc");
  const closedPrevious = {
    ...first,
    engine: { ...first.engine!, closed: true },
  };
  const progress = await singleRead(root, closedPrevious);
  assert.equal(progress.engine, null);
});

void test("a done file of another session id is not read as this loop's close", async () => {
  const root = singleRoot();
  const first = await firstSingleRead(root);
  rmSync(join(root, ENGINE_REL));
  writeDone(root, "demo-feature", "old-session");
  const closedPrevious = {
    ...first,
    engine: { ...first.engine!, closed: true },
  };
  const progress = await singleRead(root, closedPrevious);
  assert.equal(progress.engine, null);
});

void test("a done file of the same slug and session reads closed", async () => {
  const root = singleRoot();
  const first = await firstSingleRead(root);
  rmSync(join(root, ENGINE_REL));
  writeDone(root, "demo-feature", "abc");
  const progress = await singleRead(root, first);
  assert.equal(progress.engine?.closed, true);
  assert.equal(progress.engine?.closedReason, "promise");
});

void test("a missing engine file with a previous open engine stays open and warns", async () => {
  const root = singleRoot();
  const first = await firstSingleRead(root);
  rmSync(join(root, ENGINE_REL));
  const progress = await singleRead(root, first);
  assert.equal(progress.engine?.active, true);
  assert.equal(progress.engine?.closed, false);
  assert.equal(progress.engine?.sessionId, "abc");
  assert.ok(
    progress.warnings.includes("engine file removed without a close"),
    progress.warnings.join("|"),
  );
});

void test("a loop with no PRD path keeps its engine open over two reads after the engine file is gone", async () => {
  const root = emptyTemp();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ENGINE_REL),
    `---\nactive: true\niteration: 1\nsession_id: abc\ncompletion_promise: "RALPH COMPLETE local-159"\n---\nBuild it.\n`,
  );
  const first = await firstSingleRead(root);
  rmSync(join(root, ENGINE_REL));
  for (const previous of [first, await singleRead(root, first)]) {
    const progress = await singleRead(root, previous);
    assert.equal(progress.slug, "local-159");
    assert.equal(progress.engine?.active, true);
    assert.equal(progress.engine?.closed, false);
    assert.equal(progress.engine?.keptOpen, true);
    assert.ok(
      progress.warnings.includes("engine file removed without a close"),
      progress.warnings.join("|"),
    );
  }
});

void test("a missing engine file with no previous engine reads no engine", async () => {
  const root = singleRoot();
  const first = await firstSingleRead(root);
  rmSync(join(root, ENGINE_REL));
  const progress = await singleRead(root, { ...first, engine: null });
  assert.equal(progress.engine, null);
  assert.deepEqual(progress.warnings, []);
});
