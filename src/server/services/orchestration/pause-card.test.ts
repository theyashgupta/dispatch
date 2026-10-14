import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type {
  Card,
  OrchestrationEvent,
  Session,
} from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import { run, spawnPiped } from "../../adapters/exec.js";
import { parseProcessTable, signalTree } from "../../adapters/process-tree.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const {
  continueOrphans,
  continueSession,
  onPausedPidsReleased,
  pauseCard,
  pauseTools,
  unpauseCard,
} = await import("./pause-card.js");
const { runningLoops } = await import("./boards.js");

const SHELL = 4242;
const JOB = 4300;
const GRAND = 4301;
const OTHER = 5000;
const owned = (tpgid: number) => Promise.resolve({ pgid: SHELL, tpgid });
const realTools = { ...pauseTools };
let cards: Map<string, Card>;
let events: Omit<OrchestrationEvent, "id">[];
let starting: Set<string>;
let signals: [number[], string][];
let paneMap: Map<string, number[]> | null;
let typed: [string, string, string[] | string][];
let terminal: () => Promise<{ pgid: number; tpgid: number } | null>;
let elapsed: Map<number, number> | null;
let promptTargets: string[];
let killed: [number, string][];
let sleeps: number;
let shell: boolean;

beforeEach(() => {
  cards = new Map();
  events = [];
  starting = new Set();
  signals = [];
  paneMap = new Map([["dsp-GROUP-1", [4242]]]);
  typed = [];
  terminal = () => owned(OTHER);
  elapsed = null;
  promptTargets = [];
  killed = [];
  sleeps = 0;
  shell = true;
  pauseTools.kill = (pid, signal) => {
    killed.push([pid, signal]);
  };
  pauseTools.sessionEnvHas = () => Promise.resolve(shell);
  pauseTools.sleep = () => {
    sleeps += 1;
    return Promise.resolve();
  };
  pauseTools.paneTerminal = (target) => {
    promptTargets.push(target);
    return terminal();
  };
  pauseTools.readElapsed = () => Promise.resolve(elapsed);
  pauseTools.sendKeys = (target, keys) => {
    typed.push(["keys", target, keys]);
    return Promise.resolve();
  };
  pauseTools.sendLiteral = (target, text) => {
    typed.push(["literal", target, text]);
    return Promise.resolve();
  };
  pauseTools.panePids = () => Promise.resolve(paneMap);
  pauseTools.signalTree = (pids, signal) => {
    signals.push([pids, signal]);
    return Promise.resolve(pids);
  };
  setBoardRepository(
    fakeBoardRepository({
      getCard: (id) => cards.get(id),
      isStarting: (id) => starting.has(id),
      listCards: () => [...cards.values()],
      markCardPaused: (id, sessionId, mark) => {
        const card = cards.get(id);
        if (!card || card.activeSessionId !== sessionId)
          return Promise.resolve(false);
        card.paused = mark;
        return Promise.resolve(true);
      },
      setPausedPids: (id, pids) => {
        const card = cards.get(id);
        if (card?.paused) card.paused = { ...card.paused, pids };
        return Promise.resolve();
      },
      clearCardPaused: (id) => {
        const card = cards.get(id);
        if (card) card.paused = null;
        return Promise.resolve();
      },
      appendOrchestrationEvent: (e) => {
        events.push(e);
        return { ...e, id: events.length };
      },
    }),
  );
});

afterEach(() => {
  Object.assign(pauseTools, realTools);
  setBoardRepository(store);
});

const session: Session = {
  id: "session-1",
  createdAt: "2026-10-13T00:00:00Z",
  updatedAt: "2026-10-13T00:00:00Z",
  tmuxSession: "dsp-GROUP-1",
};

function loopCard(overrides: Partial<Card> = {}): Card {
  const card: Card = {
    id: "card-1",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "card-1",
    identifier: "GROUP-1",
    title: "Loop",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-10-13T00:00:00Z",
    source: "group",
    tmuxSession: "dsp-GROUP-1",
    sessions: [session],
    activeSessionId: "session-1",
    ...overrides,
  };
  cards.set(card.id, card);
  return card;
}

