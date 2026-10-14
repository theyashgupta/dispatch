import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type {
  Card,
  MemorySample,
  PausedBy,
  Session,
  SystemMemory,
} from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import { ConflictError } from "../domain/errors.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { memorySample } = await import("../../test-support/memory-fixtures.js");
const {
  assertMemoryHeadroom,
  governorTools,
  memoryCheck,
  memoryEmitter,
  memoryPauseStep,
  recordSample,
  startMemoryGovernor,
  systemMemory,
} = await import("./memory-governor.js");

const realTools = { ...governorTools };
let cards: Map<string, Card>;
let paused: [string, { by: PausedBy; reason: string }][];
let resumed: [string, { reason: string }][];

beforeEach(async () => {
  cards = new Map();
  paused = [];
  resumed = [];
  setBoardRepository(
    fakeBoardRepository({
      getBoard: () => undefined,
      isStarting: () => false,
      listCards: () => [...cards.values()],
    }),
  );
  await memoryPauseStep({
    supported: true,
    stale: false,
    sample: memorySample(),
  });
  await memoryPauseStep({ supported: false });
});

afterEach(() => {
  Object.assign(governorTools, realTools);
  setBoardRepository(store);
});

const AT = "2026-10-13T10:00:00.000Z";
const sample: MemorySample = {
  at: AT,
  freeMb: 1676,
  compressorMb: 2338,
  swapUsedMb: 2969,
  swapTotalMb: 4096,
  load1: 4.9,
};

test("with no sample yet the reading is unsupported", () => {
  assert.deepEqual(systemMemory(), { supported: false });
});

test("a reader that gives no reading leaves the state unsupported", async () => {
  let calls = 0;
  const stop = startMemoryGovernor(() => {
    calls += 1;
    return Promise.resolve(null);
  });
  stop();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.deepEqual(systemMemory(), { supported: false });
});

test("a recorded sample is served and broadcast", () => {
  const seen: SystemMemory[] = [];
  const listen = (m: SystemMemory) => seen.push(m);
  memoryEmitter.on("change", listen);
  recordSample(sample);
  memoryEmitter.off("change", listen);
  const now = Date.parse(AT) + 1_000;
  assert.deepEqual(systemMemory(now), {
    supported: true,
    sample,
    stale: false,
  });
  assert.equal(seen.length, 1);
});

test("a sample turns stale only after 60 seconds", () => {
  recordSample(sample);
  const at60 = systemMemory(Date.parse(AT) + 60_000);
  const past60 = systemMemory(Date.parse(AT) + 60_001);
  assert.ok(at60.supported && past60.supported);
  assert.equal(at60.stale, false);
  assert.equal(past60.stale, true);
});

test("a failed read after a sample re-broadcasts the kept sample so clients see it go stale", async () => {
  recordSample({ ...sample, at: new Date(Date.now() - 61_000).toISOString() });
  const seen: SystemMemory[] = [];
  const listen = (m: SystemMemory) => seen.push(m);
  memoryEmitter.on("change", listen);
  const stop = startMemoryGovernor(() => Promise.resolve(null));
  stop();
  await new Promise((r) => setImmediate(r));
  memoryEmitter.off("change", listen);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].supported);
  assert.equal(seen[0].stale, true);
});

test("a reader that gives a sample records and broadcasts it", async () => {
  const read: MemorySample = { ...sample, freeMb: 900, swapUsedMb: 1500 };
  const seen: SystemMemory[] = [];
  const listen = (m: SystemMemory) => seen.push(m);
  memoryEmitter.on("change", listen);
  const stop = startMemoryGovernor(() => Promise.resolve(read));
  stop();
  await new Promise((r) => setImmediate(r));
  memoryEmitter.off("change", listen);
  assert.deepEqual(systemMemory(Date.parse(AT) + 1_000), {
    supported: true,
    sample: read,
    stale: false,
  });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].supported);
  assert.deepEqual(seen[0].sample, read);
});

test("a reader that rejects keeps the last sample and does not throw", async (t) => {
  t.mock.method(console, "warn", () => {});
  recordSample(sample);
  const stop = startMemoryGovernor(() => Promise.reject(new Error("boom")));
  stop();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(systemMemory(Date.parse(AT) + 1_000), {
    supported: true,
    sample,
    stale: false,
  });
});

