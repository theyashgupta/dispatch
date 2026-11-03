import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BoardKey,
  Card,
  LoopProgress,
  OrchestratorView,
  Session,
} from "../../../../shared/types.js";
import { centreTree, treeFocusOrder } from "./centre-tree.js";

const BOARD = "CEN" as BoardKey;

function card(id: string, patch: Partial<Card> = {}): Card {
  return {
    id,
    boardKey: BOARD,
    issueId: id,
    identifier: id,
    title: `Title ${id}`,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: "2026-10-08T10:00:00.000Z",
    ...patch,
  };
}

function live(
  id: string,
  patch: Partial<Card> = {},
  session: Partial<Session> = {},
): Card {
  return card(id, {
    activeSessionId: "s1",
    sessions: [
      {
        id: "s1",
        createdAt: "2026-10-08T09:00:00.000Z",
        updatedAt: "2026-10-08T09:00:00.000Z",
        ...session,
      },
    ],
    ...patch,
  });
}

function group(id: string, patch: Partial<Card> = {}): Card {
  return card(id, { source: "group", memberIds: [], ...patch });
}

function record(
  id: string,
  role: "main" | "extra",
  scope: Partial<OrchestratorView["scope"]> = {},
  patch: Partial<OrchestratorView> = {},
): OrchestratorView {
  return {
    id,
    name: `Name ${id}`,
    role,
    scope: { groupIds: [], ticketIds: [], ...scope },
    policyOverride: {},
    cardId: null,
    state: "running",
    createdAt: "2026-10-07T00:00:00.000Z",
    session: null,
    ...patch,
  };
}

function loopOf(unitCount: number) {
  return {
    slug: "auth",
    roadmapFile: "loop.md",
    units: [...Array(unitCount).keys()].map((i) => ({
      number: i + 1,
      ticket: null,
      title: `Unit ${i + 1}`,
      status: "in progress",
      statusText: "",
      branch: null,
      commit: null,
      prdPath: null,
      phaseTotal: 4,
      phases: [],
    })),
    engine: null,
    completion: "running",
    summary: {
      unitsDone: 0,
      unitsTotal: unitCount,
      currentUnit: 1,
      currentPhase: { number: 1, name: "Build" },
      lastGate: null,
    },
    warnings: [],
    readAt: "2026-10-08T12:00:00.000Z",
  } as LoopProgress;
}

const main = record("main", "main");

function groupIds(tree: ReturnType<typeof centreTree>) {
  return tree.orchestrators.map((o) => [o.id, o.groups.map((g) => g.id)]);
}

test("a group an extra lists sits under that extra, another under the main", () => {
  const tree = centreTree({
    cards: [group("G-1"), group("G-2")],
    records: [main, record("x", "extra", { groupIds: ["G-2"] })],
  });
  assert.deepEqual(groupIds(tree), [
    ["main", ["G-1"]],
    ["x", ["G-2"]],
  ]);
});

test("the main comes first and the extras keep record order", () => {
  const tree = centreTree({
    cards: [],
    records: [record("b", "extra"), main, record("a", "extra")],
  });
  assert.deepEqual(
    tree.orchestrators.map((o) => [o.id, o.focusId, o.role]),
    [
      ["main", "orch:main", "main"],
      ["b", "orch:b", "extra"],
      ["a", "orch:a", "extra"],
    ],
  );
});

test("a stale owner on a group does not move it off the main", () => {
  const tree = centreTree({
    cards: [group("G-1", { ownerOrchestrator: "x" })],
    records: [main, record("x", "extra")],
  });
  assert.deepEqual(groupIds(tree), [
    ["main", ["G-1"]],
    ["x", []],
  ]);
});

test("an orchestrator with no groups has an empty group list", () => {
  const tree = centreTree({ cards: [], records: [main] });
  assert.deepEqual(tree.orchestrators[0].groups, []);
  assert.deepEqual(tree.edges, []);
});

test("an orchestrator card, a shipped group, a member and a plain ticket make no node", () => {
  const tree = centreTree({
    cards: [
      group("G-hidden", { source: "orchestrator" }),
      group("G-done", { column: "done" }),
      group("G-flow", { shipFlow: { state: "done" } as Card["shipFlow"] }),
      live("member-1", { groupId: "G-1" }),
      live("ticket-1"),
      group("G-1"),
    ],
    records: [main],
  });
  assert.deepEqual(groupIds(tree), [["main", ["G-1"]]]);
});

test("groups of one orchestrator sort by identifier numerically, then id", () => {
  const tree = centreTree({
    cards: [
      group("c", { identifier: "GRP-10" }),
      group("b", { identifier: "GRP-2" }),
      group("a", { identifier: "GRP-2" }),
    ],
    records: [main],
  });
  assert.deepEqual(groupIds(tree), [["main", ["a", "b", "c"]]]);
});

