import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey, OrchestratorRecord } from "../../../../shared/types.js";
import {
  attentionLabel,
  dashboardItems,
  loopsLabel,
  switcherItems,
} from "./board-switcher.js";

const LOCAL = "LOCAL" as BoardKey;
const ACME = "ACME" as BoardKey;
const OLD = "OLD" as BoardKey;

const boards = [
  { key: LOCAL, name: "Dispatch", archived: false },
  { key: OLD, name: "Old", archived: true },
  { key: ACME, name: "Acme", archived: false },
];

const loop = (groupId: string) => ({ groupId, percent: null });

test("switcherItems lists active boards in order with counts and the selected mark", () => {
  const counts = [
    { key: LOCAL, running: 0, openGroups: 0, attention: 2, loops: [] },
    {
      key: ACME,
      running: 1,
      openGroups: 0,
      attention: 0,
      loops: [loop("g1"), loop("g2")],
    },
  ];
  assert.deepEqual(switcherItems(boards, counts, ACME), [
    { key: LOCAL, name: "Dispatch", attention: 2, loops: 0, selected: false },
    { key: ACME, name: "Acme", attention: 0, loops: 2, selected: true },
  ]);
});

test("switcherItems never lists an archived board, even the selected one", () => {
  assert.deepEqual(
    switcherItems(boards, undefined, OLD).map((item) => item.key),
    [LOCAL, ACME],
  );
  assert.equal(
    switcherItems(boards, undefined, OLD).some((item) => item.selected),
    false,
  );
});

test("switcherItems reads zero counts before the counts load", () => {
  const items = switcherItems(boards, undefined, LOCAL);
  assert.deepEqual(
    items.map((item) => [item.attention, item.loops]),
    [
      [0, 0],
      [0, 0],
    ],
  );
});

test("attentionLabel names the count", () => {
  assert.equal(attentionLabel(3), "3 items need attention");
  assert.equal(attentionLabel(1), "1 item needs attention");
  assert.equal(attentionLabel(1284), "1,284 items need attention");
});

test("loopsLabel names the count", () => {
  assert.equal(loopsLabel(1), "1 running loop");
  assert.equal(loopsLabel(2), "2 running loops");
});

const record = (role: OrchestratorRecord["role"]): OrchestratorRecord => ({
  id: `o-${role}`,
  name: role,
  role,
  scope: { groupIds: [], ticketIds: [] },
  policyOverride: {},
  cardId: null,
  state: "stopped",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const withOrchestrators = [
  { ...boards[0], orchestrators: [record("main")] },
  { ...boards[1], orchestrators: [record("main")] },
  { ...boards[2], orchestrators: [record("extra")] },
  { key: "ZED" as BoardKey, name: "Zed", archived: false, orchestrators: [] },
  {
    key: "BEE" as BoardKey,
    name: "Bee",
    archived: false,
    orchestrators: [record("extra"), record("main")],
  },
];

const BEE = "BEE" as BoardKey;
const ZED = "ZED" as BoardKey;

test("dashboardItems lists active boards with a main record in input order", () => {
  assert.deepEqual(
    dashboardItems(withOrchestrators, undefined, {
      page: "board",
      board: LOCAL,
    }).map((item) => item.key),
    [LOCAL, BEE],
  );
});

test("dashboardItems skips a board with only extra records, none, or an archived main", () => {
  const keys = dashboardItems(withOrchestrators, undefined, {
    page: "board",
    board: LOCAL,
  }).map((item) => item.key);
  assert.equal(keys.includes(ACME), false);
  assert.equal(keys.includes(ZED), false);
  assert.equal(keys.includes(OLD), false);
});

test("dashboardItems takes attention from counts", () => {
  const counts = [
    { key: BEE, running: 0, openGroups: 0, attention: 4, loops: [] },
  ];
  assert.deepEqual(
    dashboardItems(withOrchestrators, counts, {
      page: "board",
      board: LOCAL,
    }).map((item) => [item.key, item.attention]),
    [
      [LOCAL, 0],
      [BEE, 4],
    ],
  );
});

test("dashboardItems selects only the route board row on the dashboard page", () => {
  assert.deepEqual(
    dashboardItems(withOrchestrators, undefined, {
      page: "dashboard",
      board: BEE,
    }).map((item) => [item.key, item.selected]),
    [
      [LOCAL, false],
      [BEE, true],
    ],
  );
});

test("dashboardItems selects no row on the board page", () => {
  assert.equal(
    dashboardItems(withOrchestrators, undefined, {
      page: "board",
      board: BEE,
    }).some((item) => item.selected),
    false,
  );
});

test("dashboardItems selects no row on the dashboard page of a board without a main orchestrator", () => {
  assert.equal(
    dashboardItems(withOrchestrators, undefined, {
      page: "dashboard",
      board: ZED,
    }).some((item) => item.selected),
    false,
  );
});
