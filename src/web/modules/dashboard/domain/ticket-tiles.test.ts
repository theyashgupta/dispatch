import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Card,
  Column,
  LoopGate,
  LoopProgress,
  LoopUnit,
} from "../../../../shared/types.js";
import {
  leftOnBoard,
  ticketTiles,
  tileState,
  TILE_STATE_ORDER,
} from "./ticket-tiles.js";

const UNIT: LoopUnit = {
  number: 1,
  ticket: null,
  title: "unit",
  status: "in progress",
  statusText: "",
  branch: null,
  commit: null,
  prdPath: null,
  phaseTotal: null,
  phases: [],
};

function loop(lastGate: LoopGate | null): LoopProgress {
  return {
    slug: "demo",
    roadmapFile: "ROADMAP.md",
    units: [UNIT],
    engine: null,
    completion: "running",
    summary: {
      unitsDone: 0,
      unitsTotal: 1,
      currentUnit: 1,
      currentPhase: null,
      lastGate,
    },
    warnings: [],
    readAt: "2026-10-07T12:00:00Z",
  };
}

const failGate: LoopGate = {
  unit: 1,
  phase: 2,
  result: "fail",
  at: "2026-10-07T10:30:00Z",
};

function card(
  identifier: string,
  column: Column,
  extra: Partial<Card> = {},
): Card {
  return {
    id: `id-${identifier}`,
    identifier,
    title: `Title ${identifier}`,
    column,
    ...extra,
  } as Card;
}

const UTC = { timeZone: "UTC" };

test("every column maps to its tile state", () => {
  const expected: [Column, string][] = [
    ["needs_input", "needs_input"],
    ["in_progress", "current"],
    ["todo", "not_started"],
    ["parked", "not_started"],
    ["inbox", "not_started"],
    ["agent_done", "done"],
    ["in_review", "done"],
    ["done", "done"],
  ];
  for (const [column, state] of expected) {
    assert.equal(tileState(card("A-1", column)), state, column);
  }
});

test("a start error, a lost session or a failed gate is stuck whatever the column", () => {
  const startError = { stderr: "x" } as unknown as Card["startError"];
  assert.equal(tileState(card("A-1", "in_progress", { startError })), "stuck");
  assert.equal(
    tileState(card("A-1", "needs_input", { sessionLost: true })),
    "stuck",
  );
  assert.equal(
    tileState(card("A-1", "done", { loopProgress: loop(failGate) })),
    "stuck",
  );
  assert.equal(
    tileState(
      card("A-1", "in_progress", {
        loopProgress: loop({ ...failGate, result: "pass" }),
        sessionLost: false,
      }),
    ),
    "current",
  );
});

test("the pill reads the stuck reason in the order start error, session lost, gate", () => {
  const startError = { stderr: "x" } as unknown as Card["startError"];
  const loopProgress = loop(failGate);
  assert.equal(
    ticketTiles(
      [card("A-1", "todo", { startError, sessionLost: true, loopProgress })],
      UTC,
    )[0]?.pill,
    "Stuck: start failed",
  );
  assert.equal(
    ticketTiles(
      [card("A-1", "todo", { sessionLost: true, loopProgress })],
      UTC,
    )[0]?.pill,
    "Stuck: session lost",
  );
  assert.equal(
    ticketTiles([card("A-1", "todo", { loopProgress })], UTC)[0]?.pill,
    "Stuck: gate failed",
  );
});

test("a card that is not stuck shows its column label", () => {
  assert.deepEqual(
    ticketTiles(
      [card("A-1", "in_progress"), card("A-2", "needs_input")],
      UTC,
    ).map((t) => t.pill),
    ["Needs Input", "In Progress"],
  );
});

test("progress is the loop percent or null without a loop", () => {
  const tiles = ticketTiles(
    [
      card("A-1", "in_progress", { loopProgress: loop(null) }),
      card("A-2", "in_progress"),
    ],
    UTC,
  );
  assert.deepEqual(
    tiles.map((t) => t.progress),
    [0, null],
  );
});

