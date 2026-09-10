import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";

process.env.DISPATCH_CLEANUP_TICK_MS = "300";
isolateEnv();
const { store } = await import("../../store/board.store.js");
const { openBoardDb } = await import("../../store/board-db.js");
const { unwindGroup } = await import("./unwind.js");
const { runArchiveSweep, startCleanupScheduler } =
  await import("./cleanup-scheduler.js");
const { tempRepoWithWorkspace, addWorktree } =
  await import("../../test-support/git-fixtures.js");
const fs = await import("node:fs");
const path = await import("node:path");

function backdate(id: string, days: number): void {
  const row = store.getArchived(id)!;
  row.archivedAt = new Date(Date.now() - days * 86_400_000).toISOString();
  openBoardDb().upsertArchive(row);
}

void test("runArchiveSweep deletes only rows past the retention window and skips blocked rows", async () => {
  const { g: old } = await startedGroup(store);
  const { g: young } = await startedGroup(store);
  const { g: blocked } = await startedGroup(store);
  for (const g of [old, young, blocked]) {
    assert.equal((await unwindGroup(g.id, "todo")).ok, true);
  }
  backdate(old.id, 31);
  backdate(blocked.id, 40);
  await store.recordArchiveDeleteBlocked(
    blocked.id,
    "repo: 1 uncommitted change",
  );

  store.setArchiveRetentionDays(0);
  await runArchiveSweep();
  assert.ok(store.getArchived(old.id), "retention 0 sweeps nothing");

  store.setArchiveRetentionDays(30);
  await runArchiveSweep();
  assert.equal(store.getArchived(old.id), undefined, "past-due row deleted");
  assert.ok(store.getArchived(young.id), "young row kept");
  assert.ok(store.getArchived(blocked.id), "blocked row never retried");
  assert.deepEqual(
    store.listEvents(old.id, 5).map((e) => e.type)[0],
    "archive_deleted",
  );
});

void test("the sweep never forces: a past-due dirty worktree is blocked with its reason and its files survive", async () => {
  const { root, repo, ws } = await tempRepoWithWorkspace();
  const { g } = await startedGroup(store, {
    workspacePath: ws,
    repos: [{ path: repo, base: "main" }],
  });
  await addWorktree(repo, ws, g.id);
  assert.equal((await unwindGroup(g.id, "todo")).ok, true);
  fs.writeFileSync(path.join(ws, "repo", "wip.txt"), "unsaved");
  backdate(g.id, 40);
  store.setArchiveRetentionDays(30);
  await runArchiveSweep();
  assert.equal(
    store.getArchived(g.id)?.deleteBlocked,
    "repo: 1 uncommitted change",
  );
  assert.equal(
    fs.existsSync(path.join(ws, "repo", "wip.txt")),
    true,
    "files survive",
  );
  await runArchiveSweep();
  assert.ok(store.getArchived(g.id), "blocked row is never retried");
  fs.rmSync(root, { recursive: true, force: true });
});

void test("startCleanupScheduler wires the archive sweep into its tick", async () => {
  const { g } = await startedGroup(store);
  assert.equal((await unwindGroup(g.id, "todo")).ok, true);
  backdate(g.id, 40);
  store.setArchiveRetentionDays(30);
  startCleanupScheduler();
  const deadline = Date.now() + 5_000;
  while (store.getArchived(g.id) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(store.getArchived(g.id), undefined, "swept by a real tick");
});
