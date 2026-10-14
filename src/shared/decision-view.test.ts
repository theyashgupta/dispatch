import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionFailedText,
  decisionViews,
  liveReplyResults,
  refusalText,
  replyFeedback,
  replyKey,
  replyOutcomeText,
} from "./decision-view.js";
import type { BoardKey } from "./types.js";

const row = {
  kind: "needs_input",
  cardId: "GROUP-1",
  text: "Which branch?",
  stateSince: "2026-10-08T10:00:00.000Z",
};

test("a reply key changes when the kind, the question or its time changes", () => {
  const key = replyKey(row);
  assert.equal(replyKey({ ...row }), key);
  assert.notEqual(replyKey({ ...row, kind: "stale" }), key);
  assert.notEqual(replyKey({ ...row, stateSince: "t2" }), key);
  assert.notEqual(replyKey({ ...row, text: "B?" }), key);
});

test("a stale reply key ignores the wait text but a needs_input key does not", () => {
  const stale = { ...row, kind: "stale", text: "No progress for 15 min." };
  const later = { ...stale, text: "No progress for 16 min." };
  assert.equal(replyKey(later), replyKey(stale));
  assert.notEqual(replyKey({ ...later, stateSince: "t2" }), replyKey(stale));
  const stored = { "GROUP-1": { result: "confirmed", key: replyKey(stale) } };
  assert.deepEqual(liveReplyResults(stored, [later]), {
    "GROUP-1": "confirmed",
  });
  const asked = { "GROUP-1": { result: "confirmed", key: replyKey(row) } };
  assert.deepEqual(liveReplyResults(asked, [{ ...row, text: "Again?" }]), {});
});

