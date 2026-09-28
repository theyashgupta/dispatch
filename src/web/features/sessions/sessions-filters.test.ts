import assert from "node:assert/strict";
import { test } from "node:test";
import { accountOptions, type SessionRow } from "../../lib/sessions.js";
import { bulkEligibility, filterSessionRows } from "./sessions-filters.js";

const row = (key: string, extra: Partial<SessionRow> = {}): SessionRow => ({
  key,
  cardId: key.split(":")[0] ?? key,
  identifier: `LOCAL-${key}`,
  title: `Title ${key}`,
  sessionId: key,
  shortId: key,
  startedAt: "2026-09-24T10:00:00.000Z",
  lastActiveAt: "2026-09-24T11:00:00.000Z",
  elapsedMs: 0,
  prs: [],
  previews: [],
  lost: false,
  active: true,
  running: true,
  cardLive: false,
  cleaningUp: false,
  column: "in_progress",
  cleanupBlocked: [],
  siblings: 1,
  ...extra,
});

const rows = [
  row("a", { account: "acct-a" }),
  row("b", { account: "acct-b", column: "needs_input" }),
  row("c", { lost: true, account: "acct-a", column: "done" }),
  row("d", { column: "done", title: "Ship the Release" }),
];
const none = { liveOnly: false, account: "", status: "" as const, query: "" };

test("live only drops lost rows; account and status narrow; text matches identifier and title case-insensitively", () => {
  assert.deepEqual(
    filterSessionRows(rows, { ...none, liveOnly: true }).map((r) => r.key),
    ["a", "b", "d"],
  );
  assert.deepEqual(
    filterSessionRows(rows, { ...none, account: "acct-a" }).map((r) => r.key),
    ["a", "c"],
  );
  assert.deepEqual(
    filterSessionRows(rows, { ...none, status: "Needs you" }).map((r) => r.key),
    ["b"],
  );
  assert.deepEqual(
    filterSessionRows(rows, { ...none, status: "Lost" }).map((r) => r.key),
    ["c"],
  );
  assert.deepEqual(
    filterSessionRows(rows, { ...none, query: "local-B" }).map((r) => r.key),
    ["b"],
  );
  assert.deepEqual(
    filterSessionRows(rows, { ...none, query: "release" }).map((r) => r.key),
    ["d"],
  );
  assert.equal(filterSessionRows(rows, none).length, 4);
});

test("accountOptions lists the ids present once, sorted", () => {
  assert.deepEqual(accountOptions(rows), ["acct-a", "acct-b"]);
});

test("bulk eligibility: cleanup needs every card in Done, resume needs every row lost, nothing with an empty selection", () => {
  const done = row("x", { column: "done" });
  const lostDone = row("y", { column: "done", lost: true });
  const live = row("z");
  assert.deepEqual(bulkEligibility([]), { cleanup: false, resume: false });
  assert.deepEqual(bulkEligibility([done, lostDone]), {
    cleanup: true,
    resume: false,
  });
  assert.deepEqual(bulkEligibility([lostDone]), {
    cleanup: true,
    resume: true,
  });
  assert.deepEqual(bulkEligibility([lostDone, row("w", { lost: true })]), {
    cleanup: false,
    resume: true,
  });
  assert.deepEqual(bulkEligibility([done, live]), {
    cleanup: false,
    resume: false,
  });
});

test("resume refuses two rows of one card and cleanup refuses a card already cleaning up", () => {
  const a = row("c1:s1", { cardId: "c1", lost: true });
  const b = row("c1:s2", { cardId: "c1", lost: true });
  const other = row("c2:s3", { cardId: "c2", lost: true });
  assert.equal(bulkEligibility([a, b]).resume, false);
  assert.equal(bulkEligibility([a, other]).resume, true);
  assert.equal(
    bulkEligibility([row("d", { column: "done", cleaningUp: true })]).cleanup,
    false,
  );
});

test("resume refuses a lost sibling on a card whose active session is live", () => {
  assert.equal(
    bulkEligibility([row("c:s", { lost: true, cardLive: true })]).resume,
    false,
  );
  assert.equal(
    bulkEligibility([row("c:s", { lost: true, cardLive: false })]).resume,
    true,
  );
});
