import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";
import type { ArchivedGroup, Card } from "../../shared/types.js";

isolateEnv();
const { store, restoreBlocker, redactArchivedGroup } =
  await import("./board.store.js");
const { openBoardDb } = await import("./board-db.js");

const eventTypes = (cardId: string) =>
  store.listEvents(cardId, 50).map((e) => e.type);

void test("unwindGroup archives the snapshot with every session lost and sends members to todo", async () => {
  const { g, a, b } = await startedGroup(store);
  const sessionId = g.activeSessionId!;
  const res = await store.unwindGroup(g.id, "todo");
  assert.equal(res.ok, true);

  assert.equal(store.getCard(g.id), undefined, "group card left the map");
  for (const m of [a, b]) {
    const live = store.getCard(m.id)!;
    assert.equal(live.column, "todo");
    assert.equal(live.groupId, undefined);
  }
  const persisted = openBoardDb()
    .readAll()
    .cards.map((c) => c.id);
  assert.ok(!persisted.includes(g.id), "group row gone from cards table");

  const row = store.getArchived(g.id)!;
  assert.equal(row.identifier, g.identifier);
  assert.equal(row.destination, "todo");
  assert.deepEqual(
    row.members.map((m) => m.id),
    [a.id, b.id],
  );
  assert.equal(row.card.column, "in_progress");
  assert.equal(row.card.sessionLost, true);
  assert.equal(row.card.activeSessionId, sessionId);
  assert.ok(row.card.sessions!.every((s) => s.tmuxSession === undefined));
  assert.ok(row.card.sessions!.every((s) => s.hookToken === undefined));
  assert.equal(
    row.card.tmuxSession,
    undefined,
    "flat mirror follows the record",
  );
  assert.equal(row.card.workspacePath, `/tmp/ws-${g.id}`, "workspace kept");
  assert.deepEqual(eventTypes(g.id).slice(0, 1), ["group_unwound"]);
});

void test("unwindGroup can send members to inbox and refuses a plain ticket", async () => {
  const { g, a } = await startedGroup(store);
  const res = await store.unwindGroup(g.id, "inbox");
  assert.equal(res.ok, true);
  assert.equal(store.getCard(a.id)?.column, "inbox");
  const plain = await store.unwindGroup(a.id, "todo");
  assert.deepEqual(plain, { ok: false, reason: "only a group can be unwound" });
  assert.equal(store.getCard(a.id)?.column, "inbox", "nothing changed");
});

void test("restoreGroup puts the card, its column, its sessions and its members back exactly", async () => {
  const { g, a, b } = await startedGroup(store);
  const before = structuredClone(store.getCard(g.id)!);
  await store.unwindGroup(g.id, "todo");
  const res = await store.restoreGroup(g.id);
  assert.equal(res.ok, true);

  const card = store.getCard(g.id)!;
  assert.equal(card.identifier, before.identifier);
  assert.equal(card.column, "in_progress");
  assert.equal(card.sessionLost, true, "shows Resume");
  assert.equal(card.activeSessionId, before.activeSessionId);
  assert.equal(card.sessions?.length, 1);
  assert.equal(
    card.sessions?.[0]?.workspacePath,
    before.sessions?.[0]?.workspacePath,
  );
  assert.equal(card.workspacePath, before.workspacePath);
  assert.deepEqual(card.memberIds, before.memberIds);
  for (const m of [a, b]) {
    const live = store.getCard(m.id)!;
    assert.equal(live.groupId, g.id);
    assert.equal(live.column, "in_progress");
  }
  assert.equal(store.getArchived(g.id), undefined, "row dropped");
  assert.deepEqual(eventTypes(g.id).slice(0, 2), [
    "group_restored",
    "group_unwound",
  ]);
  const persisted = openBoardDb()
    .readAll()
    .cards.find((c) => c.id === g.id);
  assert.ok(persisted, "group row back in the cards table");
});