async function refusal(promise: Promise<Card>): Promise<ConflictError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ConflictError);
    return err;
  }
  throw new Error("expected a ConflictError");
}

void test("pause refuses a card that is not a loop", async () => {
  loopCard({ source: "local" });
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.equal(err.code, "not-pausable");
  assert.deepEqual(err.details, { reason: "not a loop" });
  assert.deepEqual(signals, []);
  assert.equal(cards.get("card-1")?.paused, undefined);
});

void test("pause refuses the hidden orchestrator card", async () => {
  loopCard({ source: "orchestrator", launch: { direction: "go" } });
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.deepEqual(err.details, { reason: "orchestrator session" });
  assert.deepEqual(signals, []);
  assert.equal(cards.get("card-1")?.paused, undefined);
});

void test("pause refuses a card whose start is in flight", async () => {
  loopCard();
  starting.add("card-1");
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.deepEqual(err.details, { reason: "start in progress" });
  assert.deepEqual(signals, []);
  assert.equal(cards.get("card-1")?.paused, undefined);
});

void test("pause refuses a card with no live session", async () => {
  loopCard({ sessions: [], activeSessionId: undefined });
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.deepEqual(err.details, { reason: "no live session" });
  assert.deepEqual(signals, []);
  assert.equal(cards.get("card-1")?.paused, undefined);
});

void test("pause accepts a launched ticket card", async () => {
  loopCard({ source: "local", launch: { direction: "go" } });
  const paused = await pauseCard("card-1", { by: "user", reason: "r" });
  assert.equal(paused.paused?.by, "user");
});

void test("pause of an unknown card throws the not found error", async () => {
  await assert.rejects(
    pauseCard("card-none", { by: "user", reason: "r" }),
    (err: unknown) =>
      err instanceof NotFoundError && err.code === "unknown card id: card-none",
  );
});

void test("pause stops the pane tree, stores the mark and logs one event", async () => {
  loopCard();
  const paused = await pauseCard("card-1", { by: "user", reason: "memory" });
  assert.deepEqual(signals, [[[4242], "SIGSTOP"]]);
  assert.equal(paused.paused?.by, "user");
  assert.equal(paused.paused?.sessionId, "session-1");
  assert.deepEqual(paused.paused?.pids, [4242]);
  assert.match(
    paused.paused?.at ?? "",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "supervisor_action");
  assert.deepEqual(events[0].data, {
    action: "pause",
    by: "user",
    reason: "memory",
  });
});

void test("pause of a paused card is 409 already-paused with no second signal", async () => {
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.equal(err.code, "already-paused");
  assert.equal(signals.length, 1);
  assert.equal(events.length, 1);
});

void test("unpause continues the tree, clears the mark and logs a resume event", async () => {
  loopCard();
  await pauseCard("card-1", { by: "memory", reason: "r" });
  const resumed = await unpauseCard("card-1", { reason: "user resume" });
  assert.deepEqual(signals[1], [[4242], "SIGCONT"]);
  assert.ok(!resumed.paused);
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].data, { action: "resume", reason: "user resume" });
});

void test("unpause types nothing when the job already owns the terminal", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB]]]);
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  terminal = () => owned(JOB);
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.deepEqual(typed, []);
  assert.equal(sleeps, 0);
  assert.ok(!resumed.paused);
});

void test("unpause types C-u, literal fg %1 and Enter once to the exact target when the shell owns the terminal and then the job does", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB]]]);
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  const reads: number[] = [];
  terminal = () => {
    reads.push(signals.length);
    return owned(typed.length === 0 ? SHELL : JOB);
  };
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.equal(reads[0], 1);
  assert.ok(reads.slice(1).every((n) => n === 2));
  assert.deepEqual(typed, [
    ["keys", "=dsp-GROUP-1:", ["C-u"]],
    ["literal", "=dsp-GROUP-1:", "fg %1"],
    ["keys", "=dsp-GROUP-1:", ["Enter"]],
  ]);
  assert.deepEqual([...new Set(promptTargets)], ["=dsp-GROUP-1:"]);
  assert.ok(!resumed.paused);
});

