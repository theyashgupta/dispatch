import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isolateTmuxEnv,
  readArgv,
  waitFor,
  writeFakeRepl,
} from "../../test-support/fixtures.js";

const env = await isolateTmuxEnv();
const { killTtyd } = await import("../../adapters/ttyd.js");
const { store } = await import("../../store/board.store.js");
const { resumeSession } = await import("./resume-session.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

void test(
  "resumeSession relaunches the newest conversation node, stamps a refused one missing, and falls back to the previous node",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const card = await store.createLocalCard("resume nodes", "");
    const branch = `resumetest-${process.pid}`;
    const tmuxSession = `dsp-${branch}`;
    const cwd = path.join(env.root, "worktree");
    fs.mkdirSync(cwd, { recursive: true });
    await store.completeStart(card.id, undefined, {
      workspacePath: cwd,
      tmuxSession,
      branch,
    });
    const sessionId = store.getCard(card.id)!.activeSessionId!;
    await store.markSessionLost(card.id, sessionId);
    await store.setClaudeSessionId(card.id, sessionId, "sess-1");
    await new Promise((r) => setTimeout(r, 2));
    await store.setClaudeSessionId(card.id, sessionId, "missing-2");
    assert.equal(store.getCard(card.id)?.claudeSessionId, "missing-2");
    const nodes = () =>
      store.getCard(card.id)?.sessions?.find((s) => s.id === sessionId)
        ?.claudeSessions;
    const typed = async () => {
      await waitFor(
        () => Promise.resolve(readArgv(argvFile) != null),
        5000,
        "the launch line to reach the fake claude",
      );
      return readArgv(argvFile)?.filter((a) => !a.startsWith("/"));
    };

    try {
      await resumeSession(card.id);
      assert.deepEqual((await typed())?.slice(0, 2), ["--resume", "missing-2"]);
      assert.deepEqual(
        nodes()?.map((n) => [n.id, typeof n.missingAt]),
        [
          ["sess-1", "undefined"],
          ["missing-2", "string"],
        ],
        "the refused node is stamped missing and kept",
      );
      assert.equal(store.getCard(card.id)?.claudeSessionId, "sess-1");
      assert.equal(store.getCard(card.id)?.sessionLost, true);
      assert.equal(store.getCard(card.id)?.tmuxSession, undefined);

      fs.rmSync(argvFile, { force: true });
      await resumeSession(card.id);
      assert.deepEqual((await typed())?.slice(0, 2), ["--resume", "sess-1"]);
      await waitFor(
        () =>
          Promise.resolve(store.getCard(card.id)?.tmuxSession === tmuxSession),
        10000,
        "the fallback resume is recorded as live",
      );
      assert.equal(nodes()?.length, 2, "history intact after the fallback");
    } finally {
      killTtyd(tmuxSession);
      await env.killServer();
    }
  },
);

void test(
  "resumeSession with no conversation node falls back to --continue and a refusal stamps nothing",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-continue.txt");
    writeFakeRepl(env, argvFile, { refuseContinue: true });
    await store.load();
    const card = await store.createLocalCard("resume continue", "");
    const branch = `continuetest-${process.pid}`;
    const tmuxSession = `dsp-${branch}`;
    const cwd = path.join(env.root, "worktree-continue");
    fs.mkdirSync(cwd, { recursive: true });
    await store.completeStart(card.id, undefined, {
      workspacePath: cwd,
      tmuxSession,
      branch,
    });
    const sessionId = store.getCard(card.id)!.activeSessionId!;
    await store.markSessionLost(card.id, sessionId);
    assert.equal(store.getCard(card.id)?.claudeSessionId, undefined);
    try {
      await resumeSession(card.id);
      await waitFor(
        () => Promise.resolve(readArgv(argvFile) != null),
        5000,
        "the launch line to reach the fake claude",
      );
      assert.deepEqual(readArgv(argvFile)?.slice(0, 1), ["--continue"]);
      const record = store
        .getCard(card.id)
        ?.sessions?.find((s) => s.id === sessionId);
      assert.equal(
        record?.claudeSessions,
        undefined,
        "no node stamped or added",
      );
      assert.equal(store.getCard(card.id)?.claudeSessionId, undefined);
      assert.equal(store.getCard(card.id)?.sessionLost, true);
      assert.match(store.getCard(card.id)?.resumeError ?? "", /^Resume failed/);
    } finally {
      killTtyd(tmuxSession);
      await env.killServer();
    }
  },
);

void test.after(() => env.cleanup());
