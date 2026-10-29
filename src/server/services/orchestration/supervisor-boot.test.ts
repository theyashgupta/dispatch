import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, Column } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { resumeLostAtBoot } = await import("./supervisor-boot.js");
const { recordMemory } = await import("../../test-support/memory-fixtures.js");
await store.load();
after(() => env.cleanup());

const made: BoardKey[] = [];
let boards = 0;
let sessions = 0;

async function newBoard(cap = 3): Promise<BoardKey> {
  boards += 1;
  const key = parseBoardKey(`BT${boards}`)!;
  const created = await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/bt/${key}`,
    repositories: [],
    linearTeamKeys: [],
  });
  assert.ok(created.ok);
  await store.setBoardPolicy(key, {
    ...created.board.policy,
    concurrencyCap: cap,
  });
  made.push(key);
  return key;
}

afterEach(async () => {
  for (const key of made) {
    const board = store.getBoard(key)!;
    await store.setBoardPolicy(key, { ...board.policy, supervisor: "off" });
  }
  recordMemory(8192, 0);
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lostCard(
  board: BoardKey,
  title: string,
  opts: { column?: Column; launch?: boolean } = {},
): Promise<string> {
  const created = await store.createLocalCard(board, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: `/tmp/ws-${created.id}`,
    tmuxSession: `dsp-${created.id}`,
    branch: created.id,
  });
  if (opts.launch) {
    await store.setOrchestratorFields(created.id, {
      launch: { playbook: "Write code directly", direction: "" },
    });
  }
  if (opts.column === "agent_done") {
    await store.applyMarker(
      created.id,
      undefined,
      "agent_done",
      undefined,
      `done-${created.id}`,
      "status_agent_done",
    );
  } else if (opts.column !== undefined && opts.column !== "in_progress") {
    await store.moveCardManual(created.id, opts.column);
  }
  await store.markSessionLost(created.id, undefined);
  assert.equal(store.getCard(created.id)?.sessionLost, true);
  await pause(4);
  return created.id;
}

async function makeLive(cardId: string): Promise<void> {
  sessions += 1;
  const card = store.getCard(cardId)!;
  await store.resumeSession(
    cardId,
    { session: `dsp-boot-${sessions}` },
    card.activeSessionId,
  );
}

function sweep(overrides: { supervise?: (id: string) => Promise<void> } = {}) {
  const passed: string[] = [];
  const lines: string[] = [];
  const run = () =>
    resumeLostAtBoot({
      supervise: async (id) => {
        passed.push(id);
        await (overrides.supervise ?? makeLive)(id);
      },
      sample: () => Promise.resolve(),
      log: (line) => lines.push(line),
    });
  return { passed, lines, run };
}

const identifierOf = (id: string) => store.getCard(id)!.identifier;

void test("lost cards whose session_lost events fired before any listener existed are still passed", async () => {
  const board = await newBoard();
  const a = await lostCard(board, "boot a");
  const b = await lostCard(board, "boot b");
  const s = sweep();
  await s.run();
  assert.deepEqual(s.passed, [a, b]);
});

void test("only in_progress and needs_input cards are passed", async () => {
  const board = await newBoard();
  const inProgress = await lostCard(board, "col in_progress");
  const needsInput = await lostCard(board, "col needs_input", {
    column: "needs_input",
  });
  for (const column of [
    "agent_done",
    "in_review",
    "parked",
    "inbox",
    "done",
  ] as const) {
    const id = await lostCard(board, `col ${column}`, { column });
    assert.equal(store.getCard(id)?.column, column, `${column} holds a card`);
  }
  const s = sweep();
  await s.run();
  assert.deepEqual([...s.passed].sort(), [inProgress, needsInput].sort());
  assert.equal(s.lines.length, 2);
});

void test("an orchestrator card is not passed", async () => {
  const board = await newBoard();
  const hidden = await store.createOrchestratorCard(board, "Orch", "main");
  await store.completeStart(hidden.id, undefined, {
    workspacePath: "/tmp/ws-orch-boot",
    tmuxSession: "dsp-orch-boot",
    branch: "orch-boot",
  });
  await store.markSessionLost(hidden.id, undefined);
  assert.equal(store.getCard(hidden.id)?.sessionLost, true);
  const ticket = await lostCard(board, "ticket beside orchestrator");
  const s = sweep();
  await s.run();
  assert.deepEqual(s.passed, [ticket]);
});

void test("a card on a board with supervisor off is not passed", async () => {
  assert.equal(
    store.getBoard(DEFAULT_BOARD_KEY)?.policy.supervisor,
    "off",
    "the default board starts off",
  );
  const off = await lostCard(DEFAULT_BOARD_KEY, "off board");
  const board = await newBoard();
  const on = await lostCard(board, "on board");
  const s = sweep();
  await s.run();
  assert.deepEqual(s.passed, [on]);
  assert.ok(!s.passed.includes(off));
});

void test("order is columnSince ascending, a card with no columnSince last, ties in store order", async () => {
  const board = await newBoard();
  const a = await lostCard(board, "order a");
  const b = await lostCard(board, "order b");
  const c = await lostCard(board, "order c");
  const none = await lostCard(board, "order none");
  delete store.getCard(none)!.columnSince;
  const tieX = await lostCard(board, "order tie x");
  const tieY = await lostCard(board, "order tie y");
  const stamp = "2099-01-01T00:00:00.000Z";
  store.getCard(tieX)!.columnSince = stamp;
  store.getCard(tieY)!.columnSince = stamp;
  store.getCard(a)!.columnSince = "2026-10-03T00:00:00.000Z";
  store.getCard(b)!.columnSince = "2026-10-01T00:00:00.000Z";
  store.getCard(c)!.columnSince = "2026-10-02T00:00:00.000Z";
  const s = sweep();
  await s.run();
  assert.deepEqual(s.passed, [b, c, a, tieX, tieY, none]);
});

void test("each supervise call starts only after the previous one resolved", async () => {
  const board = await newBoard();
  const ids = [
    await lostCard(board, "seq a"),
    await lostCard(board, "seq b"),
    await lostCard(board, "seq c"),
  ];
  let inFlight = 0;
  let peak = 0;
  const trace: string[] = [];
  const s = sweep({
    supervise: async (id) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      trace.push(`start ${id}`);
      await pause(25);
      await makeLive(id);
      trace.push(`end ${id}`);
      inFlight -= 1;
    },
  });
  await s.run();
  assert.equal(peak, 1);
  assert.deepEqual(
    trace,
    ids.flatMap((id) => [`start ${id}`, `end ${id}`]),
  );
});

void test("a memory fail on the second card stops the sweep for it and every later card", async () => {
  const board = await newBoard();
  const [a, b, c] = [
    await lostCard(board, "mem a"),
    await lostCard(board, "mem b"),
    await lostCard(board, "mem c"),
  ];
  recordMemory(8192, 0);
  let samples = 0;
  const passed: string[] = [];
  const lines: string[] = [];
  await resumeLostAtBoot({
    supervise: async (id) => {
      passed.push(id);
      await makeLive(id);
    },
    sample: () => {
      samples += 1;
      if (samples === 2) recordMemory(100, 0);
      return Promise.resolve();
    },
    log: (line) => lines.push(line),
  });
  assert.deepEqual(passed, [a]);
  assert.equal(samples, 2, "no reading after the stop");
  const reason = "free memory 100 MB is below the 1024 MB floor";
  assert.deepEqual(lines, [
    `[supervisor] boot resume ${identifierOf(a)}: resumed`,
    `[supervisor] boot resume ${identifierOf(b)}: skipped: memory-low (${reason})`,
    `[supervisor] boot resume ${identifierOf(c)}: skipped: memory-low (${reason})`,
  ]);
});

void test("a fresh reading is taken before each card, so a missing boot sample does not admit", async () => {
  const board = await newBoard();
  const a = await lostCard(board, "fresh a");
  const s = { passed: [] as string[], lines: [] as string[] };
  await resumeLostAtBoot({
    supervise: (id) => {
      s.passed.push(id);
      return makeLive(id);
    },
    sample: () => {
      recordMemory(50, 0);
      return Promise.resolve();
    },
    log: (line) => s.lines.push(line),
  });
  assert.deepEqual(s.passed, []);
  assert.match(s.lines[0], /skipped: memory-low/);
  assert.equal(store.getCard(a)?.sessionLost, true);
});

void test("at the cap the same board is skipped and another supervised board is still passed", async () => {
  const capped = await newBoard(1);
  const other = await newBoard(1);
  const first = await lostCard(capped, "cap first", { launch: true });
  const second = await lostCard(capped, "cap second", { launch: true });
  const elsewhere = await lostCard(other, "cap elsewhere", { launch: true });
  const s = sweep();
  await s.run();
  assert.deepEqual(s.passed, [first, elsewhere]);
  assert.deepEqual(s.lines, [
    `[supervisor] boot resume ${identifierOf(first)}: resumed`,
    `[supervisor] boot resume ${identifierOf(second)}: skipped: cap (concurrency cap reached: 1 of 1 loops running)`,
    `[supervisor] boot resume ${identifierOf(elsewhere)}: resumed`,
  ]);
});

void test("one log line per candidate: resumed, failed and skipped", async () => {
  const board = await newBoard();
  const ok = await lostCard(board, "log ok");
  const throws = await lostCard(board, "log throws");
  const stays = await lostCard(board, "log stays");
  const lines: string[] = [];
  await resumeLostAtBoot({
    supervise: async (id) => {
      if (id === ok) await makeLive(id);
      if (id === throws) throw new Error("boom");
    },
    sample: () => Promise.resolve(),
    log: (line) => lines.push(line),
  });
  assert.deepEqual(lines, [
    `[supervisor] boot resume ${identifierOf(ok)}: resumed`,
    `[supervisor] boot resume ${identifierOf(throws)}: failed: boom`,
    `[supervisor] boot resume ${identifierOf(stays)}: failed: not resumed`,
  ]);
});

void test("a card held by stop_session, usage_stop or budget is skipped with the reason", async () => {
  const board = await newBoard();
  const held = new Map<string, "budget" | "stop_session" | "usage_stop">();
  for (const reason of ["budget", "stop_session", "usage_stop"] as const) {
    const id = await lostCard(board, `held ${reason}`);
    await store.setSessionStateIfSession(
      id,
      store.getCard(id)!.activeSessionId!,
      "needs_input",
      reason,
    );
    held.set(id, reason);
  }
  const s = sweep();
  await s.run();
  assert.deepEqual(s.passed, []);
  assert.deepEqual(
    s.lines,
    [...held].map(
      ([id, reason]) =>
        `[supervisor] boot resume ${identifierOf(id)}: skipped: held (${reason})`,
    ),
  );
});

void test("the cap gates a launch card but not a plain ticket card", async () => {
  const board = await newBoard(1);
  const running = await lostCard(board, "cap running", { launch: true });
  await makeLive(running);
  const launch = await lostCard(board, "cap launch", { launch: true });
  const plain = await lostCard(board, "cap plain");
  const s = sweep();
  await s.run();
  assert.deepEqual(s.passed, [plain]);
  assert.deepEqual(s.lines, [
    `[supervisor] boot resume ${identifierOf(launch)}: skipped: cap (concurrency cap reached: 1 of 1 loops running)`,
    `[supervisor] boot resume ${identifierOf(plain)}: resumed`,
  ]);
});

void test("a card that left in_progress during the sweep is skipped without a log line", async () => {
  const board = await newBoard();
  const first = await lostCard(board, "moved first");
  const second = await lostCard(board, "moved second");
  const s = sweep({
    supervise: async (id) => {
      await store.moveCardManual(second, "parked");
      await makeLive(id);
    },
  });
  await s.run();
  assert.deepEqual(s.passed, [first]);
  assert.deepEqual(s.lines, [
    `[supervisor] boot resume ${identifierOf(first)}: resumed`,
  ]);
});

void test("a live card whose session sits at needs_input with resume_failed is logged as failed", async () => {
  const board = await newBoard();
  const id = await lostCard(board, "resume failed");
  const s = sweep({
    supervise: async (cardId) => {
      await makeLive(cardId);
      await store.setSessionStateIfSession(
        cardId,
        store.getCard(cardId)!.activeSessionId!,
        "needs_input",
        "resume_failed",
      );
    },
  });
  await s.run();
  assert.deepEqual(s.lines, [
    `[supervisor] boot resume ${identifierOf(id)}: failed: resume_failed`,
  ]);
});
