import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAttentionQueue } from "./attention-queue.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "./board-key.js";
import type {
  Card,
  DecisionItem,
  LoopGate,
  LoopProgress,
  OrchestrationEvent,
  Session,
  SupervisorState,
  SupervisorStateReason,
} from "./types.js";

const OTHER = parseBoardKey("OTHER") ?? DEFAULT_BOARD_KEY;
const NOW = new Date("2026-10-07T12:00:00Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60000).toISOString();
}

function session(
  id: string,
  state: SupervisorState,
  since: string,
  stateReason?: SupervisorStateReason,
): Session {
  return {
    id,
    createdAt: since,
    updatedAt: since,
    state,
    stateSince: since,
    ...(stateReason === undefined ? {} : { stateReason }),
  };
}

function card(identifier: string, extra: Partial<Card> = {}): Card {
  return {
    id: `id-${identifier}`,
    identifier,
    boardKey: DEFAULT_BOARD_KEY,
    ...extra,
  } as Card;
}

function withSession(
  identifier: string,
  state: SupervisorState,
  since: string,
  stateReason?: SupervisorStateReason,
  extra: Partial<Card> = {},
): Card {
  const s = session(`s-${identifier}`, state, since, stateReason);
  return card(identifier, { sessions: [s], activeSessionId: s.id, ...extra });
}

function withWireSession(
  identifier: string,
  state: SupervisorState,
  since: string,
  stateReason?: SupervisorStateReason,
  extra: Partial<Card> = {},
): Card {
  const id = `s-${identifier}`;
  return card(identifier, {
    activeSessionId: id,
    state,
    stateSince: since,
    ...(stateReason === undefined ? {} : { stateReason }),
    sessionSummaries: [
      {
        id,
        ordinal: 1,
        lost: false,
        active: true,
        createdAt: since,
        updatedAt: since,
        state,
        stateSince: since,
        ...(stateReason === undefined ? {} : { stateReason }),
      },
    ],
    ...extra,
  });
}

function progress(lastGate: LoopGate | null): LoopProgress {
  return {
    slug: "demo",
    roadmapFile: "ROADMAP.md",
    units: [
      {
        number: 1,
        ticket: null,
        title: "One",
        status: "in progress",
        statusText: "in progress",
        branch: null,
        commit: null,
        prdPath: null,
        phaseTotal: 4,
        phases: [
          {
            number: 4,
            name: "P4",
            gate: lastGate?.result === "fail" ? "fail" : "pass",
            attempts: 1,
            passedAt: null,
            retryBudget: 2,
          },
        ],
      },
    ],
    engine: null,
    completion: "running",
    summary: {
      unitsDone: 0,
      unitsTotal: 1,
      currentUnit: 1,
      currentPhase: { number: 4, name: "P4" },
      lastGate,
    },
    warnings: [],
    readAt: minutesAgo(0),
  };
}

function build(cards: Card[], decisions: DecisionItem[] = [], events = []) {
  return buildAttentionQueue({
    boardKey: DEFAULT_BOARD_KEY,
    cards,
    decisions,
    events,
    now: NOW,
  });
}

test("needs_input with no reason is a reply item carrying the status reason", () => {
  const [item] = build([
    withSession("GROUP-1", "needs_input", minutesAgo(34), undefined, {
      statusReason: "Which branch?",
    }),
  ]);
  assert.equal(item?.kind, "needs_input");
  assert.equal(item?.reply, true);
  assert.equal(item?.text, "Which branch?");
  assert.equal(item?.waitMinutes, 34);
  assert.equal(item?.groupId, "GROUP-1");
  assert.equal(item?.id, "needs_input:id-GROUP-1");
});

test("usage_stop and budget need_input are stop items with no reply", () => {
  const items = build([
    withSession("GROUP-1", "needs_input", minutesAgo(5), "usage_stop"),
    withSession("GROUP-2", "needs_input", minutesAgo(6), "budget"),
  ]);
  assert.deepEqual(
    items.map((i) => [i.kind, i.reply, i.text]),
    [
      ["budget_stop", false, null],
      ["usage_stop", false, null],
    ],
  );
});

