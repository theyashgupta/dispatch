import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BoardKey,
  Card,
  DecisionItem,
  LoopProgress,
  OrchestratorView,
  PlanEntry,
  Session,
  ShipFlow,
} from "../../../../shared/types.js";
import {
  centreGraph,
  type CentreBranch,
  type CentreGraphInput,
} from "./centre-graph.js";

const BOARD = "CEN" as BoardKey;
const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const HOUR = 3_600_000;

function iso(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * HOUR).toISOString();
}

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

const main = record("main", "main");
const infra = record("infra", "extra", {
  groupIds: ["GRP-1"],
  ticketIds: ["CEN-5"],
});

function entry(ref: string, order: number, size: PlanEntry["size"] = "small") {
  return { ref, playbook: `pb-${ref}`, order, size };
}

function plan(
  id: string,
  createdAt: string,
  entries: PlanEntry[],
  patch: Partial<DecisionItem> = {},
): DecisionItem {
  return {
    id,
    boardKey: BOARD,
    cardId: null,
    orchestratorId: "main",
    kind: "plan",
    question: "Approve the plan?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Reject" },
    ],
    recommendedOptionId: "approve",
    state: "open",
    answer: null,
    createdAt,
    answeredAt: null,
    plan: { entries },
    ...patch,
  };
}

function graph(patch: Partial<CentreGraphInput> = {}) {
  return centreGraph({
    cards: [],
    records: [main],
    selectedId: null,
    decisions: [],
    now: NOW,
    showOlderShipped: false,
    ...patch,
  });
}

const ids = (branches: readonly CentreBranch[]) => branches.map((b) => b.id);

const shipDone = { state: "done", finishedAt: iso(2) } as ShipFlow;

test("no orchestrator gives no centre, no branches and five empty bands", () => {
  const result = graph({
    cards: [group("GRP-1")],
    records: [],
    decisions: [plan("p", iso(1), [entry("CEN-1", 1)])],
  });
  assert.equal(result.centre, null);
  assert.deepEqual(result.branches, []);
  assert.deepEqual(result.edges, []);
  assert.equal(result.hiddenShipped, 0);
  assert.deepEqual(
    result.bands.map((b) => [b.key, b.label, b.count, b.branches.length]),
    [
      ["needs_you", "Needs you", 0, 0],
      ["running", "Running", 0, 0],
      ["planned", "Planned", 0, 0],
      ["done", "Done", 0, 0],
      ["shipped", "Shipped", 0, 0],
    ],
  );
});

test("the selected orchestrator is the one named, else the main", () => {
  const records = [main, infra];
  assert.equal(graph({ records, selectedId: "infra" }).centre?.id, "infra");
  assert.equal(graph({ records, selectedId: null }).centre?.id, "main");
  assert.equal(graph({ records, selectedId: "gone" }).centre?.id, "main");
  assert.equal(graph({ records: [infra], selectedId: null }).centre, null);
});

test("an extra orchestrator shows only the cards it owns", () => {
  const cards = [
    group("GRP-1"),
    group("GRP-2"),
    card("CEN-5", { launch: { direction: "go" } }),
    card("CEN-6", { launch: { direction: "go" } }),
  ];
  const records = [main, infra];
  assert.deepEqual(
    ids(graph({ cards, records, selectedId: "infra" }).branches),
    ["GRP-1", "CEN-5"],
  );
  assert.deepEqual(
    ids(graph({ cards, records, selectedId: "main" }).branches),
    ["GRP-2", "CEN-6"],
  );
});

test("a hidden card, a group member and a card of another orchestrator are not branches", () => {
  const cards = [
    group("GRP-1"),
    group("GRP-2", { source: "orchestrator" }),
    live("CEN-1", { groupId: "GRP-2" }),
    live("CEN-2"),
  ];
  assert.deepEqual(
    ids(graph({ cards, records: [main, infra], selectedId: "main" }).branches),
    ["CEN-2"],
  );
});

test("a plain ticket nobody planned is not a branch", () => {
  assert.deepEqual(
    graph({ cards: [card("CEN-1", { column: "todo" })] }).branches,
    [],
  );
});

