import test from "node:test";
import assert from "node:assert/strict";
import type { WorktreeRow } from "../../../shared/types.js";
import { sortWorktreeRows, worktreeActions } from "./workspace-rows.js";

function row(
  identifier: string,
  extra: Partial<WorktreeRow> = {},
): WorktreeRow {
  return {
    cardId: identifier,
    identifier,
    title: identifier,
    column: "done",
    sessionId: `s-${identifier}`,
    active: true,
    lost: false,
    workspacePath: `/ws/${identifier}`,
    branch: identifier,
    repos: ["app"],
    sizeKb: null,
    lastCommitAt: null,
    cleanupDueAt: null,
    blocked: [],
    ...extra,
  };
}

const ids = (rows: WorktreeRow[]) => rows.map((r) => r.identifier);

const rows = [
  row("A", { cleanupDueAt: 300, sizeKb: 40, lastCommitAt: 50 }),
  row("B", { cleanupDueAt: 100, sizeKb: 30, lastCommitAt: 10 }),
  row("C", { cleanupDueAt: null, sizeKb: null, lastCommitAt: null }),
  row("D", { cleanupDueAt: 200, sizeKb: 20, lastCommitAt: 5 }),
];

void test("due sorts soonest first with no due date last", () => {
  assert.deepEqual(ids(sortWorktreeRows(rows, "due")), ["B", "D", "A", "C"]);
});

void test("size sorts largest first with unknown sizes last", () => {
  assert.deepEqual(ids(sortWorktreeRows(rows, "size")), ["A", "B", "D", "C"]);
});

void test("age sorts the oldest commit first with unknown ages last", () => {
  assert.deepEqual(ids(sortWorktreeRows(rows, "age")), ["D", "B", "A", "C"]);
});

void test("ties break on identifier then session id, and the input is not mutated", () => {
  const tied = [
    row("Z", { sessionId: "s2", sizeKb: 5 }),
    row("Y", { sizeKb: 5 }),
    row("Z", { sessionId: "s1", sizeKb: 5 }),
  ];
  const before = tied.map((r) => r.sessionId);
  const sorted = sortWorktreeRows(tied, "size");
  assert.deepEqual(
    sorted.map((r) => `${r.identifier}:${r.sessionId}`),
    ["Y:s-Y", "Z:s1", "Z:s2"],
  );
  assert.deepEqual(
    tied.map((r) => r.sessionId),
    before,
  );
});

void test("nulls stay last for every key", () => {
  const nulls = [
    row("N"),
    row("M", { cleanupDueAt: 1, sizeKb: 1, lastCommitAt: 1 }),
  ];
  for (const key of ["due", "size", "age"] as const) {
    assert.deepEqual(ids(sortWorktreeRows(nulls, key)), ["M", "N"]);
  }
});

void test("a Done active row offers the code editor and cleanup", () => {
  assert.deepEqual(
    worktreeActions(row("A", { column: "done" }), { code: true, cursor: true }),
    { editor: "code", cleanup: true },
  );
});

void test("a row outside Done never offers cleanup", () => {
  for (const column of ["in_progress", "needs_input", "agent_done"] as const) {
    assert.equal(
      worktreeActions(row("A", { column }), { code: true, cursor: false })
        .cleanup,
      false,
    );
  }
});

void test("a non-active session row never offers the editor", () => {
  assert.equal(
    worktreeActions(row("A", { active: false }), { code: true, cursor: true })
      .editor,
    null,
  );
});

void test("the editor falls back to cursor and is absent when neither is installed", () => {
  assert.equal(
    worktreeActions(row("A"), { code: false, cursor: true }).editor,
    "cursor",
  );
  assert.equal(
    worktreeActions(row("A"), { code: false, cursor: false }).editor,
    null,
  );
  assert.equal(worktreeActions(row("A"), undefined).editor, null);
});