void test("unpause keeps the mark, continues nothing, types nothing and answers 409 unpause-incomplete when another process group owns the terminal", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB]]]);
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  terminal = () => owned(OTHER);
  const err = await refusal(unpauseCard("card-1", { reason: "r" }));
  assert.equal(err.code, "unpause-incomplete");
  assert.deepEqual(err.details, {
    reason: "a command typed while paused owns the terminal",
  });
  assert.deepEqual(typed, []);
  assert.equal(signals.length, 1);
  assert.deepEqual(killed, []);
  assert.deepEqual(cards.get("card-1")?.paused?.pids, [SHELL, JOB]);
  assert.equal(events.length, 1);
});

void test("unpause types the keys twice, keeps the mark and answers 409 unpause-incomplete when the shell never hands the terminal back", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB]]]);
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  terminal = () => owned(SHELL);
  const err = await refusal(unpauseCard("card-1", { reason: "r" }));
  assert.equal(err.code, "unpause-incomplete");
  assert.deepEqual(err.details, {
    reason: "the shell did not hand the terminal back",
  });
  assert.deepEqual(
    typed.map(([kind, , value]) => `${kind}:${value}`),
    Array(2).fill(["keys:C-u", "literal:fg %1", "keys:Enter"]).flat(),
  );
  assert.deepEqual(cards.get("card-1")?.paused?.pids, [SHELL, JOB]);
  assert.equal(events.length, 1);
  assert.equal(signals.at(-1)?.[1], "SIGSTOP");
});

void test("unpause does not retype the keys when the job owns the terminal at the re-check after the first wait", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB]]]);
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  let reads = 0;
  terminal = () => owned(++reads <= 12 ? SHELL : JOB);
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.equal(typed.length, 3);
  assert.ok(!resumed.paused);
});

void test("with a single stored pid unpause types the keys when the shell is at its prompt and stops when it lets go", async () => {
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  terminal = () => owned(typed.length === 0 ? SHELL : OTHER);
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.equal(typed.length, 3);
  assert.ok(!resumed.paused);
});

void test("with a single stored pid unpause types nothing when the shell never owns the terminal", async () => {
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.deepEqual(typed, []);
  assert.equal(sleeps, 10);
  assert.ok(!resumed.paused);
});

void test("unpause types nothing and still clears the mark when the terminal read throws", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB]]]);
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  terminal = () => Promise.reject(new Error("no tmux"));
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.deepEqual(typed, []);
  assert.ok(!resumed.paused);
});

void test("unpause types nothing and still clears the mark when the pane terminal is gone", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB]]]);
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  terminal = () => Promise.resolve(null);
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.deepEqual(typed, []);
  assert.equal(sleeps, 0);
  assert.ok(!resumed.paused);
});

void test("two concurrent unpauses type the keys once", async () => {
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  terminal = () => owned(typed.length === 0 ? SHELL : OTHER);
  const outcomes = await Promise.allSettled([
    unpauseCard("card-1", { reason: "r" }),
    unpauseCard("card-1", { reason: "r" }),
  ]);
  assert.deepEqual(
    outcomes.map((o) => o.status),
    ["fulfilled", "rejected"],
  );
  const rejected = outcomes[1] as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ConflictError);
  assert.equal(rejected.reason.code, "busy");
  assert.equal(typed.length, 3);
  assert.equal(events.length, 2);
});

async function holdUnpause(): Promise<{
  first: Promise<Card>;
  release: () => void;
}> {
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  terminal = () => gate.then(() => owned(OTHER));
  return { first: unpauseCard("card-1", { reason: "r" }), release };
}

void test("an unpause that finds the lock busy after the mark cleared answers not-paused", async () => {
  const { first, release } = await holdUnpause();
  const card = cards.get("card-1") as Card;
  cards.set("card-1", { ...card, paused: null });
  const second = await refusal(unpauseCard("card-1", { reason: "r" }));
  release();
  await first;
  assert.equal(second.code, "not-paused");
  assert.deepEqual(typed, []);
});