test("each sign of a card run by the orchestrator makes it a branch", () => {
  const signs: [string, Partial<Card>][] = [
    ["group", { source: "group" }],
    ["active session id", { activeSessionId: "s1" }],
    [
      "sessions",
      {
        sessions: [{ id: "s9", createdAt: iso(1), updatedAt: iso(1) }],
      },
    ],
    ["launch", { launch: { direction: "go" } }],
    ["start intent", { startIntent: { playbook: "pb" } }],
    ["created by orchestrator", { createdByOrchestrator: "main" }],
    ["owner orchestrator", { ownerOrchestrator: "main" }],
  ];
  for (const [name, patch] of signs) {
    const result = graph({ cards: [card("CEN-1", patch)] });
    assert.deepEqual(ids(result.branches), ["CEN-1"], name);
  }
});

test("a plan entry that names a ticket makes it a branch", () => {
  const result = graph({
    cards: [card("CEN-1", { column: "todo" })],
    decisions: [plan("p", iso(1), [entry("CEN-1", 1)])],
  });
  assert.deepEqual(ids(result.branches), ["CEN-1"]);
});

test("the newest plan wins over an older one", () => {
  const result = graph({
    cards: [
      card("CEN-1", { column: "todo" }),
      card("CEN-2", { column: "todo" }),
    ],
    decisions: [
      plan("old", iso(5), [entry("CEN-1", 1)]),
      plan("new", iso(1), [entry("CEN-2", 1)]),
    ],
  });
  assert.deepEqual(ids(result.branches), ["CEN-2"]);
});

test("a rejected newer plan adds nothing and the approved plan stays", () => {
  const result = graph({
    cards: [card("CEN-1", { column: "todo" })],
    decisions: [
      plan("old", iso(5), [entry("CEN-1", 1)], {
        state: "answered",
        answer: { optionId: "approve", note: null },
      }),
      plan("new", iso(1), [entry("CEN-1", 1), entry("Gone", 2)], {
        state: "answered",
        answer: { optionId: "reject", note: null },
      }),
    ],
  });
  assert.deepEqual(ids(result.branches), ["CEN-1"]);
  assert.equal(result.branches[0]?.planOrder, 1);
});

test("a rejected plan alone gives no planned branch", () => {
  const result = graph({
    cards: [card("CEN-1", { column: "todo" })],
    decisions: [
      plan("only", iso(1), [entry("CEN-1", 1)], {
        state: "answered",
        answer: { optionId: "reject", note: null },
      }),
    ],
  });
  assert.deepEqual(result.branches, []);
});

test("a newer open plan keeps the approved orders and adds its new entries after them", () => {
  const result = graph({
    cards: [
      card("CEN-1", { column: "todo" }),
      card("CEN-2", { column: "todo" }),
      card("CEN-3", { column: "todo" }),
    ],
    decisions: [
      plan("approved", iso(5), [entry("CEN-2", 1), entry("CEN-1", 2)], {
        state: "answered",
        answer: { optionId: "approve", note: null },
      }),
      plan("proposal", iso(1), [entry("CEN-1", 1), entry("CEN-3", 2)]),
    ],
  });
  assert.deepEqual(
    result.branches.map((b) => [b.id, b.planOrder, b.slot]),
    [
      ["CEN-2", 1, 0],
      ["CEN-1", 2, 1],
      ["CEN-3", 4, 2],
    ],
  );
});

test("an open plan older than the approved one is ignored", () => {
  const result = graph({
    cards: [
      card("CEN-1", { column: "todo" }),
      card("CEN-2", { column: "todo" }),
    ],
    decisions: [
      plan("stale", iso(9), [entry("CEN-2", 1)]),
      plan("approved", iso(5), [entry("CEN-1", 1)], {
        state: "answered",
        answer: { optionId: "approve", note: null },
      }),
    ],
  });
  assert.deepEqual(ids(result.branches), ["CEN-1"]);
});

