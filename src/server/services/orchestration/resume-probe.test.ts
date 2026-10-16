import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type {
  Card,
  OrchestrationEvent,
  Session,
} from "../../../shared/types.js";
import {
  MEMORY_RESUME_LINE,
  isDispatchLine,
} from "../../../shared/dispatch-lines.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import { initialMemory } from "../domain/supervisor-state.js";
import { initialPlanMemory } from "../domain/supervisor-plan.js";
import type { SupervisorWatcher } from "./supervisor-registry.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { probeResume, probeTools } = await import("./resume-probe.js");
const { withCardLock } = await import("./card-lock.js");

const SHELL = 4242;
const JOB = 4300;
const IDLE = "output\n────\n❯ \n────\n  ? for shortcuts";
const BUSY = "✻ Working… (esc to interrupt)\n❯ \n  esc to interrupt";
const DIALOG =
  "❯ \nDo you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel";
const realTools = { ...probeTools };
type Sent = Awaited<ReturnType<typeof probeTools.send>>;
let cards: Map<string, Card>;
let events: Omit<OrchestrationEvent, "id">[];
let sentLines: string[];
let killed: [number, string][];
let resumed: [Card, Session][];
let needsInput: string[];
let panes: string[];
let sendResults: Sent[];
let terminal: { pgid: number; tpgid: number };
let atPrompt: () => boolean;
let cooked: boolean | null;
let shellRoot: boolean;
let starting: boolean;
let watcher: SupervisorWatcher;
let sleeps: number;

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

const probeEvents = () =>
  events.filter((e) => e.data.action === "resume_probe").map((e) => e.data);
const relaunchEvents = () => events.filter((e) => e.data.action === "relaunch");
const unconfirmed = (reason: string): Sent => ({
  result: "unconfirmed",
  reason: reason as Sent["reason"],
});

beforeEach(() => {
  cards = new Map();
  events = [];
  sentLines = [];
  killed = [];
  resumed = [];
  needsInput = [];
  panes = [IDLE];
  sendResults = [{ result: "confirmed" }];
  terminal = { pgid: SHELL, tpgid: JOB };
  atPrompt = () => true;
  cooked = true;
  shellRoot = true;
  starting = false;
  sleeps = 0;
  watcher = {
    tmuxSession: "dsp-GROUP-1",
    memory: initialMemory(null),
    running: false,
    shellRoot: false,
    plan: initialPlanMemory(),
    progressRead: false,
    closeTriedAt: 0,
  };
  Object.assign(probeTools, {
    capturePane: () =>
      Promise.resolve(panes.length > 1 ? panes.shift()! : panes[0]),
    paneTerminal: () => Promise.resolve(terminal),
    ttyCooked: () => Promise.resolve(cooked),
    atShellPrompt: () => Promise.resolve(atPrompt()),
    shellRoot: () => Promise.resolve(shellRoot),
    hasSession: () => Promise.resolve(true),
    watcher: () => watcher,
    send: (_c: Card, _s: Session, text: string) => {
      sentLines.push(text);
      return Promise.resolve(
        sendResults.length > 1 ? sendResults.shift()! : sendResults[0],
      );
    },
    resume: (card: Card, s: Session) => {
      resumed.push([card, s]);
      return Promise.resolve();
    },
    kill: (pid: number, signal: string) => {
      killed.push([pid, signal]);
      if (signal === "SIGKILL") atPrompt = () => true;
    },
    sleep: () => {
      sleeps += 1;
      return Promise.resolve();
    },
    timing: { readyMs: 1, settleMs: 1, confirmMs: 1, pollMs: 1 },
    grace: { hangupMs: 5, killMs: 5, pollMs: 1 },
  });
  setBoardRepository(
    fakeBoardRepository({
      getCard: (id) => cards.get(id),
      isStarting: () => starting,
      appendOrchestrationEvent: (e) => {
        events.push(e);
        return { ...e, id: events.length };
      },
      setSessionStateIfSession: (_id, _sid, _state, reason) => {
        needsInput.push(String(reason));
        return Promise.resolve(true);
      },
      applyMarker: () => Promise.resolve(),
    }),
  );
});

afterEach(() => {
  Object.assign(probeTools, realTools);
  setBoardRepository(store);
});

void test("a probe that is confirmed records one confirmed event and changes nothing", async () => {
  loopCard();
  await probeResume("card-1");
  assert.deepEqual(sentLines, [MEMORY_RESUME_LINE]);
  assert.deepEqual(probeEvents(), [
    { action: "resume_probe", result: "confirmed" },
  ]);
  assert.deepEqual(killed, []);
  assert.deepEqual(resumed, []);
  assert.equal(watcher.running, false);
});

for (const reason of ["not in transcript", "not ready"]) {
  void test(`a probe unconfirmed as "${reason}" on a cooked tty ends the job and resumes the card`, async () => {
    const card = loopCard();
    sendResults = [unconfirmed(reason)];
    atPrompt = () => killed.length > 0;
    await probeResume("card-1");
    assert.equal(relaunchEvents().length, 1);
    assert.deepEqual(relaunchEvents()[0].data, {
      action: "relaunch",
      level: "WARN",
      reason: `resume probe: ${reason}, pane tty cooked`,
    });
    assert.deepEqual(killed, [[-JOB, "SIGHUP"]]);
    assert.deepEqual(resumed, [[card, session]]);
    assert.equal(watcher.running, false);
  });
}

