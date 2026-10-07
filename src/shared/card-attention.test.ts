import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionTitle, errorCopy, needsAttention } from "./card-attention.js";
import type { Card } from "./types.js";

function card(extra: Partial<Card> = {}): Card {
  return {
    id: "c1",
    issueId: "i1",
    identifier: "LOCAL-1",
    title: "A card",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...extra,
  };
}

test("errorCopy names the branch conflict with the identifier", () => {
  assert.deepEqual(
    errorCopy({ step: "s", stderr: "", variant: "branch-conflict" }, "LOCAL-9"),
    {
      heading: "Start failed: branch checked out elsewhere",
      detail: "Branch LOCAL-9 is attached to another worktree.",
    },
  );
});

test("errorCopy names a Claude start timeout without a detail", () => {
  assert.deepEqual(
    errorCopy({ step: "s", stderr: "", variant: "repl-timeout" }, "LOCAL-9"),
    { heading: "Start failed: Claude didn't start" },
  );
});

test("errorCopy falls back to the failed step for every other variant", () => {
  const expected = { heading: "Start failed: creating worktrees" };
  assert.deepEqual(
    errorCopy({ step: "creating worktrees", stderr: "" }, "LOCAL-9"),
    expected,
  );
  assert.deepEqual(
    errorCopy(
      { step: "creating worktrees", stderr: "", variant: "config" },
      "LOCAL-9",
    ),
    expected,
  );
});

test("a card with no attention condition needs none and has no title", () => {
  assert.equal(needsAttention(card()), false);
  assert.equal(attentionTitle(card()), null);
  assert.equal(needsAttention(card({ startError: null })), false);
  assert.equal(needsAttention(card({ cleanupBlocked: [] })), false);
});

test("a start error needs attention and its heading is the title", () => {
  const withError = card({ startError: { step: "git", stderr: "x" } });
  assert.equal(needsAttention(withError), true);
  assert.equal(attentionTitle(withError), "Start failed: git");
});

test("a lost session needs attention outside Done and not inside it", () => {
  const lost = card({ sessionLost: true });
  assert.equal(needsAttention(lost), true);
  assert.equal(attentionTitle(lost), "Session lost");
  const done = card({ sessionLost: true, column: "done" });
  assert.equal(needsAttention(done), false);
  assert.equal(attentionTitle(done), null);
});

test("blocked cleanup needs attention", () => {
  const blocked = card({ cleanupBlocked: [{ repo: "api", count: 2 }] });
  assert.equal(needsAttention(blocked), true);
  assert.equal(attentionTitle(blocked), "Uncommitted work: cleanup blocked");
});

test("the first matching condition wins the title: start error, then lost session, then cleanup", () => {
  const all = card({
    startError: { step: "git", stderr: "" },
    sessionLost: true,
    cleanupBlocked: [{ repo: "api", count: 1 }],
  });
  assert.equal(attentionTitle(all), "Start failed: git");
  const lostAndBlocked = card({
    sessionLost: true,
    cleanupBlocked: [{ repo: "api", count: 1 }],
  });
  assert.equal(attentionTitle(lostAndBlocked), "Session lost");
});