test("resume_failed strips the resume prefix and carries lost", () => {
  const [item] = build([
    withSession("GROUP-1", "needs_input", minutesAgo(5), "resume_failed", {
      statusReason: "resume: pane never came back",
      sessionLost: true,
    }),
  ]);
  assert.equal(item?.kind, "resume_failed");
  assert.equal(item?.text, "pane never came back");
  assert.equal(item?.lost, true);
  assert.equal(item?.reply, false);
});

test("stale adds the 15 minute threshold to the wait", () => {
  const [item] = build([withSession("GROUP-1", "stale", minutesAgo(20))]);
  assert.equal(item?.kind, "stale");
  assert.equal(item?.text, "No progress for 35 min.");
  assert.equal(item?.reply, true);
});

test("permission_prompt reads the evidence of the newest matching event", () => {
  const event = (
    id: number,
    ts: string,
    to: string,
    sessionId: string,
  ): OrchestrationEvent => ({
    id,
    boardKey: DEFAULT_BOARD_KEY,
    cardId: "id-GROUP-1",
    sessionId,
    kind: "supervisor_state",
    data: { to, evidence: `evidence ${id}` },
    ts,
  });
  const cards = [withSession("GROUP-1", "permission_prompt", minutesAgo(3))];
  const items = buildAttentionQueue({
    boardKey: DEFAULT_BOARD_KEY,
    cards,
    decisions: [],
    events: [
      event(1, minutesAgo(10), "permission_prompt", "s-GROUP-1"),
      event(2, minutesAgo(4), "permission_prompt", "s-GROUP-1"),
      event(3, minutesAgo(1), "working", "s-GROUP-1"),
      event(4, minutesAgo(1), "permission_prompt", "other"),
    ],
    now: NOW,
  });
  assert.equal(items[0]?.text, "evidence 2");
  assert.equal(items[0]?.reply, false);
  assert.equal(build(cards)[0]?.text, null);
});

test("other states yield no session item", () => {
  const states: SupervisorState[] = [
    "working",
    "idle",
    "usage_limit_dialog",
    "usage_limit_wait",
    "shell_prompt",
    "lost",
  ];
  const cards = states.map((state, i) =>
    withSession(`GROUP-${i}`, state, minutesAgo(5)),
  );
  assert.deepEqual(build(cards), []);
});

test("a failed gate becomes an item and a later pass removes it", () => {
  const failed: LoopGate = {
    unit: 1,
    phase: 4,
    result: "fail",
    at: minutesAgo(12),
  };
  const [item] = build([card("GROUP-1", { loopProgress: progress(failed) })]);
  assert.equal(item?.kind, "failed_gate");
  assert.equal(item?.waitMinutes, 12);
  assert.deepEqual(item?.gate, { unit: 1, phase: 4, attempt: 1, limit: 2 });
  assert.equal(item?.reply, false);

  const passed: LoopGate = { ...failed, result: "pass", at: minutesAgo(2) };
  assert.deepEqual(
    build([card("GROUP-1", { loopProgress: progress(passed) })]),
    [],
  );
});

test("open decisions of the board join the queue and other boards are ignored", () => {
  const decision = (
    id: string,
    boardKey: DecisionItem["boardKey"],
    state: DecisionItem["state"],
  ): DecisionItem => ({
    id,
    boardKey,
    cardId: "id-GROUP-1",
    orchestratorId: "o",
    kind: "ruling",
    question: `Question ${id}?`,
    options: [],
    recommendedOptionId: null,
    state,
    answer: null,
    createdAt: minutesAgo(60),
    answeredAt: null,
  });
  const items = build(
    [card("GROUP-1")],
    [
      decision("d1", DEFAULT_BOARD_KEY, "open"),
      decision("d2", DEFAULT_BOARD_KEY, "answered"),
      decision("d3", OTHER, "open"),
    ],
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "decision");
  assert.equal(items[0]?.text, "Question d1?");
  assert.equal(items[0]?.groupId, "GROUP-1");
  assert.equal(items[0]?.waitMinutes, 60);
});