void test("restoreGroup refuses when a member moved, joined another group, or started, and changes nothing", async () => {
  const { g, a, b } = await startedGroup(store);
  await store.unwindGroup(g.id, "inbox");

  await store.moveCardManual(a.id, "todo");
  let res = await store.restoreGroup(g.id);
  assert.deepEqual(res, {
    ok: false,
    status: 409,
    reason: `${a.identifier} moved to todo`,
  });
  assert.equal(store.getCard(g.id), undefined);
  assert.equal(store.getCard(a.id)?.groupId, undefined);
  assert.ok(store.getArchived(g.id), "row kept");

  await store.moveCardManual(b.id, "todo");
  const other = await store.createGroupCard("other", [a.id, b.id]);
  assert.equal(other.ok, true);
  res = await store.restoreGroup(g.id);
  assert.deepEqual(res, {
    ok: false,
    status: 409,
    reason: `${a.identifier} is in another group`,
  });

  const { g: g2, a: a2 } = await startedGroup(store);
  await store.unwindGroup(g2.id, "todo");
  await store.completeStart(a2.id, undefined, {
    workspacePath: `/tmp/ws-${a2.id}`,
    tmuxSession: `dsp-${a2.id}`,
    branch: a2.id,
  });
  await store.moveCardManual(a2.id, "todo");
  res = await store.restoreGroup(g2.id);
  assert.deepEqual(res, {
    ok: false,
    status: 409,
    reason: `${a2.identifier} has session history`,
  });

  res = await store.restoreGroup("GROUP-does-not-exist");
  assert.deepEqual(res, {
    ok: false,
    status: 404,
    reason: "unknown archive id",
  });
});

void test("restoreBlocker is null only when every member is exactly where unwind left it", () => {
  const member = (over: Partial<Card>): Card => ({
    id: "LOCAL-9",
    issueId: "LOCAL-9",
    identifier: "LOCAL-9",
    title: "m",
    description: null,
    priority: 0,
    column: "todo",
    updatedAt: "2026-09-10T00:00:00.000Z",
    source: "local",
    ...over,
  });
  const row: ArchivedGroup = {
    id: "GROUP-9",
    identifier: "GROUP-9",
    title: "g",
    archivedAt: "2026-09-10T00:00:00.000Z",
    destination: "todo",
    card: member({ id: "GROUP-9", identifier: "GROUP-9", source: "group" }),
    members: [{ id: "LOCAL-9", identifier: "LOCAL-9" }],
  };
  const live = (m: Card | null) => new Map<string, Card>(m ? [[m.id, m]] : []);
  assert.equal(restoreBlocker(row, live(member({}))), null);
  assert.equal(restoreBlocker(row, live(null)), "LOCAL-9 no longer exists");
  assert.equal(
    restoreBlocker(row, live(member({ groupId: "GROUP-10" }))),
    "LOCAL-9 is in another group",
  );
  assert.equal(
    restoreBlocker(row, live(member({ column: "inbox" }))),
    "LOCAL-9 moved to inbox",
  );
  assert.equal(
    restoreBlocker(row, live(member({ branch: "LOCAL-9" }))),
    "LOCAL-9 has session history",
  );
  const withGroupLive = live(member({}));
  withGroupLive.set("GROUP-9", row.card);
  assert.equal(
    restoreBlocker(row, withGroupLive),
    "GROUP-9 is already on the board",
  );
});

