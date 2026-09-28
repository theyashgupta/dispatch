import assert from "node:assert/strict";
import { test } from "node:test";
import type { Column } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";

isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

async function seedAll(
  source: string,
  cards: ReadonlyArray<readonly [string, Column, string?]>,
): Promise<void> {
  await store.applyIssues(
    cards.map(([id, , updatedAt]) => issue(id, updatedAt ? { updatedAt } : {})),
    new Date().toISOString(),
    { source },
  );
  for (const [id, column] of cards) {
    await store.moveCardManual(id, "todo");
    if (column !== "todo") await store.moveCardManual(id, column);
  }
}

test("the tracked set holds only this source's cards past To Do that the pull missed", async () => {
  await store.applyIssues([issue("t1")], new Date().toISOString(), {
    source: "linear",
  });
  await seedAll("linear", [
    ["t2", "todo"],
    ["t3", "in_review"],
    ["t4", "done"],
    ["t5", "parked"],
  ]);
  await seedAll("other", [["o1", "in_review"]]);
  assert.deepEqual(store.trackedIssueIds("linear", new Set(["t5"])), [
    "t3",
    "t4",
  ]);
  assert.deepEqual(store.trackedIssueIds("other", new Set()), ["o1"]);
});

test("the tracked set orders active, active gone, Done, Done gone, newest first, and honors the cap", async () => {
  await seedAll("tier", [
    ["done-old", "done", "2026-09-01T00:00:00.000Z"],
    ["done-new", "done", "2026-09-20T00:00:00.000Z"],
    ["review", "in_review", "2026-09-10T00:00:00.000Z"],
    ["parked-gone", "parked", "2026-09-15T00:00:00.000Z"],
    ["done-gone", "done", "2026-09-25T00:00:00.000Z"],
  ]);
  await store.applyIssues(
    [issue("done-old"), issue("done-new"), issue("review")],
    new Date().toISOString(),
    { source: "tier" },
  );
  assert.equal(store.getCard("parked-gone")?.goneFromLinear, true);
  assert.equal(store.getCard("done-gone")?.goneFromLinear, true);
  assert.deepEqual(store.trackedIssueIds("tier", new Set()), [
    "review",
    "parked-gone",
    "done-new",
    "done-old",
    "done-gone",
  ]);
  assert.deepEqual(store.trackedIssueIds("tier", new Set(), 2), [
    "review",
    "parked-gone",
  ]);
});

test("a grouped card past To Do is in the tracked set", async () => {
  await seedAll("grp", [["g1", "in_review"]]);
  const card = store.getCard("g1");
  assert.ok(card);
  card.groupId = "GROUP-9";
  assert.deepEqual(store.trackedIssueIds("grp", new Set()), ["g1"]);
});

test("a display-only refresh that clears a gone flag writes no sync_in event", async () => {
  await seedAll("evsrc", [["e1", "in_review"]]);
  await store.applyIssues([], new Date().toISOString(), { source: "evsrc" });
  assert.equal(store.getCard("e1")?.goneFromLinear, true);
  const events: string[] = [];
  const onActivity = (e: { type: string; cardId: string | null }) => {
    if (e.cardId === "e1") events.push(e.type);
  };
  store.on("activity", onActivity);
  await store.applyIssues(
    [issue("e1", { state: { id: "s", name: "In Progress", type: "started" } })],
    new Date().toISOString(),
    { source: "evsrc" },
  );
  store.off("activity", onActivity);
  assert.equal(store.getCard("e1")?.linearState?.name, "In Progress");
  assert.equal(store.getCard("e1")?.goneFromLinear, false);
  assert.deepEqual(events, []);
});

test("a To Do card with a fresh pending hold is tracked; an expired one is not", async () => {
  await seedAll("pend", [
    ["fresh", "todo"],
    ["stale", "todo"],
  ]);
  const fresh = store.getCard("fresh");
  const stale = store.getCard("stale");
  assert.ok(fresh && stale);
  fresh.pendingState = { id: "st-progress", at: new Date().toISOString() };
  stale.pendingState = {
    id: "st-progress",
    at: new Date(Date.now() - 300_000).toISOString(),
  };
  assert.deepEqual(store.trackedIssueIds("pend", new Set()), ["fresh"]);
});
