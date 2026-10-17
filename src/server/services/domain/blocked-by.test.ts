import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey, Card } from "../../../shared/types.js";
import { checkBlockers, isReadyBlocked } from "./blocked-by.js";

const LOCAL = "LOCAL" as BoardKey;
const OTHER = "OTH" as BoardKey;

function card(n: number, extra: Partial<Card> = {}): Card {
  return {
    id: `id-${n}`,
    identifier: `LOCAL-${n}`,
    boardKey: LOCAL,
    source: "local",
    ...extra,
  } as Card;
}

function lookup(...cards: Card[]) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return (id: string) => byId.get(id);
}

void test("a valid list passes and keeps its order", () => {
  const get = lookup(card(1), card(2), card(3));
  assert.deepEqual(checkBlockers(LOCAL, ["id-3", "id-2"], get, card(1)), {
    ok: true,
    ids: ["id-3", "id-2"],
  });
});

void test("duplicate ids are removed and the first position stays", () => {
  const get = lookup(card(2), card(3));
  assert.deepEqual(checkBlockers(LOCAL, ["id-3", "id-2", "id-3"], get), {
    ok: true,
    ids: ["id-3", "id-2"],
  });
});

void test("an empty list passes", () => {
  assert.deepEqual(checkBlockers(LOCAL, [], lookup(), card(1)), {
    ok: true,
    ids: [],
  });
});

void test("a card that blocks itself is a cycle with a two-entry chain", () => {
  const me = card(1);
  assert.deepEqual(checkBlockers(LOCAL, ["id-1"], lookup(me), me), {
    ok: false,
    code: "blocked-by-cycle",
    reason: "LOCAL-1 -> LOCAL-1",
  });
});

void test("a two-card cycle names the chain", () => {
  const me = card(1);
  const two = card(2, { blockedBy: ["id-1"] });
  assert.deepEqual(checkBlockers(LOCAL, ["id-2"], lookup(me, two), me), {
    ok: false,
    code: "blocked-by-cycle",
    reason: "LOCAL-1 -> LOCAL-2 -> LOCAL-1",
  });
});

void test("a three-card cycle names the chain", () => {
  const me = card(1);
  const two = card(2, { blockedBy: ["id-3"] });
  const three = card(3, { blockedBy: ["id-1"] });
  assert.deepEqual(checkBlockers(LOCAL, ["id-2"], lookup(me, two, three), me), {
    ok: false,
    code: "blocked-by-cycle",
    reason: "LOCAL-1 -> LOCAL-2 -> LOCAL-3 -> LOCAL-1",
  });
});

void test("the proposed list replaces the stored list of the card itself", () => {
  const me = card(1, { blockedBy: ["id-2"] });
  const two = card(2, { blockedBy: ["id-1"] });
  assert.equal(
    checkBlockers(LOCAL, ["id-3"], lookup(me, two, card(3)), me).ok,
    true,
  );
});

void test("an existing cycle that does not include the card does not loop", () => {
  const me = card(1);
  const two = card(2, { blockedBy: ["id-3"] });
  const three = card(3, { blockedBy: ["id-2"] });
  assert.equal(
    checkBlockers(LOCAL, ["id-2"], lookup(me, two, three), me).ok,
    true,
  );
});

void test("a blocker on another board is refused and named", () => {
  const far = card(2, { boardKey: OTHER });
  assert.deepEqual(checkBlockers(LOCAL, ["id-2"], lookup(far), card(1)), {
    ok: false,
    code: "invalid-blocker",
    reason: "blocker id-2 is on another board",
  });
});

void test("an unknown blocker is refused and named", () => {
  assert.deepEqual(checkBlockers(LOCAL, ["id-9"], lookup(), card(1)), {
    ok: false,
    code: "invalid-blocker",
    reason: "unknown blocker: id-9",
  });
});

void test("a grouped member and a hidden card cannot block", () => {
  const member = card(2, { groupId: "id-g" });
  const hidden = card(3, { source: "orchestrator" });
  const get = lookup(member, hidden);
  for (const id of ["id-2", "id-3"]) {
    const result = checkBlockers(LOCAL, [id], get, card(1));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "invalid-blocker");
    assert.equal(!result.ok && result.reason.includes(id), true);
  }
});

void test("a group card can block", () => {
  const group = card(2, { source: "group" });
  assert.deepEqual(checkBlockers(LOCAL, ["id-2"], lookup(group), card(1)), {
    ok: true,
    ids: ["id-2"],
  });
});

void test("a group card, a group member and a hidden card cannot be blocked", () => {
  const get = lookup(card(2));
  const cases = [
    card(1, { source: "group" }),
    card(1, { groupId: "id-g" }),
    card(1, { source: "orchestrator" }),
  ];
  for (const blocked of cases) {
    const result = checkBlockers(LOCAL, ["id-2"], get, blocked);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "invalid-blocked-card");
  }
});

const DONE = new Set(["id-1", "id-2"]);
const isDone = (id: string) => DONE.has(id);

void test("isReadyBlocked is true only for a free To Do card whose blockers are all done", () => {
  const ready = { blockedBy: ["id-1", "id-2"], column: "todo" as const };
  assert.equal(isReadyBlocked(card(9, ready), isDone), true);
  assert.equal(
    isReadyBlocked(card(9, { ...ready, blockedBy: ["id-1", "id-3"] }), isDone),
    false,
  );
  assert.equal(
    isReadyBlocked(card(9, { ...ready, blockedBy: [] }), isDone),
    false,
  );
  assert.equal(isReadyBlocked(card(9, { column: "todo" }), isDone), false);
});

void test("isReadyBlocked refuses every other column", () => {
  for (const column of ["inbox", "in_progress", "parked", "done"] as const) {
    assert.equal(
      isReadyBlocked(card(9, { blockedBy: ["id-1"], column }), isDone),
      false,
      column,
    );
  }
});

void test("isReadyBlocked refuses paused, group, member and hidden cards", () => {
  const base = { blockedBy: ["id-1"], column: "todo" as const };
  const paused = { by: "user", at: "", sessionId: "s", pids: [] };
  for (const extra of [
    { paused },
    { source: "group" as const },
    { groupId: "g-1" },
    { source: "orchestrator" as const },
  ] as Partial<Card>[]) {
    assert.equal(
      isReadyBlocked(card(9, { ...base, ...extra }), isDone),
      false,
      JSON.stringify(extra),
    );
  }
});

void test("isReadyBlocked refuses a card that failed to start or already ran a session", () => {
  const base = { blockedBy: ["id-1"], column: "todo" as const };
  const startError = { step: "creating worktrees", stderr: "boom" };
  for (const extra of [
    { startError },
    { sessions: [{ id: "s-1", tmuxSession: "t" }] },
    { sessions: [{ id: "s-1", claudeSessionId: "c" }] },
  ] as unknown as Partial<Card>[]) {
    assert.equal(
      isReadyBlocked(card(9, { ...base, ...extra }), isDone),
      false,
      JSON.stringify(extra),
    );
  }
  assert.equal(
    isReadyBlocked(
      card(9, { ...base, startError: null, sessions: [] }),
      isDone,
    ),
    true,
  );
});
