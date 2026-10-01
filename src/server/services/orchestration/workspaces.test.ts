import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../../adapters/exec.js";
import { discoverRepos } from "./workspaces.js";

async function initRepo(repo: string): Promise<void> {
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => run("git", args, { cwd: repo });
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
}

async function addWorktree(
  repo: string,
  worktree: string,
  branch = "wt",
): Promise<void> {
  await run("git", ["worktree", "add", "-q", "-b", branch, worktree, "main"], {
    cwd: repo,
  });
}

void test("discoverRepos keeps the main checkout and drops its worktrees, whichever is discovered first", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-discover-"));
  try {
    const a = path.join(root, "m-main");
    const b = path.join(root, "n-other");
    await initRepo(a);
    await initRepo(b);
    await addWorktree(a, path.join(root, "a-wt"), "wt-before");
    await addWorktree(a, path.join(root, "z-wt"), "wt-after");
    const repos = await discoverRepos(root);
    assert.deepEqual(repos.map((r) => r.path).sort(), [a, b]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("discoverRepos keeps a worktree whose main checkout is outside the folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-discover-"));
  try {
    const main = path.join(root, "main");
    const folder = path.join(root, "folder");
    fs.mkdirSync(folder);
    await initRepo(main);
    await addWorktree(main, path.join(folder, "wt"));
    const repos = await discoverRepos(folder);
    assert.deepEqual(
      repos.map((r) => r.path),
      [path.join(folder, "wt")],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
