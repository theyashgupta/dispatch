import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Card } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import { ValidationError } from "../domain/errors.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { reportLoopGate } = await import("./loop-report.js");

const ENTRY = { cardId: "card-1", sessionId: "session-1" };
const REPORT = {
  kind: "phase",
  unit: 2,
  phase: 5,
  result: "pass",
  note: "ok",
} as const;

afterEach(() => {
  setBoardRepository(store);
});

function card(overrides: Partial<Card>): Card {
  return {
    id: "card-1",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "card-1",
    identifier: "GROUP-1",
    title: "Group",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-10-06T00:00:00Z",
    source: "group",
    ...overrides,
  };
}

function install(found: Card | undefined): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  setBoardRepository(
    fakeBoardRepository({
      getCard: () => found,
      appendOrchestrationEvent: (event) => {
        events.push({ ...event });
        return undefined as never;
      },
    }),
  );
  return events;
}

void test("a group card appends exactly one loop_gate event with the report", () => {
  const events = install(
    card({ boardKey: parseBoardKey("BRD7") ?? DEFAULT_BOARD_KEY }),
  );

  reportLoopGate(ENTRY, REPORT);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.boardKey, "BRD7");
  assert.equal(events[0]?.cardId, "card-1");
  assert.equal(events[0]?.sessionId, "session-1");
  assert.equal(events[0]?.kind, "loop_gate");
  assert.deepEqual(events[0]?.data, REPORT);
});

void test("a card without a board key uses the default board key", () => {
  const events = install(card({}));

  reportLoopGate(ENTRY, REPORT);

  assert.equal(events[0]?.boardKey, DEFAULT_BOARD_KEY);
});

void test("a non group card throws not-group-card and appends nothing", () => {
  const events = install(card({ source: "linear" }));

  assert.throws(
    () => reportLoopGate(ENTRY, REPORT),
    (error: unknown) =>
      error instanceof ValidationError && error.code === "not-group-card",
  );
  assert.equal(events.length, 0);
});

void test("an unknown card id throws not-group-card and appends nothing", () => {
  const events = install(undefined);

  assert.throws(
    () => reportLoopGate(ENTRY, REPORT),
    (error: unknown) =>
      error instanceof ValidationError && error.code === "not-group-card",
  );
  assert.equal(events.length, 0);
});