test("cards of another board are ignored and a missing board key means LOCAL", () => {
  const other = withSession("GROUP-9", "stale", minutesAgo(5), undefined, {
    boardKey: OTHER,
  });
  const noKey = {
    ...withSession("GROUP-8", "stale", minutesAgo(5)),
    boardKey: undefined,
  } as unknown as Card;
  assert.deepEqual(
    build([other, noKey]).map((i) => i.groupId),
    ["GROUP-8"],
  );
});

test("items sort oldest first with ties by group id", () => {
  const items = build([
    withSession("GROUP-3", "stale", minutesAgo(10)),
    withSession("GROUP-2", "stale", minutesAgo(10)),
    withSession("GROUP-1", "stale", minutesAgo(1)),
    withSession("GROUP-4", "stale", minutesAgo(90)),
  ]);
  assert.deepEqual(
    items.map((i) => i.groupId),
    ["GROUP-4", "GROUP-2", "GROUP-3", "GROUP-1"],
  );
});

test("equal waits order group ids by number, so GROUP-9 comes before GROUP-10", () => {
  const items = build([
    withSession("GROUP-10", "stale", minutesAgo(10)),
    withSession("GROUP-9", "stale", minutesAgo(10)),
  ]);
  assert.deepEqual(
    items.map((i) => i.groupId),
    ["GROUP-9", "GROUP-10"],
  );
});

test("a future stateSince never gives a negative wait", () => {
  const [item] = build([withSession("GROUP-1", "stale", minutesAgo(-5))]);
  assert.equal(item?.waitMinutes, 0);
});

test("stateSince falls back to the session updatedAt", () => {
  const s = session("s1", "stale", minutesAgo(8));
  delete s.stateSince;
  const [item] = build([
    card("GROUP-1", { sessions: [s], activeSessionId: "s1" }),
  ]);
  assert.equal(item?.waitMinutes, 8);
});

test("a Needs Input card with no supervisor state is a needs_input item from its update time", () => {
  const s: Session = {
    id: "s-GROUP-7",
    createdAt: minutesAgo(90),
    updatedAt: minutesAgo(90),
  };
  const [item] = build([
    card("GROUP-7", {
      column: "needs_input",
      updatedAt: minutesAgo(20),
      statusReason: "Pick a base branch",
      sessions: [s],
      activeSessionId: s.id,
    }),
  ]);
  assert.equal(item?.kind, "needs_input");
  assert.equal(item?.state, null);
  assert.equal(item?.reply, true);
  assert.equal(item?.waitMinutes, 20);
  assert.equal(item?.text, "Pick a base branch");
});

test("a Needs Input card waits from columnSince when set, else from its update time", () => {
  const since = minutesAgo(1);
  const [fresh] = build([
    card("GROUP-7", {
      column: "needs_input",
      updatedAt: minutesAgo(45),
      columnSince: since,
    }),
  ]);
  assert.equal(fresh?.waitMinutes, 1);
  assert.equal(fresh?.waitingSince, since);
  const [legacy] = build([
    card("GROUP-8", { column: "needs_input", updatedAt: minutesAgo(45) }),
  ]);
  assert.equal(legacy?.waitMinutes, 45);
});

test("a Needs Input card with no session counts with no reply, and a supervised card counts once", () => {
  const items = build([
    card("LOCAL-3", { column: "needs_input", updatedAt: minutesAgo(5) }),
    withSession("GROUP-8", "needs_input", minutesAgo(9), undefined, {
      column: "needs_input",
    }),
    card("LOCAL-4", { column: "in_progress", updatedAt: minutesAgo(5) }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.groupId, i.reply]),
    [
      ["GROUP-8", true],
      ["LOCAL-3", false],
    ],
  );
});

