import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type {
  BoardKey,
  OrchestrationEvent,
  OrchestrationEventKind,
} from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { waitForEvent } = await import("./orchestrator-wait.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
await store.load();
after(() => env.cleanup());

function append(
  board: BoardKey,
  kind: OrchestrationEventKind,
  cardId: string | null = null,
  data: Record<string, unknown> = {},
): OrchestrationEvent {
  return store.appendOrchestrationEvent({
    boardKey: board,
    cardId,
    sessionId: null,
    kind,
    data,
    ts: new Date().toISOString(),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const listeners = () => store.listenerCount("orchestration");
const lastId = (board: BoardKey) =>
  store.listOrchestrationEvents(board, 0, 10_000).at(-1)?.id ?? 0;

void test("a match appended after the wait starts resolves within 2 s of the append", async () => {
  const base = listeners();
  const wait = waitForEvent(SBX, { since: 0, kinds: ["pr_state"] }, 10_000);
  assert.equal(listeners(), base + 1);
  await sleep(300);
  const appended = Date.now();
  const event = append(SBX, "pr_state");
  const result = await wait;
  assert.ok(Date.now() - appended < 2000);
  assert.deepEqual(result, { event });
  assert.equal(listeners(), base);
});

void test("a wrong kind, a wrong card or another board does not end the wait", async () => {
  const base = listeners();
  const wait = waitForEvent(
    SBX,
    { since: 0, kinds: ["pr_state"], cardIds: ["c1"] },
    10_000,
  );
  let ended = false;
  void wait.then(() => (ended = true));
  append(SBX, "loop_gate", "c1");
  append(SBX, "pr_state", "c2");
  append(SBX, "pr_state", null);
  append(OTH, "pr_state", "c1");
  await sleep(100);
  assert.equal(ended, false);
  const event = append(SBX, "pr_state", "c1");
  assert.deepEqual(await wait, { event });
  assert.equal(listeners(), base);
});

void test("an intake_submitted event for another orchestrator does not end the wait, one for the caller does", async () => {
  const base = listeners();
  const wait = waitForEvent(
    SBX,
    { since: 0, kinds: ["intake_submitted"], orchestratorId: "feat-a" },
    10_000,
  );
  let ended = false;
  void wait.then(() => (ended = true));
  append(SBX, "intake_submitted", "c9", { orchestratorId: "feat-b" });
  await sleep(100);
  assert.equal(ended, false);
  const event = append(SBX, "intake_submitted", "c9", {
    orchestratorId: "feat-a",
  });
  assert.deepEqual(await wait, { event });
  assert.equal(listeners(), base);
});

void test("tool_call rows end no wait unless kinds names tool_call", async () => {
  const base = listeners();
  const since = append(SBX, "machine_wake").id;
  const open = waitForEvent(SBX, { since }, 10_000);
  const named = waitForEvent(SBX, { since, kinds: ["tool_call"] }, 10_000);
  let ended = false;
  void open.then(() => (ended = true));
  const call = append(SBX, "tool_call");
  assert.deepEqual(await named, { event: call });
  await sleep(100);
  assert.equal(ended, false);
  const other = append(SBX, "supervisor_action");
  assert.deepEqual(await open, { event: other });
  assert.equal(listeners(), base);
});

void test("the time limit answers timedOut with the largest board event id seen", async () => {
  const base = listeners();
  const since = append(SBX, "machine_wake").id;
  const wait = waitForEvent(SBX, { since, kinds: ["pr_state"] }, 300);
  const seen = append(SBX, "loop_gate");
  append(OTH, "loop_gate");
  const started = Date.now();
  assert.deepEqual(await wait, { timedOut: true, cursor: seen.id });
  assert.ok(Date.now() - started >= 250);
  assert.equal(listeners(), base);
});

void test("a timeout with nothing seen answers the since cursor", async () => {
  const since = append(SBX, "machine_wake").id;
  assert.deepEqual(await waitForEvent(SBX, { since }, 100), {
    timedOut: true,
    cursor: since,
  });
});

void test("an event already after since answers at once with no listener added", async () => {
  const since = append(SBX, "machine_wake").id;
  const first = append(SBX, "pr_state");
  append(SBX, "pr_state");
  const base = listeners();
  const started = Date.now();
  const result = await waitForEvent(
    SBX,
    { since, kinds: ["pr_state"] },
    10_000,
  );
  assert.deepEqual(result, { event: first });
  assert.ok(Date.now() - started < 500);
  assert.equal(listeners(), base);
});

void test("a match past the first 200 rows is still found", async () => {
  const since = append(SBX, "machine_wake").id;
  for (let i = 0; i < 205; i += 1) append(SBX, "tool_call");
  const event = append(SBX, "pr_state");
  assert.deepEqual(await waitForEvent(SBX, { since }, 10_000), { event });
});

void test("an abort answers null and leaves no listener or timer", async () => {
  const base = listeners();
  const since = lastId(SBX);
  const gone = new AbortController();
  const wait = waitForEvent(
    SBX,
    { since, kinds: ["decision_answered"] },
    60_000,
    gone.signal,
  );
  assert.equal(listeners(), base + 1);
  gone.abort();
  assert.equal(await wait, null);
  assert.equal(listeners(), base);
  const pre = AbortSignal.abort();
  assert.equal(
    await waitForEvent(
      SBX,
      { since, kinds: ["decision_answered"] },
      60_000,
      pre,
    ),
    null,
  );
  assert.equal(listeners(), base);
});

void test("a wait on group_state returns that event, and a wait on other kinds does not end on it", async () => {
  const base = listeners();
  const since = lastId(SBX);
  const other = waitForEvent(
    SBX,
    { since, kinds: ["pr_state"], cardIds: ["g-wait"] },
    300,
  );
  const wait = waitForEvent(
    SBX,
    { since, kinds: ["group_state"], cardIds: ["g-wait"] },
    10_000,
  );
  const event = append(SBX, "group_state", "g-wait");
  assert.deepEqual(await wait, { event });
  const timedOut = await other;
  assert.ok(timedOut !== null && "timedOut" in timedOut);
  assert.equal(listeners(), base);
});

const WAK = parseBoardKey("WAK") as BoardKey;

void test("wait_for_event returns on a machine_wake event even when the caller did not list that kind", async () => {
  const base = listeners();
  const since = lastId(WAK);
  const wait = waitForEvent(
    WAK,
    { since, kinds: ["pr_state"], cardIds: ["c1"] },
    10_000,
  );
  assert.equal(listeners(), base + 1);
  const event = append(WAK, "machine_wake", null, { sleptSeconds: 600 });
  assert.deepEqual(await wait, { event });
  assert.equal(listeners(), base);
});

void test("a machine_wake row already after since answers at once", async () => {
  const since = lastId(WAK);
  const event = append(WAK, "machine_wake", null, { sleptSeconds: 600 });
  const base = listeners();
  const result = await waitForEvent(
    WAK,
    { since, kinds: ["pr_state"], cardIds: ["c1"] },
    10_000,
  );
  assert.deepEqual(result, { event });
  assert.equal(listeners(), base);
});

void test("a machine_wake row at or before since does not end the wait", async () => {
  const base = listeners();
  const since = append(WAK, "machine_wake").id;
  assert.deepEqual(await waitForEvent(WAK, { since }, 300), {
    timedOut: true,
    cursor: since,
  });
  assert.equal(listeners(), base);
});

void test("a wait started before a sleep ends within one poll interval after the wake", async () => {
  const base = listeners();
  let offset = 0;
  const clock = { now: () => Date.now() + offset, pollMs: 50 };
  const since = lastId(WAK);
  const wait = waitForEvent(WAK, { since }, 55_000, undefined, clock);
  await sleep(120);
  offset = 10 * 60_000;
  const jumped = Date.now();
  const result = await wait;
  assert.ok(result !== null && "timedOut" in result);
  assert.equal(result.timedOut, true);
  assert.equal("machineWake" in result && result.machineWake, true);
  assert.ok(Date.now() - jumped < 250);
  assert.equal(listeners(), base);
});

void test("a wait with no clock jump does not end before its timeout", async () => {
  const base = listeners();
  const since = lastId(WAK);
  const started = Date.now();
  const result = await waitForEvent(WAK, { since }, 300, undefined, {
    now: Date.now,
    pollMs: 20,
  });
  assert.deepEqual(result, { timedOut: true, cursor: since });
  assert.ok(Date.now() - started >= 280);
  assert.equal(listeners(), base);
});
