import test from "node:test";
import assert from "node:assert/strict";
import type { OrchestratorRecord } from "./types.js";
import {
  cardOwner,
  groupOwner,
  isGroupMember,
  kindLabel,
  orchestratorKind,
  scopeLabel,
} from "./orchestrator-owner.js";

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

void test("kind: a record without a stored kind has the kind of its role, a stored kind wins", () => {
  assert.equal(orchestratorKind(main), "board");
  assert.equal(orchestratorKind(infra), "feature");
  assert.equal(orchestratorKind({ ...infra, kind: "board" }), "board");
});

void test("scope label: a board orchestrator reads Board, a feature orchestrator counts its cards", () => {
  const feature = (scope: Partial<OrchestratorRecord["scope"]>) =>
    record("feature", "extra", scope);
  const cards = [
    { id: "SBX-9", source: "group" as const },
    { id: "SBX-3", source: "local" as const },
    { id: "SBX-4", source: "local" as const },
  ];
  assert.equal(scopeLabel(main, cards), "Board");
  assert.equal(scopeLabel({ ...infra, kind: "board" }, cards), "Board");
  assert.equal(scopeLabel(feature({}), cards), "Feature, 0 cards");
  assert.equal(
    scopeLabel(feature({ ticketIds: ["SBX-3"] }), cards),
    "Feature, 1 card",
  );
  assert.equal(
    scopeLabel(
      feature({ groupIds: ["SBX-9"], ticketIds: ["SBX-3", "SBX-4"] }),
      cards,
    ),
    "Feature, 3 cards",
  );
  assert.equal(
    scopeLabel(feature({ groupIds: ["SBX-9"], ticketIds: ["SBX-3"] }), cards),
    "Feature, 2 cards",
  );
});

void test("scope label: a ticket that joined a group is not counted", () => {
  const cards = [{ id: "SBX-3", source: "local" as const, groupId: "SBX-9" }];
  assert.equal(
    scopeLabel(record("f", "extra", { ticketIds: ["SBX-3"] }), cards),
    "Feature, 0 cards",
  );
});

void test("scope label: a group id with no card is not counted", () => {
  assert.equal(
    scopeLabel(record("f", "extra", { groupIds: ["SBX-9"] }), []),
    "Feature, 0 cards",
  );
});

void test("scope label: a hidden card is not counted", () => {
  const cards = [{ id: "SBX-3", source: "orchestrator" as const }];
  assert.equal(
    scopeLabel(record("f", "extra", { ticketIds: ["SBX-3"] }), cards),
    "Feature, 0 cards",
  );
});

void test("kind label: Board for a board orchestrator, Feature for a feature orchestrator", () => {
  assert.equal(kindLabel(main), "Board");
  assert.equal(kindLabel(infra), "Feature");
  assert.equal(kindLabel({ ...infra, kind: "board" }), "Board");
  assert.equal(kindLabel({ ...main, kind: "feature" }), "Feature");
});

void test("group member: a non-group card with a group id is a member", () => {
  assert.equal(isGroupMember({ source: "local", groupId: "SBX-9" }), true);
  assert.equal(isGroupMember({ source: "local" }), false);
  assert.equal(isGroupMember({ source: "group" }), false);
  assert.equal(isGroupMember({ source: "group", groupId: "SBX-9" }), false);
});
