import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

const SYNCED = "2026-09-24T10:00:00.000Z";
const source = { source: "dismiss", kind: "snapshot" } as const;

void test.after(() => env.cleanup());

void test("setInboxDismissed stamps the time, checks the column inside the store and clears in any column", async () => {
  await store.applyIssues([issue("d5")], SYNCED, source);
  assert.equal(await store.setInboxDismissed("d5", true), "ok");
  assert.match(
    store.getCard("d5")?.inboxDismissedAt ?? "",
    /^\d{4}-\d\d-\d\dT/,
  );
  await store.moveCardManual("d5", "todo");
  assert.equal(await store.setInboxDismissed("d5", true), "not-in-inbox");
  assert.equal(store.getCard("d5")?.inboxDismissedAt, undefined);
  assert.equal(await store.setInboxDismissed("d5", false), "ok");
  assert.equal(await store.setInboxDismissed("no-such-card", false), "unknown");
});

void test("a dismissed card moved out of the Inbox loses inboxDismissedAt", async () => {
  await store.applyIssues([issue("d6")], SYNCED, source);
  await store.setInboxDismissed("d6", true);
  assert.ok(store.getCard("d6")?.inboxDismissedAt);
  await store.moveCardManual("d6", "todo");
  assert.equal(store.getCard("d6")?.column, "todo");
  assert.equal(store.getCard("d6")?.inboxDismissedAt, undefined);
});

void test("a card reset to the Inbox is not dismissed", async () => {
  await store.applyIssues([issue("d7")], SYNCED, source);
  await store.setInboxDismissed("d7", true);
  await store.moveCardManual("d7", "todo");
  await store.resetCard("d7");
  assert.equal(store.getCard("d7")?.column, "inbox");
  assert.equal(store.getCard("d7")?.inboxDismissedAt, undefined);
});

void test("a group move mirrors the column onto a member and clears its dismissal", async () => {
  await store.applyIssues([issue("m1"), issue("m2")], SYNCED, source);
  await store.moveCardManual("m1", "todo");
  await store.moveCardManual("m2", "todo");
  const made = await store.createGroupCard(DEFAULT_BOARD_KEY, "group", [
    "m1",
    "m2",
  ]);
  assert.ok(made.ok);
  const member = store.getCard("m1");
  assert.ok(member);
  member.inboxDismissedAt = SYNCED;
  await store.moveCardManual(made.card.id, "done");
  assert.equal(store.getCard("m1")?.column, "done");
  assert.equal(store.getCard("m1")?.inboxDismissedAt, undefined);
});

void test("an unwound group returns a member to the Inbox without a dismissal", async () => {
  const group = [...store.listCards(DEFAULT_BOARD_KEY)].find(
    (c) => c.source === "group",
  );
  assert.ok(group);
  const member = store.getCard("m2");
  assert.ok(member);
  member.inboxDismissedAt = SYNCED;
  const unwound = await store.unwindGroup(group.id, "inbox");
  assert.ok(unwound.ok);
  assert.equal(store.getCard("m2")?.column, "inbox");
  assert.equal(store.getCard("m2")?.inboxDismissedAt, undefined);
});