test("unitCount is the loop unit count, else 0", () => {
  const tree = centreTree({
    cards: [group("G-1", { loopProgress: loopOf(3) }), group("G-2")],
    records: [main],
  });
  assert.deepEqual(
    tree.orchestrators[0].groups.map((g) => [g.id, g.unitCount]),
    [
      ["G-1", 3],
      ["G-2", 0],
    ],
  );
});

test("a group status carries the session state only while a session is live", () => {
  const tree = centreTree({
    cards: [
      live("G-1", { source: "group", state: "working" }),
      live("G-2", { source: "group", column: "agent_done" }),
      group("G-3"),
    ],
    records: [main],
  });
  assert.deepEqual(
    tree.orchestrators[0].groups.map((g) => [g.id, g.status, g.dashed]),
    [
      [
        "G-1",
        {
          state: "running",
          sessionState: "working",
          label: "Running",
          tone: "neutral",
        },
        false,
      ],
      [
        "G-2",
        {
          state: "done",
          sessionState: null,
          label: "Agent done",
          tone: "success",
        },
        false,
      ],
      [
        "G-3",
        {
          state: "planned",
          sessionState: null,
          label: "Planned",
          tone: "muted",
        },
        true,
      ],
    ],
  );
});

const SPECIALISED_ROWS = [
  {
    name: "budget",
    state: "needs_input",
    stateReason: "budget",
    label: "Budget reached",
  },
  {
    name: "usage stop",
    state: "needs_input",
    stateReason: "usage_stop",
    label: "Usage limit",
  },
  {
    name: "usage limit dialog",
    state: "usage_limit_dialog",
    stateReason: undefined,
    label: "Usage limit",
  },
  {
    name: "resume failed",
    state: "working",
    stateReason: "resume_failed",
    label: "Resume failed",
  },
] as const;

for (const row of SPECIALISED_ROWS) {
  test(`a ${row.name} group shows its label and no session state`, () => {
    const tree = centreTree({
      cards: [
        live(
          "G-1",
          { source: "group" },
          { state: row.state, stateReason: row.stateReason },
        ),
      ],
      records: [main],
    });
    const [g] = tree.orchestrators[0].groups;
    assert.equal(g.status.sessionState, null);
    assert.equal(g.status.label, row.label);
  });
}

test("a stale group carries its session state with the session label", () => {
  const tree = centreTree({
    cards: [live("G-1", { source: "group" }, { state: "stale" })],
    records: [main],
  });
  const [g] = tree.orchestrators[0].groups;
  assert.equal(g.status.sessionState, "stale");
  assert.equal(g.status.label, "No progress");
});

test("a plain needs input group carries the needs input session state", () => {
  const tree = centreTree({
    cards: [live("G-1", { source: "group" }, { state: "needs_input" })],
    records: [main],
  });
  const [g] = tree.orchestrators[0].groups;
  assert.equal(g.status.sessionState, "needs_input");
  assert.equal(g.status.label, "Needs input");
});

test("an orchestrator status reads its session, and a stopped one reads Stopped", () => {
  const session = { state: "working" } as OrchestratorView["session"];
  const tree = centreTree({
    cards: [],
    records: [
      record("main", "main", {}, { session }),
      record("x", "extra", {}, { state: "stopped", session }),
      record("y", "extra", {}, { state: "stopping", session }),
      record("z", "extra", {}, { session: null }),
    ],
  });
  assert.deepEqual(
    tree.orchestrators.map((o) => o.status),
    [
      {
        state: null,
        sessionState: "working",
        label: "Working",
        tone: "neutral",
      },
      { state: null, sessionState: null, label: "Stopped", tone: "muted" },
      { state: null, sessionState: null, label: "Stopping", tone: "muted" },
      { state: null, sessionState: null, label: "Starting", tone: "neutral" },
    ],
  );
});

test("edges follow the tree order and the focus order lists each orchestrator then its groups", () => {
  const tree = centreTree({
    cards: [
      group("G-2"),
      group("G-1", { launch: { direction: "go" } }),
      live("G-3", { source: "group" }),
    ],
    records: [record("x", "extra", { groupIds: ["G-2"] }), main],
  });
  assert.deepEqual(tree.edges, [
    { from: "main", to: "G-1", dashed: true },
    { from: "main", to: "G-3", dashed: false },
    { from: "x", to: "G-2", dashed: true },
  ]);
  assert.deepEqual(treeFocusOrder(tree), [
    "orch:main",
    "G-1",
    "G-3",
    "orch:x",
    "G-2",
  ]);
});

test("the focus order matches a one-group-each tree", () => {
  const tree = centreTree({
    cards: [group("G-1"), group("G-2")],
    records: [main, record("x", "extra", { groupIds: ["G-2"] })],
  });
  assert.deepEqual(treeFocusOrder(tree), ["orch:main", "G-1", "orch:x", "G-2"]);
});