for (const tty of [false, null]) {
  void test(`an unconfirmed probe on a tty that reads ${tty} kills nothing`, async () => {
    loopCard();
    sendResults = [unconfirmed("not in transcript")];
    cooked = tty;
    await probeResume("card-1");
    assert.deepEqual(probeEvents(), [
      { action: "resume_probe", result: "unconfirmed", reason: "not stuck" },
    ]);
    assert.deepEqual(relaunchEvents(), []);
    assert.deepEqual(killed, []);
    assert.deepEqual(resumed, []);
  });
}

void test("an unconfirmed probe on a pane with no shell root kills nothing", async () => {
  loopCard();
  sendResults = [unconfirmed("not in transcript")];
  shellRoot = false;
  await probeResume("card-1");
  assert.deepEqual(probeEvents(), [
    { action: "resume_probe", result: "unconfirmed", reason: "no shell root" },
  ]);
  assert.deepEqual(relaunchEvents(), []);
  assert.deepEqual(killed, []);
  assert.deepEqual(resumed, []);
});

void test("a pane that turns busy after the unconfirmed send is not typed again or killed", async () => {
  loopCard();
  panes = [IDLE, BUSY, IDLE];
  sendResults = [unconfirmed("not in transcript"), { result: "confirmed" }];
  await probeResume("card-1");
  assert.equal(sentLines.length, 1);
  assert.deepEqual(killed, []);
  assert.deepEqual(relaunchEvents(), []);
  assert.deepEqual(probeEvents(), [
    { action: "resume_probe", result: "unconfirmed", reason: "turn began" },
  ]);
});

for (const reason of ["dialog opened", "no tmux session"]) {
  void test(`a probe unconfirmed as "${reason}" is recorded and not relaunched`, async () => {
    loopCard();
    sendResults = [unconfirmed(reason)];
    await probeResume("card-1");
    assert.deepEqual(probeEvents(), [
      { action: "resume_probe", result: "unconfirmed", reason },
    ]);
    assert.deepEqual(relaunchEvents(), []);
    assert.deepEqual(killed, []);
    assert.deepEqual(resumed, []);
  });
}

void test("a card paused before the probe gets no line", async () => {
  loopCard({
    paused: { at: "x", by: "user", sessionId: "session-1", pids: [1] },
  });
  await probeResume("card-1");
  assert.deepEqual(sentLines, []);
});

void test("a card outside In Progress gets no line", async () => {
  loopCard({ column: "needs_input" });
  await probeResume("card-1");
  assert.deepEqual(sentLines, []);
});

for (const state of ["needs_input", "permission_prompt"] as const) {
  void test(`a session in state ${state} gets no line`, async () => {
    loopCard({ sessions: [{ ...session, state }] });
    await probeResume("card-1");
    assert.deepEqual(sentLines, []);
  });
}

void test("a card with a start in flight gets no line", async () => {
  loopCard();
  starting = true;
  await probeResume("card-1");
  assert.deepEqual(sentLines, []);
});

void test("the line is typed only after a busy pane turns idle", async () => {
  loopCard();
  panes = [BUSY, BUSY, IDLE];
  let captures = 0;
  const capture = probeTools.capturePane;
  probeTools.capturePane = (...args) => {
    captures += 1;
    return capture(...args);
  };
  let capturesAtSend = 0;
  probeTools.send = () => {
    capturesAtSend = captures;
    sentLines.push("sent");
    return Promise.resolve({ result: "confirmed" });
  };
  await probeResume("card-1");
  assert.equal(capturesAtSend, 3);
  assert.deepEqual(sentLines, ["sent"]);
});

void test("a failed capture is not idle", async () => {
  loopCard();
  let fails = 2;
  probeTools.capturePane = () =>
    fails-- > 0 ? Promise.reject(new Error("tmux")) : Promise.resolve(IDLE);
  await probeResume("card-1");
  assert.equal(sleeps, 2);
  assert.equal(sentLines.length, 1);
});

void test("a pane that stays busy past the limit gets no line", async (t) => {
  loopCard();
  panes = [BUSY];
  const real = Date.now.bind(Date);
  let skew = 0;
  t.mock.method(Date, "now", () => real() + skew);
  probeTools.sleep = () => {
    skew += 10 * 60_000;
    return Promise.resolve();
  };
  await probeResume("card-1");
  assert.deepEqual(sentLines, []);
});

void test("a card paused during the busy wait gets no line", async () => {
  const card = loopCard();
  panes = [BUSY];
  probeTools.sleep = () => {
    card.paused = { at: "x", by: "memory", sessionId: "session-1", pids: [1] };
    return Promise.resolve();
  };
  await probeResume("card-1");
  assert.deepEqual(sentLines, []);
});

