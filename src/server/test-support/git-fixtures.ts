import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../adapters/exec.js";
import { worktreeAddNewBranch } from "../adapters/git.js";

/**
 * A throwaway git repo with one commit on `main`, plus an empty workspace folder beside it, for
 * tests that need real worktrees. Callers remove `root` when done.
 */
export async function tempRepoWithWorkspace(): Promise<{
  root: string;
  repo: string;
  ws: string;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-git-fixture-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
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
  const ws = path.join(root, "ws");
  fs.mkdirSync(ws);
  return { root, repo, ws };
}

/** Register a real worktree for `branch` at `<ws>/repo`, cut from `main`. */
export async function addWorktree(
  repo: string,
  ws: string,
  branch: string,
): Promise<string> {
  const worktree = path.join(ws, "repo");
  await worktreeAddNewBranch(repo, worktree, branch, "main");
  return worktree;
}
