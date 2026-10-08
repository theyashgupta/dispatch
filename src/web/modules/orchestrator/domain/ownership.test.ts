import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Card } from "../../../../shared/types.js";
import {
  movableGroups,
  movePlan,
  nextExtra,
  orchestratorRows,
  scopeOf,
  scopeRows,
  type OwnerRecord,
} from "./ownership.js";

function card(id: string, patch: Partial<Card> = {}): Card {
  return {
    id,
    boardKey: DEFAULT_BOARD_KEY,
    issueId: id,
    identifier: id,
    title: `Title ${id}`,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: "2026-10-08T10:00:00.000Z",
    source: "group",
    ...patch,
  };
}

const empty = { groupIds: [], ticketIds: [] };
const main: OwnerRecord = {
  id: "main",
  name: "Main orchestrator",
  role: "main",
  scope: empty,
  policyOverride: {},
};
const extra: OwnerRecord = {
  id: "extra-1",
  name: "Extra orchestrator 1",
  role: "extra",
  scope: { groupIds: ["GROUP-14", "GROUP-15"], ticketIds: [] },
  policyOverride: { concurrencyCap: 1 },
};
const extraTwo: OwnerRecord = {
  id: "extra-2",
  name: "Extra orchestrator 2",
  role: "extra",
  scope: { groupIds: ["GROUP-16"], ticketIds: ["LOCAL-5"] },
  policyOverride: {},
};
const cards = [
  card("GROUP-12"),
  card("GROUP-13"),
  card("GROUP-14"),
  card("GROUP-15"),
  card("GROUP-16"),
  card("GROUP-9", { column: "done" }),
  card("LOCAL-5", { source: "linear" }),
  card("LOCAL-6", { source: "linear", groupId: "GROUP-12" }),
  card("HID-1", { source: "orchestrator" }),
];

test("scope rows list open groups and tickets, with the owner of a taken one", () => {
  const rows = scopeRows(cards, [main, extra, extraTwo], null);
  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.ownedBy]),
    [
      ["GROUP-12", "group", null],
      ["GROUP-13", "group", null],
      ["GROUP-14", "group", "Extra orchestrator 1"],
      ["GROUP-15", "group", "Extra orchestrator 1"],
      ["GROUP-16", "group", "Extra orchestrator 2"],
      ["LOCAL-5", "ticket", "Extra orchestrator 2"],
    ],
  );
});

test("the owner of a row does not block itself", () => {
  const rows = scopeRows(cards, [main, extra], "extra-1");
  assert.equal(rows.find((r) => r.id === "GROUP-14")?.ownedBy, null);
});

test("picked ids split into group and ticket scope", () => {
  const rows = scopeRows(cards, [main], null);
  assert.deepEqual(scopeOf(["GROUP-12", "LOCAL-5"], rows), {
    groupIds: ["GROUP-12"],
    ticketIds: ["LOCAL-5"],
  });
});

test("the next extra takes the smallest free number", () => {
  assert.deepEqual(nextExtra([main]), {
    id: "extra-1",
    name: "Extra orchestrator 1",
  });
  assert.equal(nextExtra([main, extra, extraTwo]).id, "extra-3");
  assert.equal(nextExtra([main, extraTwo]).id, "extra-1");
});

test("moving groups to another extra removes them from the source first", () => {
  const plan = movePlan([main, extra, extraTwo], "extra-1", "extra-2", [
    "GROUP-14",
  ]);
  assert.equal(plan.blocked, null);
  assert.deepEqual(
    plan.steps.map((s) => [s.id, s.scope.groupIds]),
    [
      ["extra-1", ["GROUP-15"]],
      ["extra-2", ["GROUP-16", "GROUP-14"]],
    ],
  );
  assert.deepEqual(plan.steps[0]?.restore, extra.scope);
});

test("moving to the main only removes the groups from the extra", () => {
  const plan = movePlan([main, extra], "extra-1", "main", ["GROUP-14"]);
  assert.deepEqual(
    plan.steps.map((s) => s.id),
    ["extra-1"],
  );
});

test("moving from the main only adds the groups to the target", () => {
  const plan = movePlan([main, extra], "main", "extra-1", ["GROUP-12"]);
  assert.deepEqual(plan.steps, [
    {
      id: "extra-1",
      scope: { groupIds: ["GROUP-14", "GROUP-15", "GROUP-12"], ticketIds: [] },
      restore: extra.scope,
    },
  ]);
});

test("a move that empties an extra is blocked and a move of nothing has no steps", () => {
  const blocked = movePlan([main, extra], "extra-1", "main", [
    "GROUP-14",
    "GROUP-15",
  ]);
  assert.equal(
    blocked.blocked,
    "Extra orchestrator 1 must keep at least one group or ticket.",
  );
  assert.equal(blocked.steps.length, 0);
  assert.deepEqual(movePlan([main, extra], "extra-1", "main", []), {
    steps: [],
    blocked: null,
  });
  const keepsTicket = movePlan([main, extraTwo], "extra-2", "main", [
    "GROUP-16",
  ]);
  assert.equal(keepsTicket.blocked, null);
});

test("movable groups: an extra lists its scope and the main lists the groups no extra owns", () => {
  assert.deepEqual(
    movableGroups(extra, [main, extra], cards).map((g) => g.id),
    ["GROUP-14", "GROUP-15"],
  );
  assert.deepEqual(
    movableGroups(main, [main, extra, extraTwo], cards).map((g) => g.id),
    ["GROUP-12", "GROUP-13"],
  );
});

test("table rows show the main scope text, the owned groups and the narrowed fields", () => {
  const rows = orchestratorRows([main, extra], cards);
  assert.deepEqual(rows[0], {
    id: "main",
    name: "Main orchestrator",
    role: "Main",
    scope: "Each group that no extra owns",
    owns: "GROUP-12, GROUP-13, GROUP-16",
    policy: "Board policy",
  });
  assert.deepEqual(rows[1], {
    id: "extra-1",
    name: "Extra orchestrator 1",
    role: "Extra",
    scope: "GROUP-14, GROUP-15",
    owns: "GROUP-14, GROUP-15",
    policy: "Loops at once: 1",
  });
});
