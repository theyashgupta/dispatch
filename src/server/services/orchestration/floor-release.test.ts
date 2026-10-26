import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type {
  Card,
  Column,
  OrchestrationEvent,
  Session,
  SupervisorState,
  SupervisorStateReason,
} from "../../../shared/types.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { floorExiting, floorReleaseTools, releaseFinished } =
  await import("./floor-release.js");

const { ConflictError } = await import("../domain/errors.js");
const { releaseForMemory, waitForMemory } = await import("./memory-wait.js");
const { withMemoryFakes } =
  await import("../../test-support/memory-fixtures.js");
const { resumeLoop, sessionTools } = await import("./orchestrator-sessions.js");

const BOARD = DEFAULT_BOARD_KEY;
const LOW_812 = "free memory 812 MB is below the 1024 MB floor";
const IDLE_PANE = "Done. Waiting.\n\n  ? for shortcuts\n";
const BUSY_PANE = "Working...\n  esc to interrupt\n  ? for shortcuts\n";
const BACKGROUND_PANE =
  "Background work is running\n  1. Exit anyway\n  ? for shortcuts\n";

interface CardSpec {
  id: string;
  column: Column;
  state?: SupervisorState;
  reason?: SupervisorStateReason;
  engine?: { active: boolean; closed: boolean };
  shipState?: "running" | "stopped" | "done";
}

interface Fixture {
  cards: Card[];
  events: Omit<OrchestrationEvent, "id">[];
  keys: { target: string; keys: string[] }[];
  literals: { target: string; text: string }[];
}

function makeCard(spec: CardSpec): Card {
  const session = {
    id: `${spec.id}-s`,
    tmuxSession: `dsp-${spec.id}`,
    state: spec.state ?? "idle",
    stateReason: spec.reason,
  } as Session;
  return {
    id: spec.id,
    boardKey: BOARD,
    column: spec.column,
    tmuxSession: session.tmuxSession,
    activeSessionId: session.id,
    sessions: [session],
    loopProgress: spec.engine ? { engine: spec.engine } : undefined,
    shipFlow: spec.shipState ? { state: spec.shipState } : undefined,
  } as unknown as Card;
}

function stateOf(fixture: Fixture, id: string): SupervisorState | undefined {
  return fixture.cards.find((c) => c.id === id)?.sessions?.[0]?.state;
}

function install(specs: CardSpec[]): Fixture {
  const fixture: Fixture = {
    cards: specs.map(makeCard),
    events: [],
    keys: [],
    literals: [],
  };
  setBoardRepository(
    fakeBoardRepository({
      listCards: () => fixture.cards,
      getCard: (id) => fixture.cards.find((c) => c.id === id),
      isStarting: () => false,
      setSessionStateIfSession: (id, sessionId, state) => {
        const session = fixture.cards
          .find((c) => c.id === id)
          ?.sessions?.find((s) => s.id === sessionId);
        if (!session) return Promise.resolve(false);
        session.state = state;
        return Promise.resolve(true);
      },
      appendOrchestrationEvent: (e) => {
        fixture.events.push(e);
        return { ...e, id: fixture.events.length };
      },
    }),
  );
  floorReleaseTools.sendKeys = (target, keys) => {
    fixture.keys.push({ target, keys });
    return Promise.resolve();
  };
  floorReleaseTools.sendLiteral = (target, text) => {
    fixture.literals.push({ target, text });
    return Promise.resolve();
  };
  floorReleaseTools.capturePane = () => Promise.resolve(IDLE_PANE);
  floorReleaseTools.paneAtPrompt = () => Promise.resolve(true);
  floorReleaseTools.awaitShellPrompt = () => Promise.resolve();
  floorReleaseTools.sessionEnvHas = () => Promise.resolve(true);
  return fixture;
}

function releaseEvents(fixture: Fixture, result: string) {
  return fixture.events.filter(
    (e) => e.data.action === "release_session" && e.data.result === result,
  );
}

const saved = { ...floorReleaseTools };
const savedSessionTools = { ...sessionTools };

beforeEach(() => {
  Object.assign(floorReleaseTools, saved);
});

afterEach(() => {
  Object.assign(floorReleaseTools, saved);
  Object.assign(sessionTools, savedSessionTools);
  setBoardRepository(store);
});

