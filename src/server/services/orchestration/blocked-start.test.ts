import test, { after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, Card } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { DISPATCH_DATA_DIR } = await import("../../store/data-dir.js");
assert.notEqual(
  path.resolve(DISPATCH_DATA_DIR),
  path.join(os.userInfo().homedir, ".dispatch"),
  "test bound to the live board.db",
);
const { recordMemory } = await import("../../test-support/memory-fixtures.js");
const { store } = await import("../../store/board.store.js");
const { tempRepoWithWorkspace } =
  await import("../../test-support/git-fixtures.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { seedPlaybooks } = await import("../infra/playbooks.js");
const { setBoardPolicy } = await import("./boards.js");
const { sessionStarter } = await import("./start-session.js");
const { RETRY_MS, startUnblockedCards } = await import("./blocked-start.js");

const PLAYBOOK = "Write code directly";
const fixture = await tempRepoWithWorkspace();
const starts: {
  id: string;
  extraDirection: string;
  playbook: string | undefined;
}[] = [];
sessionStarter.start = (id, extraDirection, _config, opts) => {
  store.beginStart(id);
  starts.push({ id, extraDirection, playbook: opts?.playbook });
  return Promise.resolve();
};

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await seedPlaybooks();

let boardCount = 0;
async function newBoard(cap = 3): Promise<BoardKey> {
  const key = parseBoardKey(
    `TB${"ABCDEFGHIJKLMNOP"[boardCount++]}`,
  ) as BoardKey;
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [
      { path: fixture.repo, baseBranch: "main", checkCommand: "" },
    ],
    linearTeamKeys: [],
  });
  await setBoardPolicy(key, {
    ...store.getBoard(key)!.policy,
    concurrencyCap: cap,
  });
  return key;
}

async function ticket(board: BoardKey): Promise<Card> {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return store.createLocalCard(board, "ticket", "");
}

async function blockedBy(card: Card, ...blockers: (Card | string)[]) {
  await store.setBlockedBy(
    card.id,
    blockers.map((b) => (typeof b === "string" ? b : b.id)),
  );
}

const done = async (card: Card) => {
  await store.moveCardManual(card.id, "done");
};

const startedIds = () => starts.map((s) => s.id);
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Yield to the event loop until `done` holds, at most 500 turns.
 *
 * @remarks A retry sweep runs over several awaited store writes, so a fixed number of turns is
 * flaky under load; mocked `setTimeout` rules out a wall-clock wait.
 */
async function settleUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !done(); i++) await settle();
}

async function sweepLogs(board: BoardKey): Promise<string[]> {
  const lines: string[] = [];
  const log = mock.method(console, "log", (line: string) => lines.push(line));
  try {
    await startUnblockedCards(board);
  } finally {
    log.mock.restore();
  }
  return lines;
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  recordMemory(100_000, 0);
  starts.length = 0;
});

after(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  env.cleanup();
});

void test("a full cap starts the first blocked card, holds the next, and a timer retries it once a slot frees", async () => {
  const board = await newBoard(1);
  const a = await ticket(board);
  const c = await ticket(board);
  const b = await ticket(board);
  await blockedBy(b, a);
  await blockedBy(c, a);
  await done(a);
  mock.timers.enable({ apis: ["setTimeout"] });

  const lines = await sweepLogs(board);

  assert.deepEqual(startedIds(), [b.id]);
  assert.ok(
    lines.some((l) => l.startsWith(`[blocked-start] ${c.identifier} waits:`)),
  );

  await store.moveCardManual(b.id, "done");
  store.endStart(b.id);
  mock.timers.tick(RETRY_MS - 1);
  await settle();
  assert.deepEqual(startedIds(), [b.id]);
  mock.timers.tick(1);
  await settleUntil(() => startedIds().length === 2);
  assert.deepEqual(startedIds(), [b.id, c.id]);
});

void test("a card with one open blocker of two does not start", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const d = await ticket(board);
  const b = await ticket(board);
  await blockedBy(b, a, d);
  await done(a);
  await startUnblockedCards(board);
  assert.deepEqual(startedIds(), []);
});

void test("a missing blocker id does not start the card", async () => {
  const board = await newBoard();
  const b = await ticket(board);
  await blockedBy(b, "no-such-card");
  await startUnblockedCards(board);
  assert.deepEqual(startedIds(), []);
});

void test("an Inbox card and a paused card with done blockers do not start", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const inbox = await ticket(board);
  const paused = await ticket(board);
  await blockedBy(inbox, a);
  await blockedBy(paused, a);
  await done(a);
  await store.moveCardManual(inbox.id, "inbox");
  Object.assign(store.getCard(paused.id)!, {
    paused: {
      by: "user",
      at: new Date().toISOString(),
      sessionId: "s",
      pids: [],
    },
  });
  await startUnblockedCards(board);
  assert.deepEqual(startedIds(), []);
});

void test("the memory guard holds a ready card in To Do and a timer starts it once memory is back", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const b = await ticket(board);
  await blockedBy(b, a);
  await done(a);
  recordMemory(10, 0);
  mock.timers.enable({ apis: ["setTimeout"] });

  const lines = await sweepLogs(board);

  assert.deepEqual(startedIds(), []);
  assert.equal(store.getCard(b.id)?.column, "todo");
  assert.ok(
    lines.some((l) => l.startsWith(`[blocked-start] ${b.identifier} waits:`)),
  );

  recordMemory(100_000, 0);
  mock.timers.tick(RETRY_MS - 1);
  await settle();
  assert.deepEqual(startedIds(), []);
  mock.timers.tick(1);
  await settleUntil(() => startedIds().length === 1);
  assert.deepEqual(startedIds(), [b.id]);
});

