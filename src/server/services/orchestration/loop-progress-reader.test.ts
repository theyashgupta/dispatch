import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Card, Column, LoopProgress } from "../../../shared/types.js";
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
}

function installRepo(
  getCard: () => Card,
  recorded: Recorded[],
  onSet?: () => Promise<void>,
): void {
  setBoardRepository(
    fakeBoardRepository({
      listBoards: () => [{ key: "board-1" }] as never,
      snapshot: () => ({ cards: [getCard()], syncedAt: null }),
      getCard: () => {
        const stored = recorded.at(-1)?.progress;
        return stored ? { ...getCard(), loopProgress: stored } : getCard();
      },
      setLoopProgress: async (cardId, progress) => {
        recorded.push({ at: Date.now(), cardId, progress });
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
