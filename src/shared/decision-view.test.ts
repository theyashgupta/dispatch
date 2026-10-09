import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionFailedText,
  liveReplyResults,
  refusalText,
  replyKey,
} from "./decision-view.js";

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
