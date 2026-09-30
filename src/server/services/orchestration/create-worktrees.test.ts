import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Card, Config } from "../../../shared/types.js";
import { run } from "../../adapters/exec.js";
import { steps, type SagaContext } from "./steps.js";

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
  await git("remote", "add", "origin", repo);
}

void test("createWorktrees skips a saved repo entry that is a worktree of an earlier entry, with one warning", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-worktrees-"));
  try {
    const folder = path.join(root, "folder");
    const a = path.join(folder, "a");
    const aWorktree = path.join(folder, "a-wt");
    await initRepo(a);
    await run("git", ["worktree", "add", "-q", "-b", "wt", aWorktree, "main"], {
      cwd: a,
    });
    const workspacePath = path.join(root, "ws", "LOCAL-54");
    fs.mkdirSync(workspacePath, { recursive: true });
    const card: Card = {
      id: "LOCAL-54",
      issueId: "LOCAL-54",
      identifier: "LOCAL-54",
      title: "t",
      description: null,
      priority: 0,
      column: "in_progress",
      updatedAt: "2026-09-29T00:00:00.000Z",
      workspace: {
        folder,
        repos: [
          { path: a, base: "main" },
          { path: aWorktree, base: "main" },
        ],
      },
    };
    const ctx: SagaContext = {
      card,
      identifier: "LOCAL-54",
      sessionName: "LOCAL-54",
      sessionId: undefined,
      workspacePath,
      extraDirection: "",
      config: {} as Config,
      createdWorkspaceDir: true,
      createdWorktrees: [],
      createdBranches: [],
      tmuxSessionCreated: false,
      restarted: false,
      warnings: [],
    };
    const createWorktrees = steps.find((s) => s.name === "creating worktrees");
    assert.ok(createWorktrees);
    await createWorktrees.run(ctx);
    assert.deepEqual(ctx.createdWorktrees, [
      { repoPath: a, worktreePath: path.join(workspacePath, "a") },
    ]);
    assert.equal(ctx.warnings.length, 1);
    assert.match(ctx.warnings[0], /^a-wt /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
