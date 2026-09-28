import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultTeamId,
  stateChipColor,
  stateTypeRank,
  teamCycleLabel,
} from "./linear-state.js";

test("each state type without a color falls back to its token", () => {
  assert.equal(stateChipColor({ type: "unstarted" }), "var(--col-todo)");
  assert.equal(stateChipColor({ type: "triage" }), "var(--col-todo)");
  assert.equal(stateChipColor({ type: "backlog" }), "var(--col-todo)");
  assert.equal(stateChipColor({ type: "started" }), "var(--prio-medium)");
  assert.equal(stateChipColor({ type: "completed" }), "var(--col-in-review)");
  assert.equal(stateChipColor({ type: "canceled" }), "var(--col-done)");
  assert.equal(stateChipColor({ type: "mystery" }), "var(--text-muted)");
});

test("a 6-digit hex color from Linear wins over the fallback", () => {
  assert.equal(
    stateChipColor({ type: "started", color: "#f2c94c" }),
    "#f2c94c",
  );
  assert.equal(
    stateChipColor({ type: "completed", color: "#4CB782" }),
    "#4CB782",
  );
});

test("a non-hex color string never reaches the style value", () => {
  for (const color of ["red", "#fff", "url(x)", "#f2c94c; x", ""]) {
    assert.equal(
      stateChipColor({ type: "started", color }),
      "var(--prio-medium)",
      color,
    );
  }
});

test("team and cycle text covers each part and hides when both are absent", () => {
  assert.equal(teamCycleLabel({ key: "ENG" }, 14), "ENG · Cycle 14");
  assert.equal(teamCycleLabel({ key: "ENG" }, undefined), "ENG");
  assert.equal(teamCycleLabel(undefined, 3), "Cycle 3");
  assert.equal(teamCycleLabel(undefined, undefined), null);
  assert.equal(teamCycleLabel(null, null), null);
});

test("state types rank in workflow order with unknown types last", () => {
  const types = ["canceled", "started", "mystery", "triage", "unstarted"];
  assert.deepEqual(
    [...types].sort((a, b) => stateTypeRank(a) - stateTypeRank(b)),
    ["triage", "unstarted", "started", "canceled", "mystery"],
  );
});

const TEAMS = [{ id: "team-a" }, { id: "team-b" }];
const team = (id: string) => ({ id, key: id.toUpperCase(), name: id });

test("defaultTeamId picks the team of the most recently updated card", () => {
  const cards = [
    { team: team("team-a"), updatedAt: "2026-09-20T00:00:00.000Z" },
    { team: team("team-b"), updatedAt: "2026-09-24T00:00:00.000Z" },
    { team: undefined, updatedAt: "2026-09-25T00:00:00.000Z" },
  ];
  assert.equal(defaultTeamId(cards, TEAMS), "team-b");
});

test("defaultTeamId ignores a team id that is not in the list", () => {
  const cards = [
    { team: team("team-gone"), updatedAt: "2026-09-25T00:00:00.000Z" },
    { team: team("team-a"), updatedAt: "2026-09-01T00:00:00.000Z" },
  ];
  assert.equal(defaultTeamId(cards, TEAMS), "team-a");
});

test("defaultTeamId falls back to the first team, and to undefined with no teams", () => {
  assert.equal(
    defaultTeamId(
      [{ team: undefined, updatedAt: "2026-09-25T00:00:00.000Z" }],
      TEAMS,
    ),
    "team-a",
  );
  assert.equal(defaultTeamId([], []), undefined);
});
