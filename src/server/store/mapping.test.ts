import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey, Card } from "../../shared/types.js";
import { issue } from "../test-support/fake-source.js";
import { reconcile } from "./mapping.js";

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    boardKey: DEFAULT_BOARD_KEY,
    issueId: id,
    identifier: id.toUpperCase(),
    title: `Issue ${id}`,
    description: null,
    priority: 2,
    column: "inbox",
    updatedAt: "2026-09-24T09:00:00.000Z",
    source: "linear",
    ...extra,
  };
}

function current(...cards: Card[]): Map<string, Card> {
  return new Map(cards.map((c) => [c.issueId, c]));
}

test("a new issue becomes an Inbox card stamped with the source id", () => {
  const r = reconcile([issue("a")], current(), new Set(), "linear");
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0]?.column, "inbox");
  assert.equal(r.upserts[0]?.source, "linear");
  assert.equal(r.upserts[0]?.goneFromLinear, false);
  assert.deepEqual([r.removeIds, r.goneIds, r.reappearedIds], [[], [], []]);
});

test("a new issue takes the board that boardForNewCard picks for its identifier", () => {
  const acme = "ACME" as BoardKey;
  const picked: string[] = [];
  const r = reconcile(
    [issue("a")],
    current(),
    new Set(),
    "linear",
    undefined,
    Date.now(),
    new Set(),
    (identifier) => {
      picked.push(identifier);
      return acme;
    },
  );
  assert.equal(r.upserts[0]?.column, "inbox");
  assert.equal(r.upserts[0]?.boardKey, acme);
  assert.deepEqual(picked, [issue("a").identifier]);
});

test("existing todo and inbox cards refresh in place and clear the gone flag", () => {
  const todo = card("a", {
    column: "todo",
    goneFromLinear: true,
    title: "old",
  });
  const inbox = card("b", { column: "inbox", title: "old" });
  const r = reconcile(
    [issue("a", { title: "new a" }), issue("b", { title: "new b" })],
    current(todo, inbox),
  );
  assert.deepEqual(
    r.upserts.map((c) => [c.id, c.title, c.column, c.goneFromLinear]),
    [
      ["a", "new a", "todo", false],
      ["b", "new b", "inbox", false],
    ],
  );
});

test("a card past To Do keeps its board-owned fields when only the title changed in Linear", () => {
  const r = reconcile(
    [issue("a", { title: "new" })],
    current(
      card("a", {
        column: "in_progress",
        title: "old",
        linearState: { name: "Todo", type: "unstarted" },
      }),
    ),
  );
  assert.deepEqual(r.upserts, []);
  assert.deepEqual(r.reappearedIds, []);
});

test("a gone card past To Do whose issue returns is reported as reappeared only", () => {
  const r = reconcile(
    [issue("a")],
    current(
      card("a", {
        column: "done",
        goneFromLinear: true,
        linearState: { name: "Todo", type: "unstarted" },
      }),
    ),
  );
  assert.deepEqual(r.upserts, []);
  assert.deepEqual(r.reappearedIds, ["a"]);
});

test("an absent issue removes a todo or inbox card and flags a card past To Do", () => {
  const r = reconcile(
    [],
    current(
      card("a", { column: "todo" }),
      card("b", { column: "inbox" }),
      card("c", { column: "in_review" }),
    ),
  );
  assert.deepEqual(r.removeIds.sort(), ["a", "b"]);
  assert.deepEqual(r.goneIds, ["c"]);
});

test("a todo card with a start in flight or provisioning state is flagged, never removed", () => {
  const r = reconcile(
    [],
    current(
      card("a", { column: "todo" }),
      card("b", { column: "todo", provisioningStep: "worktree" }),
    ),
    new Set(["a"]),
  );
  assert.deepEqual(r.removeIds, []);
  assert.deepEqual(r.goneIds.sort(), ["a", "b"]);
});

