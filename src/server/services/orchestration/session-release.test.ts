import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isolateTmuxEnv,
  waitFor,
  writeFakeRepl,
} from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = await isolateTmuxEnv();
const tmux = await import("../../adapters/tmux.js");
const { store } = await import("../../store/board.store.js");
const { launchClaude } = await import("./steps.js");
const { runClaude } = await import("./run-claude.js");
const { releaseIfDue } = await import("./session-release.js");
const { withCardLock } = await import("./card-lock.js");
const { READY } = await import("./steps.js");
const { footer } = await import("./session-account-move.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const DONE_LINE = "DISPATCH_STATUS: DONE - shipped";
const DONE_KEY = "DONE shipped";
const ELEVEN_MINUTES = 11 * 60_000;
const idle = { state: "idle" } as const;

async function finishedCard(title: string) {
  await store.load();
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  const tmuxSession = `dsp-${title}-${process.pid}`;
  const target = `=${tmuxSession}:`;
  const cwd = path.join(env.root, title);
  fs.mkdirSync(cwd, { recursive: true });
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
    branch: title,
  });
  await store.setOrchestratorFields(card.id, {
    launch: { direction: "ship it" },
  });
  await tmux.sendKeys(target, ["C-c"]);
  await waitFor(() => tmux.paneAtPrompt(target), 5000, "shell prompt");
  await tmux.sendLiteral(target, `echo '${DONE_LINE}'`);
  await tmux.sendKeys(target, ["Enter"]);
  await waitFor(
    async () => (await tmux.capturePane(target)).includes(DONE_LINE),
    5000,
    "the DONE line in the pane",
  );
  assert.equal(await runClaude(card.id), "launched");
  await waitFor(
    async () => !(await tmux.paneAtPrompt(target)),
    5000,
    "claude running again",
  );
  const active = store.getCard(card.id)!.activeSessionId!;
  await store.applyMarker(
    card.id,
    active,
    "agent_done",
    "shipped",
    DONE_KEY,
    "status_agent_done",
  );
  await store.setSessionStateIfSession(card.id, active, "idle");
  const done = store.getCard(card.id)!;
  return {
    card: done,
    session: done.sessions!.find((s) => s.id === done.activeSessionId)!,
    tmuxSession,
    target,
    now: Date.now() + ELEVEN_MINUTES,
  };
}

function releaseRows(cardId: string) {
  return store
    .listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 1000)
    .filter(
      (e) =>
        e.cardId === cardId &&
        e.kind === "supervisor_action" &&
        e.data.action === "release_session",
    );
}

async function wholePane(target: string): Promise<string> {
  return (
    (await tmux.captureHistory(target, 2000)) + (await tmux.capturePane(target))
  );
}

void test(
  "releaseIfDue exits claude to the shell and keeps the card, marker, summary, pane and tmux session",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv.txt");
    writeFakeRepl(env, argvFile, { stateDir: path.join(env.root, "fake") });
    const f = await finishedCard("released");
    try {
      await releaseIfDue(f.card, f.session, idle, false, f.now);

      assert.equal(await tmux.paneAtPrompt(f.target), true, "claude exited");
      const after = store.getCard(f.card.id)!;
      const session = after.sessions!.find((s) => s.id === f.session.id)!;
      assert.equal(session.state, "released");
      assert.equal(after.column, "agent_done");
      assert.equal(after.lastMarker, DONE_KEY);
      assert.equal(session.lastMarker, DONE_KEY);
      assert.equal(after.statusReason, "shipped");
      assert.ok((await wholePane(f.target)).includes(DONE_LINE));
      assert.equal(await tmux.hasSession(`=${f.tmuxSession}`), true);

      const rows = releaseRows(f.card.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.data.result, "released");
      const states = store
        .listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 1000)
        .filter(
          (e) =>
            e.cardId === f.card.id &&
            e.kind === "supervisor_state" &&
            e.data.to === "released",
        );
      assert.equal(states.length, 1);
      assert.equal(states[0]?.data.from, "idle");
      assert.equal(states[0]?.data.evidence, "idle 600 s after DONE");
    } finally {
      await tmux.killSession(`=${f.tmuxSession}`);
      await env.killServer();
    }
  },
);