void test("a pause while an unpause holds the lock answers already-paused", async () => {
  const { first, release } = await holdUnpause();
  const second = await refusal(
    pauseCard("card-1", { by: "memory", reason: "r" }),
  );
  release();
  await first;
  assert.equal(second.code, "already-paused");
  assert.equal(signals.filter(([, sig]) => sig === "SIGSTOP").length, 1);
});

void test("unpause of a card that is not paused is 409 not-paused", async () => {
  loopCard();
  const err = await refusal(unpauseCard("card-1", { reason: "r" }));
  assert.equal(err.code, "not-paused");
  assert.deepEqual(signals, []);
  assert.equal(events.length, 0);
});

void test("unpause clears the mark when the pane is gone", async () => {
  loopCard();
  await pauseCard("card-1", { by: "user", reason: "r" });
  paneMap = new Map();
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.ok(!resumed.paused);
  assert.equal(signals.length, 1);
});

void test("pause with no pane pid for the session is 409 not-pausable and writes nothing", async () => {
  loopCard();
  paneMap = new Map([["dsp-OTHER", [1]]]);
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.equal(err.code, "not-pausable");
  assert.deepEqual(err.details, { reason: "no live session" });
  assert.deepEqual(signals, []);
  assert.equal(events.length, 0);
  assert.equal(cards.get("card-1")?.paused ?? null, null);
});

void test("pause with a failed tmux read leaves no mark and answers no live session", async () => {
  loopCard();
  paneMap = null;
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.deepEqual(err.details, { reason: "no live session" });
  assert.equal(events.length, 0);
  assert.equal(cards.get("card-1")?.paused, null);
});

void test("pause whose process read fails leaves no mark and answers process read failed", async () => {
  loopCard();
  pauseTools.signalTree = () => Promise.resolve(null);
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.equal(err.code, "not-pausable");
  assert.deepEqual(err.details, { reason: "process read failed" });
  assert.equal(events.length, 0);
  assert.equal(cards.get("card-1")?.paused, null);
});

void test("pause that signals nothing leaves no mark and answers no live session", async () => {
  loopCard();
  pauseTools.signalTree = () => Promise.resolve([]);
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.deepEqual(err.details, { reason: "no live session" });
  assert.equal(events.length, 0);
  assert.equal(cards.get("card-1")?.paused, null);
});

void test("pause of a legacy session without the shell marker answers no shell session and signals nothing", async () => {
  loopCard();
  shell = false;
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.equal(err.code, "not-pausable");
  assert.deepEqual(err.details, { reason: "no shell session" });
  assert.deepEqual(signals, []);
  assert.equal(cards.get("card-1")?.paused, undefined);
});

void test("pause whose session changed before the mark answers no live session and signals nothing", async () => {
  loopCard();
  pauseTools.sessionEnvHas = () => {
    const card = cards.get("card-1") as Card;
    cards.set("card-1", { ...card, activeSessionId: "session-2" });
    return Promise.resolve(true);
  };
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.deepEqual(err.details, { reason: "no live session" });
  assert.deepEqual(signals, []);
  assert.equal(cards.get("card-1")?.paused, undefined);
});

void test("pause whose session is lost mid-pause continues exactly the signalled pids and answers no live session", async () => {
  paneMap = new Map([["dsp-GROUP-1", [SHELL, JOB, OTHER]]]);
  loopCard();
  pauseTools.signalTree = (pids, signal) => {
    signals.push([pids, signal]);
    const card = cards.get("card-1") as Card;
    card.paused = null;
    return Promise.resolve([SHELL, JOB]);
  };
  const err = await refusal(pauseCard("card-1", { by: "user", reason: "r" }));
  assert.equal(err.code, "not-pausable");
  assert.deepEqual(err.details, { reason: "no live session" });
  assert.deepEqual(killed, [
    [SHELL, "SIGCONT"],
    [JOB, "SIGCONT"],
  ]);
  assert.equal(events.length, 0);
  assert.equal(cards.get("card-1")?.paused, null);
});

