import test from "node:test";
import assert from "node:assert/strict";
import { planApply, type PlanSession } from "./session-account-plan.js";

const TARGET = "target";
const base = { accountId: "default", lost: false, legacy: false } as const;
const sessions: PlanSession[] = [
  { cardId: "c1", sessionId: "idle", turn: "idle", ...base },
  { cardId: "c2", sessionId: "busy", turn: "busy", ...base },
  { cardId: "c3", sessionId: "limit", turn: "limit", ...base },
  { cardId: "c4", sessionId: "unknown", turn: "unknown", ...base },
  { cardId: "c5", sessionId: "lost", turn: "idle", ...base, lost: true },
  { cardId: "c6", sessionId: "legacy", turn: "idle", ...base, legacy: true },
  { cardId: "c7", sessionId: "same", turn: "idle", ...base, accountId: TARGET },
];
const ref = (name: string) => {
  const s = sessions.find((x) => x.sessionId === name)!;
  return { cardId: s.cardId, sessionId: s.sessionId };
};
const skip = (name: string, reason: string) => ({ ...ref(name), reason });

void test("idle moves idle and limit, skips busy and unknown, and skips same, lost and legacy", () => {
  assert.deepEqual(planApply(sessions, "idle", TARGET), {
    move: [ref("idle"), ref("limit")],
    queue: [],
    skip: [
      skip("busy", "busy"),
      skip("unknown", "busy"),
      skip("lost", "lost"),
      skip("legacy", "legacy"),
      skip("same", "same"),
    ],
  });
});

void test("all moves idle and limit, queues busy and unknown, and skips same, lost and legacy", () => {
  assert.deepEqual(planApply(sessions, "all", TARGET), {
    move: [ref("idle"), ref("limit")],
    queue: [ref("busy"), ref("unknown")],
    skip: [
      skip("lost", "lost"),
      skip("legacy", "legacy"),
      skip("same", "same"),
    ],
  });
});

void test("a busy session already on the target is skipped as same, never queued", () => {
  const busySame: PlanSession = {
    cardId: "c9",
    sessionId: "bs",
    turn: "busy",
    ...base,
    accountId: TARGET,
  };
  assert.deepEqual(planApply([busySame], "all", TARGET), {
    move: [],
    queue: [],
    skip: [{ cardId: "c9", sessionId: "bs", reason: "same" }],
  });
});