test("the gate admits a stale reading even past both thresholds", () => {
  const over = { freeMb: 10, swapUsedMb: 60_000 };
  recordSample({
    ...sample,
    ...over,
    at: new Date(Date.now() - 61_000).toISOString(),
  });
  assert.deepEqual(memoryCheck(DEFAULT_BOARD_KEY), { ok: true });
  assert.doesNotThrow(() => assertMemoryHeadroom(DEFAULT_BOARD_KEY));
  recordSample({ ...sample, ...over, at: new Date().toISOString() });
  assert.throws(
    () => assertMemoryHeadroom(DEFAULT_BOARD_KEY),
    (e: Error & { status?: number; code?: string; details?: unknown }) =>
      e.status === 409 &&
      e.code === "memory-pressure" &&
      JSON.stringify(e.details) ===
        '{"reason":"free memory 10 MB is below the 1024 MB floor"}',
  );
});

function loopCard(id: string, createdAt: string, over: Partial<Card> = {}) {
  const session: Session = {
    id: `${id}-session`,
    createdAt,
    updatedAt: createdAt,
    tmuxSession: `dsp-${id}`,
  };
  const card: Card = {
    id,
    boardKey: DEFAULT_BOARD_KEY,
    issueId: id,
    identifier: id,
    title: id,
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: createdAt,
    source: "group",
    tmuxSession: session.tmuxSession,
    sessions: [session],
    activeSessionId: session.id,
    ...over,
  };
  cards.set(id, card);
  return card;
}

function recordTools(pause?: () => Promise<Card>): void {
  governorTools.pauseCard = (id, opts) => {
    paused.push([id, opts]);
    return pause ? pause() : Promise.resolve(cards.get(id) as Card);
  };
  governorTools.unpauseCard = (id, opts) => {
    resumed.push([id, opts]);
    return Promise.resolve(cards.get(id) as Card);
  };
}

function step(swapUsedMb: number): Promise<void> {
  return memoryPauseStep({
    supported: true,
    stale: false,
    sample: memorySample({ swapUsedMb }),
  });
}

const MEMORY_MARK = {
  at: AT,
  by: "memory" as const,
  sessionId: "old-session",
  pids: [1],
};

test("swap above the ceiling pauses the newest loop card with the exact reason", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  loopCard("old", "2026-10-13T08:00:00.000Z");
  loopCard("new", "2026-10-13T09:00:00.000Z");
  await step(9000);
  assert.deepEqual(paused, [
    [
      "new",
      {
        by: "memory",
        reason: "swap used 9000 MB is above the 8192 MB ceiling",
        swapMb: 9000,
      },
    ],
  ]);
});

test("a refused pause does not advance the run, so the next step tries the same card and logs once", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  recordTools(() => Promise.reject(new ConflictError("busy")));
  loopCard("old", "2026-10-13T08:00:00.000Z");
  loopCard("new", "2026-10-13T09:00:00.000Z");
  await step(9000);
  await step(9000);
  assert.deepEqual(
    paused.map(([id]) => id),
    ["new", "new"],
  );
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    String(warn.mock.calls[0].arguments[0]),
    /pause new refused: busy/,
  );
});

test("two readings below ceiling minus 1024 resume a memory-paused card and one does not", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  loopCard("old", "2026-10-13T08:00:00.000Z", { paused: MEMORY_MARK });
  await step(7000);
  assert.deepEqual(resumed, []);
  await step(7000);
  assert.deepEqual(resumed, [
    ["old", { reason: "swap used 7000 MB is below 7168 MB" }],
  ]);
});

test("a user-paused card is never resumed", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  loopCard("old", "2026-10-13T08:00:00.000Z", {
    paused: { ...MEMORY_MARK, by: "user" },
  });
  loopCard("new", "2026-10-13T09:00:00.000Z", {
    paused: { ...MEMORY_MARK, sessionId: "new-session" },
  });
  await step(1000);
  await step(1000);
  await step(1000);
  assert.deepEqual(
    resumed.map(([id]) => id),
    ["new"],
  );
  assert.deepEqual(paused, []);
});

test("a memory-paused card in Agent done is resumed after two low readings", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  loopCard("held", "2026-10-13T08:00:00.000Z", {
    column: "agent_done",
    paused: MEMORY_MARK,
  });
  await step(7000);
  await step(7000);
  assert.deepEqual(
    resumed.map(([id]) => id),
    ["held"],
  );
});

test("a failed read keeps the pause run, so a small rise does not pause again", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  loopCard("old", "2026-10-13T08:00:00.000Z");
  loopCard("new", "2026-10-13T09:00:00.000Z");
  recordSample(memorySample({ swapUsedMb: 9000 }));
  await step(9000);
  const stop = startMemoryGovernor(() => Promise.resolve(null));
  stop();
  await new Promise((r) => setImmediate(r));
  await step(9100);
  assert.deepEqual(
    paused.map(([id]) => id),
    ["new"],
  );
});

