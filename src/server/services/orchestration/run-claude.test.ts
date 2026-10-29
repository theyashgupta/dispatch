import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isolateTmuxEnv,
  readArgv,
  waitFor,
  writeFakeRepl,
} from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = await isolateTmuxEnv();
const tmux = await import("../../adapters/tmux.js");
const { store } = await import("../../store/board.store.js");
const { launchClaude } = await import("./steps.js");
const { runClaude } = await import("./run-claude.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

void test(
  "runClaude relaunches only into a pane at its shell prompt, resumes a recorded id or starts fresh, and never mints a token",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "run claude",
      "",
    );
    const tmuxSession = `dsp-runtest-${process.pid}`;
    const target = `=${tmuxSession}:`;
    const cwd = path.join(env.root, "worktree");
    fs.mkdirSync(cwd, { recursive: true });
    const exitClaude = async () => {
      await tmux.sendKeys(target, ["C-c"]);
      await waitFor(() => tmux.paneAtPrompt(target), 5000, "shell prompt");
      fs.rmSync(argvFile, { force: true });
    };
    const typed = async () => {
      await waitFor(
        () => Promise.resolve((readArgv(argvFile) ?? []).some((a) => a !== "")),
        5000,
        "the relaunch line to reach the fake claude",
      );
      return readArgv(argvFile)?.filter((a) => !a.startsWith("/"));
    };

    try {
      await launchClaude({
        cardId: card.id,
        tmuxSession,
        cwd,
        leadingArgs: [],
        account: { id: "default" },
      });
      await store.completeStart(card.id, undefined, {
        workspacePath: cwd,
        tmuxSession,
        branch: "run-claude",
      });
      const tokenBefore = store.getCard(card.id)?.hookToken;
      assert.equal(typeof tokenBefore, "string");
      const firstArgv = readArgv(argvFile);

      assert.equal(await runClaude(card.id), "busy", "claude is running");
      await new Promise((r) => setTimeout(r, 700));
      assert.deepEqual(readArgv(argvFile), firstArgv, "nothing typed");

      await exitClaude();
      assert.equal(await runClaude(card.id), "launched");
      assert.deepEqual(
        await typed(),
        ["--settings", "--dangerously-skip-permissions"],
        "no recorded conversation id: a new conversation, never a guessed --continue",
      );
      assert.equal(
        store.getCard(card.id)?.hookToken,
        tokenBefore,
        "no re-mint",
      );
      assert.deepEqual([...(await tmux.listSessions())], [tmuxSession]);

      await exitClaude();
      await store.setClaudeSessionId(card.id, undefined, "sess-123");
      assert.equal(await runClaude(card.id), "launched");
      assert.deepEqual(await typed(), [
        "--resume",
        "sess-123",
        "--settings",
        "--dangerously-skip-permissions",
      ]);

      await exitClaude();
      const outcomes = await Promise.all([
        runClaude(card.id),
        runClaude(card.id),
        runClaude(card.id),
      ]);
      assert.deepEqual(
        outcomes.filter((o) => o === "launched"),
        ["launched"],
        "overlapping relaunches: exactly one types, the rest are busy",
      );
      assert.deepEqual((await typed())?.slice(0, 2), ["--resume", "sess-123"]);

      await exitClaude();
      await new Promise((r) => setTimeout(r, 2));
      await store.setClaudeSessionId(card.id, undefined, "missing-777");
      assert.equal(store.getCard(card.id)?.claudeSessionId, "missing-777");
      assert.equal(await runClaude(card.id), "launched");
      await waitFor(
        () =>
          Promise.resolve(
            store.getCard(card.id)?.claudeSessionId === "sess-123",
          ),
        10000,
        "a refused --resume id falls back to the previous conversation node",
      );
      const nodes = store
        .getCard(card.id)
        ?.sessions?.find(
          (s) => s.id === store.getCard(card.id)?.activeSessionId,
        )?.claudeSessions;
      assert.deepEqual(
        nodes?.map((n) => [n.id, typeof n.missingAt]),
        [
          ["sess-123", "undefined"],
          ["missing-777", "string"],
        ],
        "the refused node is stamped missing and kept, the sibling untouched",
      );
      await waitFor(
        () => tmux.paneAtPrompt(target),
        5000,
        "prompt after refusal",
      );
      fs.rmSync(argvFile, { force: true });
      assert.equal(await runClaude(card.id), "launched");
      assert.deepEqual(
        await typed(),
        [
          "--resume",
          "sess-123",
          "--settings",
          "--dangerously-skip-permissions",
        ],
        "the click after a refused resume reopens the previous conversation",
      );

      await exitClaude();
      store.beginStart(card.id);
      try {
        assert.equal(await runClaude(card.id), "busy", "a start in flight");
      } finally {
        store.endStart(card.id);
      }

      const activeSessionId = store.getCard(card.id)?.activeSessionId as string;
      await store.markCardPaused(card.id, activeSessionId, {
        at: "2026-10-13T00:00:00.000Z",
        by: "user",
        sessionId: activeSessionId,
        pids: [],
      });
      try {
        assert.equal(await runClaude(card.id), "busy", "a paused card");
      } finally {
        await store.clearCardPaused(card.id);
      }

      const orphan = await store.createLocalCard(
        DEFAULT_BOARD_KEY,
        "no session",
        "",
      );
      assert.equal(await runClaude(orphan.id), "no-session");
      assert.equal(await runClaude("no-such-card"), "no-session");
      assert.equal(await tmux.hasSession(`=dsp-${orphan.identifier}`), false);

      const dead = await store.createLocalCard(
        DEFAULT_BOARD_KEY,
        "dead session",
        "",
      );
      await store.completeStart(dead.id, undefined, {
        workspacePath: cwd,
        tmuxSession: "dsp-no-such-session",
        branch: "dead",
      });
      assert.equal(await runClaude(dead.id), "no-session");

      const legacyName = `dsp-legacy-${process.pid}`;
      await tmux.newSession(legacyName, cwd, ["sleep", "300"]);
      const legacy = await store.createLocalCard(
        DEFAULT_BOARD_KEY,
        "pre-upgrade session",
        "",
      );
      await store.completeStart(legacy.id, undefined, {
        workspacePath: cwd,
        tmuxSession: legacyName,
        branch: "legacy",
      });
      try {
        assert.equal(
          await runClaude(legacy.id),
          "legacy",
          "a session whose pane root is not a marked login shell is never typed into",
        );
      } finally {
        await tmux.killSession(`=${legacyName}`);
      }

      const stale = await store.createLocalCard(
        DEFAULT_BOARD_KEY,
        "stale account",
        "",
      );
      await store.completeStart(stale.id, undefined, {
        workspacePath: cwd,
        tmuxSession,
        branch: "stale",
        claudeAccountId: "no-such-account",
      });
      assert.equal(await runClaude(stale.id), "account");
      assert.equal(
        readArgv(argvFile),
        null,
        "an unresolved account types nothing",
      );
    } finally {
      await tmux.killSession(`=${tmuxSession}`);
      await env.killServer();
    }
  },
);