void test("releaseFinished exits every finished idle session and leaves the running card alone", async () => {
  const fixture = install([
    { id: "a-agent-done", column: "agent_done" },
    { id: "a-done", column: "done" },
    {
      id: "a-running",
      column: "in_progress",
      engine: { active: true, closed: false },
    },
  ]);

  const released = await releaseFinished(BOARD);

  assert.equal(released, 2);
  assert.equal(stateOf(fixture, "a-agent-done"), "released");
  assert.equal(stateOf(fixture, "a-done"), "released");
  assert.equal(stateOf(fixture, "a-running"), "idle");
  for (const id of ["a-agent-done", "a-done"]) {
    const target = `=dsp-${id}:`;
    assert.deepEqual(
      fixture.literals.filter((l) => l.target === target),
      [{ target, text: "/exit" }],
    );
    assert.deepEqual(
      fixture.keys.filter((k) => k.target === target),
      [{ target, keys: ["Enter"] }],
    );
  }
  assert.equal(
    [...fixture.literals, ...fixture.keys].filter(
      (k) => k.target === "=dsp-a-running:",
    ).length,
    0,
  );
  assert.deepEqual(
    fixture.cards.map((c) => [c.id, c.column, c.tmuxSession]),
    [
      ["a-agent-done", "agent_done", "dsp-a-agent-done"],
      ["a-done", "done", "dsp-a-done"],
      ["a-running", "in_progress", "dsp-a-running"],
    ],
  );
  assert.equal(releaseEvents(fixture, "released").length, 2);
  const stateRows = fixture.events.filter(
    (e) => e.kind === "supervisor_state" && e.data.to === "released",
  );
  assert.equal(stateRows.length, 2);
});

void test("releaseFinished keeps a finished card whose ship flow is running", async () => {
  const fixture = install([
    { id: "b-ship", column: "agent_done", shipState: "running" },
  ]);

  assert.equal(await releaseFinished(BOARD), 0);
  assert.equal(stateOf(fixture, "b-ship"), "idle");
  assert.equal(fixture.literals.length + fixture.keys.length, 0);
});

void test("releaseFinished keeps a finished card whose pane is busy", async () => {
  const fixture = install([{ id: "c-busy", column: "done" }]);
  floorReleaseTools.capturePane = () => Promise.resolve(BUSY_PANE);

  assert.equal(await releaseFinished(BOARD), 0);
  assert.equal(stateOf(fixture, "c-busy"), "idle");
  assert.equal(fixture.literals.length + fixture.keys.length, 0);
});

void test("releaseFinished restores the previous state when the exit never reaches the shell", async () => {
  const fixture = install([{ id: "d-fail", column: "done", state: "idle" }]);
  floorReleaseTools.awaitShellPrompt = () => Promise.reject(new Error("slow"));
  floorReleaseTools.paneAtPrompt = () => Promise.resolve(false);

  assert.equal(await releaseFinished(BOARD), 0);
  assert.equal(stateOf(fixture, "d-fail"), "idle");
  assert.equal(releaseEvents(fixture, "busy").length, 1);
  assert.equal(releaseEvents(fixture, "released").length, 0);
  assert.equal(
    fixture.keys.some((k) => k.keys.includes("Escape")),
    false,
  );
});

void test("releaseFinished presses Escape when the failed exit shows the background work menu", async () => {
  const fixture = install([{ id: "d-menu", column: "done", state: "idle" }]);
  let captures = 0;
  floorReleaseTools.capturePane = () => {
    captures += 1;
    return Promise.resolve(captures === 1 ? IDLE_PANE : BACKGROUND_PANE);
  };
  floorReleaseTools.awaitShellPrompt = () => Promise.reject(new Error("slow"));
  floorReleaseTools.paneAtPrompt = () => Promise.resolve(false);

  assert.equal(await releaseFinished(BOARD), 0);
  assert.deepEqual(fixture.keys.at(-1), {
    target: "=dsp-d-menu:",
    keys: ["Escape"],
  });
  assert.equal(stateOf(fixture, "d-menu"), "idle");
  assert.equal(releaseEvents(fixture, "busy").length, 1);
});

void test("releaseFinished counts an exit as released when the pane is at the shell prompt after a timeout", async () => {
  const fixture = install([{ id: "e-late", column: "agent_done" }]);
  floorReleaseTools.awaitShellPrompt = () => Promise.reject(new Error("slow"));
  floorReleaseTools.paneAtPrompt = () => Promise.resolve(true);

  assert.equal(await releaseFinished(BOARD), 1);
  assert.equal(stateOf(fixture, "e-late"), "released");
  assert.equal(releaseEvents(fixture, "released").length, 1);
});

void test("releaseFinished answers 0 and sends no key when no session is finished", async () => {
  const fixture = install([
    {
      id: "f-running",
      column: "in_progress",
      engine: { active: true, closed: false },
    },
    { id: "f-plain", column: "in_progress" },
  ]);

  assert.equal(await releaseFinished(BOARD), 0);
  assert.equal(fixture.literals.length + fixture.keys.length, 0);
  assert.equal(fixture.events.length, 0);
});

