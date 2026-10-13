import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeSession } from "../../shared/types.js";
import {
  CLAUDE_SESSION_TOUCH_MS,
  latestClaudeSession,
  startClaudeSession,
  touchClaudeSession,
} from "./claude-sessions.js";

const T0 = "2026-09-01T00:00:00.000Z";
const at = (offsetMs: number): string =>
  new Date(Date.parse(T0) + offsetMs).toISOString();

function node(
  id: string,
  createdAt: string,
  lastActiveAt = createdAt,
  missingAt?: string,
): ClaudeSession {
  return missingAt === undefined
    ? { id, createdAt, lastActiveAt }
    : { id, createdAt, lastActiveAt, missingAt };
}

void test("latestClaudeSession: empty and undefined resolve to no node", () => {
  assert.equal(latestClaudeSession(undefined), undefined);
  assert.equal(latestClaudeSession([]), undefined);
});

void test("latestClaudeSession: newest start wins, not newest lastActiveAt", () => {
  const nodes = [node("a", at(0), at(5000)), node("b", at(1000), at(2000))];
  assert.equal(latestClaudeSession(nodes)?.id, "b");
});

void test("latestClaudeSession: a missing node is skipped; all missing resolves to none", () => {
  const nodes = [node("a", at(0)), node("b", at(1000), at(1000), at(2000))];
  assert.equal(latestClaudeSession(nodes)?.id, "a");
  nodes[0].missingAt = at(3000);
  assert.equal(latestClaudeSession(nodes), undefined);
});

void test("touchClaudeSession: an unknown id appends a node stamped created = lastActive = now", () => {
  const first = touchClaudeSession(undefined, "a", at(0));
  assert.deepEqual(first, [{ ...node("a", at(0)), startedAt: at(0) }]);
  const second = touchClaudeSession(first, "b", at(10));
  assert.equal(second?.length, 2);
  assert.equal(latestClaudeSession(second)?.id, "b");
});

void test("touchClaudeSession: the latest node is not bumped inside the throttle window", () => {
  const nodes = [node("a", at(0))];
  assert.equal(
    touchClaudeSession(nodes, "a", at(CLAUDE_SESSION_TOUCH_MS - 1)),
    undefined,
  );
  assert.equal(nodes[0].lastActiveAt, at(0), "input is never mutated");
});

void test("touchClaudeSession: the latest node is bumped at exactly the throttle window", () => {
  const next = touchClaudeSession(
    [node("a", at(0))],
    "a",
    at(CLAUDE_SESSION_TOUCH_MS),
  );
  assert.equal(next?.[0]!.lastActiveAt, at(CLAUDE_SESSION_TOUCH_MS));
});

void test("touchClaudeSession: a known non-latest id is bumped at once and stays behind the newer start", () => {
  const next = touchClaudeSession(
    [node("a", at(0)), node("b", at(1000))],
    "a",
    at(1500),
  );
  assert.equal(next?.length, 2, "no duplicate node");
  assert.equal(next?.[0]?.lastActiveAt, at(1500));
  assert.equal(latestClaudeSession(next)?.id, "b");
});

void test("touchClaudeSession: a known missing id is bumped at once but stays missing", () => {
  const next = touchClaudeSession(
    [node("a", at(0), at(0), at(500)), node("b", at(1000))],
    "a",
    at(1200),
  );
  assert.equal(next?.[0]!.lastActiveAt, at(1200));
  assert.equal(next?.[0].missingAt, at(500));
  assert.equal(latestClaudeSession(next)?.id, "b");
});

void test("latestClaudeSession: an exact createdAt tie goes to the later node", () => {
  const nodes = [node("a", at(1000), at(5000)), node("b", at(1000), at(2000))];
  assert.equal(latestClaudeSession(nodes)?.id, "b");
});

void test("touchClaudeSession: a new node starts at now and its lastActiveAt is never stamped before the latest", () => {
  const next = touchClaudeSession(
    [node("a", at(0), at(90_000))],
    "b",
    at(1000),
  );
  assert.equal(next?.[1]?.createdAt, at(1000));
  assert.equal(next?.[1]?.startedAt, at(1000), "startedAt is not clamped");
  assert.equal(
    next?.[1]?.lastActiveAt,
    at(90_000),
    "lastActiveAt is held at the latest node's",
  );
});

void test("startClaudeSession: sets startedAt and lastActiveAt on a new and a known node", () => {
  const first = startClaudeSession(undefined, "a", at(0));
  assert.deepEqual(first, [
    { id: "a", createdAt: at(0), lastActiveAt: at(0), startedAt: at(0) },
  ]);
  const again = startClaudeSession(first, "a", at(5000));
  assert.equal(again.length, 1);
  assert.equal(again[0].startedAt, at(5000));
  assert.equal(again[0].lastActiveAt, at(5000));
  assert.equal(again[0].createdAt, at(0));
  assert.equal(first[0].startedAt, at(0), "input is never mutated");
});

void test("startClaudeSession: clears missingAt", () => {
  const next = startClaudeSession(
    [node("a", at(0), at(0), at(500))],
    "a",
    at(1000),
  );
  assert.equal("missingAt" in next[0], false);
  assert.equal(latestClaudeSession(next)?.id, "a");
});

void test("startClaudeSession: restarting an older id after a newer one makes the older latest", () => {
  let nodes = startClaudeSession(undefined, "a", at(0));
  nodes = startClaudeSession(nodes, "b", at(1000));
  assert.equal(latestClaudeSession(nodes)?.id, "b");
  nodes = startClaudeSession(nodes, "a", at(2000));
  assert.equal(latestClaudeSession(nodes)?.id, "a");
});

void test("touchClaudeSession: never changes startedAt, and a late touch of an older node keeps the rank", () => {
  const nodes = startClaudeSession(
    startClaudeSession(undefined, "a", at(0)),
    "b",
    at(1000),
  );
  const next = touchClaudeSession(nodes, "a", at(5000));
  assert.equal(next?.[0]!.startedAt, at(0));
  assert.equal(next?.[0].lastActiveAt, at(5000));
  assert.equal(latestClaudeSession(next)?.id, "b");
});

void test("touchClaudeSession: a new node gets startedAt equal to createdAt", () => {
  const next = touchClaudeSession(
    [node("a", at(0), at(90_000))],
    "b",
    at(1000),
  );
  assert.equal(next?.[1]?.startedAt, next?.[1]?.createdAt);
  assert.equal(next?.[1]?.startedAt, at(1000));
});

void test("latestClaudeSession: a node without startedAt ranks by createdAt", () => {
  const nodes = [
    node("a", at(0), at(9000)),
    { ...node("b", at(100), at(100)), startedAt: at(500) },
    node("c", at(300), at(8000)),
  ];
  assert.equal(latestClaudeSession(nodes)?.id, "b");
  assert.equal(latestClaudeSession([nodes[0], nodes[2]])?.id, "c");
});

void test("latestClaudeSession: a tie on startedAt goes to the later node and a missing node is skipped", () => {
  const nodes = [
    startClaudeSession(undefined, "a", at(0))[0],
    startClaudeSession(undefined, "b", at(0))[0],
    {
      ...startClaudeSession(undefined, "c", at(9000))[0],
      missingAt: at(9500),
    },
  ];
  assert.equal(latestClaudeSession(nodes)?.id, "b");
});
