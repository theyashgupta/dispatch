import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import type { Card } from "../../shared/types.js";

isolateEnv();
const { redactCard } = await import("./board.store.js");

function card(sessions: Card["sessions"], activeSessionId?: string): Card {
  return {
    id: "c1",
    issueId: "c1",
    identifier: "LOCAL-1",
    title: "t",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-09-02T00:00:00.000Z",
    hookToken: "secret-token",
    activeSessionId,
    sessions,
  };
}

void test("redactCard surfaces the active session's account and strips secrets", () => {
  const wire = redactCard(
    card(
      [
        {
          id: "s1",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          claudeAccountId: "default",
          tmuxSession: "dsp-LOCAL-1",
        },
        {
          id: "s2",
          createdAt: "2026-09-02T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:00.000Z",
          claudeAccountId: "11111111-1111-4111-8111-111111111111",
          tmuxSession: "dsp-LOCAL-1-2",
        },
      ],
      "s2",
    ),
  );
  assert.equal(wire.claudeAccountId, "11111111-1111-4111-8111-111111111111");
  assert.equal("hookToken" in wire, false);
  assert.equal("sessions" in wire, false);
  assert.deepEqual(
    wire.sessionSummaries?.map((s) => [s.id, s.claudeAccountId]),
    [
      ["s1", "default"],
      ["s2", "11111111-1111-4111-8111-111111111111"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(wire), /secret-token/);
});

void test("redactCard leaves the field absent when no session carries an account", () => {
  const wire = redactCard(
    card([{ id: "s1", createdAt: "x", updatedAt: "x" }], "s1"),
  );
  assert.equal("claudeAccountId" in wire, false);
});

void test("recordResumeFailure carries an account reason into resumeError, else the fixed copy", async () => {
  const { store } = await import("./board.store.js");
  await store.load();
  const created = await store.createLocalCard("resume reason", "");
  await store.recordResumeFailure(
    created.id,
    undefined,
    "Claude account a@example.com has no config directory; re-login from Settings, Accounts",
  );
  assert.equal(
    store.getCard(created.id)?.resumeError,
    "Resume failed: Claude account a@example.com has no config directory; re-login from Settings, Accounts",
  );
  await store.recordResumeFailure(created.id);
  assert.match(
    store.getCard(created.id)?.resumeError ?? "",
    /^Resume failed\. The worktree may be gone/,
  );
});