void test(
  "runClaude into a session stored released writes the state working, and a busy refusal leaves it released",
  { skip: !env.canRunRealTmux },
  async () => {
    writeFakeRepl(env, path.join(env.root, "claude-argv-released.txt"));
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "released run",
      "",
    );
    const tmuxSession = `dsp-released-${process.pid}`;
    const target = `=${tmuxSession}:`;
    const cwd = path.join(env.root, "released-worktree");
    fs.mkdirSync(cwd, { recursive: true });
    try {
      await launchClaude({
        cardId: card.id,
        tmuxSession,
        cwd,
        leadingArgs: [],
        account: { id: "default" },
      });
      await store.completeStart(card.id, undefined, {
        workspacePath: cwd,
        tmuxSession,
        branch: "released-run",
      });
      const sessionId = store.getCard(card.id)!.activeSessionId!;
      const stored = () =>
        store.getCard(card.id)!.sessions!.find((s) => s.id === sessionId)
          ?.state;
      await store.setSessionStateIfSession(card.id, sessionId, "released");

      assert.equal(await runClaude(card.id), "busy", "claude is running");
      assert.equal(stored(), "released");

      await tmux.sendKeys(target, ["C-c"]);
      await waitFor(() => tmux.paneAtPrompt(target), 5000, "shell prompt");
      assert.equal(await runClaude(card.id), "launched");
      assert.equal(stored(), "working");

      await tmux.sendKeys(target, ["C-c"]);
      await waitFor(() => tmux.paneAtPrompt(target), 5000, "shell prompt");
      await store.setSessionStateIfSession(card.id, sessionId, "released");
      const getCard = store.getCard.bind(store);
      const spy = mock.method(
        store,
        "getCard",
        (id: string) => {
          const first = getCard(id)!;
          return {
            ...first,
            sessions: first.sessions!.map((s) => ({
              ...s,
              state: "working" as const,
            })),
          };
        },
        { times: 1 },
      );
      try {
        assert.equal(await runClaude(card.id), "launched");
      } finally {
        spy.mock.restore();
      }
      assert.equal(
        stored(),
        "working",
        "the state is read live, not from the first read",
      );
    } finally {
      await tmux.killSession(`=${tmuxSession}`);
      await env.killServer();
    }
  },
);

void test.after(() => env.cleanup());
