import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultBoardPolicy,
  parseBoardKey,
} from "../../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  OrchestratorPolicyOverride,
  OrchestratorRecord,
} from "../../../shared/types.js";
import {
  cardOwner,
  checkRecords,
  effectivePolicy,
  groupOwner,
  mayShip,
  widerOverrideField,
} from "./orchestrator-rules.js";

const SBX = parseBoardKey("SBX") as BoardKey;

const policy: BoardPolicy = {
  ...defaultBoardPolicy(SBX),
  roadmapApproval: "rules",
  concurrencyCap: 3,
  usageLimit: "wait",
  shipRights: "open_prs",
  budgetPerGroup: 20,
};

function record(
  id: string,
  role: "main" | "extra",
  scope: Partial<OrchestratorRecord["scope"]> = {},
  policyOverride: OrchestratorPolicyOverride = {},
): OrchestratorRecord {
  return {
    id,
    name: id,
    role,
    scope: { groupIds: [], ticketIds: [], ...scope },
    policyOverride,
    cardId: null,
    state: "stopped",
    createdAt: "2026-10-07T00:00:00.000Z",
  };
}

const main = record("main", "main");
const infra = record("infra", "extra", { groupIds: ["SBX-9"] });
const web = record("web", "extra", { ticketIds: ["SBX-3"] });

void test("records: the truth table of main count, extra prerequisites and scopes", () => {
  const cases: [string, OrchestratorRecord[], unknown][] = [
    ["no orchestrator", [], { ok: true }],
    ["one main", [main], { ok: true }],
    ["a main and a scoped extra", [main, infra], { ok: true }],
    ["a main and two extras", [main, infra, web], { ok: true }],
    [
      "two mains",
      [main, record("second", "main")],
      { ok: false, code: "main-exists" },
    ],
    ["an extra with no main", [infra], { ok: false, code: "extra-needs-main" }],
    [
      "an extra with an empty scope",
      [main, record("empty", "extra")],
      { ok: false, code: "extra-needs-scope", id: "empty" },
    ],
    [
      "a main with a scope",
      [record("main", "main", { groupIds: ["SBX-9"] })],
      { ok: false, code: "main-has-scope" },
    ],
    [
      "a main with an override",
      [record("main", "main", {}, { concurrencyCap: 1 })],
      { ok: false, code: "main-has-override" },
    ],
    [
      "two records with one id",
      [main, record("main", "extra", { groupIds: ["SBX-1"] })],
      { ok: false, code: "duplicate-id", id: "main" },
    ],
    [
      "a second claim of one group",
      [main, infra, record("other", "extra", { groupIds: ["SBX-9"] })],
      { ok: false, code: "group-owned", groupId: "SBX-9", owner: "infra" },
    ],
  ];
  for (const [name, records, expected] of cases) {
    assert.deepEqual(checkRecords(policy, records), expected, name);
  }
});

void test("records: an extra with a wider override is refused with the field", () => {
  const wide = record(
    "wide",
    "extra",
    { groupIds: ["SBX-1"] },
    { shipRights: "merge" },
  );
  assert.deepEqual(checkRecords(policy, [main, wide]), {
    ok: false,
    code: "wider-override",
    field: "shipRights",
  });
});

void test("records: a stale wider override on an untouched record does not block a change of another", () => {
  const stale = record(
    "stale",
    "extra",
    { groupIds: ["SBX-1"] },
    { shipRights: "merge" },
  );
  assert.deepEqual(checkRecords(policy, [main, stale, web], ["web"]), {
    ok: true,
  });
  assert.deepEqual(checkRecords(policy, [main, stale], []), { ok: true });
  assert.deepEqual(checkRecords(policy, [main, stale, web], ["stale"]), {
    ok: false,
    code: "wider-override",
    field: "shipRights",
  });
});

void test("records: a ticket listed by two extras is refused with the first owner", () => {
  const second = record("second", "extra", { ticketIds: ["SBX-3"] });
  assert.deepEqual(checkRecords(policy, [main, web, second]), {
    ok: false,
    code: "ticket-owned",
    ticketId: "SBX-3",
    owner: "web",
  });
});

void test("a stored override key outside the five fields is ignored, never thrown on", () => {
  const odd = record("odd", "extra", { groupIds: ["SBX-1"] }, {
    model: "x",
    concurrencyCap: 1,
  } as unknown as OrchestratorPolicyOverride);
  assert.equal(widerOverrideField(policy, odd.policyOverride), null);
  assert.equal(effectivePolicy(policy, odd).concurrencyCap, 1);
  assert.equal(
    effectivePolicy(policy, odd).orchestratorModel,
    policy.orchestratorModel,
  );
  assert.deepEqual(checkRecords(policy, [main, odd]), { ok: true });
});

