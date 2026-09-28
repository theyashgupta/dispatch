import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../shared/types.js";
import { fakeItem as item } from "../test-support/fake-source.js";
import {
  ITEM_DESCRIPTION_MAX,
  ITEM_TITLE_MAX,
  applyItemUpserts,
  buildPromotedCard,
  redactItem,
  wakeItem,
  withState,
} from "./items.js";

const NOW = "2026-09-24T12:00:00.000Z";

function existing(...items: Item[]): Map<string, Item> {
  return new Map(items.map((i) => [i.id, i]));
}

const snapshot = {
  source: "fake",
  kind: "snapshot" as const,
  partial: false,
  now: NOW,
};
const append = { ...snapshot, kind: "append" as const };

test("a new row is stored as given, unread by default", () => {
  const r = applyItemUpserts(existing(), [item("a")], snapshot);
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0]?.state, "unread");
  assert.deepEqual(r.counts, { inserted: 1, updated: 0, resolved: 0 });
});

test("an existing row keeps state, snoozedUntil and cardId and refreshes the connector fields", () => {
  const prior = item("a", {
    state: "snoozed",
    snoozedUntil: "2026-09-25T09:00:00.000Z",
    cardId: "LOCAL-9",
    title: "old",
    priority: 10,
  });
  const r = applyItemUpserts(
    existing(prior),
    [item("a", { title: "new", priority: 80 })],
    snapshot,
  );
  const row = r.upserts[0];
  assert.equal(row?.state, "snoozed");
  assert.equal(row?.snoozedUntil, "2026-09-25T09:00:00.000Z");
  assert.equal(row?.cardId, "LOCAL-9");
  assert.equal(row?.title, "new");
  assert.equal(row?.priority, 80);
  assert.deepEqual(r.counts, { inserted: 0, updated: 1, resolved: 0 });
});

test("a read row is never reset to unread by an upsert, and an unchanged row is not rewritten", () => {
  const changed = applyItemUpserts(
    existing(item("a", { state: "read" })),
    [item("a", { title: "changed" })],
    snapshot,
  );
  assert.equal(changed.upserts[0]?.state, "read");
  const same = applyItemUpserts(
    existing(item("a", { state: "read" })),
    [item("a")],
    snapshot,
  );
  assert.deepEqual(same.upserts, []);
  assert.deepEqual(same.counts, { inserted: 0, updated: 0, resolved: 0 });
});

test("meta merges with connector keys winning and app keys surviving", () => {
  const prior = item("a", { meta: { repo: "old", pinned: "1" } });
  const r = applyItemUpserts(
    existing(prior),
    [item("a", { meta: { repo: "new", ci: "red" } })],
    snapshot,
  );
  assert.deepEqual(r.upserts[0]?.meta, { repo: "new", pinned: "1", ci: "red" });
});

test("a complete snapshot pull resolves missing rows to done, drops their snooze, keeps cardId, and leaves done rows done", () => {
  const r = applyItemUpserts(
    existing(
      item("a"),
      item("b", { state: "read", cardId: "LOCAL-3" }),
      item("c", { state: "done" }),
      item("s", { state: "snoozed", snoozedUntil: "2026-09-30T09:00:00.000Z" }),
    ),
    [item("a")],
    snapshot,
  );
  const byId = new Map(r.upserts.map((u) => [u.id, u]));
  assert.equal(byId.get("fake:b")?.state, "done");
  assert.equal(byId.get("fake:b")?.cardId, "LOCAL-3");
  assert.equal(byId.has("fake:c"), false);
  assert.equal(byId.get("fake:s")?.state, "done");
  assert.equal(byId.get("fake:s")?.snoozedUntil, undefined);
  assert.deepEqual(r.counts, { inserted: 0, updated: 0, resolved: 2 });
});

test("a done row that reappears in a pull stays done", () => {
  const r = applyItemUpserts(
    existing(item("c", { state: "done", cardId: "LOCAL-1" })),
    [item("c", { title: "back" })],
    snapshot,
  );
  assert.equal(r.upserts[0]?.state, "done");
  assert.equal(r.upserts[0]?.cardId, "LOCAL-1");
  assert.equal(r.upserts[0]?.title, "back");
});