void test("listArchive is newest first, deleteArchived drops a row once, and the due sweep honours retention", async () => {
  const { g } = await startedGroup(store);
  await store.unwindGroup(g.id, "todo");
  const db = openBoardDb();
  const old = structuredClone(store.getArchived(g.id)!);
  old.id = "GROUP-old";
  old.identifier = "GROUP-old";
  old.archivedAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
  db.upsertArchive(old);

  const ids = store.listArchive().map((r) => r.id);
  assert.equal(ids[0], g.id, "newest first");
  assert.equal(ids[ids.length - 1], "GROUP-old");

  assert.deepEqual(store.archiveDueForDelete(Date.now(), 0), []);
  assert.deepEqual(
    store.archiveDueForDelete(Date.now(), 30).map((r) => r.id),
    ["GROUP-old"],
  );
  assert.deepEqual(
    store.archiveDueForDelete(Date.now(), 60).map((r) => r.id),
    [],
  );
  const liveDuplicate = structuredClone(old);
  liveDuplicate.id = g.id;
  liveDuplicate.identifier = g.identifier;
  await store.restoreGroup(g.id);
  db.upsertArchive(liveDuplicate);
  assert.deepEqual(
    store.archiveDueForDelete(Date.now(), 30).map((r) => r.id),
    ["GROUP-old"],
    "a row whose group is live again is never due",
  );
  db.deleteArchive(g.id);
  await store.recordArchiveDeleteBlocked("GROUP-old", "repo: 2 uncommitted");
  assert.equal(
    store.getArchived("GROUP-old")?.deleteBlocked,
    "repo: 2 uncommitted",
  );
  assert.deepEqual(
    store.archiveDueForDelete(Date.now(), 30),
    [],
    "blocked rows are never due",
  );

  assert.equal(await store.deleteArchived("GROUP-old"), true);
  assert.equal(await store.deleteArchived("GROUP-old"), false);
  assert.equal(store.getArchived("GROUP-old"), undefined);
  assert.deepEqual(eventTypes("GROUP-old"), ["archive_deleted"]);
});

void test("redactArchivedGroup carries no card snapshot or session records", async () => {
  const { g } = await startedGroup(store);
  await store.unwindGroup(g.id, "todo");
  const wire = redactArchivedGroup(
    store.getArchived(g.id)!,
  ) as unknown as Record<string, unknown>;
  assert.equal(wire.id, g.id);
  assert.equal("workspacePath" in wire, false);
  assert.equal("card" in wire, false);
  assert.equal("sessions" in wire, false);
  assert.ok(!JSON.stringify(wire).includes("hookToken"));
});

void test("restoring a row whose group is already live drops the stale row without touching the card", async () => {
  const { g } = await startedGroup(store);
  await store.unwindGroup(g.id, "todo");
  const zombie = structuredClone(store.getArchived(g.id)!);
  const first = await store.restoreGroup(g.id);
  assert.equal(first.ok, true);
  openBoardDb().upsertArchive(zombie);
  assert.ok(store.getArchived(g.id), "zombie row present beside the live card");
  const before = store.listEvents(g.id, 5).length;
  const again = await store.restoreGroup(g.id);
  assert.equal(again.ok, true);
  assert.equal(store.getArchived(g.id), undefined, "stale row dropped");
  assert.equal(store.getCard(g.id)?.column, "in_progress");
  assert.equal(
    store.listEvents(g.id, 5).length,
    before,
    "no event for a no-op restore",
  );
});

void test("the store refuses to unwind while a start is in flight, even when the service guard is bypassed", async () => {
  const { g, a } = await startedGroup(store);
  store.beginStart(g.id);
  try {
    const res = await store.unwindGroup(g.id, "todo");
    assert.deepEqual(res, {
      ok: false,
      reason: "a start or resume is in flight",
    });
    assert.equal(store.getCard(a.id)?.groupId, g.id, "nothing changed");
    assert.equal(store.getArchived(g.id), undefined);
  } finally {
    store.endStart(g.id);
  }
});

void test("a group that never started unwinds with no session records and restores whole", async () => {
  await store.load();
  const a = await store.createLocalCard("cold a", "");
  const b = await store.createLocalCard("cold b", "");
  const minted = await store.createGroupCard("cold group", [a.id, b.id]);
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const res = await store.unwindGroup(minted.card.id, "inbox");
  assert.equal(res.ok, true);
  assert.equal(store.getArchived(minted.card.id)?.card.sessions, undefined);
  assert.equal(store.getCard(a.id)?.column, "inbox");
  assert.equal((await store.restoreGroup(minted.card.id)).ok, true);
  assert.equal(store.getCard(minted.card.id)?.column, "todo");
  assert.equal(store.getCard(b.id)?.groupId, minted.card.id);
});
