import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { unwindGroup } = await import("./unwind.js");

void test("unwindGroup resolves the group from a member id and archives it", async () => {
  const { g, a, b } = await startedGroup(store);
  const outcome = await unwindGroup(a.id, "todo");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.row.id, g.id);
  assert.equal(store.getCard(g.id), undefined);
  assert.equal(store.getCard(a.id)?.column, "todo");
  assert.equal(store.getCard(b.id)?.groupId, undefined);
  assert.ok(store.getArchived(g.id)?.card.sessionLost);
});

void test("unwindGroup refuses an unknown card, a plain ticket, and a group with a saga in flight", async () => {
  const { g, a } = await startedGroup(store);
  assert.deepEqual(await unwindGroup("LOCAL-none", "todo"), {
    ok: false,
    status: 404,
    error: "unknown card id: LOCAL-none",
  });
  const plain = await store.createLocalCard("plain", "");
  assert.deepEqual(await unwindGroup(plain.id, "todo"), {
    ok: false,
    status: 409,
    error: "only a group can be unwound",
  });
  store.beginStart(g.id);
  try {
    const busy = await unwindGroup(g.id, "inbox");
    assert.equal(busy.ok, false);
    if (!busy.ok) assert.equal(busy.status, 409);
    assert.ok(store.getCard(g.id), "group untouched");
    assert.equal(store.getCard(a.id)?.groupId, g.id);
  } finally {
    store.endStart(g.id);
  }
  store.beginCleanup(g.id);
  try {
    const busy = await unwindGroup(g.id, "inbox");
    assert.equal(busy.ok, false);
  } finally {
    store.endCleanup(g.id);
  }
});
