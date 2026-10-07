import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionSummary } from "../../../../shared/types.js";
import { cleanupPlan } from "./cleanup-plan.js";

function summary(
  id: string,
  ordinal: number,
  cleanupBlocked?: { repo: string; count: number }[],
): SessionSummary {
  return {
    id,
    ordinal,
    lost: false,
    active: ordinal === 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    cleanupBlocked,
  };
}

test("a clean single-session card asks the plain question", () => {
  assert.deepEqual(cleanupPlan({}), {
    blocked: false,
    message:
      "Clean up workspace? Kills the session and removes worktrees; branches are kept.",
  });
});

test("an empty blocked list is not blocked", () => {
  assert.equal(cleanupPlan({ cleanupBlocked: [] }).blocked, false);
});

test("a blocked single-session card lists each repo with a file count", () => {
  assert.deepEqual(
    cleanupPlan({
      cleanupBlocked: [
        { repo: "api", count: 1 },
        { repo: "web", count: 3 },
      ],
    }),
    {
      blocked: true,
      lines: [
        { key: "api", text: "api: 1 uncommitted file" },
        { key: "web", text: "web: 3 uncommitted files" },
      ],
    },
  );
});

test("a single summary is judged by the card, not by the summary", () => {
  assert.deepEqual(
    cleanupPlan({
      sessionSummaries: [summary("s1", 1, [{ repo: "api", count: 2 }])],
      cleanupBlocked: [{ repo: "api", count: 2 }],
    }),
    {
      blocked: true,
      lines: [{ key: "api", text: "api: 2 uncommitted files" }],
    },
  );
});

test("a clean multi-session card names the session count", () => {
  assert.deepEqual(
    cleanupPlan({ sessionSummaries: [summary("s1", 1), summary("s2", 2)] }),
    {
      blocked: false,
      message:
        "Clean up all 2 sessions? Kills each session and removes its worktrees; branches are kept.",
    },
  );
});

test("a dirty multi-session card lists each dirty session", () => {
  assert.deepEqual(
    cleanupPlan({
      sessionSummaries: [
        summary("s1", 1),
        summary("s2", 2, [{ repo: "web", count: 1 }]),
      ],
    }),
    {
      blocked: true,
      lines: [{ key: "s2:web", text: "Session 2 (web): 1 uncommitted file" }],
    },
  );
});