test("a complete snapshot pull only resolves rows of its own source", () => {
  const r = applyItemUpserts(
    existing(item("x", { source: "other" })),
    [],
    snapshot,
  );
  assert.deepEqual(r.upserts, []);
});

test("a partial snapshot pull resolves nothing", () => {
  const r = applyItemUpserts(
    existing(item("a"), item("b")),
    [item("a", { title: "touched" })],
    { ...snapshot, partial: true },
  );
  assert.deepEqual(
    r.upserts.map((u) => u.id),
    ["fake:a"],
  );
  assert.equal(r.counts.resolved, 0);
});

test("an append pull resolves nothing", () => {
  const r = applyItemUpserts(
    existing(item("a"), item("b")),
    [item("a", { title: "touched" })],
    append,
  );
  assert.deepEqual(
    r.upserts.map((u) => u.id),
    ["fake:a"],
  );
  assert.equal(r.counts.resolved, 0);
});

test("wakeItem flips an expired snooze to unread and leaves a future snooze and done alone", () => {
  const woken = wakeItem(
    item("a", { state: "snoozed", snoozedUntil: "2026-09-24T11:59:00.000Z" }),
    NOW,
  );
  assert.equal(woken.state, "unread");
  assert.equal(woken.snoozedUntil, undefined);
  const future = item("b", {
    state: "snoozed",
    snoozedUntil: "2026-09-24T12:01:00.000Z",
  });
  assert.equal(wakeItem(future, NOW), future);
  const done = item("c", { state: "done" });
  assert.equal(wakeItem(done, NOW), done);
});

test("withState copies the row into the state and drops the snooze time", () => {
  const prior = item("a", {
    state: "snoozed",
    snoozedUntil: "2026-09-30T09:00:00.000Z",
  });
  const next = withState(prior, "read");
  assert.equal(next.state, "read");
  assert.equal(next.snoozedUntil, undefined);
  assert.equal(prior.state, "snoozed", "the input is untouched");
});

test("an expired snooze is woken inside an upsert", () => {
  const prior = item("a", {
    state: "snoozed",
    snoozedUntil: "2026-09-24T11:00:00.000Z",
  });
  const r = applyItemUpserts(existing(prior), [item("a")], snapshot);
  assert.equal(r.upserts[0]?.state, "unread");
  assert.equal(r.upserts[0]?.snoozedUntil, undefined);
});

test("redactItem drops an unknown extra field and keeps the named ones", () => {
  const raw = {
    ...item("a", { url: "https://x", cardId: "LOCAL-1" }),
    secret: "nope",
  } as Item;
  const wire = redactItem(raw);
  assert.equal("secret" in wire, false);
  assert.deepEqual(Object.keys(wire).sort(), [
    "cardId",
    "createdAt",
    "id",
    "meta",
    "priority",
    "snippet",
    "source",
    "state",
    "title",
    "type",
    "url",
  ]);
});

test("buildPromotedCard builds a local Inbox card with the snippet, source link and meta lines", () => {
  const card = buildPromotedCard(
    item("a", {
      url: "https://example.test/pr/42",
      meta: { repo: "acme/app", author: "sam" },
    }),
    "LOCAL-7",
    NOW,
  );
  assert.equal(card.id, "LOCAL-7");
  assert.equal(card.identifier, "LOCAL-7");
  assert.equal(card.issueId, "fake:a");
  assert.equal(card.column, "inbox");
  assert.equal(card.source, "local");
  assert.equal(card.priority, 0);
  assert.equal(card.updatedAt, NOW);
  assert.equal(
    card.description,
    "Snippet a\n\nSource: https://example.test/pr/42\n\n- repo: acme/app\n- author: sam",
  );
});

test("buildPromotedCard caps the title and description and drops an empty description", () => {
  const long = buildPromotedCard(
    item("a", { title: "t".repeat(400), snippet: "s".repeat(30000), meta: {} }),
    "LOCAL-8",
    NOW,
  );
  assert.equal(long.title.length, ITEM_TITLE_MAX);
  assert.equal(long.description?.length, ITEM_DESCRIPTION_MAX);
  const bare = buildPromotedCard(
    item("b", { snippet: "  ", meta: {} }),
    "LOCAL-9",
    NOW,
  );
  assert.equal(bare.description, null);
});