test("a group member refreshes even past To Do and is never removed", () => {
  const member = card("a", {
    column: "in_progress",
    groupId: "GROUP-1",
    title: "old",
  });
  const refreshed = reconcile([issue("a", { title: "new" })], current(member));
  assert.equal(refreshed.upserts[0]?.title, "new");
  const absent = reconcile([], current(member));
  assert.deepEqual(absent.removeIds, []);
  assert.deepEqual(absent.goneIds, ["a"]);
});

const STARTED = {
  id: "s-started",
  name: "In Progress",
  type: "started",
  color: "#f2c94c",
};
const TEAM = { id: "t-eng", key: "ENG", name: "Engineering" };

test("a returned issue refreshes only display fields on a card past To Do", () => {
  const existing = card("a", {
    column: "in_review",
    title: "board title",
    description: "board body",
    priority: 4,
    updatedAt: "2026-09-20T00:00:00.000Z",
    linearState: { id: "s-todo", name: "Todo", type: "unstarted" },
  });
  const r = reconcile(
    [
      issue("a", {
        title: "linear title",
        description: "linear body",
        priority: 1,
        url: "https://example.test/moved",
        identifier: "OPS-9",
        updatedAt: "2026-09-25T00:00:00.000Z",
        project: { id: "p", name: "P" },
        state: STARTED,
        team: TEAM,
        cycle: 14,
        assignee: { id: "u", name: "U" },
      }),
    ],
    current(existing),
  );
  const up = r.upserts[0];
  assert.equal(r.upserts.length, 1);
  assert.deepEqual(up?.linearState, STARTED);
  assert.deepEqual(up?.team, TEAM);
  assert.equal(up?.cycle, 14);
  assert.deepEqual(up?.assignee, { id: "u", name: "U" });
  assert.equal(up?.column, "in_review");
  assert.equal(up?.title, "board title");
  assert.equal(up?.description, "board body");
  assert.equal(up?.priority, 4);
  assert.equal(up?.identifier, "A");
  assert.equal(up?.url, undefined);
  assert.equal(up?.project, undefined);
  assert.equal(up?.updatedAt, "2026-09-20T00:00:00.000Z");
});

test("an unchanged display set past To Do emits no upsert", () => {
  const r = reconcile(
    [issue("a", { state: STARTED, team: TEAM, cycle: 3 })],
    current(
      card("a", {
        column: "done",
        linearState: STARTED,
        team: TEAM,
        cycle: 3,
      }),
    ),
  );
  assert.deepEqual(r.upserts, []);
  assert.deepEqual(r.reappearedIds, []);
});

test("a tracked hit refreshes a card past To Do and clears its gone flag", () => {
  const r = reconcile(
    [],
    current(card("a", { column: "in_review", goneFromLinear: true })),
    new Set(),
    "linear",
    { issues: [issue("a", { state: STARTED })], requested: new Set(["a"]) },
  );
  assert.deepEqual(r.goneIds, []);
  assert.equal(r.upserts[0]?.goneFromLinear, false);
  assert.deepEqual(r.upserts[0]?.linearState, STARTED);
});

test("a card past To Do is gone only when it was requested by id and not returned", () => {
  const board = current(
    card("a", { column: "in_review" }),
    card("b", { column: "done" }),
  );
  const r = reconcile([], board, new Set(), "linear", {
    issues: [],
    requested: new Set(["a"]),
  });
  assert.deepEqual(r.goneIds, ["a"]);
  const failed = reconcile([], board, new Set(), "linear", {
    issues: [],
    requested: new Set(),
  });
  assert.deepEqual(failed.goneIds, []);
  assert.deepEqual(failed.upserts, []);
  const plain = reconcile([], board, new Set(), "linear");
  assert.deepEqual(plain.goneIds.sort(), ["a", "b"]);
});

test("a grouped member past To Do found by id is refreshed, not flagged gone", () => {
  const r = reconcile(
    [],
    current(card("a", { column: "in_progress", groupId: "GROUP-1" })),
    new Set(),
    "linear",
    { issues: [issue("a", { state: STARTED })], requested: new Set(["a"]) },
  );
  assert.deepEqual(r.goneIds, []);
  assert.deepEqual(r.upserts[0]?.linearState, STARTED);
  assert.equal(r.upserts[0]?.column, "in_progress");
});