void test("a memory wait stops the sweep before a second ready card", async () => {
  const board = await newBoard(3);
  const a = await ticket(board);
  const b = await ticket(board);
  const c = await ticket(board);
  await blockedBy(b, a);
  await blockedBy(c, a);
  await done(a);
  recordMemory(10, 0);
  mock.timers.enable({ apis: ["setTimeout"] });

  const lines = await sweepLogs(board);

  assert.deepEqual(startedIds(), []);
  assert.equal(lines.filter((l) => l.includes("waits:")).length, 1);
  assert.equal(store.getCard(b.id)?.column, "todo");
  assert.equal(store.getCard(c.id)?.column, "todo");

  recordMemory(100_000, 0);
  mock.timers.tick(RETRY_MS);
  await settleUntil(() => startedIds().length === 2);
  assert.deepEqual(startedIds().sort(), [b.id, c.id].sort());
});

void test("the launch record uses the card playbook, then the board group playbook, then none", async () => {
  const board = await newBoard();
  await setBoardPolicy(board, {
    ...store.getBoard(board)!.policy,
    groupPlaybook: PLAYBOOK,
  });
  const a = await ticket(board);
  const fromCard = await ticket(board);
  const fromBoard = await ticket(board);
  const ghost = await ticket(board);
  for (const card of [fromCard, fromBoard, ghost]) await blockedBy(card, a);
  await store.setOrchestratorFields(fromCard.id, {
    launch: { playbook: PLAYBOOK, direction: "from the card" },
  });
  await store.setOrchestratorFields(ghost.id, {
    launch: { playbook: "no such playbook", direction: "ghost" },
  });
  await done(a);

  await startUnblockedCards(board);

  assert.deepEqual(store.getCard(fromCard.id)?.launch, {
    playbook: PLAYBOOK,
    direction: "from the card",
  });
  assert.deepEqual(store.getCard(fromBoard.id)?.launch, {
    playbook: PLAYBOOK,
    direction: "",
  });
  assert.deepEqual(store.getCard(ghost.id)?.launch, {
    playbook: PLAYBOOK,
    direction: "ghost",
  });
  assert.equal(starts.length, 3);
  assert.equal(
    store.getCard(fromBoard.id)?.workspace?.folder,
    path.dirname(fixture.repo),
  );
  assert.equal(store.getCard(fromCard.id)?.ownerOrchestrator, undefined);
});

void test("with no playbook anywhere the launch record holds the direction only", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const b = await ticket(board);
  await blockedBy(b, a);
  await done(a);
  await startUnblockedCards(board);
  assert.deepEqual(store.getCard(b.id)?.launch, { direction: "" });
  assert.equal(starts[0]?.playbook, undefined);
});

void test("a sweep that leaves nothing waiting arms no timer", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const b = await ticket(board);
  await blockedBy(b, a);
  await done(a);
  mock.timers.enable({ apis: ["setTimeout"] });
  await startUnblockedCards(board);
  assert.deepEqual(startedIds(), [b.id]);
  mock.timers.tick(RETRY_MS);
  await settle();
  await settle();
  assert.deepEqual(startedIds(), [b.id]);
});

async function ownWithCap(board: BoardKey, cap: number, ...cards: Card[]) {
  await store.setBoardOrchestrators(board, [
    {
      id: "extra-1",
      name: "Extra",
      role: "extra",
      cardId: null,
      state: "stopped",
      createdAt: "2026-10-08T00:00:00.000Z",
      scope: { groupIds: [], ticketIds: cards.map((c) => c.id) },
      policyOverride: { concurrencyCap: cap },
    },
  ]);
}

void test("a card in the scope of an extra orchestrator obeys its lower concurrency cap", async () => {
  const board = await newBoard(3);
  const a = await ticket(board);
  const b = await ticket(board);
  const c = await ticket(board);
  await blockedBy(b, a);
  await blockedBy(c, a);
  await done(a);
  await ownWithCap(board, 1, b, c);
  mock.timers.enable({ apis: ["setTimeout"] });

  const lines = await sweepLogs(board);

  assert.deepEqual(startedIds(), [c.id]);
  assert.ok(
    lines.some((l) => l.startsWith(`[blocked-start] ${b.identifier} waits:`)),
  );
});

void test("a cap wait on one card still lets the sweep reach a card of another owner", async () => {
  const board = await newBoard(3);
  const a = await ticket(board);
  const d = await ticket(board);
  const b = await ticket(board);
  const c = await ticket(board);
  for (const card of [b, c, d]) await blockedBy(card, a);
  await done(a);
  await ownWithCap(board, 1, b, c);
  mock.timers.enable({ apis: ["setTimeout"] });

  const lines = await sweepLogs(board);

  assert.deepEqual(startedIds(), [c.id, d.id]);
  assert.ok(
    lines.some((l) => l.startsWith(`[blocked-start] ${b.identifier} waits:`)),
  );
});

void test("a ready card with a start error does not start", async () => {
  const board = await newBoard();
  const a = await ticket(board);
  const b = await ticket(board);
  await blockedBy(b, a);
  await done(a);
  Object.assign(store.getCard(b.id)!, {
    startError: { step: "creating worktrees", stderr: "boom" },
  });
  await startUnblockedCards(board);
  assert.deepEqual(startedIds(), []);
});
