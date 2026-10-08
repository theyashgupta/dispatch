import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  LoopProgress,
  OrchestrationEvent,
} from "../../shared/types.js";

isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

const ACME = parseBoardKey("ACME") as BoardKey;
await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: "/acme/sessions",
  repositories: [],
  linearTeamKeys: [],
});

async function groupOn(board: BoardKey, title: string) {
  const a = await store.createLocalCard(board, `${title} a`, "");
  const result = await store.createGroupCard(board, title, [a.id]);
  assert.ok(result.ok);
  return result.card.id;
}

const acmeGroup = await groupOn(ACME, "acme group");
const localGroup = await groupOn(DEFAULT_BOARD_KEY, "local group");

function progress(readAt: string, unitsDone = 0): LoopProgress {
  return {
    slug: "g18",
    roadmapFile: "unit-plan.md",
    units: [],
    engine: null,
    completion: "running",
    summary: {
      unitsDone,
      unitsTotal: 3,
      currentUnit: 1,
      currentPhase: null,
      lastGate: null,
    },
    warnings: [],
    readAt,
  };
}

function storedOn(board: BoardKey, id: string) {
  return store.snapshot(board).cards.find((c) => c.id === id)?.loopProgress;
}

function countChanges(): { count: () => number; stop: () => void } {
  let n = 0;
  const onChange = () => n++;
  store.on("change", onChange);
  return {
    count: () => n,
    stop: () => store.off("change", onChange),
  };
}

void test("a first progress value is stored, shows in the snapshot and fires one change", async () => {
  const changes = countChanges();
  await store.setLoopProgress(acmeGroup, progress("2026-10-06T00:00:00.000Z"));
  changes.stop();
  assert.equal(changes.count(), 1);
  assert.equal(storedOn(ACME, acmeGroup)?.readAt, "2026-10-06T00:00:00.000Z");
  assert.equal(storedOn(ACME, acmeGroup)?.summary.unitsTotal, 3);
});

void test("a value that differs only in readAt fires no change and keeps the stored readAt", async () => {
  const changes = countChanges();
  await store.setLoopProgress(acmeGroup, progress("2026-10-06T01:00:00.000Z"));
  changes.stop();
  assert.equal(changes.count(), 0);
  assert.equal(storedOn(ACME, acmeGroup)?.readAt, "2026-10-06T00:00:00.000Z");
});

void test("a value that differs in content is stored and fires one change", async () => {
  const changes = countChanges();
  await store.setLoopProgress(
    acmeGroup,
    progress("2026-10-06T02:00:00.000Z", 1),
  );
  changes.stop();
  assert.equal(changes.count(), 1);
  assert.equal(storedOn(ACME, acmeGroup)?.summary.unitsDone, 1);
});

void test("an unknown card id is a no-op", async () => {
  const changes = countChanges();
  await store.setLoopProgress("NOPE-1", progress("2026-10-06T03:00:00.000Z"));
  changes.stop();
  assert.equal(changes.count(), 0);
});

void test("the card on another board is not in the default board snapshot", () => {
  assert.equal(
    store.snapshot(DEFAULT_BOARD_KEY).cards.some((c) => c.id === acmeGroup),
    false,
  );
  assert.equal(storedOn(DEFAULT_BOARD_KEY, localGroup), undefined);
});

void test("appendOrchestrationEvent emits exactly one orchestration event with the returned row", () => {
  const seen: OrchestrationEvent[] = [];
  const onEvent = (event: OrchestrationEvent) => seen.push(event);
  store.on("orchestration", onEvent);
  let row: OrchestrationEvent;
  try {
    row = store.appendOrchestrationEvent({
      boardKey: ACME,
      cardId: acmeGroup,
      sessionId: null,
      kind: "loop_gate",
      data: { unit: 1 },
      ts: "2026-10-06T04:00:00.000Z",
    });
  } finally {
    store.off("orchestration", onEvent);
  }
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], row);
  assert.deepEqual(store.listOrchestrationEvents(ACME, 0, 10), [row]);
});

void test("listing after the highest id returns no rows", () => {
  const rows = store.listOrchestrationEvents(ACME, 0, 10);
  const last = rows.at(-1)?.id;
  assert.ok(last !== undefined);
  assert.deepEqual(store.listOrchestrationEvents(ACME, last, 10), []);
});