test("a legacy row without a state id refreshes once, then stays quiet", () => {
  const legacy = card("a", {
    column: "done",
    linearState: { name: "In Progress", type: "started" },
  });
  const fresh = issue("a", { state: STARTED });
  const first = reconcile([fresh], current(legacy));
  assert.equal(first.upserts.length, 1);
  const updated = first.upserts[0];
  assert.ok(updated);
  const second = reconcile([fresh], current(updated));
  assert.deepEqual(second.upserts, []);
});

test("To Do and Inbox removal ignores the tracked result", () => {
  const board = current(
    card("a", { column: "todo" }),
    card("b", { column: "inbox" }),
  );
  for (const requested of [new Set(["a", "b"]), new Set<string>()]) {
    const r = reconcile([], board, new Set(), "linear", {
      issues: [issue("a"), issue("b")],
      requested,
    });
    assert.deepEqual(r.removeIds.sort(), ["a", "b"]);
    assert.deepEqual(r.upserts, []);
  }
});

test("To Do, Inbox and group cards copy the display fields with the full refresh", () => {
  const r = reconcile(
    [
      issue("a", { state: STARTED, team: TEAM, cycle: 2 }),
      issue("b", { state: STARTED, team: TEAM, cycle: 2 }),
    ],
    current(
      card("a", { column: "todo" }),
      card("b", { column: "in_progress", groupId: "GROUP-1" }),
    ),
  );
  for (const up of r.upserts) {
    assert.deepEqual(up.linearState, STARTED);
    assert.deepEqual(up.team, TEAM);
    assert.equal(up.cycle, 2);
  }
  assert.equal(r.upserts.length, 2);
});

test("a grouped To Do or Inbox card absent from the pull is flagged gone, never removed", () => {
  const r = reconcile(
    [],
    current(
      card("a", { column: "todo", groupId: "GROUP-1" }),
      card("b", { column: "inbox", groupId: "GROUP-1" }),
    ),
    new Set(),
    "linear",
    { issues: [], requested: new Set() },
  );
  assert.deepEqual(r.removeIds, []);
  assert.deepEqual(r.goneIds.sort(), ["a", "b"]);
});

const COMMENT = {
  id: "c1",
  body: "Looks good",
  createdAt: "2026-09-24T10:00:00.000Z",
  author: "Ada",
};

test("a new comment on an In Review card emits an upsert with the comments", () => {
  const next = [
    COMMENT,
    { ...COMMENT, id: "c2", createdAt: "2026-09-24T11:00:00.000Z" },
  ];
  const r = reconcile(
    [issue("a", { state: STARTED, comments: next })],
    current(
      card("a", {
        column: "in_review",
        linearState: STARTED,
        comments: [COMMENT],
      }),
    ),
  );
  assert.equal(r.upserts.length, 1);
  assert.deepEqual(r.upserts[0]?.comments, next);
});

test("identical comments on an In Review card emit no upsert", () => {
  const r = reconcile(
    [issue("a", { state: STARTED, comments: [COMMENT] })],
    current(
      card("a", {
        column: "in_review",
        linearState: STARTED,
        comments: [COMMENT],
      }),
    ),
  );
  assert.deepEqual(r.upserts, []);
});

test("an adopted To Do card missing from the pull is never removed: refreshed by id, or flagged gone", () => {
  const adopted = card("LOCAL-7", { issueId: "issue-70", column: "todo" });
  const noTracked = reconcile([], new Map([["issue-70", adopted]]));
  assert.deepEqual(noTracked.removeIds, []);
  assert.deepEqual(noTracked.goneIds, ["LOCAL-7"]);

  const refreshed = reconcile(
    [],
    new Map([["issue-70", adopted]]),
    new Set(),
    "linear",
    {
      issues: [issue("issue-70", { state: STARTED })],
      requested: new Set(["issue-70"]),
    },
  );
  assert.deepEqual(refreshed.removeIds, []);
  assert.deepEqual(refreshed.upserts[0]?.linearState, STARTED);
  assert.equal(refreshed.upserts[0]?.id, "LOCAL-7");

  const missing = reconcile(
    [],
    new Map([["issue-70", adopted]]),
    new Set(),
    "linear",
    { issues: [], requested: new Set(["issue-70"]) },
  );
  assert.deepEqual(missing.removeIds, []);
  assert.deepEqual(missing.goneIds, ["LOCAL-7"]);
});

