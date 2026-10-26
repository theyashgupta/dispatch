import test from "node:test";
import assert from "node:assert/strict";
import {
  holdsReleased,
  RELEASE_AFTER_MS,
  releaseDue,
  type ReleaseFacts,
} from "./session-release.js";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();

const due: ReleaseFacts = {
  column: "agent_done",
  loopCard: true,
  lastMarker: "DONE shipped",
  engineOpen: false,
  storedState: "idle",
  detectedState: "idle",
  busy: false,
  changed: false,
  paused: false,
  starting: false,
  shipFlowState: undefined,
  columnSince: iso(RELEASE_AFTER_MS),
  stateSince: iso(RELEASE_AFTER_MS),
  now: NOW,
  afterMs: RELEASE_AFTER_MS,
};

void test("a loop card with every precondition is due at exactly 10 minutes", () => {
  assert.deepEqual(releaseDue(due), { due: true });
  assert.deepEqual(releaseDue({ ...due, detectedState: "roadmap_complete" }), {
    due: true,
  });
  assert.deepEqual(releaseDue({ ...due, shipFlowState: "done" }), {
    due: true,
  });
});

void test("it is not due at 9 minutes 59 seconds", () => {
  const early = iso(RELEASE_AFTER_MS - 1_000);
  assert.equal(
    releaseDue({ ...due, columnSince: early, stateSince: early }).due,
    false,
  );
});

const failing: [string, Partial<ReleaseFacts>][] = [
  ["a stored state that is already released", { storedState: "released" }],
  ["an open engine", { engineOpen: true }],
  ["a column other than agent_done", { column: "in_progress" }],
  ["a last marker that is not DONE", { lastMarker: "NEEDS_INPUT question" }],
  ["no last marker", { lastMarker: undefined }],
  ["a working detection", { detectedState: "working" }],
  ["a busy prompt", { busy: true }],
  ["a state change this sample", { changed: true }],
  ["a paused card", { paused: true }],
  ["a start in flight", { starting: true }],
  ["a running ship flow", { shipFlowState: "running" }],
  ["a stopped ship flow", { shipFlowState: "stopped" }],
  ["a card that is not a loop card", { loopCard: false }],
];

for (const [name, patch] of failing) {
  void test(`it is not due with ${name}`, () => {
    assert.equal(releaseDue({ ...due, ...patch }).due, false);
  });
}

void test("the clock starts at the later of columnSince and stateSince", () => {
  const recent = iso(60_000);
  const old = iso(RELEASE_AFTER_MS * 2);
  assert.equal(
    releaseDue({ ...due, columnSince: old, stateSince: recent }).due,
    false,
  );
  assert.equal(
    releaseDue({ ...due, columnSince: recent, stateSince: old }).due,
    false,
  );
  assert.equal(
    releaseDue({ ...due, columnSince: old, stateSince: old }).due,
    true,
  );
});

void test("a stored released holds while the pane does not show Claude", () => {
  assert.equal(holdsReleased("released", false), true);
});

void test("a stored released ends its hold when the pane shows Claude", () => {
  assert.equal(holdsReleased("released", true), false);
});

void test("a stored state other than released holds nothing", () => {
  for (const stored of [
    "working",
    "idle",
    "shell_prompt",
    "lost",
    "paused",
  ] as const) {
    assert.equal(holdsReleased(stored, false), false, stored);
  }
  assert.equal(holdsReleased(null, false), false);
});

void test("releaseDue names the already released reason", () => {
  assert.deepEqual(releaseDue({ ...due, storedState: "released" }), {
    due: false,
    reason: "already released",
  });
});

void test("an invalid timestamp is ignored when the other one is valid", () => {
  assert.deepEqual(releaseDue({ ...due, columnSince: "not a date" }), {
    due: true,
  });
  assert.deepEqual(releaseDue({ ...due, stateSince: undefined }), {
    due: true,
  });
  assert.deepEqual(
    releaseDue({ ...due, columnSince: undefined, stateSince: "garbage" }),
    { due: false, reason: "no timestamp" },
  );
  assert.deepEqual(
    releaseDue({ ...due, columnSince: undefined, stateSince: undefined }),
    { due: false, reason: "no timestamp" },
  );
});