test("a plan entry that names a card elsewhere on the board makes no ghost branch", () => {
  const result = graph({
    records: [main, infra],
    cards: [
      card("CEN-5", { column: "todo" }),
      card("CEN-7", { column: "todo", groupId: "GRP-9" }),
    ],
    decisions: [
      plan("p", iso(1), [
        entry("CEN-5", 1),
        entry("CEN-7", 2),
        entry("New group", 3),
      ]),
    ],
  });
  assert.deepEqual(ids(result.branches), ["plan:3"]);
});

test("an approved plan counts and a plan of another orchestrator does not", () => {
  const approved = plan("a", iso(2), [entry("Alpha", 1)], {
    state: "answered",
    answer: { optionId: "approve", note: null },
  });
  const foreign = plan("f", iso(1), [entry("Beta", 1)], {
    orchestratorId: "infra",
  });
  const result = graph({ decisions: [approved, foreign] });
  assert.deepEqual(ids(result.branches), ["plan:1"]);
  assert.equal(result.branches[0].title, "Alpha");
});

test("a plan entry matches a card by id, by identifier and, for a group, by title", () => {
  const byId = card("id-1", { identifier: "CEN-1", column: "todo" });
  const byIdentifier = card("id-2", { identifier: "CEN-2", column: "todo" });
  const byTitle = group("GRP-3", { title: "Auth rework" });
  const result = graph({
    cards: [byId, byIdentifier, byTitle],
    decisions: [
      plan("p", iso(1), [
        entry("id-1", 1, "small"),
        entry("CEN-2", 2, "medium"),
        entry("Auth rework", 3, "large"),
      ]),
    ],
  });
  assert.deepEqual(
    result.branches.map((b) => [b.id, b.planOrder, b.planSize, b.playbook]),
    [
      ["id-1", 1, "small", "pb-id-1"],
      ["id-2", 2, "medium", "pb-CEN-2"],
      ["GRP-3", 3, "large", "pb-Auth rework"],
    ],
  );
});

test("a title entry does not match a card that is not a group", () => {
  const result = graph({
    cards: [card("CEN-1", { title: "Auth rework", column: "todo" })],
    decisions: [plan("p", iso(1), [entry("Auth rework", 1)])],
  });
  assert.deepEqual(
    result.branches.map((b) => [b.id, b.cardId]),
    [["plan:1", null]],
  );
});

test("a plan entry with no match becomes a planned branch with no card", () => {
  const result = graph({
    decisions: [plan("p", iso(1), [entry("Write the docs", 4, "large")])],
  });
  assert.deepEqual(result.branches, [
    {
      id: "plan:4",
      cardId: null,
      identifier: null,
      title: "Write the docs",
      state: "planned",
      label: "Planned",
      tone: "muted",
      band: "planned",
      actions: [],
      detail: "Plan order 4, size large",
      contextPercent: null,
      cost: null,
      playbook: "pb-Write the docs",
      planOrder: 4,
      planSize: "large",
      memberCount: null,
      stateSince: null,
      shippedAt: null,
      slot: 0,
    },
  ]);
});

test("a matched card keeps its own playbook before the plan playbook", () => {
  const rows: [string, Partial<Card>, string | null][] = [
    [
      "launch",
      {
        launch: { playbook: "from-launch", direction: "go" },
        startIntent: { playbook: "from-intent" },
      },
      "from-launch",
    ],
    [
      "start intent",
      { startIntent: { playbook: "from-intent" } },
      "from-intent",
    ],
    ["plan", {}, "pb-CEN-1"],
  ];
  for (const [name, patch, expected] of rows) {
    const result = graph({
      cards: [card("CEN-1", { column: "todo", ...patch })],
      decisions: [plan("p", iso(1), [entry("CEN-1", 1)])],
    });
    assert.equal(result.branches[0].playbook, expected, name);
  }
  assert.equal(graph({ cards: [live("CEN-1")] }).branches[0].playbook, null);
});

interface StatusRow {
  name: string;
  card: Card;
  expected: Pick<
    CentreBranch,
    "state" | "label" | "tone" | "band" | "actions" | "detail"
  >;
}