const PUSHED_AT = "2026-09-25T00:00:00.000Z";
const T0 = Date.parse(PUSHED_AT);
const PUSHED = { id: "st-progress", name: "In Progress", type: "started" };
const OLD = { id: "st-todo", name: "Todo", type: "unstarted" };
const pending = { id: "st-progress", at: PUSHED_AT };

test("a fresh pending state holds against a different incoming state while other display fields refresh", () => {
  const review = card("a", {
    column: "in_review",
    linearState: PUSHED,
    pendingState: pending,
  });
  const todo = card("b", {
    column: "todo",
    linearState: PUSHED,
    pendingState: pending,
  });
  const team = { id: "team-x", key: "X", name: "Other" };
  const r = reconcile(
    [issue("a", { state: OLD, team }), issue("b", { state: OLD, team })],
    current(review, todo),
    new Set(),
    "linear",
    undefined,
    T0 + 299_999,
  );
  for (const up of r.upserts) {
    assert.deepEqual(up.linearState, PUSHED, up.id);
    assert.deepEqual(up.pendingState, pending, up.id);
    assert.deepEqual(up.team, team, up.id);
  }
  assert.equal(r.upserts.length, 2);
});

test("Linear reporting the pushed state clears the pending hold", () => {
  const review = card("a", {
    column: "in_review",
    linearState: PUSHED,
    pendingState: pending,
  });
  const r = reconcile(
    [issue("a", { state: PUSHED })],
    current(review),
    new Set(),
    "linear",
    undefined,
    T0 + 1000,
  );
  assert.equal(r.upserts[0]?.pendingState, undefined);
  assert.deepEqual(r.upserts[0]?.linearState, PUSHED);
});

test("a pending hold of five minutes or more clears and the incoming state applies", () => {
  const review = card("a", {
    column: "in_review",
    linearState: PUSHED,
    pendingState: pending,
  });
  const r = reconcile(
    [issue("a", { state: OLD })],
    current(review),
    new Set(),
    "linear",
    undefined,
    T0 + 300_000,
  );
  assert.equal(r.upserts[0]?.pendingState, undefined);
  assert.deepEqual(r.upserts[0]?.linearState, OLD);
});

test("a To Do card with a fresh pending hold missing from the main pull stays; an expired one is removed", () => {
  const todo = card("a", {
    column: "todo",
    linearState: PUSHED,
    pendingState: pending,
  });
  const tracked = {
    issues: [issue("a", { state: PUSHED })],
    requested: new Set(["a"]),
  };
  const fresh = reconcile(
    [],
    current(todo),
    new Set(),
    "linear",
    tracked,
    T0 + 1000,
  );
  assert.deepEqual([fresh.removeIds, fresh.goneIds], [[], []]);
  assert.equal(fresh.upserts[0]?.pendingState, undefined);

  const expired = reconcile(
    [],
    current(todo),
    new Set(),
    "linear",
    { issues: [], requested: new Set() },
    T0 + 300_000,
  );
  assert.deepEqual(expired.removeIds, ["a"]);
});

test("a To Do card with a push in flight is kept by a poll that misses it", () => {
  const todo = card("a", { column: "todo" });
  const noTracked = { issues: [], requested: new Set<string>() };
  const kept = reconcile(
    [],
    current(todo),
    new Set(),
    "linear",
    noTracked,
    T0,
    new Set(["a"]),
  );
  assert.deepEqual([kept.removeIds, kept.goneIds], [[], []]);
  const removed = reconcile(
    [],
    current(todo),
    new Set(),
    "linear",
    noTracked,
    T0,
  );
  assert.deepEqual(removed.removeIds, ["a"]);
});
