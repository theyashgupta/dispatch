import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeSession } from "../../shared/types.js";
import {
  CLAUDE_SESSION_TOUCH_MS,
  latestClaudeSession,
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

void test("latestClaudeSession: newest lastActiveAt wins, not newest createdAt", () => {
  const nodes = [node("a", at(0), at(5000)), node("b", at(1000), at(2000))];
  assert.equal(latestClaudeSession(nodes)?.id, "a");
});

void test("latestClaudeSession: a missing node is skipped; all missing resolves to none", () => {
  const nodes = [node("a", at(0)), node("b", at(1000), at(1000), at(2000))];
  assert.equal(latestClaudeSession(nodes)?.id, "a");
  nodes[0].missingAt = at(3000);
  assert.equal(latestClaudeSession(nodes), undefined);
});

void test("touchClaudeSession: an unknown id appends a node stamped created = lastActive = now", () => {
  const first = touchClaudeSession(undefined, "a", at(0));
  assert.deepEqual(first, [node("a", at(0))]);
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

void test("touchClaudeSession: a known non-latest id is bumped at once and becomes latest", () => {
  const next = touchClaudeSession(
    [node("a", at(0)), node("b", at(1000))],
    "a",
    at(1500),
  );
  assert.equal(next?.length, 2, "no duplicate node");
  assert.equal(latestClaudeSession(next)?.id, "a");
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

void test("latestClaudeSession: an exact lastActiveAt tie goes to the later node", () => {
  const nodes = [node("a", at(0), at(5000)), node("b", at(1000), at(5000))];
  assert.equal(latestClaudeSession(nodes)?.id, "b");
});

void test("touchClaudeSession: a clock that stepped backwards still puts a new conversation first", () => {
  const next = touchClaudeSession(
    [node("a", at(0), at(90_000))],
    "b",
    at(1000),
  );
  assert.equal(
    next?.[1]?.createdAt,
    at(1000),
    "createdAt keeps the wall clock",
  );
  assert.equal(
    next?.[1]?.lastActiveAt,
    at(90_000),
    "lastActiveAt never sorts behind the latest",
  );
  assert.equal(latestClaudeSession(next)?.id, "b");
});