const statusRows: StatusRow[] = [
  {
    name: "column done",
    card: live("CEN-1", { column: "done" }),
    expected: {
      state: "shipped",
      label: "Shipped",
      tone: "muted",
      band: "shipped",
      actions: ["open"],
      detail: null,
    },
  },
  {
    name: "ship flow done",
    card: live("CEN-1", { shipFlow: shipDone }),
    expected: {
      state: "shipped",
      label: "Shipped",
      tone: "muted",
      band: "shipped",
      actions: ["open"],
      detail: null,
    },
  },
  {
    name: "column agent done",
    card: live("CEN-1", { column: "agent_done" }),
    expected: {
      state: "done",
      label: "Agent done",
      tone: "success",
      band: "done",
      actions: ["open"],
      detail: "Awaiting ship",
    },
  },
  {
    name: "roadmap complete",
    card: live("CEN-1", { state: "roadmap_complete" }),
    expected: {
      state: "done",
      label: "Agent done",
      tone: "success",
      band: "done",
      actions: ["open"],
      detail: "Awaiting ship",
    },
  },
  {
    name: "no active session id",
    card: card("CEN-1", { launch: { direction: "go" } }),
    expected: {
      state: "planned",
      label: "Planned",
      tone: "muted",
      band: "planned",
      actions: ["open"],
      detail: null,
    },
  },
  {
    name: "an active session id with no session entry is live, as on the wire",
    card: card("CEN-1", { activeSessionId: "s9" }),
    expected: {
      state: "running",
      label: "Running",
      tone: "neutral",
      band: "running",
      actions: ["open"],
      detail: null,
    },
  },
  {
    name: "usage stop",
    card: live("CEN-1", { state: "needs_input", stateReason: "usage_stop" }),
    expected: {
      state: "usage_limit",
      label: "Usage limit",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "resume"],
      detail: "Stopped at the usage limit",
    },
  },
  {
    name: "usage limit dialog",
    card: live("CEN-1", { state: "usage_limit_dialog" }),
    expected: {
      state: "usage_limit",
      label: "Usage limit",
      tone: "attention",
      band: "needs_you",
      actions: ["open"],
      detail: "Stopped at the usage limit",
    },
  },
  {
    name: "usage limit wait",
    card: live("CEN-1", { state: "usage_limit_wait" }),
    expected: {
      state: "usage_limit",
      label: "Usage limit",
      tone: "attention",
      band: "needs_you",
      actions: ["open"],
      detail: "Stopped at the usage limit",
    },
  },
  {
    name: "budget",
    card: live("CEN-1", { state: "needs_input", stateReason: "budget" }),
    expected: {
      state: "attention",
      label: "Budget reached",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "resume"],
      detail: "Budget reached",
    },
  },
  {
    name: "resume failed",
    card: live("CEN-1", { state: "working", stateReason: "resume_failed" }),
    expected: {
      state: "attention",
      label: "Resume failed",
      tone: "error",
      band: "needs_you",
      actions: ["open", "open_terminal", "retry_resume"],
      detail: null,
    },
  },
  {
    name: "needs input",
    card: live("CEN-1", { state: "needs_input" }),
    expected: {
      state: "needs_input",
      label: "Needs input",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "reply"],
      detail: "Needs your answer",
    },
  },
  {
    name: "stale",
    card: live("CEN-1", { state: "stale" }),
    expected: {
      state: "attention",
      label: "No progress",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "reply", "open_terminal"],
      detail: null,
    },
  },
  {
    name: "permission prompt",
    card: live("CEN-1", { state: "permission_prompt" }),
    expected: {
      state: "attention",
      label: "Permission prompt",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "open_terminal"],
      detail: null,
    },
  },
  {
    name: "api error",
    card: live("CEN-1", { state: "api_error" }),
    expected: {
      state: "attention",
      label: "API error",
      tone: "error",
      band: "needs_you",
      actions: ["open", "open_terminal"],
      detail: null,
    },
  },
  {
    name: "lost",
    card: live("CEN-1", { state: "lost" }),
    expected: {
      state: "attention",
      label: "Session lost",
      tone: "error",
      band: "needs_you",
      actions: ["open", "open_terminal"],
      detail: null,
    },
  },
  {
    name: "shell prompt",
    card: live("CEN-1", { state: "shell_prompt" }),
    expected: {
      state: "attention",
      label: "Claude exited",
      tone: "error",
      band: "needs_you",
      actions: ["open", "open_terminal"],
      detail: null,
    },
  },
  ...(["working", "idle", "handoff_ready"] as const).map(
    (state): StatusRow => ({
      name: state,
      card: live("CEN-1", { state }),
      expected: {
        state: "running",
        label: "Running",
        tone: "neutral",
        band: "running",
        actions: ["open"],
        detail: null,
      },
    }),
  ),
  {
    name: "no state",
    card: live("CEN-1"),
    expected: {
      state: "running",
      label: "Running",
      tone: "neutral",
      band: "running",
      actions: ["open"],
      detail: null,
    },
  },
  {
    name: "state from the session when the card has none",
    card: live("CEN-1", {}, { state: "needs_input" }),
    expected: {
      state: "needs_input",
      label: "Needs input",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "reply"],
      detail: "Needs your answer",
    },
  },
  {
    name: "state of the card wins over the session",
    card: live("CEN-1", { state: "working" }, { state: "needs_input" }),
    expected: {
      state: "running",
      label: "Running",
      tone: "neutral",
      band: "running",
      actions: ["open"],
      detail: null,
    },
  },
  {
    name: "reason from the session when the card has none",
    card: live(
      "CEN-1",
      { state: "needs_input" },
      { stateReason: "usage_stop" },
    ),
    expected: {
      state: "usage_limit",
      label: "Usage limit",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "resume"],
      detail: "Stopped at the usage limit",
    },
  },
  {
    name: "a wire card with only the flat mirror fields is live",
    card: card("CEN-1", {
      activeSessionId: "s1",
      state: "needs_input",
      contextPercent: 40,
    }),
    expected: {
      state: "needs_input",
      label: "Needs input",
      tone: "attention",
      band: "needs_you",
      actions: ["open", "reply"],
      detail: "Needs your answer",
    },
  },
  {
    name: "a wire card with only an active session summary is live",
    card: card("CEN-1", {
      sessionSummaries: [
        {
          id: "s1",
          ordinal: 1,
          lost: false,
          active: true,
          createdAt: "2026-10-08T09:00:00.000Z",
          updatedAt: "2026-10-08T09:00:00.000Z",
          state: "working",
        },
      ] as Card["sessionSummaries"],
    }),
    expected: {
      state: "running",
      label: "Running",
      tone: "neutral",
      band: "running",
      actions: ["open"],
      detail: null,
    },
  },
];

