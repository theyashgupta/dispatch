import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey, Card } from "../../../../shared/types.js";
import {
  centreGraph,
  type BandKey,
  type CentreBranch,
  type CentreGraph,
} from "./centre-graph.js";
import {
  focusOrder,
  isFocusKey,
  isPlainEnter,
  nextFocus,
} from "./centre-focus.js";

function branch(id: string, band: BandKey, slot: number): CentreBranch {
  return {
    id,
    cardId: id,
    identifier: id,
    title: id,
    state: "running",
    label: "Running",
    tone: "neutral",
    band,
    actions: ["open"],
    detail: null,
    contextPercent: null,
    cost: null,
    playbook: null,
    planOrder: null,
    planSize: null,
    memberCount: null,
    stateSince: null,
    slot,
  };
}

function graphOf(branches: CentreBranch[]): CentreGraph {
  const keys: BandKey[] = ["needs_you", "running", "planned", "done"];
  return {
    centre: null,
    branches,
    bands: keys.map((key) => {
      const own = branches.filter((b) => b.band === key);
      return { key, label: key, branches: own, count: own.length };
    }),
    edges: [],
  };
}

const ORDER = ["centre", "A", "B", "C"];

test("down from the node goes to the first tile", () => {
  assert.equal(nextFocus(ORDER, "centre", "ArrowDown"), "A");
});

test("down from the last tile stays on it", () => {
  assert.equal(nextFocus(ORDER, "C", "ArrowDown"), "C");
});

test("down from a middle tile goes to the next tile", () => {
  assert.equal(nextFocus(ORDER, "A", "ArrowDown"), "B");
});

test("up from the first tile goes to the node", () => {
  assert.equal(nextFocus(ORDER, "A", "ArrowUp"), "centre");
});

test("up from the node stays on it", () => {
  assert.equal(nextFocus(ORDER, "centre", "ArrowUp"), "centre");
});

test("Home goes to the node from any tile", () => {
  assert.equal(nextFocus(ORDER, "B", "Home"), "centre");
});

test("End goes to the last tile from any place", () => {
  assert.equal(nextFocus(ORDER, "centre", "End"), "C");
  assert.equal(nextFocus(ORDER, "B", "End"), "C");
});

test("an empty branch list keeps focus on the node for every key", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"] as const) {
    assert.equal(nextFocus(["centre"], "centre", key), "centre");
  }
});

test("a current id that is not in the order goes to the node", () => {
  assert.equal(nextFocus(ORDER, "gone", "ArrowDown"), "centre");
  assert.equal(nextFocus(ORDER, "gone", "End"), "centre");
});

test("the focus order lists the node, then the branches in band order", () => {
  const graph = graphOf([
    branch("D1", "done", 0),
    branch("R1", "running", 1),
    branch("N1", "needs_you", 2),
    branch("R2", "running", 3),
  ]);
  assert.deepEqual(focusOrder(graph), ["centre", "N1", "R1", "R2", "D1"]);
});

test("a graph with no branch has only the node in its focus order", () => {
  assert.deepEqual(focusOrder(graphOf([])), ["centre"]);
});

test("only the four navigation keys are focus keys", () => {
  assert.equal(isFocusKey("Home"), true);
  assert.equal(isFocusKey("Enter"), false);
  assert.equal(isFocusKey("ArrowLeft"), false);
});

test("a shipped branch is not in the focus order", () => {
  const NOW = Date.parse("2026-10-08T12:00:00.000Z");
  const group = (id: string, patch: Partial<Card>): Card => ({
    id,
    boardKey: "CEN" as BoardKey,
    issueId: id,
    identifier: id,
    title: id,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: "2026-10-08T10:00:00.000Z",
    source: "group",
    memberIds: [],
    ...patch,
  });
  const input = {
    cards: [
      group("G-1", {}),
      group("G-2", {
        column: "done",
        columnSince: "2026-10-08T11:00:00.000Z",
      }),
    ],
    records: [
      {
        id: "main",
        name: "Main",
        role: "main" as const,
        scope: { groupIds: [], ticketIds: [] },
        policyOverride: {},
        cardId: null,
        state: "running" as const,
        createdAt: "2026-10-07T00:00:00.000Z",
        session: null,
      },
    ],
    selectedId: "main",
    decisions: [],
    now: NOW,
  };
  assert.deepEqual(focusOrder(centreGraph(input)), ["centre", "G-1"]);
});

test("only Enter with no modifier is a plain Enter", () => {
  const none = {
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  };
  assert.equal(isPlainEnter({ key: "Enter", ...none }), true);
  for (const modifier of [
    "shiftKey",
    "ctrlKey",
    "altKey",
    "metaKey",
  ] as const) {
    assert.equal(
      isPlainEnter({ key: "Enter", ...none, [modifier]: true }),
      false,
    );
  }
  assert.equal(isPlainEnter({ key: " ", ...none }), false);
  assert.equal(isPlainEnter({ key: "ArrowDown", ...none }), false);
});
