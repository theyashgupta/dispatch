import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";

isolateEnv();
const { store } = await import("./board.store.js");
const { openBoardDb } = await import("./board-db.js");
await store.load();

const SYNCED = "2026-09-24T10:00:00.000Z";

function bySource(source: string): Card[] {
  return store
    .snapshot()
    .cards.filter((c) => c.source === source)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function seed(source: string, ids: string[]): Promise<void> {
  await store.applyIssues(
    ids.map((id) => issue(id)),
    SYNCED,
    { source, kind: "snapshot" },
  );
}

test("a complete snapshot pull removes a vanished Inbox card and flags a vanished past card", async () => {
  await seed("snap", ["s1", "s2"]);
  await store.moveCardManual("s2", "todo");
  await store.moveCardManual("s2", "in_review");
  await store.applyIssues([], SYNCED, { source: "snap", kind: "snapshot" });
  const cards = bySource("snap");
  assert.deepEqual(
    cards.map((c) => [c.id, c.goneFromLinear]),
    [["s2", true]],
  );
});

test("a partial snapshot pull deletes nothing and names the source in the warning", async () => {
  await seed("part", ["p1"]);
  await store.applyIssues([], SYNCED, {
    source: "part",
    kind: "snapshot",
    partial: true,
  });
  assert.equal(bySource("part").length, 1);
  assert.equal(bySource("part")[0]?.goneFromLinear, false);
  assert.match(store.snapshot().syncWarning ?? "", /^part pull was truncated/);
});

test("an append pull never removes and never flags, but still upserts and clears gone", async () => {
  await store.applyIssues([issue("a1"), issue("a2")], SYNCED, {
    source: "app",
    kind: "append",
  });
  await store.moveCardManual("a2", "todo");
  await store.moveCardManual("a2", "in_review");
  const a2 = store.getCard("a2");
  if (a2) a2.goneFromLinear = true;
  await store.applyIssues(
    [issue("a2"), issue("a3", { title: "third" })],
    SYNCED,
    {
      source: "app",
      kind: "append",
    },
  );
  const cards = bySource("app");
  assert.deepEqual(
    cards.map((c) => [c.id, c.goneFromLinear ?? false]),
    [
      ["a1", false],
      ["a2", false],
      ["a3", false],
    ],
  );
  assert.equal(cards[2]?.title, "third");
});

test("the sync_in event carries the source id", async () => {
  const events: string[] = [];
  const onActivity = (e: { type: string; source: string | null }) => {
    if (e.type === "sync_in") events.push(e.source ?? "");
  };
  store.on("activity", onActivity);
  await store.applyIssues([issue("e1")], SYNCED, {
    source: "evt",
    kind: "snapshot",
  });
  store.off("activity", onActivity);
  assert.deepEqual(events, ["evt"]);
});

test("identifier counters seed from the legacy fields and persist both shapes", async () => {
  const db = openBoardDb();
  const { cards, meta } = db.readAll();
  db.persist(
    cards,
    {
      syncedAt: meta.syncedAt ?? null,
      workspaceFolders: meta.workspaceFolders ?? [],
      lastUsed: meta.lastUsed ?? null,
      localTicketCounter: 53,
      groupTicketCounter: 2,
      schemaVersion: meta.schemaVersion,
    },
    [],
  );
  await store.load();
  const first = await store.createLocalCard("one", "d");
  const second = await store.createLocalCard("two", "d");
  assert.equal(first.identifier, "LOCAL-54");
  assert.equal(second.identifier, "LOCAL-55");
  const persisted = openBoardDb().readAll().meta;
  assert.equal(persisted.identifierCounters?.LOCAL, 55);
  assert.equal(persisted.localTicketCounter, 55);
  assert.equal(persisted.groupTicketCounter, 2);
});

test("the counter map wins over a smaller legacy field", async () => {
  const db = openBoardDb();
  const { cards, meta } = db.readAll();
  db.persist(
    cards,
    {
      syncedAt: meta.syncedAt ?? null,
      workspaceFolders: meta.workspaceFolders ?? [],
      lastUsed: meta.lastUsed ?? null,
      localTicketCounter: 10,
      groupTicketCounter: 0,
      identifierCounters: { LOCAL: 60, GROUP: 4 },
      schemaVersion: meta.schemaVersion,
    },
    [],
  );
  await store.load();
  const created = await store.createLocalCard("x", "d");
  assert.equal(created.identifier, "LOCAL-61");
});

test("a partial append pull removes nothing and records the truncation warning", async () => {
  await store.applyIssues([issue("pa1"), issue("pa2")], SYNCED, {
    source: "pa",
    kind: "append",
  });
  await store.applyIssues([], SYNCED, {
    source: "pa",
    kind: "append",
    partial: true,
  });
  assert.equal(bySource("pa").length, 2);
  assert.match(store.snapshot().syncWarning ?? "", /^pa pull was truncated/);
});

test("a complete append pull clears a stale truncation warning", async () => {
  await store.applyIssues([], SYNCED, {
    source: "warn",
    kind: "snapshot",
    partial: true,
  });
  assert.match(store.snapshot().syncWarning ?? "", /^warn pull was truncated/);
  await store.applyIssues([issue("w1")], SYNCED, {
    source: "clear",
    kind: "append",
  });
  assert.equal(store.snapshot().syncWarning, null);
});

test("a legacy field larger than the map entry wins on load", async () => {
  const db = openBoardDb();
  const { cards, meta } = db.readAll();
  db.persist(
    cards,
    {
      syncedAt: meta.syncedAt ?? null,
      workspaceFolders: meta.workspaceFolders ?? [],
      lastUsed: meta.lastUsed ?? null,
      localTicketCounter: 70,
      groupTicketCounter: 0,
      identifierCounters: { LOCAL: 60 },
      schemaVersion: meta.schemaVersion,
    },
    [],
  );
  await store.load();
  const created = await store.createLocalCard("y", "d");
  assert.equal(created.identifier, "LOCAL-71");
});

test("an upsert whose id another source owns is skipped", async () => {
  await store.applyIssues([issue("shared-id")], SYNCED, {
    source: "owner",
    kind: "snapshot",
  });
  await store.applyIssues([issue("shared-id", { title: "intruder" })], SYNCED, {
    source: "intruder",
    kind: "snapshot",
  });
  const card = store.getCard("shared-id");
  assert.equal(card?.source, "owner");
  assert.equal(card?.title, "Issue shared-id");
  assert.deepEqual(bySource("intruder"), []);
});

test("a repeat pull with no changes emits no second sync_in and resets unreachable", async () => {
  const events: string[] = [];
  const onActivity = (e: { type: string; cardId: string | null }) => {
    if (e.type === "sync_in" && e.cardId === "dedup1") events.push(e.cardId);
  };
  store.on("activity", onActivity);
  await store.setSyncUnreachable(true);
  await store.applyIssues([issue("dedup1")], SYNCED, {
    source: "dedup",
    kind: "snapshot",
  });
  await store.applyIssues([issue("dedup1")], SYNCED, {
    source: "dedup",
    kind: "snapshot",
  });
  await store.applyIssues([issue("dedup1", { title: "changed" })], SYNCED, {
    source: "dedup",
    kind: "snapshot",
  });
  store.off("activity", onActivity);
  assert.deepEqual(events, ["dedup1", "dedup1"]);
  assert.equal(store.snapshot().syncUnreachable, false);
});

test("invalid counter entries are ignored and an unseen prefix starts at 1", async () => {
  const db = openBoardDb();
  const { cards, meta } = db.readAll();
  db.persist(
    cards.filter((c) => c.source !== "local"),
    {
      syncedAt: meta.syncedAt ?? null,
      workspaceFolders: meta.workspaceFolders ?? [],
      lastUsed: meta.lastUsed ?? null,
      localTicketCounter: 3.5,
      groupTicketCounter: -2,
      identifierCounters: { LOCAL: -1, GROUP: 2.5 },
      schemaVersion: meta.schemaVersion,
    },
    [],
  );
  await store.load();
  const created = await store.createLocalCard("fresh", "d");
  assert.equal(created.identifier, "LOCAL-1");
  const persisted = openBoardDb().readAll().meta;
  assert.equal(persisted.identifierCounters?.GROUP, undefined);
  assert.equal(persisted.groupTicketCounter, 0);
});
