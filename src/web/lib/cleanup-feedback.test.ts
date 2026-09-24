import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../shared/types.js";
import {
  cleanupAttemptEnded,
  cleanupOutcomeCopy,
  cleanupRequestFailedCopy,
} from "./cleanup-feedback.js";

function card(extra: Partial<Card> = {}): Card {
  return {
    id: "c1",
    issueId: "c1",
    identifier: "LOCAL-18",
    title: "t",
    description: null,
    priority: 0,
    column: "done",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...extra,
  };
}

test("an attempt is only over once the outcome counter moved and the in-flight flag dropped", () => {
  const idle = card({ cleanupAttempt: 3, workspacePath: "/ws" });
  assert.equal(cleanupAttemptEnded(idle, 3), false, "nothing happened yet");
  const inFlight = card({ cleanupAttempt: 3, cleaningUp: true });
  assert.equal(cleanupAttemptEnded(inFlight, 3), false, "still tearing down");
  const firstOfTwo = card({ cleanupAttempt: 4, cleaningUp: true });
  assert.equal(
    cleanupAttemptEnded(firstOfTwo, 3),
    false,
    "one session settled, the fan-out is still running",
  );
  const finished = card({ cleanupAttempt: 4 });
  assert.equal(cleanupAttemptEnded(finished, 3), true);
  assert.equal(
    cleanupAttemptEnded(card({ cleanupAttempt: 1 }), undefined),
    true,
    "a first-ever attempt starts from an absent counter",
  );
});

test("a quiet finish is silent, a warning and a block each get a toast, the block wins", () => {
  assert.equal(cleanupOutcomeCopy(card()), null);
  assert.equal(
    cleanupOutcomeCopy(card({ cleanupWarning: "Cleanup incomplete." })),
    "LOCAL-18: Cleanup incomplete.",
  );
  assert.equal(cleanupOutcomeCopy(card({ cleanupWarning: "  " })), null);
  const blocked = card({
    cleanupWarning: "Cleanup incomplete.",
    cleanupBlocked: [{ repo: "api", count: 2 }],
  });
  assert.equal(
    cleanupOutcomeCopy(blocked),
    "LOCAL-18: cleanup blocked by uncommitted work. Open the ticket to discard and clean up.",
  );
  const multi = card({
    sessionSummaries: [
      {
        id: "s1",
        ordinal: 1,
        lost: false,
        active: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "s2",
        ordinal: 2,
        lost: false,
        active: false,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        cleanupBlocked: [{ repo: "web", count: 1 }],
      },
    ],
  });
  assert.match(cleanupOutcomeCopy(multi) ?? "", /blocked by uncommitted work/);
});

test("request-failure copy names the ticket", () => {
  assert.equal(
    cleanupRequestFailedCopy("LOCAL-18"),
    "Couldn't clean up LOCAL-18. Try again.",
  );
});
