import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem, issue } from "../test-support/fake-source.js";
import {
  ALL_BOARDS,
  DEFAULT_BOARD_KEY,
  parseBoardKey,
} from "../../shared/board-key.js";
import { isInboxWaiting } from "../../shared/inbox-count.js";
import type { BoardKey } from "../../shared/types.js";

isolateEnv();
const { store, BoardUnavailableError } = await import("./board.store.js");
await store.load();

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

const ACME = key("ACME");
const BETA = key("BETA");
const LOCAL = DEFAULT_BOARD_KEY;

await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: "/acme/sessions",
  repositories: [
    { path: "/acme/api", baseBranch: "main", checkCommand: "npm run check" },
  ],
  linearTeamKeys: [],
});
await store.createBoard({
  key: BETA,
  name: "Beta",
  workspaceRoot: "/beta/sessions",
  repositories: [],
  linearTeamKeys: [],
});
await store.setBoardArchived(BETA, true);

const localTicket = await store.createLocalCard(LOCAL, "local ticket", "");
const acmeOne = await store.createLocalCard(ACME, "acme ticket one", "");
const acmeTwo = await store.createLocalCard(ACME, "acme ticket two", "");
const acmeGroup = await store.createGroupCard(ACME, "acme group", [
  acmeOne.id,
  acmeTwo.id,
]);
assert.ok(acmeGroup.ok);
const nextLocal = await store.createLocalCard(LOCAL, "second local", "");

void test("each board mints its own counter: ACME tickets and groups share one, LOCAL keeps its own", () => {
  assert.equal(localTicket.id, "LOCAL-1");
  assert.equal(acmeOne.id, "ACME-1");
  assert.equal(acmeTwo.id, "ACME-2");
  assert.equal(acmeGroup.ok && acmeGroup.card.id, "ACME-3");
  assert.equal(nextLocal.id, "LOCAL-2");
  assert.equal(acmeOne.boardKey, "ACME");
  assert.equal(localTicket.boardKey, "LOCAL");
});

void test("snapshot of a board holds only its own cards and names the board", () => {
  const local = store.snapshot(LOCAL);
  const acme = store.snapshot(ACME);
  assert.equal(local.boardKey, "LOCAL");
  assert.equal(acme.boardKey, "ACME");
  assert.deepEqual(local.cards.map((c) => c.id).sort(), ["LOCAL-1", "LOCAL-2"]);
  assert.deepEqual(acme.cards.map((c) => c.id).sort(), [
    "ACME-1",
    "ACME-2",
    "ACME-3",
  ]);
});

void test("search, events and the card list stay inside the board", () => {
  assert.equal(store.searchCards(LOCAL, "acme", 50).total, 0);
  assert.equal(store.searchCards(ACME, "acme group", 50).total, 1);
  const localEvents = store.listEvents(LOCAL, null, 200);
  assert.ok(localEvents.length > 0);
  assert.ok(localEvents.every((e) => !e.cardId?.startsWith("ACME")));
  assert.ok(localEvents.every((e) => e.boardKey === "LOCAL"));
  const acmeEvents = store.listEvents(ACME, null, 200);
  assert.ok(acmeEvents.some((e) => e.cardId === "ACME-1"));
  assert.ok(acmeEvents.every((e) => e.boardKey === "ACME"));
  assert.deepEqual(store.listEvents(LOCAL, "ACME-1", 50), []);
  assert.deepEqual(
    store
      .listCards(ACME)
      .map((c) => c.id)
      .sort(),
    ["ACME-1", "ACME-2", "ACME-3"],
  );
  assert.equal(store.listCards(ALL_BOARDS).length, 5);
});

void test("a create on an unknown or archived board is refused with no card and no counter change", async () => {
  const before = store.listCards(ALL_BOARDS).length;
  await assert.rejects(
    store.createLocalCard(key("NOPE"), "x", ""),
    BoardUnavailableError,
  );
  await assert.rejects(
    store.createLocalCard(BETA, "x", ""),
    BoardUnavailableError,
  );
  await assert.rejects(
    store.createGroupCard(BETA, "g", []),
    BoardUnavailableError,
  );
  assert.equal(store.listCards(ALL_BOARDS).length, before);
  const next = await store.createLocalCard(ACME, "after refusals", "");
  assert.equal(next.id, "ACME-4");
});

