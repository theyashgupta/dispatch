import assert from "node:assert/strict";
import { test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem as item } from "../test-support/fake-source.js";

isolateEnv();
const { store } = await import("./board.store.js");
const { openBoardDb } = await import("./board-db.js");
await store.load();

test("items upsert through the queue, survive a reload and keep their state", async () => {
  const counts = await store.upsertItems("fake", [item("a"), item("b")], {
    kind: "snapshot",
  });
  assert.deepEqual(counts, { inserted: 2, updated: 0, resolved: 0 });
  await store.load();
  assert.deepEqual(
    store
      .listItems()
      .map((i) => i.id)
      .sort(),
    ["fake:a", "fake:b"],
  );
  const second = await store.upsertItems(
    "fake",
    [item("a", { title: "renamed" })],
    {
      kind: "snapshot",
    },
  );
  assert.deepEqual(second, { inserted: 0, updated: 1, resolved: 1 });
  assert.equal(store.getItem("fake:a")?.title, "renamed");
  assert.equal(store.getItem("fake:b")?.state, "done");
  const third = await store.upsertItems("fake", [item("a"), item("b")], {
    kind: "snapshot",
  });
  assert.equal(
    third.updated,
    1,
    "only the row whose title changed back is rewritten",
  );
  assert.equal(store.getItem("fake:b")?.state, "done", "a done row stays done");
  const fourth = await store.upsertItems("fake", [item("a"), item("b")], {
    kind: "snapshot",
  });
  assert.deepEqual(fourth, { inserted: 0, updated: 0, resolved: 0 });
});

test("a foreign-source item rejects before the queue and writes nothing", async () => {
  const before = store.listItems().length;
  await assert.rejects(
    store.upsertItems("fake", [item("z", { source: "other" }), item("ok")], {
      kind: "snapshot",
    }),
    /belongs to source other/,
  );
  assert.equal(store.listItems().length, before);
});

test("every item mutation emits exactly one change event", async () => {
  let changes = 0;
  const onChange = () => {
    changes += 1;
  };
  await store.upsertItems("fake", [item("c")], { kind: "append" });
  store.on("change", onChange);
  await store.upsertItems("fake", [item("d")], { kind: "append" });
  await store.setItemState("fake:c", "read");
  await store.snoozeItem(
    "fake:c",
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  await store.promoteItem("fake:d");
  store.off("change", onChange);
  assert.equal(changes, 4);
  assert.equal(
    store.getItem("fake:a")?.state,
    "unread",
    "an append pull resolved nothing",
  );
});

test("promote creates a local Inbox card once, marks the item done with its cardId, and survives a reload", async () => {
  await store.upsertItems(
    "fake",
    [item("p", { url: "https://x/1", meta: { repo: "r" } })],
    {
      kind: "append",
    },
  );
  const events: {
    type: string;
    cardId: string | null;
    source: string | null;
    toCol: string | null;
  }[] = [];
  const onActivity = (e: (typeof events)[number]) => {
    if (e.type === "item_promoted") events.push(e);
  };
  store.on("activity", onActivity);
  const first = await store.promoteItem("fake:p");
  const second = await store.promoteItem("fake:p");
  store.off("activity", onActivity);
  assert.ok(first && first.created);
  assert.equal(first.card.column, "inbox");
  assert.equal(first.card.source, "local");
  assert.match(first.card.identifier, /^LOCAL-\d+$/);
  assert.equal(first.card.issueId, "fake:p");
  assert.ok(second && !second.created);
  assert.equal(second.card.id, first.card.id);
  await store.load();
  const promoted = store.getItem("fake:p");
  assert.equal(promoted?.state, "done");
  assert.equal(promoted?.cardId, first.card.id);
  assert.equal(
    store.snapshot().cards.filter((c) => c.issueId === "fake:p").length,
    1,
  );
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0]?.cardId, events[0]?.source, events[0]?.toCol],
    [first.card.id, "fake", "inbox"],
  );
  assert.equal(await store.promoteItem("fake:missing"), undefined);
});