void test("pause and unpause through the real process walk stop the tree in order and type the keys once", async () => {
  const sent: [number, string][] = [];
  const table = `    1     0\n ${SHELL}     1\n ${JOB}  ${SHELL}\n ${GRAND}  ${JOB}\n`;
  pauseTools.signalTree = (roots, sig) =>
    signalTree(roots, sig, {
      kill: (pid, signal) => {
        sent.push([pid, signal]);
      },
      readTable: () => Promise.resolve(parseProcessTable(table)),
    });
  loopCard();
  const paused = await pauseCard("card-1", { by: "user", reason: "r" });
  assert.deepEqual(paused.paused?.pids, [4242, 4300, 4301]);
  assert.deepEqual(sent, [
    [4242, "SIGSTOP"],
    [4300, "SIGSTOP"],
    [4301, "SIGSTOP"],
  ]);
  terminal = () => owned(typed.length === 0 ? SHELL : JOB);
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.deepEqual(typed, [
    ["keys", "=dsp-GROUP-1:", ["C-u"]],
    ["literal", "=dsp-GROUP-1:", "fg %1"],
    ["keys", "=dsp-GROUP-1:", ["Enter"]],
  ]);
  assert.ok(!resumed.paused);
});

void test("two concurrent pauses stop the tree once and the second answers busy", async () => {
  loopCard();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  pauseTools.sessionEnvHas = () => gate.then(() => true);
  const first = pauseCard("card-1", { by: "user", reason: "r" });
  const second = await refusal(
    pauseCard("card-1", { by: "memory", reason: "r" }),
  );
  release();
  await first;
  assert.equal(second.code, "busy");
  assert.deepEqual(signals, [[[4242], "SIGSTOP"]]);
  assert.equal(events.length, 1);
  assert.equal(cards.get("card-1")?.paused?.by, "user");
});

void test("unpause continues the stored pids first, even when the pane list cannot be read", async () => {
  loopCard({
    paused: {
      at: "2026-10-13T00:00:00.000Z",
      by: "user",
      sessionId: "session-1",
      pids: [101, 102],
    },
  });
  paneMap = null;
  const resumed = await unpauseCard("card-1", { reason: "r" });
  assert.deepEqual(killed, [
    [101, "SIGCONT"],
    [102, "SIGCONT"],
  ]);
  assert.deepEqual(signals, []);
  assert.ok(!resumed.paused);
});

void test("a paused loop still counts as a running loop", async () => {
  loopCard();
  assert.equal(runningLoops(DEFAULT_BOARD_KEY), 1);
  await pauseCard("card-1", { by: "user", reason: "r" });
  assert.equal(runningLoops(DEFAULT_BOARD_KEY), 1);
});

void test("continueOrphans sends SIGCONT to each pid and an ESRCH on one does not stop the rest", () => {
  const sent: [number, string][] = [];
  pauseTools.kill = (pid, signal) => {
    sent.push([pid, signal]);
    if (pid === 101) throw Object.assign(new Error("kill"), { code: "ESRCH" });
  };
  continueOrphans([101, 102, 103]);
  assert.deepEqual(sent, [
    [101, "SIGCONT"],
    [102, "SIGCONT"],
    [103, "SIGCONT"],
  ]);
});

const releasedBase = {
  id: 1,
  cardId: "card-1",
  fromCol: null,
  toCol: null,
  reason: null,
  source: null,
  ts: "2026-10-13T00:00:00.000Z",
} as const;

void test("onPausedPidsReleased continues the pids of any event that carries them and ignores the rest", async () => {
  const sent: number[] = [];
  pauseTools.kill = (pid) => {
    sent.push(pid);
  };
  await onPausedPidsReleased({ ...releasedBase, type: "session_lost" });
  await onPausedPidsReleased({
    ...releasedBase,
    type: "session_reset",
    pausedPids: [9],
  });
  await onPausedPidsReleased({
    ...releasedBase,
    type: "cleanup",
    pausedPids: [101, 102],
  });
  assert.deepEqual(sent, [9, 101, 102]);
});