test("the footer joins the gate text, the dependencies and the shipped time", () => {
  const cards = [
    card("A-1", "todo"),
    card("A-2", "todo"),
    card("A-3", "done", {
      dependsOn: ["id-A-1", "id-A-2", "ghost"],
      columnSince: "2026-10-07T14:25:00Z",
      loopProgress: loop({ ...failGate, result: "pass" }),
    }),
  ];
  assert.equal(
    ticketTiles(cards, UTC).find((t) => t.identifier === "A-3")?.footer,
    "Phase 2 gate passed 10:30, Depends on A-1, A-2, ghost, Shipped 14:25",
  );
});

test("a failed gate footer carries the attempt text", () => {
  assert.equal(
    ticketTiles(
      [card("A-1", "in_progress", { loopProgress: loop(failGate) })],
      UTC,
    )[0]?.footer,
    "Phase 2 gate failed 10:30, attempt 1",
  );
});

test("the footer is null with no part, and Shipped needs a parsable columnSince", () => {
  const tiles = ticketTiles(
    [
      card("A-1", "todo", { dependsOn: [] }),
      card("A-2", "done"),
      card("A-3", "done", { columnSince: "garbage" }),
      card("A-4", "in_review", { columnSince: "2026-10-07T14:25:00Z" }),
    ],
    UTC,
  );
  assert.deepEqual(
    tiles.map((t) => t.footer),
    [null, null, null, null],
  );
});

test("tiles sort by state order, then by identifier numerically", () => {
  const startError = { stderr: "x" } as unknown as Card["startError"];
  const tiles = ticketTiles(
    [
      card("A-10", "done"),
      card("A-2", "todo"),
      card("A-9", "in_progress"),
      card("A-10b", "todo"),
      card("A-3", "needs_input"),
      card("A-11", "todo", { startError }),
      card("A-1", "todo"),
    ],
    UTC,
  );
  assert.deepEqual(
    tiles.map((t) => t.identifier),
    ["A-11", "A-3", "A-9", "A-1", "A-2", "A-10b", "A-10"],
  );
  assert.deepEqual(TILE_STATE_ORDER, [
    "stuck",
    "needs_input",
    "current",
    "not_started",
    "done",
  ]);
});

test("a tile carries the card id, identifier and title", () => {
  assert.deepEqual(
    ticketTiles([card("A-1", "todo")], UTC).map((t) => [
      t.cardId,
      t.identifier,
      t.title,
    ]),
    [["id-A-1", "A-1", "Title A-1"]],
  );
});

test("leftOnBoard drops agent_done, in_review and done and sorts like the tiles", () => {
  const items = leftOnBoard([
    card("A-5", "done"),
    card("A-6", "agent_done"),
    card("A-7", "in_review"),
    card("A-4", "parked"),
    card("A-3", "in_progress"),
    card("A-2", "needs_input", { sessionLost: true }),
    card("A-1", "inbox"),
  ]);
  assert.deepEqual(items, [
    { cardId: "id-A-2", identifier: "A-2", state: "stuck" },
    { cardId: "id-A-3", identifier: "A-3", state: "current" },
    { cardId: "id-A-1", identifier: "A-1", state: "not_started" },
    { cardId: "id-A-4", identifier: "A-4", state: "not_started" },
  ]);
});

test("the stuck claim follows the shared attention rule", () => {
  const cleanupBlocked = [{ repo: "api", count: 1 }];
  assert.equal(tileState(card("A-1", "done", { sessionLost: true })), "done");
  assert.equal(tileState(card("A-1", "done", { cleanupBlocked })), "stuck");
  assert.equal(
    ticketTiles([card("A-1", "done", { cleanupBlocked })], UTC)[0]?.pill,
    "Stuck: cleanup blocked",
  );
});