for (const row of statusRows) {
  test(`status, actions and detail: ${row.name}`, () => {
    const [branch] = graph({ cards: [row.card] }).branches;
    const { state, label, tone, band, actions, detail } = branch;
    assert.deepEqual(
      { state, label, tone, band, actions, detail },
      row.expected,
    );
  });
}

test("a stopped usage reason on a working session stays running", () => {
  const [branch] = graph({
    cards: [live("CEN-1", { state: "working", stateReason: "usage_stop" })],
  }).branches;
  assert.deepEqual([branch.state, branch.actions], ["running", ["open"]]);
});

test("a running loop shows its unit and phase position", () => {
  const loop = {
    slug: "auth",
    roadmapFile: "roadmap.md",
    units: [1, 2, 3].map((number) => ({
      number,
      ticket: null,
      title: `Unit ${number}`,
      status: number === 1 ? "shipped" : "in progress",
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
      unitsDone: 1,
      unitsTotal: 3,
      currentUnit: 2,
      currentPhase: { number: 1, name: "Build" },
      lastGate: null,
    },
    warnings: [],
    readAt: iso(0),
  } as LoopProgress;
  const result = graph({
    cards: [
      group("GRP-1", {
        activeSessionId: "s1",
        sessions: [{ id: "s1", createdAt: iso(1), updatedAt: iso(1) }],
        loopProgress: loop,
        memberIds: ["a", "b"],
      }),
    ],
  });
  assert.equal(result.branches[0].detail, "Unit 2 of 3, phase 1 of 4");
});

test("a running loop with a phase and no units shows the phase only", () => {
  const loop = {
    slug: "auth",
    roadmapFile: "roadmap.md",
    units: [],
    engine: null,
    completion: "running",
    summary: {
      unitsDone: 0,
      unitsTotal: 0,
      currentUnit: null,
      currentPhase: { number: 2, name: "Build" },
      lastGate: null,
    },
    warnings: [],
    readAt: iso(0),
  } as LoopProgress;
  const result = graph({ cards: [live("CEN-1", { loopProgress: loop })] });
  assert.equal(result.branches[0].detail, "Phase 2");
});

test("a running group with no loop progress shows its ticket count", () => {
  const result = graph({
    cards: [live("GRP-1", { source: "group", memberIds: ["a", "b", "c"] })],
  });
  assert.equal(result.branches[0].detail, "Group of 3 tickets");
  assert.equal(result.branches[0].memberCount, 3);
});

test("a running ticket with no loop progress has no detail and no member count", () => {
  const [branch] = graph({ cards: [live("CEN-1")] }).branches;
  assert.equal(branch.detail, null);
  assert.equal(branch.memberCount, null);
});

test("a planned card with a plan entry shows the plan order and size", () => {
  const result = graph({
    cards: [card("CEN-1", { column: "todo" })],
    decisions: [plan("p", iso(1), [entry("CEN-1", 2, "large")])],
  });
  assert.equal(result.branches[0].detail, "Plan order 2, size large");
});

test("the meters come from the card first, then the session", () => {
  const rows: [string, Card, [number | null, number | null, string | null]][] =
    [
      [
        "card",
        live(
          "CEN-1",
          { contextPercent: 40, cost: 1.5, stateSince: iso(3) },
          { contextPercent: 90, cost: 9 },
        ),
        [40, 1.5, iso(3)],
      ],
      [
        "session",
        live("CEN-1", {}, { contextPercent: 90, cost: 9, stateSince: iso(4) }),
        [90, 9, iso(4)],
      ],
      ["none", live("CEN-1"), [null, null, null]],
    ];
  for (const [name, source, expected] of rows) {
    const [branch] = graph({ cards: [source] }).branches;
    assert.deepEqual(
      [branch.contextPercent, branch.cost, branch.stateSince],
      expected,
      name,
    );
  }
});

test("the meters read the flat mirror first, then the session entry", () => {
  const [mirror, entry] = graph({
    cards: [
      live("CEN-1", { contextPercent: 30, cost: 1.5 }, { contextPercent: 70 }),
      live("CEN-2", {}, { contextPercent: 70, cost: 2.25 }),
    ],
  }).branches;
  assert.deepEqual(
    [mirror?.contextPercent, mirror?.cost, entry?.contextPercent, entry?.cost],
    [30, 1.5, 70, 2.25],
  );
});

test("a group branch takes its playbook from the launch", () => {
  const [branch] = graph({
    cards: [group("GRP-1", { launch: { playbook: "deep", direction: "go" } })],
  }).branches;
  assert.equal(branch.playbook, "deep");
});

test("branches order by plan order, then ticket number, then id", () => {
  const cards = [
    group("CEN-12"),
    group("CEN-9"),
    group("CEN-30"),
    group("ZED-4", { identifier: "ZED-4" }),
    group("AAA-4", { identifier: "AAA-4" }),
  ];
  const result = graph({
    cards,
    decisions: [plan("p", iso(1), [entry("CEN-30", 1), entry("Later", 7)])],
  });
  assert.deepEqual(
    result.branches.map((b) => [b.id, b.slot]),
    [
      ["CEN-30", 0],
      ["plan:7", 1],
      ["AAA-4", 2],
      ["ZED-4", 3],
      ["CEN-9", 4],
      ["CEN-12", 5],
    ],
  );
});

test("a branch that changes state keeps its slot", () => {
  const slots = (cards: Card[]) =>
    Object.fromEntries(graph({ cards }).branches.map((b) => [b.id, b.slot]));
  const before = slots([
    live("CEN-9", { state: "working" }),
    live("CEN-12", { state: "working" }),
  ]);
  const after = slots([
    live("CEN-9", { state: "working" }),
    live("CEN-12", { state: "needs_input" }),
  ]);
  const shipped = slots([
    live("CEN-9", { column: "done" }),
    live("CEN-12", { state: "needs_input" }),
  ]);
  assert.deepEqual(before, { "CEN-9": 0, "CEN-12": 1 });
  assert.deepEqual(after, before);
  assert.deepEqual(shipped, before);
});

test("a new branch with no plan order takes the next slot", () => {
  const result = graph({
    cards: [
      live("CEN-9", { state: "needs_input" }),
      live("CEN-12"),
      live("CEN-20"),
    ],
  });
  assert.deepEqual(
    result.branches.map((b) => [b.id, b.slot]),
    [
      ["CEN-9", 0],
      ["CEN-12", 1],
      ["CEN-20", 2],
    ],
  );
});

test("a shipped branch older than 24 hours is hidden, one at 23 hours is shown", () => {
  const result = graph({
    cards: [
      live("CEN-1", { column: "done", columnSince: iso(23) }),
      live("CEN-2", { column: "done", columnSince: iso(25) }),
    ],
    records: [main],
  });
  assert.deepEqual(ids(result.branches), ["CEN-1"]);
  assert.equal(result.hiddenShipped, 1);
  assert.deepEqual(ids(result.bands[4].branches), ["CEN-1"]);
  assert.equal(result.bands[4].count, 1);
  assert.equal(result.centre?.branchCount, 2);
  assert.deepEqual(
    result.edges.map((e) => e.to),
    ["CEN-1"],
  );
});

test("a shipped branch at exactly 24 hours is still shown", () => {
  const result = graph({
    cards: [live("CEN-1", { column: "done", columnSince: iso(24) })],
  });
  assert.deepEqual(ids(result.branches), ["CEN-1"]);
  assert.equal(result.hiddenShipped, 0);
});

test("showing older shipped branches keeps them and reports none hidden", () => {
  const result = graph({
    cards: [live("CEN-2", { column: "done", columnSince: iso(25) })],
    showOlderShipped: true,
  });
  assert.deepEqual(ids(result.branches), ["CEN-2"]);
  assert.equal(result.hiddenShipped, 0);
});

test("a hidden shipped branch still holds its slot", () => {
  const result = graph({
    cards: [
      live("CEN-1", { column: "done", columnSince: iso(30) }),
      live("CEN-2"),
    ],
  });
  assert.deepEqual(
    result.branches.map((b) => [b.id, b.slot]),
    [["CEN-2", 1]],
  );
});

test("the shipped time is the ship flow finish, else the column time, else the update time", () => {
  const rows: [string, Partial<Card>, string][] = [
    [
      "ship flow",
      { shipFlow: { ...shipDone, finishedAt: iso(2) }, columnSince: iso(3) },
      iso(2),
    ],
    ["column time", { column: "done", columnSince: iso(3) }, iso(3)],
    ["update time", { column: "done" }, "2026-10-08T10:00:00.000Z"],
  ];
  for (const [name, patch, expected] of rows) {
    const [branch] = graph({ cards: [live("CEN-1", patch)] }).branches;
    assert.equal(branch.shippedAt, expected, name);
  }
  assert.equal(graph({ cards: [live("CEN-1")] }).branches[0].shippedAt, null);
});

test("the five bands list their visible branches in slot order", () => {
  const result = graph({
    cards: [
      live("CEN-1", { state: "needs_input" }),
      live("CEN-2", { state: "working" }),
      live("CEN-3", { state: "stale" }),
      live("CEN-4", { column: "agent_done" }),
      live("CEN-5", { column: "done", columnSince: iso(1) }),
      card("CEN-6", { launch: { direction: "go" } }),
    ],
    decisions: [plan("p", iso(1), [entry("Extra", 9)])],
  });
  assert.deepEqual(
    result.bands.map((b) => [b.key, b.label, b.count, ids(b.branches)]),
    [
      ["needs_you", "Needs you", 2, ["CEN-1", "CEN-3"]],
      ["running", "Running", 1, ["CEN-2"]],
      ["planned", "Planned", 2, ["plan:9", "CEN-6"]],
      ["done", "Done", 1, ["CEN-4"]],
      ["shipped", "Shipped", 1, ["CEN-5"]],
    ],
  );
});

test("each visible branch has one edge from the centre, dashed only when planned", () => {
  const result = graph({
    cards: [live("CEN-1", { state: "needs_input" }), live("CEN-2")],
    decisions: [plan("p", iso(1), [entry("Extra", 9)])],
  });
  assert.deepEqual(result.edges, [
    { from: "centre", to: "plan:9", band: "planned", dashed: true },
    { from: "centre", to: "CEN-1", band: "needs_you", dashed: false },
    { from: "centre", to: "CEN-2", band: "running", dashed: false },
  ]);
});

test("the centre node reads its state from the session of the record", () => {
  const rows: [string, OrchestratorView, [string, string]][] = [
    [
      "working",
      record(
        "main",
        "main",
        {},
        {
          session: { state: "working" } as OrchestratorView["session"],
        },
      ),
      ["Working", "neutral"],
    ],
    [
      "needs input",
      record(
        "main",
        "main",
        {},
        {
          session: { state: "needs_input" } as OrchestratorView["session"],
        },
      ),
      ["Needs input", "attention"],
    ],
    [
      "stopped",
      record("main", "main", {}, { state: "stopped" }),
      ["Stopped", "muted"],
    ],
    [
      "starting",
      record("main", "main", {}, { state: "starting" }),
      ["Starting", "neutral"],
    ],
    [
      "session with no state",
      record(
        "main",
        "main",
        {},
        {
          state: "running",
          session: { state: null } as OrchestratorView["session"],
        },
      ),
      ["Starting", "neutral"],
    ],
  ];
  for (const [name, source, expected] of rows) {
    const centre = graph({ records: [source] }).centre;
    assert.deepEqual([centre?.label, centre?.tone], expected, name);
  }
});

test("the centre node carries the record fields, the session meters and the counts", () => {
  const withSession = record(
    "main",
    "main",
    {},
    {
      session: {
        state: "working",
        contextPercent: 35,
        cost: 2.25,
      } as OrchestratorView["session"],
    },
  );
  const result = graph({
    records: [withSession],
    cards: [
      live("CEN-1", { state: "needs_input" }),
      live("CEN-2", { state: "stale" }),
      live("CEN-3"),
      live("CEN-4", { column: "done", columnSince: iso(48) }),
    ],
  });
  assert.deepEqual(result.centre, {
    id: "main",
    name: "Name main",
    role: "main",
    label: "Working",
    tone: "neutral",
    contextPercent: 35,
    cost: 2.25,
    branchCount: 4,
    needYouCount: 2,
  });
});

test("a centre with no session has null meters", () => {
  const centre = graph().centre;
  assert.equal(centre?.contextPercent, null);
  assert.equal(centre?.cost, null);
  assert.equal(centre?.branchCount, 0);
  assert.equal(centre?.needYouCount, 0);
});

test("the centre node reads the record state before the session state", () => {
  const node = (patch: Partial<OrchestratorView>) =>
    graph({ records: [record("main", "main", {}, patch)] }).centre;
  const working = {
    cardId: "CEN-9",
    state: "working",
  } as OrchestratorView["session"];
  assert.deepEqual(
    [
      node({ state: "stopping", session: working })?.label,
      node({ state: "stopped", session: working })?.label,
      node({ state: "starting", session: null })?.label,
      node({ state: "running", session: working })?.label,
    ],
    ["Stopping", "Stopped", "Starting", "Working"],
  );
});