test("a reply result drops when the row question or state changes or the row leaves", () => {
  const stored = { "GROUP-1": { result: "confirmed", key: replyKey(row) } };
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

test("a reply result keeps its own type, for example the line the dashboard shows", () => {
  const stored = { "GROUP-1": { result: "Not sent.", key: replyKey(row) } };
  assert.deepEqual(liveReplyResults(stored, [row]), { "GROUP-1": "Not sent." });
});

test("a reply outcome reads Delivered, the unconfirmed copy or the refusal sentence", () => {
  assert.equal(
    replyOutcomeText({ ok: true, result: "confirmed" }, "CEN-1", undefined),
    "Delivered",
  );
  assert.equal(
    replyOutcomeText({ ok: true, result: null }, "CEN-1", undefined),
    "Not confirmed. Check the terminal.",
  );
  assert.equal(
    replyOutcomeText(
      {
        ok: false,
        error: "session-state-refused",
        reason: "session is at shell_prompt",
      },
      "GROUP-1",
      "shell_prompt",
    ),
    "Not sent. GROUP-1 is now at Claude exited. Open the terminal.",
  );
  assert.equal(
    replyOutcomeText(
      { ok: false, error: "session-state-refused", reason: null },
      "CEN-1",
      "permission_prompt",
    ),
    "Not sent. CEN-1 is now at Permission prompt. Open the terminal.",
  );
  assert.equal(
    replyOutcomeText(
      { ok: false, error: "no-live-session", reason: null },
      "GROUP-1",
      "needs_input",
    ),
    null,
  );
});

test("the failed action text ends in one period", () => {
  assert.equal(actionFailedText("Stop", "boom."), "Stop failed: boom.");
  assert.equal(
    actionFailedText("Resume loop", "no-live-session"),
    "Resume loop failed: no-live-session.",
  );
});

test("refusal codes map to plain text and unknown codes never show raw", () => {
  const codes = [
    "orchestrator-busy",
    "unknown-decision",
    "invalid-option",
    "session-busy",
    "no-live-session",
    "no-loop",
    "ship-running",
    "not-resumable",
  ];
  for (const code of codes) {
    const text = refusalText(code, "server wording");
    assert.notEqual(text, code);
    assert.notEqual(text, "server wording");
    assert.doesNotMatch(text, /[a-z]+-[a-z]+/);
  }
  assert.equal(
    refusalText("no-live-session", null),
    "there is no open session",
  );
  assert.equal(
    refusalText("policy-refused", "supervisor-off"),
    "the supervisor is off",
  );
  assert.equal(refusalText("weird-code", "because"), "because");
  assert.equal(
    refusalText("weird-code", null),
    "the request failed (weird-code)",
  );
  assert.equal(refusalText(null, null), "the request failed");
});

test("every refusal code a user route can return has plain text", () => {
  const codes = [
    "supervisor-off",
    "orchestrator-running",
    "orchestrator-session-live",
    "orchestrator-not-resumable",
    "orchestrator-not-running",
    "orchestrator-busy",
    "orchestrator-start-failed",
    "orchestrator-resume-failed",
    "unknown-orchestrator",
    "unknown-board",
    "unknown-card",
    "duplicate-id",
    "main-exists",
    "extra-needs-main",
    "main-has-scope",
    "main-has-override",
    "extra-needs-scope",
    "group-owned",
    "ticket-owned",
    "wider-override",
    "empty-patch",
    "invalid-id",
    "invalid-orchestrator-id",
    "invalid-name",
    "invalid-role",
    "invalid-groupIds",
    "invalid-ticketIds",
    "invalid-card-id",
    "invalid-roadmapApproval",
    "invalid-usageLimit",
    "invalid-shipRights",
    "invalid-supervisor",
    "invalid-loopModel",
    "invalid-orchestratorModel",
    "invalid-concurrencyCap",
    "invalid-handoffPercent",
    "invalid-handoffHardPercent",
    "hard-below-handoff",
    "invalid-memoryFloorMb",
    "invalid-swapCeilingMb",
    "invalid-budgetPerGroup",
    "invalid-policy",
    "unknown-field",
    "invalid-body",
    "invalid-text",
    "session-state-refused",
    "no-live-session",
    "session-busy",
    "no-loop",
    "ship-running",
    "not-resumable",
    "unknown-decision",
    "already-answered",
    "invalid-option",
    "invalid-note",
    "invalid-state",
    "session is already live",
    "card has no lost session to resume",
    "card has no workspace to resume",
    "a start is in flight for this card",
  ];
  for (const code of codes) {
    const text = refusalText(code, null);
    assert.ok(!text.startsWith("the request failed"), code);
    assert.ok(
      !/\b[a-z]+-[a-z]+\b/i.test(text.replace(/hyphens|open PRs/g, "")),
      code,
    );
    assert.ok(!/\u2014|--/.test(text), code);
  }
});

test("a plan is a gate with its rows in plan order and no other answer", () => {
  const entries = [
    { ref: "CEN-2", playbook: "PRD + Ralph Loop", order: 2, size: "medium" },
    { ref: "CEN-1", playbook: "Write code directly", order: 1, size: "small" },
  ] as const;
  const [view] = decisionViews(
    [
      {
        id: "d1",
        boardKey: "CEN" as BoardKey,
        cardId: null,
        orchestratorId: "main",
        kind: "plan",
        question: "Two tickets.",
        options: [
          { id: "approve", label: "Approve the plan" },
          { id: "reject", label: "Do not approve" },
        ],
        recommendedOptionId: "approve",
        state: "open",
        answer: null,
        createdAt: "2026-10-11T10:00:00.000Z",
        answeredAt: null,
        plan: { entries: [...entries] },
      },
    ],
    new Map(),
    Date.parse("2026-10-11T10:05:00.000Z"),
  );
  assert.equal(view?.otherOptionId, null);
  assert.deepEqual(
    view?.planRows.map((r) => r.ref),
    ["CEN-1", "CEN-2"],
  );
  assert.deepEqual(view?.proposalTitles, []);
});

test("a reply feedback gives the result for a send and the failure only for a refusal with no result", () => {
  assert.deepEqual(
    replyFeedback(
      { ok: true, result: "confirmed" },
      "CEN-1",
      undefined,
      "Reply",
    ),
    { result: "Delivered", failure: null },
  );
  assert.deepEqual(
    replyFeedback(
      { ok: false, error: "session-state-refused", reason: null },
      "CEN-1",
      "permission_prompt",
      "Reply",
    ),
    {
      result: "Not sent. CEN-1 is now at Permission prompt. Open the terminal.",
      failure: null,
    },
  );
  assert.deepEqual(
    replyFeedback(
      { ok: false, error: "no-live-session", reason: null },
      "CEN-1",
      "needs_input",
      "Message",
    ),
    { result: null, failure: "Message failed: there is no open session." },
  );
});
