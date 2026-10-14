import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isolateTmuxEnv } from "../../test-support/fixtures.js";

const env = await isolateTmuxEnv();
const { run } = await import("../../adapters/exec.js");
const { branchExists, worktreeAddNewBranch } =
  await import("../../adapters/git.js");
const { TMUX_SERVER_ARGS, hasSession } = await import("../../adapters/tmux.js");
const { pauseTools } = await import("./pause-card.js");
const { dirtyRepos, killSessionProcesses, removeWorkspaceFiles } =
  await import("./cleanup.js");

const realTools = { ...pauseTools };

afterEach(() => {
  Object.assign(pauseTools, realTools);
});

after(async () => {
  await env.killServer();
  env.cleanup();
});

async function startSession(name: string): Promise<void> {
  await run("tmux", [
    ...TMUX_SERVER_ARGS,
    "new-session",
    "-d",
    "-s",
    name,
    "sleep 60",
  ]);
}

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

void test(
  "killSessionProcesses sends SIGCONT to the pane pids while the tmux session is still alive, then kills it",
  {
    skip: !env.canRunRealTmux,
  },
  async () => {
    await startSession("dsp-cleanup-cont");
    const calls: { pids: number[]; signal: string; alive: boolean }[] = [];
    pauseTools.panePids = () =>
      Promise.resolve(new Map([["dsp-cleanup-cont", [4242, 4243]]]));
    pauseTools.signalTree = async (pids, signal) => {
      calls.push({
        pids,
        signal,
        alive: await hasSession("=dsp-cleanup-cont"),
      });
      return pids;
    };
    await killSessionProcesses("dsp-cleanup-cont");
    assert.deepEqual(calls, [
      { pids: [4242, 4243], signal: "SIGCONT", alive: true },
    ]);
    assert.equal(await hasSession("=dsp-cleanup-cont"), false);
  },
);

void test(
  "killSessionProcesses still kills the session when the pane pid list is unavailable",
  {
    skip: !env.canRunRealTmux,
  },
  async () => {
    await startSession("dsp-cleanup-nopids");
    const signals: string[] = [];
    pauseTools.panePids = () => Promise.resolve(null);
    pauseTools.signalTree = (pids, signal) => {
      signals.push(signal);
      return Promise.resolve(pids);
    };
    await killSessionProcesses("dsp-cleanup-nopids");
    assert.deepEqual(signals, []);
    assert.equal(await hasSession("=dsp-cleanup-nopids"), false);
  },
);

void test(
  "killSessionProcesses still kills the session when the pane pid lookup throws",
  {
    skip: !env.canRunRealTmux,
  },
  async () => {
    await startSession("dsp-cleanup-throws");
    pauseTools.panePids = () => Promise.reject(new Error("tmux gone"));
    await killSessionProcesses("dsp-cleanup-throws");
    assert.equal(await hasSession("=dsp-cleanup-throws"), false);
  },
);
