import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../../adapters/exec.js";
import { branchExists, worktreeAddNewBranch } from "../../adapters/git.js";
import { dirtyRepos, removeWorkspaceFiles } from "./cleanup.js";

async function tempRepo(): Promise<{ root: string; repo: string; ws: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-cleanup-"));
  const repo = path.join(root, "repo");
  const git = (...args: string[]) => run("git", args, { cwd: repo });
  fs.mkdirSync(repo);
  await git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "hi\n");
  await git("add", ".");
  await git(
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    "init",
  );
  const ws = path.join(root, "ws", "GROUP-1");
  fs.mkdirSync(ws, { recursive: true });
  return { root, repo, ws };
}

void test("dirtyRepos reports uncommitted work per repo and treats a missing worktree as clean", async () => {
  const { root, repo, ws } = await tempRepo();
  try {
    assert.deepEqual(await dirtyRepos(ws, [repo]), {
      blocked: [],
      nonOrphanError: false,
    });
    await worktreeAddNewBranch(repo, path.join(ws, "repo"), "GROUP-1", "main");
    assert.deepEqual((await dirtyRepos(ws, [repo])).blocked, []);
    fs.writeFileSync(path.join(ws, "repo", "scratch.txt"), "x");
    fs.writeFileSync(path.join(ws, "repo", "README.md"), "changed\n");
    assert.deepEqual((await dirtyRepos(ws, [repo])).blocked, [
      { repo: "repo", count: 2 },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("removeWorkspaceFiles removes the worktree and folder, keeps the branch, and tolerates absence", async () => {
  const { root, repo, ws } = await tempRepo();
  try {
    await worktreeAddNewBranch(repo, path.join(ws, "repo"), "GROUP-1", "main");
    fs.writeFileSync(path.join(ws, "repo", "scratch.txt"), "x");
    const removed = await removeWorkspaceFiles(ws, [repo]);
    assert.deepEqual(removed.failures, []);
    assert.equal(fs.existsSync(ws), false, "workspace folder gone");
    assert.equal(await branchExists(repo, "GROUP-1"), true, "branch survives");
    const registered = (await run("git", ["worktree", "list"], { cwd: repo }))
      .stdout;
    assert.ok(!registered.includes("GROUP-1"), "registration pruned");
    const again = await removeWorkspaceFiles(ws, [repo]);
    assert.deepEqual(again.failures, [], "second run is a no-op");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