void test("a start below the floor releases two finished sessions and proceeds when memory comes back", async () => {
  const fixture = install([
    { id: "g-agent-done", column: "agent_done" },
    { id: "g-done", column: "done" },
    {
      id: "g-running",
      column: "in_progress",
      engine: { active: true, closed: false },
    },
  ]);

  await withMemoryFakes([812, 2048], async ({ slept }) => {
    const waits: string[] = [];
    const result = await waitForMemory(BOARD, (reason) => {
      waits.push(reason);
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(waits, [LOW_812]);
    assert.deepEqual(slept, [5_000]);
  });

  assert.equal(stateOf(fixture, "g-agent-done"), "released");
  assert.equal(stateOf(fixture, "g-done"), "released");
  assert.equal(stateOf(fixture, "g-running"), "idle");
  assert.equal(
    [...fixture.literals, ...fixture.keys].filter(
      (k) => k.target === "=dsp-g-running:",
    ).length,
    0,
  );
});

void test("the floor path never releases a running session", async () => {
  const fixture = install([
    {
      id: "h-running",
      column: "in_progress",
      engine: { active: true, closed: false },
    },
    {
      id: "h-agent-done",
      column: "agent_done",
      engine: { active: true, closed: false },
    },
    { id: "h-ship", column: "done", shipState: "running" },
  ]);

  await withMemoryFakes([812], async ({ slept }) => {
    const result = await releaseForMemory(BOARD);
    assert.deepEqual(result, { ok: false, reason: LOW_812 });
    assert.deepEqual(slept, []);
  });

  assert.equal(fixture.literals.length + fixture.keys.length, 0);
  for (const id of ["h-running", "h-agent-done", "h-ship"]) {
    assert.equal(stateOf(fixture, id), "idle");
  }
});

void test("memory still low 30 seconds after a release answers the low check", async () => {
  const fixture = install([{ id: "i-done", column: "done" }]);

  await withMemoryFakes([812], async ({ slept }) => {
    const result = await releaseForMemory(BOARD);
    assert.deepEqual(result, { ok: false, reason: LOW_812 });
    assert.deepEqual(slept, [5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);
  });

  assert.equal(stateOf(fixture, "i-done"), "released");
});

void test("resume_loop still answers memory-pressure when no finished session exists", async () => {
  const fixture = install([
    {
      id: "j-stopped",
      column: "in_progress",
      state: "needs_input",
      reason: "stop_session",
    },
  ]);
  const sends: string[] = [];
  sessionTools.send = (_card, _session, text) => {
    sends.push(text);
    return Promise.resolve("confirmed");
  };
  const caller = { boardKey: BOARD, orchestratorId: "orc-floor" };

  await withMemoryFakes([812], async ({ slept }) => {
    await assert.rejects(
      resumeLoop(caller, fixture.cards[0]),
      (err) =>
        err instanceof ConflictError &&
        err.code === "memory-pressure" &&
        err.details?.reason === LOW_812,
    );
    assert.deepEqual(slept, []);
  });

  assert.deepEqual(sends, []);
  assert.equal(fixture.literals.length + fixture.keys.length, 0);
  assert.equal(stateOf(fixture, "j-stopped"), "needs_input");
});

void test("memory above the floor releases nothing", async () => {
  const fixture = install([{ id: "k-done", column: "done" }]);

  await withMemoryFakes([2048], async ({ slept }) => {
    assert.deepEqual(await waitForMemory(BOARD), { ok: true });
    assert.deepEqual(slept, []);
  });

  assert.equal(stateOf(fixture, "k-done"), "idle");
  assert.equal(fixture.literals.length + fixture.keys.length, 0);
});

void test("a start still low 30 seconds after a release goes on to the 30 minute queue", async () => {
  const fixture = install([{ id: "l-done", column: "done" }]);
  const readings = [...Array.from({ length: 8 }, () => 812), 2048];

  await withMemoryFakes(readings, async ({ slept }) => {
    assert.deepEqual(await waitForMemory(BOARD), { ok: true });
    assert.deepEqual(
      slept,
      [5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 30_000, 30_000],
    );
  });

  assert.equal(stateOf(fixture, "l-done"), "released");
});

void test("releaseFinished skips a legacy session with no shell under Claude", async () => {
  const fixture = install([{ id: "m-legacy", column: "done" }]);
  floorReleaseTools.sessionEnvHas = () => Promise.resolve(false);

  assert.equal(await releaseFinished(BOARD), 0);

  assert.equal(stateOf(fixture, "m-legacy"), "idle");
  assert.equal(fixture.literals.length + fixture.keys.length, 0);
});

void test("floorExiting holds while the exit runs and ends after it", async () => {
  install([{ id: "n-done", column: "done" }]);
  const seen: boolean[] = [];
  floorReleaseTools.awaitShellPrompt = () => {
    seen.push(floorExiting("n-done-s"));
    return Promise.resolve();
  };

  assert.equal(await releaseFinished(BOARD), 1);

  assert.deepEqual(seen, [true]);
  assert.equal(floorExiting("n-done-s"), false);
});
