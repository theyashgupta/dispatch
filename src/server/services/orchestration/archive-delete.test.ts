import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { openBoardDb } = await import("../../store/board-db.js");
const { unwindGroup } = await import("./unwind.js");
const { deleteArchivedGroup } = await import("./archive-delete.js");
const { branchExists } = await import("../../adapters/git.js");
const { tempRepoWithWorkspace, addWorktree } =
  await import("../../test-support/git-fixtures.js");

const { root, repo } = await tempRepoWithWorkspace();

async function archivedGroupWithWorktree() {
  const ws = path.join(root, "ws", `g${Date.now()}${Math.random()}`);
  fs.mkdirSync(ws, { recursive: true });
  const { g } = await startedGroup(store, {
    workspacePath: ws,
    repos: [{ path: repo, base: "main" }],
  });
  await addWorktree(repo, ws, g.id);
  const outcome = await unwindGroup(g.id, "todo");
  assert.equal(outcome.ok, true);
  return { g, ws };
}

void test("a dirty archived worktree refuses without force, records the reason, then force removes it and keeps the branch", async () => {
  const { g, ws } = await archivedGroupWithWorktree();
  fs.writeFileSync(path.join(ws, "repo", "wip.txt"), "unsaved");
  assert.equal(await deleteArchivedGroup(g.id, false), "blocked");
  assert.equal(
    store.getArchived(g.id)?.deleteBlocked,
    "repo: 1 uncommitted change",
  );
  assert.equal(fs.existsSync(ws), true, "nothing removed");

  assert.equal(await deleteArchivedGroup(g.id, true), "deleted");
  assert.equal(fs.existsSync(ws), false, "workspace folder gone");
  assert.equal(await branchExists(repo, g.id), true, "branch survives");
  assert.equal(store.getArchived(g.id), undefined, "row dropped");
});

void test("a clean archived worktree is deleted without force; an unknown id is missing", async () => {
  const { g, ws } = await archivedGroupWithWorktree();
  assert.equal(await deleteArchivedGroup(g.id, false), "deleted");
  assert.equal(fs.existsSync(ws), false);
  assert.equal(store.getArchived(g.id), undefined);
  assert.equal(await deleteArchivedGroup("GROUP-nope", true), "missing");
});

void test("two concurrent deletes of the same row report deleted exactly once", async () => {
  const { g, ws } = await archivedGroupWithWorktree();
  const outcomes = await Promise.all([
    deleteArchivedGroup(g.id, true),
    deleteArchivedGroup(g.id, true),
  ]);
  assert.deepEqual(outcomes.sort(), ["busy", "deleted"]);
  assert.equal(fs.existsSync(ws), false);
  assert.equal(
    store.listEvents(g.id, 10).filter((e) => e.type === "archive_deleted")
      .length,
    1,
  );
});

void test("a delete racing a restore never destroys a live group's worktree (either ordering is safe)", async () => {
  const { g, ws } = await archivedGroupWithWorktree();
  const [restored, outcome] = await Promise.all([
    store.restoreGroup(g.id),
    deleteArchivedGroup(g.id, true),
  ]);
  if (restored.ok) {
    assert.equal(
      outcome,
      "restored",
      "delete refused because the group is live",
    );
    assert.equal(fs.existsSync(path.join(ws, "repo")), true, "worktree intact");
    assert.ok(store.getCard(g.id), "group live");
    assert.equal(
      store.getArchived(g.id),
      undefined,
      "row dropped by the restore",
    );
  } else {
    assert.equal(restored.reason, "delete in progress");
    assert.equal(outcome, "deleted", "delete held the bracket first");
    assert.equal(store.getCard(g.id), undefined, "group never re-inserted");
    assert.equal(fs.existsSync(ws), false);
  }
});

void test("a probe error refuses without force and records the preflight reason; force still deletes", async () => {
  const { g, ws } = await archivedGroupWithWorktree();
  const gitFile = path.join(ws, "repo", ".git");
  fs.chmodSync(gitFile, 0o000);
  try {
    assert.equal(await deleteArchivedGroup(g.id, false), "blocked");
    assert.equal(
      store.getArchived(g.id)?.deleteBlocked,
      "Preflight failed. A worktree could not be checked.",
    );
    assert.equal(fs.existsSync(ws), true, "nothing removed");
  } finally {
    fs.chmodSync(gitFile, 0o644);
  }
  assert.equal(await deleteArchivedGroup(g.id, true), "deleted");
  assert.equal(fs.existsSync(ws), false);
});

void test("a removal failure keeps the row with the failure recorded", async () => {
  const { g, ws } = await archivedGroupWithWorktree();
  const parent = path.dirname(ws);
  fs.chmodSync(parent, 0o500);
  try {
    assert.equal(await deleteArchivedGroup(g.id, true), "failed");
    assert.match(
      store.getArchived(g.id)?.deleteBlocked ?? "",
      /^Cleanup incomplete: /,
    );
    assert.ok(store.getArchived(g.id), "row kept");
  } finally {
    fs.chmodSync(parent, 0o755);
  }
  assert.equal(
    await deleteArchivedGroup(g.id, true),
    "deleted",
    "retry after the cause is gone",
  );
});

void test("a delete on a row whose group is live again refuses as restored, even with force", async () => {
  const { g, ws } = await archivedGroupWithWorktree();
  const row = structuredClone(store.getArchived(g.id)!);
  assert.equal((await store.restoreGroup(g.id)).ok, true);
  openBoardDb().upsertArchive(row);
  assert.equal(await deleteArchivedGroup(g.id, true), "restored");
  assert.equal(
    fs.existsSync(path.join(ws, "repo")),
    true,
    "live worktree intact",
  );
  assert.ok(store.getArchived(g.id), "stale row left for restore to reconcile");
});