test("a failed read once the kept sample is stale ends the pause run", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  loopCard("old", "2026-10-13T08:00:00.000Z");
  loopCard("new", "2026-10-13T09:00:00.000Z");
  await step(9000);
  recordSample(
    memorySample({
      swapUsedMb: 9000,
      at: new Date(Date.now() - 61_000).toISOString(),
    }),
  );
  const stop = startMemoryGovernor(() => Promise.resolve(null));
  stop();
  await new Promise((r) => setImmediate(r));
  await step(9100);
  assert.deepEqual(
    paused.map(([id]) => id),
    ["new", "new"],
  );
});

test("a pause refused as not-pausable moves on to the next card for 5 minutes", async (t) => {
  t.mock.method(console, "info", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  recordTools(() =>
    Promise.reject(
      new ConflictError("not-pausable", { reason: "no shell session" }),
    ),
  );
  loopCard("cool-old", "2026-10-13T08:00:00.000Z");
  loopCard("cool-new", "2026-10-13T09:00:00.000Z");
  await step(9000);
  await step(9000);
  assert.deepEqual(
    paused.map(([id]) => id),
    ["cool-new", "cool-old"],
  );
  assert.equal(warn.mock.callCount(), 2);
});

test("an unpause refused as unpause-incomplete lets the next memory-paused card resume", async (t) => {
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "warn", () => {});
  recordTools();
  governorTools.unpauseCard = (id, opts) => {
    resumed.push([id, opts]);
    return id === "stuck-old"
      ? Promise.reject(new ConflictError("unpause-incomplete"))
      : Promise.resolve(cards.get(id) as Card);
  };
  loopCard("stuck-old", "2026-10-13T08:00:00.000Z", { paused: MEMORY_MARK });
  loopCard("stuck-new", "2026-10-13T09:00:00.000Z", {
    paused: { ...MEMORY_MARK, sessionId: "stuck-new-session" },
  });
  await step(7000);
  await step(7000);
  await step(7000);
  assert.deepEqual(
    resumed.map(([id]) => id),
    ["stuck-old", "stuck-new"],
  );
});

test("a card in Agent done and a card that is not a loop are not candidates", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  loopCard("old", "2026-10-13T08:00:00.000Z");
  loopCard("done", "2026-10-13T09:00:00.000Z", { column: "agent_done" });
  loopCard("plain", "2026-10-13T10:00:00.000Z", { source: "local" });
  await step(9000);
  assert.deepEqual(
    paused.map(([id]) => id),
    ["old"],
  );
});

test("with only non-candidate cards nothing is paused", async () => {
  recordTools();
  loopCard("done", "2026-10-13T09:00:00.000Z", { column: "agent_done" });
  loopCard("plain", "2026-10-13T10:00:00.000Z", { source: "local" });
  await step(9000);
  assert.deepEqual(paused, []);
});

async function restartWith(swapUsedMb: number): Promise<void> {
  const stop = startMemoryGovernor(() =>
    Promise.resolve(memorySample({ swapUsedMb })),
  );
  stop();
  await new Promise((r) => setImmediate(r));
}

function restartBoard(): void {
  loopCard("held", "2026-10-13T07:00:00.000Z", {
    paused: { ...MEMORY_MARK, sessionId: "held-session", swapMb: 9000 },
  });
  loopCard("mine", "2026-10-13T08:00:00.000Z", {
    paused: { ...MEMORY_MARK, by: "user", sessionId: "mine-session" },
  });
  loopCard("free", "2026-10-13T09:00:00.000Z");
}

test("after a restart with swap under the ceiling the first reading resumes the governor-paused loop only", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  restartBoard();
  await restartWith(8000);
  assert.deepEqual(resumed, [
    [
      "held",
      {
        reason:
          "swap used 8000 MB is not above the 8192 MB ceiling after a restart",
      },
    ],
  ]);
  assert.deepEqual(paused, []);
});

test("after a restart with swap over the ceiling nothing new is paused until swap grows 256 MB past the persisted reading", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  restartBoard();
  await restartWith(9100);
  await step(9255);
  assert.equal(paused.length, 0);
  assert.deepEqual(resumed, []);
  await step(9256);
  assert.deepEqual(
    paused.map(([id]) => id),
    ["free"],
  );
});

test("the restart rebuild runs once, so later readings under the ceiling use the resume floor", async (t) => {
  t.mock.method(console, "info", () => {});
  recordTools();
  restartBoard();
  await restartWith(9100);
  await step(8000);
  await step(8000);
  assert.deepEqual(resumed, []);
});
