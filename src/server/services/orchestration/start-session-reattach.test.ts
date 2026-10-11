import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateTmuxEnv, writeFakeRepl } from "../../test-support/fixtures.js";
import { tempRepoWithWorkspace } from "../../test-support/git-fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { Config } from "../../../shared/types.js";

const env = await isolateTmuxEnv();
const tmux = await import("../../adapters/tmux.js");
const { store } = await import("../../store/board.store.js");
const { startSession } = await import("./start-session.js");
const { steps } = await import("./steps.js");
const { isGuardedLaunch, resolveCrossSessionInbound } =
  await import("../domain/cross-session-inbound.js");

const ROADMAP_LOOP = "Roadmap Loop (autonomous)";
const config = (): Config => ({ workspaceRoot: env.root }) as Config;

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
  "a reattach leaves the stored start intent playbook unchanged",
  { skip: !env.canRunRealTmux },
  async () => {
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "reattach intent",
      "",
    );
    const workspacePath = path.join(env.root, "local", card.identifier);
    fs.mkdirSync(workspacePath, { recursive: true });
    const tmuxSession = `dsp-${card.identifier}`;
    await tmux.newSession(tmuxSession, workspacePath, ["sleep", "60"]);
    try {
      await store.setStartIntent(card.id, { playbook: "A" });
      await store.completeStart(card.id, undefined, {
        workspacePath,
        branch: card.identifier,
        tmuxSession,
      });
      await startSession(
        card.id,
        "",
        { workspaceRoot: path.join(env.root, "local") } as Config,
        { playbook: "B" },
      );
      const after = store.getCard(card.id);
      assert.equal(after?.tmuxSession, tmuxSession);
      assert.equal(after?.startIntent?.playbook, "A");
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

void test(
  "a one-field start keeps the other stored intent field, in both directions",
  { skip: !env.canRunRealTmux },
  async (t) => {
    await store.load();
    t.mock.method(store, "setProvisioning", () =>
      Promise.reject(new Error("saga stopped by the test")),
    );
    const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "merge", "");
    await store.setStartIntent(card.id, {
      playbook: "Ship it",
      crossSessionInbound: "hold",
    });

    await startSession(card.id, "", config(), {
      crossSessionInbound: "refuse",
    });
    assert.deepEqual(store.getCard(card.id)?.startIntent, {
      playbook: "Ship it",
      crossSessionInbound: "refuse",
    });

    await startSession(card.id, "", config(), { playbook: "Other" });
    assert.deepEqual(store.getCard(card.id)?.startIntent, {
      playbook: "Other",
      crossSessionInbound: "refuse",
    });
  },
);

void test(
  "a new-session start leaves the card intent alone and a later primary launch stays guarded",
  { skip: !env.canRunRealTmux },
  async (t) => {
    await store.load();
    t.mock.method(store, "setProvisioning", () =>
      Promise.reject(new Error("saga stopped by the test")),
    );
    const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "loop", "");
    await store.setStartIntent(card.id, { playbook: ROADMAP_LOOP });
    await store.completeStart(card.id, undefined, {
      workspacePath: path.join(env.root, card.identifier),
      branch: card.identifier,
      tmuxSession: `dsp-${card.identifier}`,
    });

    await startSession(card.id, "", config(), {
      newSession: true,
      crossSessionInbound: "accept",
      playbook: "Other",
    });

    const after = store.getCard(card.id);
    assert.ok(after);
    assert.match(after.startError?.stderr ?? "", /saga stopped by the test/);
    assert.equal(isGuardedLaunch(after), true);
    assert.equal(
      resolveCrossSessionInbound({
        intent: after.startIntent?.crossSessionInbound,
        guarded: true,
        policy: null,
        config: "accept",
      }),
      "refuse",
    );
    assert.deepEqual(after.startIntent, { playbook: ROADMAP_LOOP });
  },
);

void test(
  "a new-session start hands the merged request intent to the launch and keeps the card intent",
  { skip: !env.canRunRealTmux },
  async (t) => {
    await store.load();
    let launchIntent: unknown = "unset";
    t.mock.method(steps[0], "run", (ctx: { launchIntent?: unknown }) => {
      launchIntent = ctx.launchIntent;
      return Promise.reject(new Error("saga stopped by the test"));
    });
    const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "ticket", "");
    await store.completeStart(card.id, undefined, {
      workspacePath: path.join(env.root, card.identifier),
      branch: card.identifier,
      tmuxSession: `dsp-${card.identifier}`,
    });

    await startSession(card.id, "", config(), {
      newSession: true,
      playbook: ROADMAP_LOOP,
    });

    assert.deepEqual(launchIntent, { playbook: ROADMAP_LOOP });
    assert.equal(store.getCard(card.id)?.startIntent, undefined);
  },
);

void test(
  "a start that reattaches to a live session does not save the request intent",
  { skip: !env.canRunRealTmux },
  async () => {
    await store.load();
    const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "live", "");
    await store.setStartIntent(card.id, { playbook: ROADMAP_LOOP });
    const workspacePath = path.join(env.root, card.identifier);
    fs.mkdirSync(workspacePath, { recursive: true });
    const tmuxSession = `dsp-${card.identifier}`;
    await tmux.newSession(tmuxSession, workspacePath, ["sleep", "60"]);
    try {
      await store.completeStart(card.id, undefined, {
        workspacePath,
        branch: card.identifier,
        tmuxSession,
      });
      await startSession(card.id, "", config(), {
        crossSessionInbound: "accept",
      });
      assert.deepEqual(store.getCard(card.id)?.startIntent, {
        playbook: ROADMAP_LOOP,
      });
    } finally {
      await tmux.killSession(`=${tmuxSession}`);
    }
  },
);

void test.after(() => env.cleanup());
