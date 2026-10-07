import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import type { SessionMeters } from "../../shared/types.js";

const env = isolateEnv();
const { store, redactCard } = await import("./board.store.js");
await store.load();
after(() => env.cleanup());

const METERS: SessionMeters = {
  contextPercent: 38,
  model: "Opus 5.5",
  cost: 1.25,
  usage: { fiveHourPercent: 12, sevenDayPercent: 40 },
};
const SIBLING_METERS: SessionMeters = {
  contextPercent: 90,
  model: "Haiku 4.5",
  cost: 0.5,
  usage: { fiveHourPercent: null, sevenDayPercent: null },
};

async function cardWithSession(title: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: `/tmp/ws-${title}`,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  return created.id;
}

void test("meters land on the session record that owns the tmux session", async () => {
  const id = await cardWithSession("meters-record");
  assert.equal(
    await store.setSessionMetersIfSession(id, "dsp-meters-record", METERS),
    true,
  );
  const record = store.getCard(id)!.sessions![0];
  assert.equal(record.contextPercent, 38);
  assert.equal(record.model, "Opus 5.5");
  assert.equal(record.cost, 1.25);
  assert.deepEqual(record.usage, METERS.usage);
  assert.ok(record.metersAt);
});

void test("the active session meters show on the wire card and its summary", async () => {
  const id = await cardWithSession("meters-active");
  await store.setSessionMetersIfSession(id, "dsp-meters-active", METERS);
  const wire = redactCard(store.getCard(id)!);
  assert.equal(wire.contextPercent, 38);
  assert.equal(wire.model, "Opus 5.5");
  assert.equal(wire.cost, 1.25);
  assert.deepEqual(wire.usage, METERS.usage);
  const summary = wire.sessionSummaries![0];
  assert.equal(summary.contextPercent, 38);
  assert.equal(summary.model, "Opus 5.5");
  assert.equal(summary.cost, 1.25);
  assert.deepEqual(summary.usage, METERS.usage);
});

void test("a card with no meters carries no meter fields", async () => {
  const id = await cardWithSession("meters-none");
  const wire = redactCard(store.getCard(id)!);
  for (const key of ["contextPercent", "model", "cost", "usage"] as const)
    assert.equal(key in wire, false);
});

void test("a non-active sibling shows only in its own summary", async () => {
  const id = await cardWithSession("meters-sibling");
  const primaryId = store.getCard(id)!.activeSessionId!;
  const reserved = await store.reserveNewSession(
    id,
    store.getCard(id)!.identifier,
  );
  await store.completeStart(id, reserved!.sessionId, {
    workspacePath: "/tmp/ws-meters-sibling-2",
    tmuxSession: "dsp-meters-sibling-2",
    branch: "meters-sibling-2",
  });
  await store.switchActiveSession(id, primaryId);
  assert.equal(store.getCard(id)!.activeSessionId, primaryId);

  await store.setSessionMetersIfSession(
    id,
    "dsp-meters-sibling-2",
    SIBLING_METERS,
  );
  const wire = redactCard(store.getCard(id)!);
  assert.equal("contextPercent" in wire, false);
  assert.equal("model" in wire, false);
  const byId = new Map(wire.sessionSummaries!.map((s) => [s.id, s]));
  assert.equal(byId.get(reserved!.sessionId)!.contextPercent, 90);
  assert.equal(byId.get(reserved!.sessionId)!.model, "Haiku 4.5");
  assert.equal(byId.get(primaryId)!.contextPercent, undefined);
});

void test("an unknown card id is a no-op", async () => {
  const before = JSON.stringify(store.snapshot(DEFAULT_BOARD_KEY));
  assert.equal(
    await store.setSessionMetersIfSession("no-such-card", "dsp-x", METERS),
    false,
  );
  assert.equal(JSON.stringify(store.snapshot(DEFAULT_BOARD_KEY)), before);
});

void test("an unknown tmux session is a no-op", async () => {
  const id = await cardWithSession("meters-unowned");
  const before = JSON.stringify(store.getCard(id));
  assert.equal(
    await store.setSessionMetersIfSession(id, "dsp-someone-else", METERS),
    false,
  );
  assert.equal(JSON.stringify(store.getCard(id)), before);
});

void test("an unknown card or session emits no change event", async () => {
  const id = await cardWithSession("meters-quiet");
  let changes = 0;
  const onChange = () => changes++;
  store.on("change", onChange);
  try {
    await store.setSessionMetersIfSession("no-such-card", "dsp-x", METERS);
    await store.setSessionMetersIfSession(id, "dsp-someone-else", METERS);
    assert.equal(changes, 0);
    await store.setSessionMetersIfSession(id, "dsp-meters-quiet", METERS);
    assert.equal(changes, 1);
  } finally {
    store.off("change", onChange);
  }
});
