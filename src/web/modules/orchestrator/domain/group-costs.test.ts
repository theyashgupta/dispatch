import assert from "node:assert/strict";
import { test } from "node:test";
import type { CentreBranch, CentreGraph } from "./centre-graph.js";
import { withGroupCosts } from "./group-costs.js";

function branch(
  id: string,
  cardId: string | null,
  cost: number | null,
): CentreBranch {
  return {
    id,
    cardId,
    identifier: id,
    title: id,
    state: "running",
    label: "Running",
    tone: "neutral",
    band: "running",
    actions: [],
    detail: null,
    contextPercent: null,
    cost,
    playbook: null,
    planOrder: null,
    planSize: null,
    memberCount: null,
    stateSince: null,
    slot: 0,
  };
}

function graphOf(branches: CentreBranch[]): CentreGraph {
  return {
    centre: null,
    branches,
    bands: [
      { key: "running", label: "Running", branches, count: branches.length },
    ],
    edges: [],
  };
}

const GROUPS = [{ cardId: "g1", cost: 12.3, budget: 20 }];

test("a branch whose card is a group gets the group cost and budget", () => {
  const out = withGroupCosts(graphOf([branch("a", "g1", 1)]), GROUPS);
  assert.equal(out.branches[0]?.cost, 12.3);
  assert.equal(out.branches[0]?.budget, 20);
  assert.equal(out.bands[0]?.branches[0]?.cost, 12.3);
  assert.equal(out.bands[0]?.branches[0]?.budget, 20);
});

test("a branch not in the groups keeps its session cost and has no budget", () => {
  const own = branch("b", "c1", 2.5);
  const out = withGroupCosts(graphOf([own]), GROUPS);
  assert.equal(out.branches[0], own);
  assert.equal(out.branches[0]?.cost, 2.5);
  assert.equal(out.branches[0]?.budget, undefined);
});

test("a planned group branch with no cost stays unchanged, so it keeps Not started", () => {
  const notStarted = { ...branch("n", "g1", null), state: "planned" as const };
  const out = withGroupCosts(graphOf([notStarted]), [
    { cardId: "g1", cost: 0, budget: 20 },
  ]);
  assert.equal(out.branches[0], notStarted);
  assert.equal(out.bands[0]?.branches[0], notStarted);
});

test("a running group branch with no session cost shows the group cost of 0 and its budget", () => {
  const out = withGroupCosts(graphOf([branch("r", "g1", null)]), [
    { cardId: "g1", cost: 0, budget: 20 },
  ]);
  assert.equal(out.branches[0]?.cost, 0);
  assert.equal(out.branches[0]?.budget, 20);
});

test("a planned branch with no card is unchanged", () => {
  const planned = branch("p", null, null);
  const out = withGroupCosts(graphOf([planned]), GROUPS);
  assert.equal(out.branches[0], planned);
});
