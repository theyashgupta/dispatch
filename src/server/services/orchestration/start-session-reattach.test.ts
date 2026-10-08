import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateTmuxEnv, writeFakeRepl } from "../../test-support/fixtures.js";
import { tempRepoWithWorkspace } from "../../test-support/git-fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { Config } from "../../../shared/types.js";

const env = await isolateTmuxEnv();
const tmux = await import("../../adapters/tmux.js");
const { store } = await import("../../store/board.store.js");
const { startSession } = await import("./start-session.js");

void test(
  "a reattach keeps the stored session folder after the board folder changes",
  { skip: !env.canRunRealTmux },
  async () => {
    await store.load();
    const acme = parseBoardKey("ACME");
    assert.ok(acme);
    const oldRoot = path.join(env.root, "acme-old");
    const newRoot = path.join(env.root, "acme-new");
    fs.mkdirSync(newRoot, { recursive: true });
    await store.createBoard({
      key: acme,
      name: "Acme",
      workspaceRoot: oldRoot,
      repositories: [],
      linearTeamKeys: [],
    });
    const card = await store.createLocalCard(acme, "reattach", "");
    const workspacePath = path.join(oldRoot, card.identifier);
    fs.mkdirSync(workspacePath, { recursive: true });
    const tmuxSession = `dsp-${card.identifier}`;
    await tmux.newSession(tmuxSession, workspacePath, ["sleep", "60"]);
    try {
      await store.completeStart(card.id, undefined, {
        workspacePath,
        branch: card.identifier,
        tmuxSession,
      });
      await store.updateBoard(acme, { workspaceRoot: newRoot });
      await startSession(card.id, "", {
        workspaceRoot: path.join(env.root, "local"),
      } as Config);
      assert.equal(store.getCard(card.id)?.workspacePath, workspacePath);
    } finally {
      await tmux.killSession(`=${tmuxSession}`);
    }
  },
);

void test(
  "a group start on a second board creates its worktrees under that board's sessions folder and reaches the running state",
  { skip: !env.canRunRealTmux },
  async () => {
    writeFakeRepl(env, path.join(env.root, "claude-argv.txt"));
    await store.load();
    const acme = parseBoardKey("ACME2");
    assert.ok(acme);
    const { root: reposRoot, repo } = await tempRepoWithWorkspace();
    const acmeRoot = path.join(env.root, "acme2-sessions");
    const localRoot = path.join(env.root, "local-sessions");
    await store.createBoard({
      key: acme,
      name: "Acme Two",
      workspaceRoot: acmeRoot,
      repositories: [{ path: repo, baseBranch: "main", checkCommand: "true" }],
      linearTeamKeys: [],
    });
    const a = await store.createLocalCard(acme, "member a", "");
    const b = await store.createLocalCard(acme, "member b", "");
    const minted = await store.createGroupCard(acme, "acme group", [
      a.id,
      b.id,
    ]);
    assert.ok(minted.ok);
    const group = minted.card;
    await store.setCardWorkspace(group.id, {
      folder: reposRoot,
      repos: [{ path: repo, base: "main" }],
    });
    try {
      await startSession(group.id, "", {
        workspaceRoot: localRoot,
      } as Config);
      const started = store.getCard(group.id);
      const workspacePath = path.join(acmeRoot, group.identifier);
      assert.equal(started?.workspacePath, workspacePath);
      assert.equal(started?.column, "in_progress");
      assert.equal(started?.startError ?? null, null);
      assert.notEqual(started?.sessionLost, true);
      assert.equal(started?.provisioningStep ?? null, null);
      assert.equal(started?.tmuxSession, `dsp-${group.identifier}`);
      assert.equal(await tmux.hasSession(`=dsp-${group.identifier}`), true);
      assert.ok(
        fs.existsSync(path.join(workspacePath, path.basename(repo), ".git")),
        "the worktree sits under the ACME2 sessions folder",
      );
      assert.equal(fs.existsSync(localRoot), false);
    } finally {
      await env.killServer();
      fs.rmSync(reposRoot, { recursive: true, force: true });
    }
  },
);

void test.after(() => env.cleanup());