void test("a group refuses a member of another board and mints nothing", async () => {
  const lone = await store.createLocalCard(LOCAL, "lone local", "");
  const result = await store.createGroupCard(ACME, "mixed", [lone.id]);
  assert.deepEqual(result, { ok: false, ineligibleIds: [lone.id] });
  const after = await store.createLocalCard(ACME, "counter check", "");
  assert.equal(after.id, "ACME-5");
});

void test("the member mirror moves only members of the group's own board", async () => {
  const outsider = await store.createLocalCard(LOCAL, "outsider", "");
  const group = store.getCard("ACME-3");
  assert.ok(group?.memberIds);
  group.memberIds.push(outsider.id);
  await store.moveCardManual("ACME-3", "done");
  assert.equal(store.getCard("ACME-1")?.column, "done");
  assert.equal(store.getCard(outsider.id)?.column, "todo");
  group.memberIds.pop();
  await store.moveCardManual("ACME-3", "todo");
});

void test("an unwound group archives on its board and restores onto it", async () => {
  const unwound = await store.unwindGroup("ACME-3", "todo");
  assert.ok(unwound.ok);
  assert.deepEqual(
    store.listArchive(ACME).map((r) => r.id),
    ["ACME-3"],
  );
  assert.deepEqual(store.listArchive(LOCAL), []);
  assert.ok(
    store
      .listEvents(ACME, "ACME-3", 10)
      .some((e) => e.type === "group_unwound"),
  );
  const restored = await store.restoreGroup("ACME-3");
  assert.ok(restored.ok);
  assert.equal(store.getCard("ACME-3")?.boardKey, "ACME");
  assert.ok(store.snapshot(ACME).cards.some((c) => c.id === "ACME-3"));
});

void test("workspace folders of a new board live on its row and leave LOCAL alone", async () => {
  const localBefore = store.getWorkspaceFolders(LOCAL);
  await store.addWorkspaceFolder(ACME, "/acme/web");
  await store.setLastUsedFolder(ACME, "/acme/web");
  assert.deepEqual(store.getWorkspaceFolders(ACME), {
    folders: ["/acme/api", "/acme/web"],
    lastUsed: "/acme/web",
  });
  assert.deepEqual(store.getBoard(ACME)?.repositories[1], {
    path: "/acme/web",
    baseBranch: null,
    checkCommand: "npm run check",
  });
  await store.removeWorkspaceFolder(ACME, "/acme/web");
  assert.deepEqual(store.getWorkspaceFolders(ACME), {
    folders: ["/acme/api"],
    lastUsed: "/acme/api",
  });
  assert.deepEqual(store.getWorkspaceFolders(LOCAL), localBefore);
  assert.deepEqual(store.snapshot(ACME).workspaceFolders, ["/acme/api"]);
});

void test("an item promotes onto the named board and is refused on an archived one", async () => {
  await store.upsertItems("fake", [fakeItem("p1"), fakeItem("p2")], {
    kind: "snapshot",
  });
  const promoted = await store.promoteItem(ACME, "fake:p1");
  assert.equal(promoted?.card.boardKey, "ACME");
  assert.match(promoted?.card.id ?? "", /^ACME-\d+$/);
  await assert.rejects(
    store.promoteItem(BETA, "fake:p2"),
    BoardUnavailableError,
  );
  assert.equal(store.getItem("fake:p2")?.cardId, undefined);
});

void test("the board keys survive a reload", async () => {
  await store.load();
  assert.equal(store.getCard("ACME-1")?.boardKey, "ACME");
  assert.equal(store.getCard("LOCAL-1")?.boardKey, "LOCAL");
  assert.equal(store.listArchive(ACME).length, 0);
});

void test("a dropped counter skips the ids the board already holds", async () => {
  const taken = new Set(store.snapshot(ACME).cards.map((c) => c.id));
  const first = store.getCard("ACME-1");
  const counters = (
    store as unknown as { identifierCounters: Record<string, number> }
  ).identifierCounters;
  counters.ACME = 0;
  const card = await store.createLocalCard(ACME, "after a dropped counter", "");
  assert.equal(taken.has(card.id), false);
  assert.equal(store.getCard("ACME-1")?.title, first?.title);
});

