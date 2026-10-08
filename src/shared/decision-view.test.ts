import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionFailedText,
  liveReplyResults,
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
