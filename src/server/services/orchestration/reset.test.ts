import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { run } from "../../adapters/exec.js";
import { branchExists, worktreeAddNewBranch } from "../../adapters/git.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { resetCard } = await import("./reset.js");

async function tempRepo(): Promise<{ root: string; repo: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-reset-"));
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
  return { root, repo };
}

void test("resetCard removes the workspace and branch, detaches the session, and lands in Inbox", async () => {
  await store.load();
  const { root, repo } = await tempRepo();
  try {
    const card = await store.createLocalCard("reset me", "");
    const ws = path.join(root, "ws", card.identifier);
    await store.setCardWorkspace(card.id, {
      folder: path.join(root, "ws"),
      repos: [{ path: repo, base: "main" }],
    });
    await worktreeAddNewBranch(
      repo,
      path.join(ws, "repo"),
      card.identifier,
      "main",
    );
    await store.completeStart(card.id, undefined, {
      workspacePath: ws,
      tmuxSession: `dsp-${card.identifier}`,
      branch: card.identifier,
    });
    await store.setExtraDirection(card.id, "extra");
    assert.equal(store.getCard(card.id)?.column, "in_progress");

    assert.deepEqual(await resetCard(card.id), { ok: true });

    const after = store.getCard(card.id);
    assert.equal(after?.column, "inbox");
    assert.equal(after?.tmuxSession, undefined);
    assert.equal(after?.workspacePath, undefined);
    assert.equal(after?.branch, undefined);
    assert.equal(after?.sessions?.length ?? 0, 0);
    assert.equal(after?.activeSessionId, undefined);
    assert.equal(after?.extraDirection, undefined);
    assert.equal(after?.sessionLost, undefined);
    assert.equal(fs.existsSync(ws), false, "workspace folder gone");
    assert.equal(await branchExists(repo, card.identifier), false);

    assert.equal((await resetCard(card.id)).ok, false, "nothing left to reset");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("resetCard refuses an unknown card, a pristine card, and a card mid-saga", async () => {
  await store.load();
  assert.deepEqual(await resetCard("LOCAL-none"), {
    ok: false,
    status: 404,
    error: "unknown card id: LOCAL-none",
  });
  const plain = await store.createLocalCard("plain", "");
  const pristine = await resetCard(plain.id);
  assert.equal(pristine.ok, false);
  if (!pristine.ok) assert.equal(pristine.status, 409);

  await store.completeStart(plain.id, undefined, {
    workspacePath: `/tmp/ws-missing-${plain.id}`,
    tmuxSession: `dsp-${plain.id}`,
    branch: plain.id,
  });
  store.beginStart(plain.id);
  try {
    const busy = await resetCard(plain.id);
    assert.equal(busy.ok, false);
    assert.equal(store.getCard(plain.id)?.column, "in_progress");
  } finally {
    store.endStart(plain.id);
  }
  store.beginCleanup(plain.id);
  try {
    assert.equal((await resetCard(plain.id)).ok, false);
  } finally {
    store.endCleanup(plain.id);
  }
  assert.deepEqual(await resetCard(plain.id), { ok: true });
  assert.equal(store.getCard(plain.id)?.column, "inbox");
});