void test("onPausedPidsReleased sends SIGCONT to every pid, then SIGHUP only to a pid that started before the pause", async () => {
  elapsed = new Map([
    [101, 3600],
    [102, 5],
  ]);
  await onPausedPidsReleased({
    ...releasedBase,
    type: "session_lost",
    pausedPids: [101, 102, 103],
    pausedAt: new Date(Date.now() - 60000).toISOString(),
  });
  assert.deepEqual(killed, [
    [101, "SIGCONT"],
    [102, "SIGCONT"],
    [103, "SIGCONT"],
    [101, "SIGHUP"],
  ]);
});

void test("onPausedPidsReleased sends no SIGHUP and does not throw when the elapsed read fails", async () => {
  await onPausedPidsReleased({
    ...releasedBase,
    type: "session_lost",
    pausedPids: [101],
    pausedAt: new Date(Date.now() - 60000).toISOString(),
  });
  pauseTools.readElapsed = () => Promise.reject(new Error("ps"));
  await onPausedPidsReleased({
    ...releasedBase,
    type: "session_lost",
    pausedPids: [102],
    pausedAt: new Date(Date.now() - 60000).toISOString(),
  });
  assert.deepEqual(killed, [
    [101, "SIGCONT"],
    [102, "SIGCONT"],
  ]);
});

void test("onPausedPidsReleased sends no SIGHUP when the event has no pause time", async () => {
  elapsed = new Map([[101, 3600]]);
  await onPausedPidsReleased({
    ...releasedBase,
    type: "session_lost",
    pausedPids: [101],
  });
  assert.deepEqual(killed, [[101, "SIGCONT"]]);
});

void test("continueOrphans never signals pid 0, pid 1 or the server", () => {
  continueOrphans([0, 1, process.pid, process.ppid, 103]);
  assert.deepEqual(killed, [[103, "SIGCONT"]]);
});

void test("continueSession continues the live tree and the stored pids of a card paused in that session", async () => {
  loopCard({
    paused: {
      at: "2026-10-13T00:00:00.000Z",
      by: "user",
      sessionId: "session-1",
      pids: [101, 102],
    },
  });
  await continueSession("dsp-GROUP-1");
  assert.deepEqual(signals, [[[4242], "SIGCONT"]]);
  assert.deepEqual(killed, [
    [101, "SIGCONT"],
    [102, "SIGCONT"],
  ]);
  killed = [];
  await continueSession("dsp-OTHER");
  assert.deepEqual(killed, []);
});

void test("continueSession reaches the stored pids when the pane list cannot be read and never throws", async () => {
  loopCard({
    paused: {
      at: "2026-10-13T00:00:00.000Z",
      by: "user",
      sessionId: "session-1",
      pids: [101],
    },
  });
  pauseTools.panePids = () => Promise.reject(new Error("no tmux"));
  await continueSession("dsp-GROUP-1");
  assert.deepEqual(killed, [[101, "SIGCONT"]]);
});

void test("continueOrphans with the real kill resumes a stopped process", async () => {
  const child = spawnPiped("sleep", ["30"]);
  const pid = child.pid as number;
  try {
    pauseTools.kill = realTools.kill;
    process.kill(pid, "SIGSTOP");
    const stat = async () =>
      (await run("ps", ["-o", "stat=", "-p", String(pid)])).stdout.trim();
    const deadline = Date.now() + 3000;
    while (!(await stat()).startsWith("T") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok((await stat()).startsWith("T"));
    continueOrphans([pid]);
    assert.ok(!(await stat()).startsWith("T"));
  } finally {
    child.kill("SIGKILL");
  }
});

void test("onPausedPidsReleased with the real kill and ps continues a stopped process and hangs it up", async () => {
  const child = spawnPiped("sleep", ["30"]);
  const pid = child.pid as number;
  try {
    pauseTools.kill = realTools.kill;
    pauseTools.readElapsed = realTools.readElapsed;
    process.kill(pid, "SIGSTOP");
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await onPausedPidsReleased({
      ...releasedBase,
      type: "session_lost",
      pausedPids: [pid],
      pausedAt: new Date().toISOString(),
    });
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    assert.equal(child.signalCode, "SIGHUP");
  } finally {
    child.kill("SIGKILL");
  }
});