void test("an open dialog in the pane skips the probe", async () => {
  loopCard();
  panes = [DIALOG];
  await probeResume("card-1");
  assert.deepEqual(sentLines, []);
  assert.deepEqual(probeEvents(), [
    { action: "resume_probe", result: "skipped", reason: "dialog open" },
  ]);
});

void test("a held supervisor watcher delays the line until it is free", async () => {
  loopCard();
  watcher.running = true;
  const runningAtSend: boolean[] = [];
  probeTools.send = () => {
    runningAtSend.push(watcher.running);
    sentLines.push("sent");
    return Promise.resolve({ result: "confirmed" });
  };
  probeTools.sleep = () => {
    sleeps += 1;
    if (sleeps === 1) watcher.running = false;
    return Promise.resolve();
  };
  await probeResume("card-1");
  assert.equal(sleeps, 1);
  assert.deepEqual(runningAtSend, [true]);
  assert.equal(watcher.running, false);
});

void test("a watcher that stays held for every attempt gets no line, is left held and is recorded", async () => {
  loopCard();
  watcher.running = true;
  await probeResume("card-1");
  assert.deepEqual(sentLines, []);
  assert.deepEqual(probeEvents(), [
    { action: "resume_probe", result: "skipped", reason: "supervisor busy" },
  ]);
  assert.equal(sleeps, 3);
  assert.equal(watcher.running, true);
});

void test("a held card lock delays the line until it is free", async () => {
  loopCard();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = withCardLock("card-1", () => gate);
  probeTools.sleep = () => {
    sleeps += 1;
    release();
    return Promise.resolve();
  };
  await probeResume("card-1");
  await held;
  assert.equal(sleeps, 1);
  assert.equal(sentLines.length, 1);
  assert.equal(watcher.running, false);
});

void test("a send that throws leaves the watcher free", async () => {
  loopCard();
  probeTools.send = () => Promise.reject(new Error("boom"));
  await probeResume("card-1");
  assert.equal(watcher.running, false);
});

void test("a shell that already owns the terminal is never signalled and the card is resumed", async () => {
  loopCard();
  sendResults = [unconfirmed("not in transcript")];
  terminal = { pgid: SHELL, tpgid: SHELL };
  await probeResume("card-1");
  assert.deepEqual(killed, []);
  assert.equal(resumed.length, 1);
});

for (const tpgid of [0, 1, process.pid, process.ppid]) {
  void test(`a foreground group ${tpgid} that is not safe to signal is never signalled`, async () => {
    loopCard();
    sendResults = [unconfirmed("not in transcript")];
    terminal = { pgid: SHELL, tpgid };
    await probeResume("card-1");
    assert.deepEqual(killed, []);
  });
}

void test("a job that survives the hangup is killed while it still owns the terminal", async () => {
  loopCard();
  sendResults = [unconfirmed("not in transcript")];
  atPrompt = () => killed.some(([, s]) => s === "SIGKILL");
  probeTools.kill = (pid, signal) => {
    killed.push([pid, signal]);
  };
  await probeResume("card-1");
  assert.deepEqual(killed, [
    [-JOB, "SIGHUP"],
    [-JOB, "SIGKILL"],
  ]);
  assert.equal(resumed.length, 1);
  assert.deepEqual(needsInput, []);
});

void test("a terminal that changed owner after the hangup is not killed", async () => {
  loopCard();
  sendResults = [unconfirmed("not in transcript")];
  atPrompt = () => false;
  probeTools.kill = (pid, signal) => {
    killed.push([pid, signal]);
    terminal = { pgid: SHELL, tpgid: 5555 };
  };
  await probeResume("card-1");
  assert.deepEqual(killed, [[-JOB, "SIGHUP"]]);
});

void test("a job that survives the kill needs input and is not resumed", async () => {
  loopCard();
  sendResults = [unconfirmed("not in transcript")];
  atPrompt = () => false;
  probeTools.kill = (pid, signal) => {
    killed.push([pid, signal]);
  };
  await probeResume("card-1");
  assert.deepEqual(killed, [
    [-JOB, "SIGHUP"],
    [-JOB, "SIGKILL"],
  ]);
  assert.deepEqual(needsInput, ["resume_failed"]);
  assert.deepEqual(resumed, []);
});

void test("a card paused while its job ends is not resumed", async () => {
  const card = loopCard();
  sendResults = [unconfirmed("not in transcript")];
  atPrompt = () => killed.length > 0;
  probeTools.kill = (pid, signal) => {
    killed.push([pid, signal]);
    card.paused = { at: "x", by: "user", sessionId: "session-1", pids: [1] };
  };
  await probeResume("card-1");
  assert.deepEqual(resumed, []);
  assert.deepEqual(needsInput, []);
});

void test("a second probe of the same card during the busy wait does nothing", async () => {
  loopCard();
  panes = [BUSY, IDLE];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  probeTools.sleep = () => gate;
  const first = probeResume("card-1");
  await probeResume("card-1");
  release();
  await first;
  assert.equal(sentLines.length, 1);
});

void test("the resume line counts as a Dispatch line", () => {
  assert.equal(isDispatchLine(MEMORY_RESUME_LINE), true);
});
