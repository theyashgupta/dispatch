import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Card, DecisionItem } from "../../../../shared/types.js";
import {
  askedAgo,
  attentionRows,
  decisionCount,
  decisionViews,
  liveReplyResults,
  replyKey,
  REPLY_COPY,
  stoppedLoops,
  stoppedLoopText,
} from "./decision-view.js";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

function item(patch: Partial<DecisionItem> = {}): DecisionItem {
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
      { id: "c", label: "Skip the phase" },
    ],
    recommendedOptionId: "b",
    state: "open",
    answer: null,
    createdAt: "2026-10-08T11:54:00.000Z",
    answeredAt: null,
    ...patch,
  };
}

function group(id: string, patch: Partial<Card> = {}): Card {
  return {
    id,
    boardKey: DEFAULT_BOARD_KEY,
    issueId: id,
    identifier: id,
    title: id,
    description: null,
    priority: 3,
    column: "needs_input",
    updatedAt: "2026-10-08T10:00:00.000Z",
    source: "group",
    ...patch,
  };
}

const names = new Map([["main", "Main orchestrator"]]);

test("a decision item shows its question, line 2 and the options in written order", () => {
  const [view] = decisionViews([item()], names, NOW);
  assert.equal(view?.question, "How should the loop continue?");
  assert.equal(view?.meta, "GROUP-13, asked by Main orchestrator 6 min ago");
  assert.deepEqual(
    view?.options.map((o) => [o.id, o.recommended]),
    [
      ["a", false],
      ["b", true],
      ["c", false],
    ],
  );
});

test("a board level item says Board and an unknown orchestrator shows its id", () => {
  const [view] = decisionViews(
    [item({ cardId: null, orchestratorId: "gone" })],
    names,
    NOW,
  );
  assert.equal(view?.meta, "Board, asked by gone 6 min ago");
});

test("only open items show", () => {
  const views = decisionViews(
    [item(), item({ id: "d2", state: "answered" })],
    names,
    NOW,
  );
  assert.deepEqual(
    views.map((v) => v.id),
    ["d1"],
  );
});

test("the other answer uses the recommended option, else the first, else none", () => {
  assert.equal(decisionViews([item()], names, NOW)[0]?.otherOptionId, "b");
  assert.equal(
    decisionViews([item({ recommendedOptionId: null })], names, NOW)[0]
      ?.otherOptionId,
    "a",
  );
  assert.equal(
    decisionViews(
      [item({ options: [], recommendedOptionId: null })],
      names,
      NOW,
    )[0]?.otherOptionId,
    null,
  );
});

test("a ticket proposal lists its proposed titles and other kinds list none", () => {
  const proposal = {
    tickets: [
      { title: "First", description: "" },
      { title: "Second", description: "" },
    ],
    usedIndexes: [],
  };
  assert.deepEqual(
    decisionViews([item({ kind: "ticket_proposal", proposal })], names, NOW)[0]
      ?.proposalTitles,
    ["First", "Second"],
  );
  assert.deepEqual(
    decisionViews([item({ kind: "ruling", proposal })], names, NOW)[0]
      ?.proposalTitles,
    [],
  );
});

test("the age reads in minutes, hours and days", () => {
  const ago = (ms: number) => askedAgo(new Date(NOW - ms).toISOString(), NOW);
  assert.equal(ago(10_000), "under 1 min ago");
  assert.equal(ago(59 * 60_000), "59 min ago");
  assert.equal(ago(3 * 3_600_000), "3 h ago");
  assert.equal(ago(2 * 86_400_000), "2 d ago");
  assert.equal(askedAgo("nope", NOW), "");
});

test("attention rows: a reply row at needs_input and a prompt row at permission_prompt", () => {
  const rows = attentionRows([
    group("GROUP-1", { state: "needs_input", statusReason: "Which branch?" }),
    group("GROUP-2", { state: "permission_prompt", statusReason: "Run rm?" }),
    group("GROUP-3", { state: "working" }),
    group("GROUP-4", { state: "needs_input", stateReason: "usage_stop" }),
    group("GROUP-5", { state: "needs_input", stateReason: "budget" }),
    group("GROUP-6", { state: "needs_input", stateReason: "stop_session" }),
    group("LOCAL-1", { state: "needs_input", source: "linear" }),
    group("HID-1", { state: "needs_input", source: "orchestrator" }),
  ]);
  assert.deepEqual(rows, [
    {
      kind: "needs_input",
      cardId: "GROUP-1",
      text: "Which branch?",
      stateSince: null,
    },
    {
      kind: "permission_prompt",
      cardId: "GROUP-2",
      text: "Run rm?",
      stateSince: null,
    },
    { kind: "needs_input", cardId: "GROUP-6", text: null, stateSince: null },
  ]);
});

test("stopped loops are group sessions at needs_input with usage_stop or budget", () => {
  const loops = stoppedLoops([
    group("GROUP-4", {
      state: "needs_input",
      stateReason: "usage_stop",
      stateSince: "2026-10-08T09:05:00.000Z",
    }),
    group("GROUP-5", { state: "needs_input", stateReason: "budget" }),
    group("GROUP-6", { state: "needs_input", stateReason: "stop_session" }),
    group("GROUP-7", { state: "working", stateReason: "budget" }),
  ]);
  assert.deepEqual(
    loops.map((l) => [l.cardId, l.reason]),
    [
      ["GROUP-4", "usage limit (policy Stop)"],
      ["GROUP-5", "budget reached"],
    ],
  );
  assert.equal(
    stoppedLoopText(loops[0], "21:05"),
    "GROUP-4 stopped at 21:05: usage limit (policy Stop)",
  );
});

test("the reply copy and the tab count follow the contract", () => {
  assert.equal(REPLY_COPY.confirmed, "Delivered");
  assert.equal(REPLY_COPY.unconfirmed, "Not confirmed. Check the terminal.");
  const views = decisionViews([item()], names, NOW);
  const rows = attentionRows([group("GROUP-1", { state: "needs_input" })]);
  assert.equal(decisionCount(views, rows), 2);
  assert.equal(decisionCount([], []), 0);
});

test("an approval gate item or ticket proposal has no other answer", () => {
  for (const kind of ["roadmap_approval", "ticket_proposal"] as const) {
    assert.equal(
      decisionViews([item({ kind })], names, NOW)[0]?.otherOptionId,
      null,
    );
  }
});

test("a reply result drops when the row question or state changes or the row leaves", () => {
  const row = {
    kind: "needs_input" as const,
    cardId: "GROUP-1",
    text: "Which branch?",
    stateSince: "2026-10-08T10:00:00.000Z",
  };
  const stored = {
    "GROUP-1": { result: "confirmed" as const, key: replyKey(row) },
  };
  assert.deepEqual(liveReplyResults(stored, [row]), { "GROUP-1": "confirmed" });
  assert.deepEqual(liveReplyResults(stored, [{ ...row, text: "Again?" }]), {});
  assert.deepEqual(
    liveReplyResults(stored, [
      { ...row, stateSince: "2026-10-08T11:00:00.000Z" },
    ]),
    {},
  );
  assert.deepEqual(liveReplyResults(stored, []), {});
});
