import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey } from "../../../../shared/types.js";
import { attentionLabel, loopsLabel, switcherItems } from "./board-switcher.js";

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
