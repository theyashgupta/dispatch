import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Card, Config } from "../../../shared/types.js";
import { run } from "../../adapters/exec.js";
import { steps, withRepoLock, type SagaContext } from "./steps.js";

async function initRepo(repo: string, withRemote = true): Promise<void> {
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
  if (withRemote) await git("remote", "add", "origin", repo);
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
      boardKey: DEFAULT_BOARD_KEY,
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

const PARALLEL_STARTS = 6;

void test("createWorktrees of concurrent sagas in one repository all succeed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-worktrees-"));
  try {
    const folder = path.join(root, "folder");
    const repo = path.join(folder, "a");
    await initRepo(repo, false);
    const createWorktrees = steps.find((s) => s.name === "creating worktrees");
    assert.ok(createWorktrees);
    const ctxs = Array.from(
      { length: PARALLEL_STARTS },
      (_, i): SagaContext => {
        const identifier = `LOCAL-${100 + i}`;
        const workspacePath = path.join(root, "ws", identifier);
        fs.mkdirSync(workspacePath, { recursive: true });
        return {
          card: {
            id: identifier,
            boardKey: DEFAULT_BOARD_KEY,
            issueId: identifier,
            identifier,
            title: "t",
            description: null,
            priority: 0,
            column: "in_progress",
            updatedAt: "2026-09-29T00:00:00.000Z",
            workspace: { folder, repos: [{ path: repo, base: "main" }] },
          },
          identifier,
          sessionName: identifier,
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
      },
    );
    await Promise.all(ctxs.map((ctx) => createWorktrees.run(ctx)));
    const { stdout: branches } = await run(
      "git",
      ["branch", "--format=%(refname:short)"],
      { cwd: repo },
    );
    for (const ctx of ctxs) {
      assert.ok(
        fs.existsSync(path.join(ctx.workspacePath, "a", "README.md")),
        `${ctx.sessionName} worktree exists`,
      );
      assert.ok(
        branches.split("\n").includes(ctx.sessionName),
        `${ctx.sessionName} branch exists`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("withRepoLock runs one key at a time in call order and different keys in parallel", async () => {
  const events: string[] = [];
  let releaseA: () => void = () => {};
  const aHeld = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const a = withRepoLock("one", async () => {
    events.push("a:start");
    await aHeld;
    events.push("a:end");
  });
  const b = withRepoLock("one", () => {
    events.push("b:start");
    return Promise.resolve();
  });
  await withRepoLock("two", () => {
    events.push("c:run");
    return Promise.resolve();
  });
  assert.deepEqual(events, ["a:start", "c:run"]);
  releaseA();
  await Promise.all([a, b]);
  assert.deepEqual(events, ["a:start", "c:run", "a:end", "b:start"]);
});

void test("withRepoLock lets the next holder run after a failed one", async () => {
  const failed = withRepoLock("k", () => Promise.reject(new Error("boom")));
  const next = withRepoLock("k", () => Promise.resolve("ok"));
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ok");
});
