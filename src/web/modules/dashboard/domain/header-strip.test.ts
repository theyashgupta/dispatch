import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Card,
  LoopPhase,
  LoopProgress,
  LoopSummary,
  LoopUnit,
} from "../../../../shared/types.js";
import {
  gatesText,
  gatesPassedToday,
  needsCallText,
  nextStep,
  spentText,
} from "./header-strip.js";

function phase(
  number: number,
  gate: LoopPhase["gate"],
  passedAt: string | null,
): LoopPhase {
  return { number, name: `p${number}`, gate, attempts: 1, passedAt };
}

function unit(number: number, extra: Partial<LoopUnit> = {}): LoopUnit {
  return {
    number,
    ticket: null,
    title: `Title ${number}`,
    status: "in progress",
    statusText: "",
    branch: null,
    commit: null,
    prdPath: null,
    phaseTotal: null,
    phases: [],
    ...extra,
  };
}

function loop(
  units: LoopUnit[],
  summary: Partial<LoopSummary> = {},
  completion: LoopProgress["completion"] = "running",
): LoopProgress {
  return {
    slug: "demo",
    roadmapFile: "ROADMAP.md",
    units,
    engine: null,
    completion,
    summary: {
      unitsDone: 0,
      unitsTotal: units.length,
      currentUnit: null,
      currentPhase: null,
      lastGate: null,
      ...summary,
    },
    warnings: [],
    readAt: "2026-10-07T12:00:00Z",
  };
}

const card = (identifier: string, loopProgress?: LoopProgress): Card =>
  ({
    id: identifier,
    identifier,
    ...(loopProgress === undefined ? {} : { loopProgress }),
  }) as Card;

test("gates passed today counts only passes on the calendar day of now in the zone", () => {
  const now = new Date("2026-10-13T00:30:00+05:30");
  const cards = [
    card(
      "GROUP-1",
      loop([
        unit(1, {
          phases: [
            phase(1, "pass", "2026-10-12T23:50:00+05:30"),
            phase(2, "pass", "2026-10-13T00:10:00+05:30"),
            phase(3, "fail", "2026-10-13T00:15:00+05:30"),
            phase(4, "pass", null),
            phase(5, "pass", "garbage"),
          ],
        }),
      ]),
    ),
    card(
      "GROUP-2",
      loop([
        unit(1, { phases: [phase(1, "pass", "2026-10-13T00:20:00+05:30")] }),
      ]),
    ),
    card("GROUP-3"),
  ];
  assert.equal(gatesPassedToday(cards, now, "Asia/Kolkata"), 2);
  assert.equal(gatesPassedToday(cards, now, "UTC"), 3);
});

test("spent text sums the group costs and never says today", () => {
  assert.equal(spentText([{ cost: 12.4 }, { cost: 0.1 }]), "$12.50 spent");
  assert.equal(spentText([]), "$0.00 spent");
});

test("needs-a-call text reads 0, 1 and many", () => {
  assert.equal(needsCallText(0), "nothing needs you");
  assert.equal(needsCallText(1), "1 needs a call");
  assert.equal(needsCallText(3), "3 need a call");
});

test("next step names the current unit and phase of the first running loop by identifier", () => {
  const running = (phaseTotal: number | null) =>
    loop(
      [
        unit(1),
        unit(2, {
          title: "Build it",
          phaseTotal,
          phases: [phase(1, "pass", null)],
        }),
      ],
      { currentUnit: 2, currentPhase: { number: 2, name: "Wire" } },
    );
  assert.deepEqual(
    nextStep([card("GROUP-10", running(4)), card("GROUP-9", running(4))]),
    { headline: "GROUP-9 unit 2: Build it", detail: "Phase 2 of 4: Wire" },
  );
  assert.equal(
    nextStep([card("GROUP-9", running(null))]).detail,
    "Phase 2 of 1: Wire",
  );
});

test("next step with zero phases drops the total, and with no current phase reads the unit position", () => {
  const noPhases = loop([unit(1)], {
    currentUnit: 1,
    currentPhase: { number: 3, name: "Wire" },
  });
  assert.equal(nextStep([card("GROUP-1", noPhases)]).detail, "Phase 3: Wire");
  const noPhase = loop([unit(1), unit(2)], { currentUnit: 2 });
  assert.deepEqual(nextStep([card("GROUP-1", noPhase)]), {
    headline: "GROUP-1 unit 2: Title 2",
    detail: "Unit 2 of 2",
  });
});

test("next step skips loops that are not running or have no current unit", () => {
  const none = {
    headline: "No loop running",
    detail: "Start a group from the board.",
  };
  assert.deepEqual(nextStep([]), none);
  assert.deepEqual(
    nextStep([
      card("GROUP-1"),
      card("GROUP-2", loop([unit(1)], { currentUnit: 1 }, "complete")),
      card("GROUP-3", loop([unit(1)], { currentUnit: 1 }, "not_started")),
      card("GROUP-4", loop([unit(1)], { currentUnit: null })),
      card("GROUP-5", loop([unit(1)], { currentUnit: 7 })),
    ]),
    none,
  );
});

test("gatesText uses the singular for one gate", () => {
  assert.deepEqual(
    [gatesText(0), gatesText(1), gatesText(4)],
    ["0 gates passed today", "1 gate passed today", "4 gates passed today"],
  );
});
