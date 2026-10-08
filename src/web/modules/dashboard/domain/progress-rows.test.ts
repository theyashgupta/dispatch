import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, LoopProgress } from "../../../../shared/types.js";
import { loopsRunningText, progressRows } from "./progress-rows.js";

const NOW = new Date("2026-10-07T12:00:00Z");

function progress(completion: LoopProgress["completion"]): LoopProgress {
  return {
    slug: "demo",
    roadmapFile: "ROADMAP.md",
    units: [],
    engine: null,
    completion,
    summary: {
      unitsDone: 0,
      unitsTotal: 0,
      currentUnit: null,
      currentPhase: null,
      lastGate: null,
    },
    warnings: [],
    readAt: NOW.toISOString(),
  };
}

function card(identifier: string, loop?: LoopProgress, extra = {}): Card {
  return {
    id: identifier,
    identifier,
    ...(loop === undefined ? {} : { loopProgress: loop }),
    ...extra,
  } as Card;
}

test("running loops come first by group id, then the other loops, and cards without a loop drop", () => {
  const rows = progressRows(
    [
      card("GROUP-3", progress("running")),
      card("GROUP-1", progress("complete")),
      card("GROUP-2", progress("running")),
      card("GROUP-9"),
    ],
    NOW,
  );
  assert.deepEqual(
    rows.map((r) => r.groupId),
    ["GROUP-2", "GROUP-3", "GROUP-1"],
  );
});

test("a row carries the state, the context percent and the session time of the active session", () => {
  const row = progressRows(
    [
      card("GROUP-1", progress("running"), {
        activeSessionId: "s1",
        sessions: [
          {
            id: "s1",
            createdAt: "2026-10-07T09:50:00Z",
            state: "needs_input",
            contextPercent: 38.4,
          },
        ],
      }),
    ],
    NOW,
  )[0];
  assert.equal(row?.state, "needs_input");
  assert.equal(row?.context, "Context 38%");
  assert.equal(row?.sessionTime, "Session 2 h 10 min");
  assert.equal(row?.slug, "demo");
});

test("a row with no session has no state, context or session time", () => {
  const row = progressRows([card("GROUP-1", progress("running"))], NOW)[0];
  assert.deepEqual(
    [row?.state, row?.context, row?.sessionTime],
    [null, null, null],
  );
});

test("the count text reads the cap", () => {
  assert.equal(loopsRunningText(2, 3), "2 of 3 loops running");
  assert.equal(loopsRunningText(1, null), "1 loop running");
});

test("a wire-shape row reads the flat mirror and the summary", () => {
  const row = progressRows(
    [
      card("GROUP-1", progress("running"), {
        activeSessionId: "s1",
        state: "needs_input",
        contextPercent: 38.4,
        sessionSummaries: [
          {
            id: "s1",
            active: true,
            createdAt: "2026-10-07T09:50:00Z",
            updatedAt: "2026-10-07T11:00:00Z",
          },
        ],
      }),
    ],
    NOW,
  )[0];
  assert.equal(row?.state, "needs_input");
  assert.equal(row?.context, "Context 38%");
  assert.equal(row?.sessionTime, "Session 2 h 10 min");
});

test("group ids sort by their number, so GROUP-9 comes before GROUP-10", () => {
  const rows = progressRows(
    [
      card("GROUP-10", progress("running")),
      card("GROUP-9", progress("running")),
    ],
    NOW,
  );
  assert.deepEqual(
    rows.map((r) => r.groupId),
    ["GROUP-9", "GROUP-10"],
  );
});
