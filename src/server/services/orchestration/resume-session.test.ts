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
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

const env = await isolateTmuxEnv();
const { projectsDirOf } = await import("../../adapters/transcript.js");
const { killTtyd } = await import("../../adapters/ttyd.js");
const { store } = await import("../../store/board.store.js");
const { reconnectTerminal, resumeSession } =
  await import("./resume-session.js");
const { recordMemory } = await import("../../test-support/memory-fixtures.js");
const { applyHookEvent } = await import("./hook-events.js");
const { resumeLostAtBoot } = await import("./supervisor-boot.js");
const tmux = await import("../../adapters/tmux.js");
const { pauseTools } = await import("./pause-card.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

void test(
  "resumeSession relaunches the newest conversation node, stamps a refused one missing, and falls back to the previous node",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "resume nodes",
      "",
    );
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
    const folder = projectsDirOf(path.join(env.home, ".claude"), cwd);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "sess-1.jsonl"), "");
    fs.writeFileSync(path.join(folder, "missing-2.jsonl"), "");
    await new Promise((r) => setTimeout(r, 20));
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
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "resume continue",
      "",
    );
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
    const realTools = { ...pauseTools };
    const continued: { pids: number[]; signal: string; alive: boolean }[] = [];
    pauseTools.panePids = () =>
      Promise.resolve(new Map([[tmuxSession, [4242]]]));
    pauseTools.signalTree = async (pids, signal) => {
      continued.push({
        pids,
        signal,
        alive: await tmux.hasSession(`=${tmuxSession}`),
      });
      return pids;
    };
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
      assert.deepEqual(continued, [
        { pids: [4242], signal: "SIGCONT", alive: true },
      ]);
    } finally {
      Object.assign(pauseTools, realTools);
      killTtyd(tmuxSession);
      await env.killServer();
    }
  },
);

async function lostCard(
  title: string,
  branch: string,
  board: BoardKey = DEFAULT_BOARD_KEY,
) {
  const card = await store.createLocalCard(board, title, "");
  const cwd = path.join(env.root, `worktree-${branch}`);
  fs.mkdirSync(cwd, { recursive: true });
  await store.completeStart(card.id, undefined, {
    workspacePath: cwd,
    tmuxSession: `dsp-${branch}`,
    branch,
  });
  const sessionId = store.getCard(card.id)!.activeSessionId!;
  await store.markSessionLost(card.id, sessionId);
  return {
    cardId: card.id,
    sessionId,
    tmuxSession: `dsp-${branch}`,
    folder: projectsDirOf(path.join(env.home, ".claude"), cwd),
  };
}

void test(
  "resumeSession resumes a newer conversation file than the stored node and records it as the latest",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-newer.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const lost = await lostCard("resume newer", `newertest-${process.pid}`);
    fs.mkdirSync(lost.folder, { recursive: true });
    fs.writeFileSync(path.join(lost.folder, "conv-a.jsonl"), "");
    await new Promise((r) => setTimeout(r, 20));
    await store.setClaudeSessionId(lost.cardId, lost.sessionId, "conv-a");
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(lost.folder, "conv-b.jsonl"), "");
    try {
      await resumeSession(lost.cardId);
      await waitFor(
        () => Promise.resolve(readArgv(argvFile) != null),
        5000,
        "the launch line to reach the fake claude",
      );
      assert.deepEqual(readArgv(argvFile)?.slice(0, 2), ["--resume", "conv-b"]);
      assert.equal(store.getCard(lost.cardId)?.claudeSessionId, "conv-b");
    } finally {
      killTtyd(lost.tmuxSession);
      await env.killServer();
    }
  },
);

void test(
  "resumeSession continues instead of resuming a stored conversation whose file is gone",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-gone.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const lost = await lostCard("resume gone", `gonetest-${process.pid}`);
    await store.setClaudeSessionId(lost.cardId, lost.sessionId, "stale-id");
    try {
      await resumeSession(lost.cardId);
      await waitFor(
        () => Promise.resolve(readArgv(argvFile) != null),
        5000,
        "the launch line to reach the fake claude",
      );
      const argv = readArgv(argvFile) ?? [];
      assert.deepEqual(argv.slice(0, 1), ["--continue"]);
      assert.ok(!argv.includes("stale-id"));
    } finally {
      killTtyd(lost.tmuxSession);
      await env.killServer();
    }
  },
);

async function launched(argvFile: string) {
  await waitFor(
    () => Promise.resolve(readArgv(argvFile) != null),
    5000,
    "the launch line to reach the fake claude",
  );
  return readArgv(argvFile) ?? [];
}

const nodeIdsOf = (cardId: string, sessionId: string) =>
  store
    .getCard(cardId)
    ?.sessions?.find((s) => s.id === sessionId)
    ?.claudeSessions?.map((n) => n.id);