void test("each sweep over all boards sees an ACME session and a LOCAL sweep does not", async () => {
  const created = await store.createLocalCard(ACME, "sweep card", "");
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const session = {
    id: "s-sweep",
    createdAt: stamp,
    updatedAt: stamp,
    tmuxSession: "dsp-sweep",
    cleanupDueAt: now - 1,
  };
  const { BOARD_DB_PATH } = await import("./board-db.js");
  const { DatabaseSync } = await import("node:sqlite");
  const raw = new DatabaseSync(BOARD_DB_PATH);
  raw
    .prepare(
      "UPDATE cards SET data = json_set(data, '$.column', 'done', '$.source', 'sweep', '$.sessions', json(?)) WHERE id = ?",
    )
    .run(JSON.stringify([session]), created.id);
  raw.close();
  await store.load();
  const card = store.getCard(created.id);
  assert.ok(card);
  const ids = (rows: { card: { id: string } }[]): string[] =>
    rows.map((r) => r.card.id);
  assert.ok(ids(store.sessionsWithTmux(ALL_BOARDS)).includes(card.id));
  assert.ok(!ids(store.sessionsWithTmux(LOCAL)).includes(card.id));
  assert.ok(
    ids(store.sessionsDueForCleanup(ALL_BOARDS, now)).includes(card.id),
  );
  assert.ok(!ids(store.sessionsDueForCleanup(LOCAL, now)).includes(card.id));
  assert.deepEqual(store.trackedIssueIds(ALL_BOARDS, "sweep", new Set()), [
    card.issueId,
  ]);
  assert.deepEqual(store.trackedIssueIds(LOCAL, "sweep", new Set()), []);
});

void test("a group restores onto its archived board, and its aged row is due and deleted on that board", async () => {
  assert.ok((await store.unwindGroup("ACME-3", "todo")).ok);
  await store.setBoardArchived(ACME, true);
  const restored = await store.restoreGroup("ACME-3");
  await store.setBoardArchived(ACME, false);
  assert.ok(restored.ok);
  assert.equal(store.getCard("ACME-3")?.boardKey, "ACME");

  assert.ok((await store.unwindGroup("ACME-3", "todo")).ok);
  const { openBoardDb } = await import("./board-db.js");
  const db = openBoardDb();
  const row = store.getArchived("ACME-3");
  assert.ok(row);
  db.upsertArchive({
    ...row,
    archivedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
  });
  const due = (scope: typeof ALL_BOARDS | BoardKey): string[] =>
    store.archiveDueForDelete(scope, Date.now(), 30).map((r) => r.id);
  assert.deepEqual(due(ALL_BOARDS), ["ACME-3"]);
  assert.deepEqual(due(LOCAL), []);
  assert.equal(await store.deleteArchived("ACME-3"), true);
  assert.ok(
    store
      .listEvents(ACME, "ACME-3", 5)
      .some((e) => e.type === "archive_deleted"),
  );
  assert.ok(
    !store
      .listEvents(LOCAL, "ACME-3", 5)
      .some((e) => e.type === "archive_deleted"),
  );
});

void test("Done counts of a snapshot count only the cards of its board", async () => {
  const localBefore = store.snapshot(LOCAL).doneCounts?.total ?? 0;
  const acmeBefore = store.snapshot(ACME).doneCounts?.total ?? 0;
  const card = await store.createLocalCard(ACME, "done count", "");
  await store.moveCardManual(card.id, "done");
  assert.equal(store.snapshot(ACME).doneCounts?.total, acmeBefore + 1);
  assert.equal(store.snapshot(LOCAL).doneCounts?.total ?? 0, localBefore);
});

void test("minting skips an id that a Linear card holds as its identifier", async () => {
  await store.applyIssues(
    [issue("linear-acme-uuid", { identifier: "ACME-60" })],
    new Date().toISOString(),
    { source: "linearprobe" },
  );
  const counters = (
    store as unknown as { identifierCounters: Record<string, number> }
  ).identifierCounters;
  counters.ACME = 59;
  const card = await store.createLocalCard(ACME, "after a Linear id", "");
  assert.equal(card.id, "ACME-61");
});

void test("the Inbox cards of a snapshot belong to its board, so a LOCAL Inbox card never reaches ACME", async () => {
  const localInbox = await store.createLocalCard(LOCAL, "local inbox", "");
  const acmeInbox = await store.createLocalCard(ACME, "acme inbox", "");
  await store.moveCardManual(localInbox.id, "inbox");
  await store.moveCardManual(acmeInbox.id, "inbox");
  const waiting = (board: BoardKey) =>
    store.snapshot(board).cards.filter(isInboxWaiting);
  assert.ok(waiting(ACME).some((c) => c.id === acmeInbox.id));
  assert.ok(waiting(ACME).every((c) => c.boardKey === ACME));
  assert.ok(waiting(LOCAL).some((c) => c.id === localInbox.id));
  assert.ok(waiting(LOCAL).every((c) => c.boardKey === LOCAL));
});