void test(
  "a /exit that does not reach the shell records busy once and sends no keys inside the retry period",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-stuck.txt");
    writeFakeRepl(env, argvFile);
    const f = await finishedCard("stuck");
    const exits = async () =>
      (await tmux.capturePane(f.target)).split("/exit").length - 1;
    try {
      await releaseIfDue(f.card, f.session, idle, false, f.now);
      assert.equal(await exits(), 1, "one /exit typed");
      const rows = releaseRows(f.card.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.data.result, "busy");
      const kept = store
        .getCard(f.card.id)!
        .sessions!.find((s) => s.id === f.session.id)!;
      assert.equal(kept.state, "idle");

      await releaseIfDue(f.card, f.session, idle, false, f.now + 5 * 60_000);
      assert.equal(await exits(), 1, "no second /exit inside 10 minutes");
      assert.equal(releaseRows(f.card.id).length, 1);
    } finally {
      await tmux.killSession(`=${f.tmuxSession}`);
      await env.killServer();
    }
  },
);

void test(
  "a call while another withCardLock holds the card writes nothing and records nothing",
  { skip: !env.canRunRealTmux },
  async () => {
    writeFakeRepl(env, path.join(env.root, "claude-argv-locked.txt"));
    const f = await finishedCard("locked");
    try {
      await withCardLock(f.card.id, () =>
        releaseIfDue(f.card, f.session, idle, false, f.now),
      );
      assert.equal(await tmux.paneAtPrompt(f.target), false, "claude runs");
      assert.ok(!(await tmux.capturePane(f.target)).includes("/exit"));
      const kept = store
        .getCard(f.card.id)!
        .sessions!.find((s) => s.id === f.session.id)!;
      assert.equal(kept.state, "idle");
      assert.equal(releaseRows(f.card.id).length, 0);
    } finally {
      await tmux.killSession(`=${f.tmuxSession}`);
      await env.killServer();
    }
  },
);

void test(
  "a pane without the ready footer types no /exit, keeps the state and records nothing",
  { skip: !env.canRunRealTmux },
  async () => {
    writeFakeRepl(env, path.join(env.root, "claude-argv-draft.txt"));
    const f = await finishedCard("draft");
    try {
      await waitFor(
        async () => READY.test(await tmux.capturePane(f.target)),
        5000,
        "the ready footer",
      );
      for (let i = 0; i < 6; i++) {
        await tmux.sendLiteral(f.target, "draft");
        await tmux.sendKeys(f.target, ["Enter"]);
      }
      await waitFor(
        async () => !READY.test(footer(await tmux.capturePane(f.target))),
        5000,
        "the footer scrolled away",
      );
      await releaseIfDue(f.card, f.session, idle, false, f.now);
      assert.ok(!(await tmux.capturePane(f.target)).includes("/exit"));
      assert.equal(await tmux.paneAtPrompt(f.target), false, "claude runs");
      const kept = store
        .getCard(f.card.id)!
        .sessions!.find((s) => s.id === f.session.id)!;
      assert.equal(kept.state, "idle");
      assert.equal(releaseRows(f.card.id).length, 0);
    } finally {
      await tmux.killSession(`=${f.tmuxSession}`);
      await env.killServer();
    }
  },
);

void test(
  "a failed exit keeps a state that replaced released during the wait",
  { skip: !env.canRunRealTmux },
  async () => {
    writeFakeRepl(env, path.join(env.root, "claude-argv-newer.txt"));
    const f = await finishedCard("newer");
    const stored = () =>
      store.getCard(f.card.id)!.sessions!.find((s) => s.id === f.session.id)!
        .state;
    try {
      const pending = releaseIfDue(f.card, f.session, idle, false, f.now);
      await waitFor(
        () => Promise.resolve(stored() === "released"),
        5000,
        "the released mark",
      );
      await store.setSessionStateIfSession(f.card.id, f.session.id, "working");
      await pending;
      assert.equal(stored(), "working");
      assert.equal(releaseRows(f.card.id)[0]?.data.result, "busy");
    } finally {
      await tmux.killSession(`=${f.tmuxSession}`);
      await env.killServer();
    }
  },
);

void test.after(() => env.cleanup());
