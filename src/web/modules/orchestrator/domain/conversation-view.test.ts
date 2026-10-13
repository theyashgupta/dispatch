import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type {
  ConversationMessage,
  DecisionItem,
} from "../../../../shared/types.js";
import {
  ANSWERED_DECISION_CAP,
  conversationView,
} from "./conversation-view.js";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const names = new Map([
  ["main", "Main orchestrator"],
  ["infra", "Infra"],
]);

function decision(patch: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: "d1",
    boardKey: DEFAULT_BOARD_KEY,
    cardId: "GROUP-13",
    orchestratorId: "main",
    kind: "ruling",
    question: "How should the loop continue?",
    options: [
      { id: "a", label: "Give 2 more rounds" },
      { id: "b", label: "Stop the loop" },
    ],
    recommendedOptionId: "b",
    state: "open",
    answer: null,
    createdAt: "2026-10-08T11:00:00.000Z",
    answeredAt: null,
    ...patch,
  };
}

function message(
  id: string,
  at: string | null,
  role: ConversationMessage["role"] = "orchestrator",
): ConversationMessage {
  return { id, at, role, text: `text ${id}` };
}

function view(
  messages: ConversationMessage[],
  decisions: DecisionItem[],
  orchestratorId = "main",
) {
  return conversationView({
    messages,
    decisions,
    orchestratorId,
    orchestratorName: "Main orchestrator",
    orchestratorNames: names,
    now: NOW,
  });
}

const ids = (entries: { id: string }[]) => entries.map((e) => e.id);

test("a decision goes before the first message that is later than it", () => {
  const entries = view(
    [
      message("m1", "2026-10-08T10:00:00.000Z"),
      message("m2", "2026-10-08T10:30:00.000Z"),
      message("m3", "2026-10-08T11:30:00.000Z"),
      message("m4", "2026-10-08T11:45:00.000Z"),
    ],
    [decision()],
  );
  assert.deepEqual(ids(entries), ["m1", "m2", "d1", "m3", "m4"]);
});

test("decisions after every message go last, in time order", () => {
  const entries = view(
    [message("m1", "2026-10-08T10:00:00.000Z")],
    [
      decision({ id: "late", createdAt: "2026-10-08T11:30:00.000Z" }),
      decision({ id: "early", createdAt: "2026-10-08T11:00:00.000Z" }),
    ],
  );
  assert.deepEqual(ids(entries), ["m1", "early", "late"]);
});

test("a decision that is older than every message goes first", () => {
  const entries = view(
    [message("m1", "2026-10-08T11:30:00.000Z")],
    [decision()],
  );
  assert.deepEqual(ids(entries), ["d1", "m1"]);
});

test("a tie keeps the message first", () => {
  const entries = view(
    [message("m1", "2026-10-08T11:00:00.000Z")],
    [decision()],
  );
  assert.deepEqual(ids(entries), ["m1", "d1"]);
});

test("a message with no time never moves a decision before it", () => {
  const entries = view(
    [
      message("m1", "2026-10-08T10:00:00.000Z"),
      message("m2", null),
      message("m3", "2026-10-08T11:30:00.000Z"),
    ],
    [decision()],
  );
  assert.deepEqual(ids(entries), ["m1", "m2", "d1", "m3"]);
});

test("messages keep their order even when their times go backwards", () => {
  const entries = view(
    [
      message("m1", "2026-10-08T10:30:00.000Z"),
      message("m2", "2026-10-08T10:00:00.000Z"),
    ],
    [],
  );
  assert.deepEqual(ids(entries), ["m1", "m2"]);
});

test("a decision of another orchestrator is left out", () => {
  const entries = view(
    [],
    [
      decision({ id: "mine" }),
      decision({ id: "other", orchestratorId: "infra" }),
    ],
  );
  assert.deepEqual(ids(entries), ["mine"]);
});

test("the author of a message follows its role", () => {
  const entries = view(
    [
      message("u", null, "user"),
      message("o", null, "orchestrator"),
      message("s", null, "system"),
    ],
    [],
  );
  assert.deepEqual(
    entries.map((e) => e.kind === "message" && e.author),
    ["You", "Main orchestrator", "Dispatch"],
  );
});

test("a message entry carries its time, role and text", () => {
  const [entry] = view([message("m1", "2026-10-08T10:00:00.000Z", "user")], []);
  assert.deepEqual(entry, {
    kind: "message",
    id: "m1",
    at: "2026-10-08T10:00:00.000Z",
    role: "user",
    author: "You",
    text: "text m1",
  });
});

test("the badge is Decision for plan, roadmap approval and ticket proposal, else Question", () => {
  const kinds = [
    ["plan", "Decision"],
    ["roadmap_approval", "Decision"],
    ["ticket_proposal", "Decision"],
    ["ruling", "Question"],
    ["ship_failure", "Question"],
    ["other", "Question"],
  ] as const;
  for (const [kind, badge] of kinds) {
    const [entry] = view([], [decision({ kind })]);
    assert.equal(entry.kind === "decision" && entry.badge, badge, kind);
  }
});

test("a plan decision carries its rows sorted by order and no other answer", () => {
  const [entry] = view(
    [],
    [
      decision({
        kind: "plan",
        plan: {
          entries: [
            { ref: "CEN-2", playbook: "build", order: 2, size: "large" },
            { ref: "CEN-1", playbook: "fix", order: 1, size: "small" },
          ],
        },
      }),
    ],
  );
  assert.equal(entry.kind, "decision");
  if (entry.kind !== "decision") return;
  assert.deepEqual(
    entry.view.planRows.map((r) => r.ref),
    ["CEN-1", "CEN-2"],
  );
  assert.equal(entry.view.otherOptionId, null);
});