function writeBornAtLaunchRepl(argvFile: string, bornFile: string) {
  writeFakeRepl(env, argvFile);
  fs.writeFileSync(
    path.join(env.binDir, "claude"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_CLAUDE_ARGV_FILE"
: > '${bornFile}'
echo "? for shortcuts"
trap 'exit 0' INT
while :; do sleep 1; done
`,
    { mode: 0o755 },
  );
}

void test(
  "resumeSession with no stored node resumes the only conversation file in the folder and records it",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-only.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const lost = await lostCard("resume only", `onlytest-${process.pid}`);
    fs.mkdirSync(lost.folder, { recursive: true });
    fs.writeFileSync(path.join(lost.folder, "only-conv.jsonl"), "");
    assert.equal(nodeIdsOf(lost.cardId, lost.sessionId), undefined);
    try {
      await resumeSession(lost.cardId);
      assert.deepEqual((await launched(argvFile)).slice(0, 2), [
        "--resume",
        "only-conv",
      ]);
      assert.deepEqual(nodeIdsOf(lost.cardId, lost.sessionId), ["only-conv"]);
      assert.equal(store.getCard(lost.cardId)?.claudeSessionId, "only-conv");
    } finally {
      killTtyd(lost.tmuxSession);
      await env.killServer();
    }
  },
);

async function resumeThroughBornAtLaunch(
  title: string,
  statusChannel: "pane" | "auto",
) {
  const argvFile = path.join(env.root, `claude-argv-${title}.txt`);
  const lost = await lostCard(title, `${title}-${process.pid}`);
  writeBornAtLaunchRepl(
    argvFile,
    path.join(lost.folder, "born-at-launch.jsonl"),
  );
  fs.mkdirSync(lost.folder, { recursive: true });
  fs.writeFileSync(path.join(lost.folder, "conv-a.jsonl"), "");
  await new Promise((r) => setTimeout(r, 20));
  await store.setClaudeSessionId(lost.cardId, lost.sessionId, "conv-a");
  setHooksRuntime({ capable: true, port: 1, statusChannel });
  try {
    await resumeSession(lost.cardId);
    return {
      argv: await launched(argvFile),
      nodes: nodeIdsOf(lost.cardId, lost.sessionId),
      mirror: store.getCard(lost.cardId)?.claudeSessionId,
    };
  } finally {
    setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
    killTtyd(lost.tmuxSession);
    await env.killServer();
  }
}

void test(
  "a hook silent resumeSession records a conversation file born after the launch",
  { skip: !env.canRunRealTmux },
  async () => {
    await store.load();
    const result = await resumeThroughBornAtLaunch("silent-born", "pane");
    assert.deepEqual(result.argv.slice(0, 2), ["--resume", "conv-a"]);
    assert.deepEqual(result.nodes, ["conv-a", "born-at-launch"]);
    assert.equal(result.mirror, "born-at-launch");
  },
);

void test(
  "a hook capable resumeSession does not read the folder after the launch",
  { skip: !env.canRunRealTmux },
  async () => {
    await store.load();
    const result = await resumeThroughBornAtLaunch("capable-born", "auto");
    assert.deepEqual(result.argv.slice(0, 2), ["--resume", "conv-a"]);
    assert.deepEqual(result.nodes, ["conv-a"]);
    assert.equal(result.mirror, "conv-a");
  },
);

void test(
  "a refused newer conversation is skipped by the next Resume until a SessionStart hook for it clears the mark",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-loop.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const lost = await lostCard("resume loop", `looptest-${process.pid}`);
    const refused = "missing-b";
    const now = Date.now();
    await store.startClaudeSession(
      lost.cardId,
      lost.sessionId,
      "conv-a",
      new Date(now - 60_000).toISOString(),
    );
    await store.startClaudeSession(
      lost.cardId,
      lost.sessionId,
      refused,
      new Date(now - 30_000).toISOString(),
    );
    fs.mkdirSync(lost.folder, { recursive: true });
    fs.writeFileSync(path.join(lost.folder, "conv-a.jsonl"), "");
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(lost.folder, `${refused}.jsonl`), "");
    const missingOf = (id: string) =>
      store
        .getCard(lost.cardId)
        ?.sessions?.find((s) => s.id === lost.sessionId)
        ?.claudeSessions?.find((n) => n.id === id)?.missingAt;

    try {
      await resumeSession(lost.cardId);
      assert.deepEqual((await launched(argvFile)).slice(0, 2), [
        "--resume",
        refused,
      ]);
      assert.equal(typeof missingOf(refused), "string");

      fs.rmSync(argvFile, { force: true });
      await resumeSession(lost.cardId);
      assert.deepEqual((await launched(argvFile)).slice(0, 2), [
        "--resume",
        "conv-a",
      ]);
      assert.equal(typeof missingOf(refused), "string");

      killTtyd(lost.tmuxSession);
      await tmux.killSession(`=${lost.tmuxSession}`);
      await store.markSessionLost(lost.cardId, lost.sessionId);
      await applyHookEvent(lost.cardId, lost.sessionId, {
        hook_event_name: "SessionStart",
        session_id: refused,
        source: "resume",
      });
      assert.equal(missingOf(refused), undefined);

      fs.rmSync(argvFile, { force: true });
      await resumeSession(lost.cardId);
      assert.deepEqual((await launched(argvFile)).slice(0, 2), [
        "--resume",
        refused,
      ]);
    } finally {
      killTtyd(lost.tmuxSession);
      await env.killServer();
    }
  },
);

void test(
  "a reconnect whose pane is gone does not relaunch under memory pressure and shows the reason",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-memory.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "reconnect memory",
      "",
    );
    const branch = `memorytest-${process.pid}`;
    const cwd = path.join(env.root, "worktree-memory");
    fs.mkdirSync(cwd, { recursive: true });
    await store.completeStart(card.id, undefined, {
      workspacePath: cwd,
      tmuxSession: `dsp-${branch}`,
      branch,
    });
    recordMemory(812, 1000);
    try {
      await reconnectTerminal(card.id);
    } finally {
      recordMemory(2048, 1000);
    }
    assert.equal(
      store.getCard(card.id)?.resumeError,
      "Resume failed: free memory 812 MB is below the 1024 MB floor",
    );
    assert.equal(store.getCard(card.id)?.sessionLost, true);
    assert.equal(store.getCard(card.id)?.tmuxSession, undefined);
    assert.equal(store.isStarting(card.id), false);
    assert.equal(readArgv(argvFile), null, "claude was not launched");
  },
);

/** Make a lost card whose workspace folder is renamed away, so its stored path is missing. */
async function lostCardWithoutWorkspace(
  title: string,
  branch: string,
  board: BoardKey = DEFAULT_BOARD_KEY,
) {
  const lost = await lostCard(title, branch, board);
  const cwd = store.getCard(lost.cardId)!.workspacePath!;
  fs.renameSync(cwd, `${cwd}-gone`);
  const resumeFailures = () =>
    store
      .listEvents(board, lost.cardId, 50)
      .filter((e) => e.type === "resume_failed").length;
  const session = () =>
    store.getCard(lost.cardId)?.sessions?.find((s) => s.id === lost.sessionId);
  return { ...lost, cwd, resumeFailures, session };
}

void test("resumeSession refuses a lost session whose workspace folder is missing and launches no claude", async () => {
  const argvFile = path.join(env.root, "claude-argv-missing.txt");
  writeFakeRepl(env, argvFile);
  await store.load();
  const lost = await lostCardWithoutWorkspace(
    "resume missing",
    `missingtest-${process.pid}`,
  );

  await resumeSession(lost.cardId);

  assert.equal(readArgv(argvFile), null, "claude was not launched");
  assert.equal(await tmux.hasSession(`=${lost.tmuxSession}`), false);
  const card = store.getCard(lost.cardId);
  assert.equal(
    card?.resumeError,
    `Resume failed: workspace-missing: ${lost.cwd}`,
  );
  assert.equal(card?.sessionLost, true);
  assert.equal(lost.session()?.state, "needs_input");
  assert.equal(lost.session()?.stateReason, "resume_failed");
  assert.equal(lost.resumeFailures(), 1);
  assert.equal(store.isStarting(lost.cardId), false);
});

void test("the boot resume sweep refuses a lost session whose workspace folder is missing and moves the card to Needs input", async () => {
  const argvFile = path.join(env.root, "claude-argv-boot-missing.txt");
  writeFakeRepl(env, argvFile);
  await store.load();
  const board = parseBoardKey("BOOTWS")!;
  const created = await store.createBoard({
    key: board,
    name: "boot missing",
    workspaceRoot: env.root,
    repositories: [],
    linearTeamKeys: [],
  });
  assert.ok(created.ok);
  await store.setBoardPolicy(board, {
    ...created.board.policy,
    supervisor: "on",
  });
  const lost = await lostCardWithoutWorkspace(
    "boot missing",
    `bootmissing-${process.pid}`,
    board,
  );
  const lines: string[] = [];

  try {
    await resumeLostAtBoot({
      sample: () => Promise.resolve(),
      log: (line) => lines.push(line),
    });
  } finally {
    await store.setBoardPolicy(board, {
      ...created.board.policy,
      supervisor: "off",
    });
  }

  assert.equal(readArgv(argvFile), null, "claude was not launched");
  const card = store.getCard(lost.cardId);
  assert.deepEqual(lines, [
    `[supervisor] boot resume ${card?.identifier}: failed: Resume failed: workspace-missing: ${lost.cwd}`,
  ]);
  assert.equal(card?.column, "needs_input");
  assert.equal(lost.session()?.state, "needs_input");
  assert.equal(lost.session()?.stateReason, "resume_failed");
  assert.equal(lost.resumeFailures(), 1);
});

void test.after(() => env.cleanup());