test("a promoted item cannot be reopened, only kept done", async () => {
  await store.upsertItems("fake", [item("keep")], { kind: "append" });
  await store.promoteItem("fake:keep");
  assert.equal(await store.setItemState("fake:keep", "unread"), "promoted");
  assert.equal(await store.setItemState("fake:keep", "read"), "promoted");
  assert.equal(
    await store.snoozeItem(
      "fake:keep",
      new Date(Date.now() + 3_600_000).toISOString(),
    ),
    "promoted",
  );
  assert.equal(store.getItem("fake:keep")?.state, "done");
  assert.equal(store.getItem("fake:keep")?.snoozedUntil, undefined);
  assert.equal(await store.setItemState("fake:keep", "done"), "ok");
});

test("promote advances the LOCAL counter exactly once across two calls", async () => {
  await store.upsertItems("fake", [item("q")], { kind: "append" });
  const before = await store.createLocalCard("marker", "d");
  const n = Number(before.identifier.split("-")[1]);
  const first = await store.promoteItem("fake:q");
  await store.promoteItem("fake:q");
  const after = await store.createLocalCard("marker2", "d");
  assert.equal(first?.card.identifier, `LOCAL-${n + 1}`);
  assert.equal(after.identifier, `LOCAL-${n + 2}`);
});

test("snooze sets the state and time, done clears it, unknown ids report as such", async () => {
  await store.upsertItems("fake", [item("s")], { kind: "append" });
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  assert.equal(await store.snoozeItem("fake:s", future), "ok");
  assert.equal(store.getItem("fake:s")?.state, "snoozed");
  assert.equal(store.getItem("fake:s")?.snoozedUntil, future);
  assert.equal(await store.snoozeItem("fake:missing", future), "unknown");
  assert.equal(await store.setItemState("fake:s", "done"), "ok");
  assert.equal(store.getItem("fake:s")?.state, "done");
  assert.equal(store.getItem("fake:s")?.snoozedUntil, undefined);
  assert.equal(await store.setItemState("fake:missing", "read"), "unknown");
});

test("an expired snooze is persisted as unread by the next state write on the row", async () => {
  await store.upsertItems("fake", [item("w")], { kind: "append" });
  const soon = new Date(Date.now() + 30).toISOString();
  assert.equal(await store.snoozeItem("fake:w", soon), "ok");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(await store.setItemState("fake:w", "read"), "ok");
  const row = store.getItem("fake:w");
  assert.equal(row?.state, "read");
  assert.equal(row?.snoozedUntil, undefined);
});

test("snapshot items exclude done rows, present expired snoozes as unread and carry only Item fields", async () => {
  await store.upsertItems(
    "wire",
    [
      item("d", { source: "wire", state: "done" }),
      item("s", { source: "wire" }),
      item("u", { source: "wire", priority: 99 }),
    ],
    { kind: "append" },
  );
  assert.equal(
    await store.snoozeItem("wire:s", new Date(Date.now() + 30).toISOString()),
    "ok",
  );
  await new Promise((r) => setTimeout(r, 40));
  const items = (store.snapshot().items ?? []).filter(
    (i) => i.source === "wire",
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ["wire:u", "wire:s"],
  );
  assert.equal(items[1]?.state, "unread");
  assert.equal(items[1]?.snoozedUntil, undefined);
  const allowed = new Set([
    "id",
    "source",
    "type",
    "title",
    "snippet",
    "url",
    "createdAt",
    "priority",
    "state",
    "snoozedUntil",
    "meta",
    "cardId",
  ]);
  for (const row of items) {
    for (const key of Object.keys(row))
      assert.ok(allowed.has(key), `unexpected key ${key}`);
  }
  assert.equal(
    store.getItem("wire:s")?.state,
    "snoozed",
    "the read path did not mutate the row",
  );
});