test("a ticket proposal carries its titles and no other answer", () => {
  const [entry] = view(
    [],
    [
      decision({
        kind: "ticket_proposal",
        proposal: {
          tickets: [
            { title: "Add login", description: "d1" },
            { title: "Add logout", description: "d2" },
          ],
          usedIndexes: [],
        },
      }),
    ],
  );
  assert.equal(entry.kind, "decision");
  if (entry.kind !== "decision") return;
  assert.deepEqual(entry.view.proposalTitles, ["Add login", "Add logout"]);
  assert.equal(entry.view.otherOptionId, null);
});

test("a roadmap approval has no other answer and a ruling answers on the recommended option", () => {
  const [gate] = view([], [decision({ kind: "roadmap_approval" })]);
  const [ruling] = view([], [decision({ kind: "ruling" })]);
  assert.equal(gate.kind === "decision" && gate.view.otherOptionId, null);
  assert.equal(ruling.kind === "decision" && ruling.view.otherOptionId, "b");
});

test("an open decision has state open and no answer label", () => {
  const [entry] = view([], [decision()]);
  assert.equal(entry.kind, "decision");
  if (entry.kind !== "decision") return;
  assert.equal(entry.state, "open");
  assert.equal(entry.answerLabel, null);
  assert.equal(entry.at, "2026-10-08T11:00:00.000Z");
  assert.equal(entry.view.meta, "GROUP-13, asked by Main orchestrator 1 h ago");
});

test("an answered decision shows the label of the answered option", () => {
  const [entry] = view(
    [],
    [
      decision({
        state: "answered",
        answer: { optionId: "a", note: null },
        answeredAt: "2026-10-08T11:10:00.000Z",
      }),
    ],
  );
  assert.equal(entry.kind, "decision");
  if (entry.kind !== "decision") return;
  assert.equal(entry.state, "answered");
  assert.equal(entry.answerLabel, "Give 2 more rounds");
});

test("an answered decision whose option is gone has a null label", () => {
  const [entry] = view(
    [],
    [
      decision({
        state: "answered",
        answer: { optionId: "zzz", note: null },
      }),
    ],
  );
  assert.equal(entry.kind === "decision" && entry.answerLabel, null);
});

test("a decision entry carries its kind and the typed note of its answer", () => {
  const [entry] = conversationView({
    messages: [],
    decisions: [
      {
        id: "d9",
        boardKey: DEFAULT_BOARD_KEY,
        cardId: null,
        orchestratorId: "main",
        kind: "ruling",
        question: "Which branch?",
        options: [
          { id: "a", label: "Main" },
          { id: "b", label: "Release" },
        ],
        recommendedOptionId: "a",
        state: "answered",
        answer: { optionId: "a", note: "Use the release branch after 18:00" },
        createdAt: "2026-10-11T10:00:00.000Z",
        answeredAt: "2026-10-11T10:05:00.000Z",
      },
    ],
    orchestratorId: "main",
    orchestratorName: "Main",
    orchestratorNames: new Map(),
    now: Date.parse("2026-10-11T11:00:00.000Z"),
  });
  assert.equal(entry?.kind, "decision");
  if (entry?.kind !== "decision") return;
  assert.equal(entry.decisionKind, "ruling");
  assert.equal(entry.badge, "Question");
  assert.equal(entry.answerLabel, "Main");
  assert.equal(entry.answerNote, "Use the release branch after 18:00");
});

function answered(id: string, minute: number, orchestratorId = "main") {
  const at = `2026-10-08T10:${String(minute).padStart(2, "0")}:00.000Z`;
  return decision({
    id,
    orchestratorId,
    state: "answered",
    createdAt: `2026-10-08T09:${String(minute).padStart(2, "0")}:00.000Z`,
    answeredAt: at,
    answer: { optionId: "a", note: null },
  });
}

const KEPT = [
  "a06",
  "a07",
  "a08",
  "a09",
  "a10",
  "a11",
  "a12",
  "a13",
  "a14",
  "a15",
  "a16",
  "a17",
  "a18",
  "a19",
  "a20",
  "a21",
  "a22",
  "a23",
  "a24",
  "a25",
];

function answeredRange(count: number, orchestratorId = "main") {
  return Array.from({ length: count }, (_, i) =>
    answered(`a${String(i + 1).padStart(2, "0")}`, i + 1, orchestratorId),
  );
}

test("the cap is 20", () => {
  assert.equal(ANSWERED_DECISION_CAP, 20);
});

test("25 answered and 3 open give the 20 newest answered and the 3 open", () => {
  const open = ["o1", "o2", "o3"].map((id) =>
    decision({ id, createdAt: "2026-10-08T11:00:00.000Z" }),
  );
  const entries = view([], [...answeredRange(25), ...open]);
  assert.deepEqual(ids(entries).sort(), [...KEPT, "o1", "o2", "o3"].sort());
});

test("exactly 20 answered all stay", () => {
  assert.equal(view([], answeredRange(20)).length, 20);
});

test("the cap counts only the answered decisions of the selected orchestrator", () => {
  const entries = view(
    [],
    [...answeredRange(25, "extra-1"), ...answeredRange(25)],
  );
  assert.deepEqual(ids(entries), KEPT);
});

test("an answered decision with no answer time falls back to its creation time", () => {
  const stale = answered("old", 59);
  stale.answeredAt = null;
  stale.createdAt = "2026-10-08T08:00:00.000Z";
  const entries = view([], [...answeredRange(20), stale]);
  assert.equal(ids(entries).includes("old"), false);
});

test("an item in both the open and the answered list shows once, as answered", () => {
  const entries = view([], [decision({ id: "d9" }), answered("d9", 5)]);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.kind === "decision" && entry.state, "answered");
});