test("a wire-shape card with no sessions key yields the same session items", () => {
  const items = build([
    withWireSession("GROUP-1", "needs_input", minutesAgo(5), "usage_stop"),
    withWireSession("GROUP-2", "needs_input", minutesAgo(6), "budget"),
    withWireSession("GROUP-3", "stale", minutesAgo(20)),
    withWireSession("GROUP-4", "permission_prompt", minutesAgo(7)),
    withWireSession("GROUP-5", "needs_input", minutesAgo(8), "resume_failed", {
      statusReason: "resume: pane never came back",
      sessionLost: true,
    }),
    withWireSession("GROUP-6", "needs_input", minutesAgo(9), undefined, {
      column: "needs_input",
    }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.groupId, i.kind, i.reply]),
    [
      ["GROUP-3", "stale", true],
      ["GROUP-6", "needs_input", true],
      ["GROUP-5", "resume_failed", false],
      ["GROUP-4", "permission_prompt", false],
      ["GROUP-2", "budget_stop", false],
      ["GROUP-1", "usage_stop", false],
    ],
  );
  assert.equal(items[0]?.text, "No progress for 35 min.");
  assert.equal(items[2]?.text, "pane never came back");
  assert.equal(items[2]?.lost, true);
});

test("a wire-shape permission prompt reads the event evidence", () => {
  const items = buildAttentionQueue({
    boardKey: DEFAULT_BOARD_KEY,
    cards: [withWireSession("GROUP-1", "permission_prompt", minutesAgo(3))],
    decisions: [],
    events: [
      {
        id: 1,
        boardKey: DEFAULT_BOARD_KEY,
        cardId: "id-GROUP-1",
        sessionId: "s-GROUP-1",
        kind: "supervisor_state",
        data: { to: "permission_prompt", evidence: "Allow Bash?" },
        ts: minutesAgo(4),
      },
    ],
    now: NOW,
  });
  assert.equal(items[0]?.text, "Allow Bash?");
});

test("a wire-shape Needs Input card with a supervisor state is not a bare column item", () => {
  const items = build([
    withWireSession("GROUP-1", "needs_input", minutesAgo(5), "usage_stop", {
      column: "needs_input",
    }),
  ]);
  assert.deepEqual(
    items.map((i) => i.kind),
    ["usage_stop"],
  );
});

test("a failed gate on a done card or a complete loop yields no item", () => {
  const failed: LoopGate = {
    unit: 1,
    phase: 4,
    result: "fail",
    at: minutesAgo(12),
  };
  const complete = { ...progress(failed), completion: "complete" as const };
  assert.deepEqual(
    build([
      card("GROUP-1", { column: "done", loopProgress: progress(failed) }),
      card("GROUP-2", { loopProgress: complete }),
    ]),
    [],
  );
});

test("a permission prompt with no event evidence reads the status reason", () => {
  const [item] = build([
    withSession("GROUP-1", "permission_prompt", minutesAgo(3), undefined, {
      statusReason: "Allow Bash: npm test",
    }),
  ]);
  assert.equal(item?.text, "Allow Bash: npm test");
});

test("a Needs Input card whose session state is working or idle still yields the column item", () => {
  const items = build([
    withSession("GROUP-1", "working", minutesAgo(9), undefined, {
      column: "needs_input",
    }),
    withSession("GROUP-2", "idle", minutesAgo(8), undefined, {
      column: "needs_input",
    }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.groupId, i.kind, i.reply]),
    [
      ["GROUP-1", "needs_input", true],
      ["GROUP-2", "needs_input", true],
    ],
  );
});

test("a group in Needs Input gives one item, not one per mirrored member", () => {
  const items = build([
    card("GROUP-1", {
      id: "g1",
      column: "needs_input",
      updatedAt: minutesAgo(5),
      memberIds: ["m1", "m2"],
    }),
    card("LOCAL-1", {
      id: "m1",
      column: "needs_input",
      updatedAt: minutesAgo(5),
    }),
    card("LOCAL-2", {
      id: "m2",
      column: "needs_input",
      updatedAt: minutesAgo(5),
    }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.kind, i.cardId]),
    [["needs_input", "g1"]],
  );
});