test("item rows staged during a failed persist are written by the next persist", async () => {
  await store.upsertItems("retry", [item("r1", { source: "retry" })], {
    kind: "append",
  });
  const inner = store as unknown as {
    db: { persist: (...args: unknown[]) => number[] };
  };
  const realPersist = inner.db.persist;
  let failed = false;
  inner.db.persist = (...args: unknown[]) => {
    if (!failed) {
      failed = true;
      throw new Error("disk full");
    }
    return realPersist.apply(inner.db, args);
  };
  try {
    assert.equal(await store.setItemState("retry:r1", "read"), "ok");
    assert.equal(
      openBoardDb()
        .readAllItems()
        .find((i) => i.id === "retry:r1")?.state,
      "unread",
    );
    await store.upsertItems("retry", [item("r2", { source: "retry" })], {
      kind: "append",
    });
  } finally {
    inner.db.persist = realPersist;
  }
  const persisted = openBoardDb().readAllItems();
  assert.equal(persisted.find((i) => i.id === "retry:r1")?.state, "read");
  assert.equal(
    persisted.some((i) => i.id === "retry:r2"),
    true,
  );
});

test("a mis-prefixed id with a matching source rejects before the queue", async () => {
  const before = store.listItems().length;
  await assert.rejects(
    store.upsertItems("fake", [item("bad", { id: "other:bad" })], {
      kind: "snapshot",
    }),
    /belongs to source/,
  );
  assert.equal(store.listItems().length, before);
});

test("duplicate ids in one batch collapse to the last copy and a new row never carries a cardId", async () => {
  const counts = await store.upsertItems(
    "fake",
    [
      item("dup", { title: "first" }),
      item("dup", { title: "second", cardId: "LOCAL-99" }),
    ],
    { kind: "append" },
  );
  assert.deepEqual(counts, { inserted: 1, updated: 0, resolved: 0 });
  assert.equal(store.getItem("fake:dup")?.title, "second");
  assert.equal(store.getItem("fake:dup")?.cardId, undefined);
  const again = await store.upsertItems(
    "fake",
    [item("dup", { title: "third", cardId: "LOCAL-98" })],
    {
      kind: "append",
    },
  );
  assert.equal(again.updated, 1);
  assert.equal(
    store.getItem("fake:dup")?.cardId,
    undefined,
    "an incoming cardId is ignored on update",
  );
});

test("a re-promote after the card was removed mints a new card", async () => {
  await store.upsertItems("fake", [item("gone")], { kind: "append" });
  const first = await store.promoteItem("fake:gone");
  assert.ok(first?.created);
  (store as unknown as { cards: Map<string, unknown> }).cards.delete(
    first.card.id,
  );
  const second = await store.promoteItem("fake:gone");
  assert.ok(second?.created);
  assert.notEqual(second.card.id, first.card.id);
  assert.equal(store.getItem("fake:gone")?.cardId, second.card.id);
});

test("a redacted snoozed row carries its snooze time on the wire", async () => {
  await store.upsertItems("wire2", [item("z", { source: "wire2" })], {
    kind: "append",
  });
  const until = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(await store.snoozeItem("wire2:z", until), "ok");
  const row = (store.snapshot().items ?? []).find((i) => i.id === "wire2:z");
  assert.equal(row?.state, "snoozed");
  assert.equal(row?.snoozedUntil, until);
});

test("persisted item rows carry only Item fields and never a card secret", () => {
  const allowed = new Set([
    "id",
    "source",
    "type",
    "title",
    "snippet",
    "url",
    "createdAt",
    "priority",
    "state",
    "snoozedUntil",
    "meta",
    "cardId",
  ]);
  const rows = openBoardDb().readAllItems();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    for (const key of Object.keys(row))
      assert.ok(allowed.has(key), `unexpected key ${key}`);
  }
  assert.equal(JSON.stringify(rows).includes("hookToken"), false);
});

test("the snapshot reports the enabled sources, empty until set", () => {
  assert.deepEqual(store.snapshot().enabledSources, []);
  store.setEnabledSources(["fake", "linear"]);
  assert.deepEqual(store.snapshot().enabledSources, ["fake", "linear"]);
  store.setEnabledSources([]);
});
