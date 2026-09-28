import test from "node:test";
import assert from "node:assert/strict";
import type { Card, Session } from "../../../shared/types.js";
import { buildWorktreeRows } from "./workspace-inventory.js";

function session(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T11:00:00.000Z",
    workspacePath: `/ws/${id}`,
    workspace: {
      folder: "/repos",
      repos: [
        { path: "/repos/app", base: "main" },
        { path: "/repos/api", base: "main" },
      ],
    },
    branch: `branch-${id}`,
    tmuxSession: `dsp-${id}`,
    ...extra,
  };
}

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    issueId: id,
    identifier: id,
    title: `Title ${id}`,
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-09-20T11:00:00.000Z",
    ...extra,
  };
}

void test("a card with no sessions yields no rows", () => {
  assert.deepEqual(buildWorktreeRows([card("LOCAL-1")]), []);
});

void test("a session without a workspace path never becomes a row", () => {
  const rows = buildWorktreeRows([
    card("LOCAL-1", {
      sessions: [session("s1", { workspacePath: undefined })],
    }),
  ]);
  assert.deepEqual(rows, []);
});

void test("a two-session card yields two rows, active only on the active session", () => {
  const rows = buildWorktreeRows([
    card("LOCAL-2", {
      sessions: [session("s1"), session("s2")],
      activeSessionId: "s2",
    }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.sessionId, r.active]),
    [
      ["s1", false],
      ["s2", true],
    ],
  );
});

void test("row fields come from the session record", () => {
  const [row] = buildWorktreeRows([
    card("LOCAL-3", {
      column: "done",
      sessions: [
        session("s1", {
          tmuxSession: undefined,
          cleanupDueAt: 1790773012426,
          cleanupBlocked: [{ repo: "app", count: 2 }],
        }),
      ],
      activeSessionId: "s1",
    }),
  ]);
  assert.deepEqual(row, {
    cardId: "LOCAL-3",
    identifier: "LOCAL-3",
    title: "Title LOCAL-3",
    column: "done",
    sessionId: "s1",
    active: true,
    lost: true,
    workspacePath: "/ws/s1",
    branch: "branch-s1",
    repos: ["app", "api"],
    sizeKb: null,
    lastCommitAt: null,
    cleanupDueAt: 1790773012426,
    blocked: [{ repo: "app", count: 2 }],
  });
});

void test("absent optional fields default to null and empty", () => {
  const [row] = buildWorktreeRows([
    card("LOCAL-4", {
      sessions: [session("s1", { branch: undefined, workspace: undefined })],
    }),
  ]);
  assert.equal(row?.branch, null);
  assert.deepEqual(row?.repos, []);
  assert.equal(row?.cleanupDueAt, null);
  assert.deepEqual(row?.blocked, []);
  assert.equal(row?.lost, false);
  assert.equal(row?.active, false);
});
