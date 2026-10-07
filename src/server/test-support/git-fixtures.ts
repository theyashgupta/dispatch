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

/** The trimmed stdout of one git command run in `repo`. */
export async function gitOutput(
  repo: string,
  ...args: string[]
): Promise<string> {
  return (await run("git", args, { cwd: repo })).stdout.trim();
}

export const SHIP_IDENTITY = { name: "Ship Bot", email: "ship@example.com" };

/**
 * A temp repository with a local bare `origin` and a worktree at `<ws>/repo` holding the stack.
 *
 * @remarks `unit-1` adds `a.txt` from `main`, `unit-2` adds `b.txt` on top of it and the specs
 * branch `test/ship-specs` adds `docs/spec.md` on top of that. The repository config carries
 * {@link SHIP_IDENTITY}.
 */
export async function shipStack(): Promise<{
  root: string;
  repo: string;
  ws: string;
  bare: string;
  worktree: string;
}> {
  const { root, repo, ws } = await tempRepoWithWorkspace();
  const bare = path.join(root, "origin.git");
  await run("git", ["init", "-q", "--bare", "-b", "main", bare]);
  await gitOutput(repo, "remote", "add", "origin", bare);
  await gitOutput(repo, "push", "-q", "origin", "main");
  await gitOutput(repo, "config", "user.name", SHIP_IDENTITY.name);
  await gitOutput(repo, "config", "user.email", SHIP_IDENTITY.email);
  const worktree = await addWorktree(repo, ws, "group-work");
  for (const [branch, from, file] of [
    ["unit-1", "main", "a.txt"],
    ["unit-2", "unit-1", "b.txt"],
    ["test/ship-specs", "unit-2", "docs/spec.md"],
  ] as const) {
    await gitOutput(worktree, "checkout", "-q", "-b", branch, from);
    fs.mkdirSync(path.dirname(path.join(worktree, file)), { recursive: true });
    fs.writeFileSync(path.join(worktree, file), `${branch}\n`);
    await gitOutput(worktree, "add", "-A");
    await gitOutput(worktree, "commit", "-qm", `${branch} work`);
  }
  await gitOutput(worktree, "checkout", "-q", "group-work");
  return { root, repo, ws, bare, worktree };
}

/** Write or delete files in a fresh clone of `bare` and push one commit to its branch `branch`. */
export async function pushToBranch(
  bare: string,
  branch: string,
  files: Record<string, string | null>,
  message: string,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-push-"));
  try {
    await run("git", ["clone", "-q", "-b", branch, bare, dir]);
    for (const [file, text] of Object.entries(files)) {
      if (text === null) await gitOutput(dir, "rm", "-q", file);
      else fs.writeFileSync(path.join(dir, file), text);
    }
    await gitOutput(dir, "add", "-A");
    await gitOutput(
      dir,
      "-c",
      `user.name=${SHIP_IDENTITY.name}`,
      "-c",
      `user.email=${SHIP_IDENTITY.email}`,
      "commit",
      "-qm",
      message,
    );
    await gitOutput(dir, "push", "-q", "origin", `HEAD:${branch}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function pushToMain(
  bare: string,
  files: Record<string, string | null>,
  message: string,
): Promise<void> {
  return pushToBranch(bare, "main", files, message);
}
