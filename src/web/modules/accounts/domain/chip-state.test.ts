import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeUsageSnapshot } from "../../../../shared/types.js";
import { chipState } from "./usage-format.js";

const snapshot = (
  status: ClaudeUsageSnapshot["status"],
): ClaudeUsageSnapshot => ({
  status,
  windows: [
    {
      kind: "session",
      label: "Session",
      percent: 95,
      resetsAt: null,
      isActive: true,
      periodStart: null,
      periodEnd: null,
    },
  ],
  fetchedAt: "2026-10-02T09:00:00Z",
});

void test("chipState shows the status copy in the stale tone for error, rate-limited and stale, ignoring the windows", () => {
  for (const [status, copy] of [
    ["error", "Usage could not be fetched"],
    ["rate-limited", "Usage rate limited, try again later"],
    ["stale", "Usage stale, refreshes on the next session"],
  ] as const) {
    assert.deepEqual(chipState(snapshot(status)), {
      tone: "stale",
      summary: copy,
      label: copy,
    });
  }
});
