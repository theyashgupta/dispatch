import test from "node:test";
import assert from "node:assert/strict";
import type { OrchestratorRecord } from "./types.js";
import { cardOwner, groupOwner } from "./orchestrator-owner.js";

function record(
  id: string,
  role: "main" | "extra",
  scope: Partial<OrchestratorRecord["scope"]> = {},
): OrchestratorRecord {
  return {
    id,
    name: id,
    role,
    scope: { groupIds: [], ticketIds: [], ...scope },
    policyOverride: {},
    cardId: null,
    state: "stopped",
    createdAt: "2026-10-07T00:00:00.000Z",
  };
}

const main = record("main", "main");
const infra = record("infra", "extra", { groupIds: ["SBX-9"] });
const web = record("web", "extra", { ticketIds: ["SBX-3"] });

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
