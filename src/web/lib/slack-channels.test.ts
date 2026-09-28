import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addChannelRow,
  addPicked,
  filterChannelRows,
  mergeChannelRows,
  samePicked,
} from "./slack-channels.js";

const listed = [
  { id: "C0G6GEN", name: "general", private: false },
  { id: "G0G6SEC", name: "security", private: true },
  { id: "C0G6ENG", name: "eng-platform", private: false },
];

test("merge sorts by name and flags saved channels Slack no longer lists", () => {
  const rows = mergeChannelRows(listed, [
    { id: "C0G6ENG", name: "eng-platform" },
    { id: "C0G6OLD", name: "archived-team" },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.private, r.notListed]),
    [
      ["archived-team", false, true],
      ["eng-platform", false, false],
      ["general", false, false],
      ["security", true, false],
    ],
  );
});

test("merge keeps one row per id", () => {
  const rows = mergeChannelRows(
    [...listed, { id: "C0G6GEN", name: "general", private: false }],
    [{ id: "C0G6GEN", name: "general" }],
  );
  assert.equal(rows.filter((r) => r.id === "C0G6GEN").length, 1);
});

test("filter matches the name case-insensitively and keeps every row when empty", () => {
  const rows = mergeChannelRows(listed, []);
  assert.deepEqual(
    filterChannelRows(rows, "ENG").map((r) => r.id),
    ["C0G6ENG"],
  );
  assert.equal(filterChannelRows(rows, "  ").length, 3);
  assert.equal(filterChannelRows(rows, "zzz").length, 0);
});

test("addPicked never adds the same channel twice", () => {
  const once = addPicked([], { id: "C0G6ENG", name: "eng-platform" });
  const twice = addPicked(once, { id: "C0G6ENG", name: "eng-platform" });
  assert.deepEqual(twice, [{ id: "C0G6ENG", name: "eng-platform" }]);
});

test("samePicked compares ids regardless of order", () => {
  const a = [
    { id: "C1", name: "a" },
    { id: "C2", name: "b" },
  ];
  assert.ok(samePicked(a, [...a].reverse()));
  assert.ok(!samePicked(a, [a[0]]));
  assert.ok(!samePicked(a, [a[0], { id: "C3", name: "c" }]));
});

test("addChannelRow inserts a pasted channel as listed and keeps the other rows' flags", () => {
  const rows = mergeChannelRows([], [{ id: "C0G6ENG", name: "eng-platform" }]);
  const next = addChannelRow(rows, { id: "C0G6GEN", name: "general" });
  assert.deepEqual(
    next.map((r) => [r.id, r.notListed]),
    [
      ["C0G6ENG", true],
      ["C0G6GEN", false],
    ],
  );
  assert.equal(
    addChannelRow(next, { id: "C0G6GEN", name: "general" }).length,
    2,
  );
});