void test("narrowing: each field allows equal or narrower values and refuses wider ones", () => {
  const cases: [OrchestratorPolicyOverride, string | null][] = [
    [{}, null],
    [{ concurrencyCap: 3 }, null],
    [{ concurrencyCap: 1 }, null],
    [{ concurrencyCap: 4 }, "concurrencyCap"],
    [{ budgetPerGroup: 20 }, null],
    [{ budgetPerGroup: 5 }, null],
    [{ budgetPerGroup: 21 }, "budgetPerGroup"],
    [{ budgetPerGroup: null }, "budgetPerGroup"],
    [{ shipRights: "none" }, null],
    [{ shipRights: "open_prs" }, null],
    [{ shipRights: "merge" }, "shipRights"],
    [{ roadmapApproval: "ask" }, null],
    [{ roadmapApproval: "rules" }, null],
    [{ roadmapApproval: "all" }, "roadmapApproval"],
    [{ usageLimit: "stop" }, null],
    [{ usageLimit: "wait" }, null],
    [{ roadmapApproval: "ask", concurrencyCap: 9 }, "concurrencyCap"],
  ];
  for (const [override, expected] of cases) {
    assert.equal(
      widerOverrideField(policy, override),
      expected,
      JSON.stringify(override),
    );
  }
  const strict = { ...policy, usageLimit: "stop" as const };
  assert.equal(
    widerOverrideField(strict, { usageLimit: "wait" }),
    "usageLimit",
  );
  const unlimited = { ...policy, budgetPerGroup: null };
  assert.equal(widerOverrideField(unlimited, { budgetPerGroup: null }), null);
  assert.equal(widerOverrideField(unlimited, { budgetPerGroup: 100 }), null);
});

void test("effective policy takes the narrower value per field, even after the board narrows", () => {
  const extra = record(
    "x",
    "extra",
    { groupIds: ["SBX-1"] },
    { concurrencyCap: 2, shipRights: "none", roadmapApproval: "ask" },
  );
  assert.deepEqual(effectivePolicy(policy, extra), {
    ...policy,
    concurrencyCap: 2,
    shipRights: "none",
    roadmapApproval: "ask",
  });
  const narrowed = { ...policy, concurrencyCap: 1 };
  assert.equal(effectivePolicy(narrowed, extra).concurrencyCap, 1);
  assert.deepEqual(effectivePolicy(policy, undefined), policy);
  assert.deepEqual(effectivePolicy(policy, main), policy);
});

void test("ownership: an extra owns the groups in its scope, the main owns the rest", () => {
  const records = [main, infra, web];
  assert.equal(groupOwner(records, { id: "SBX-9" }), "infra");
  assert.equal(groupOwner(records, { id: "SBX-7" }), "main");
  assert.equal(groupOwner([], { id: "SBX-9" }), null);
});

void test("ownership: a group an extra created and the user then moved to the main is owned by the main", () => {
  const created = {
    id: "SBX-7",
    source: "group" as const,
    ownerOrchestrator: "web",
  };
  const moved = [main, infra, web];
  assert.equal(groupOwner(moved, created), "main");
  assert.equal(cardOwner(moved, created, undefined), "main");
  assert.equal(
    cardOwner(
      moved,
      { id: "SBX-8", source: "local", groupId: "SBX-7" },
      created,
    ),
    "main",
  );
});

void test("ownership: a member follows its group and a loose ticket follows the ticket scope", () => {
  const records = [main, infra, web];
  const group = { id: "SBX-9" };
  assert.equal(
    cardOwner(records, { id: "SBX-9", source: "group" }, undefined),
    "infra",
  );
  assert.equal(
    cardOwner(
      records,
      { id: "SBX-10", source: "local", groupId: "SBX-9" },
      group,
    ),
    "infra",
  );
  assert.equal(
    cardOwner(records, { id: "SBX-3", source: "local" }, undefined),
    "web",
  );
  assert.equal(
    cardOwner(records, { id: "SBX-4", source: "local" }, undefined),
    "main",
  );
  assert.equal(
    cardOwner([], { id: "SBX-4", source: "local" }, undefined),
    null,
  );
});

void test("ship: only the main ships once records exist", () => {
  assert.equal(mayShip([main, infra], "main"), true);
  assert.equal(mayShip([main, infra], "infra"), false);
  assert.equal(mayShip([main, infra], "stranger"), false);
  assert.equal(mayShip([], "anyone"), true);
});
