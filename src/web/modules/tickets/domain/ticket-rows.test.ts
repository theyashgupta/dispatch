import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../../shared/types.js";
import {
  filterTicketRows,
  groupTicketRows,
  parseTicketsGroupBy,
  TICKETS_GROUP_BY,
  TICKETS_GROUP_BY_KEY,
  ticketRows,
} from "./ticket-rows.js";

const NOW = Date.parse("2026-09-28T12:00:00Z");

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    issueId: id,
    identifier: id,
    title: `Card ${id}`,
    description: null,
    priority: 3,
    column: "todo",
    updatedAt: new Date(NOW - 60_000).toISOString(),
    ...extra,
  };
}

const ENG = { id: "team-eng", key: "ENG", name: "Engineering" };
const OPS = { id: "team-ops", key: "OPS", name: "Operations" };

const labels = (groups: { label: string }[]) => groups.map((g) => g.label);
const ids = (rows: Card[]) => rows.map((r) => r.id);

test("local cards and group cards never become rows; source-less and member cards do", () => {
  const rows = ticketRows([
    card("L-1", { source: "local" }),
    card("G-1", { source: "linear", memberIds: ["ENG-1"] }),
    card("ENG-1", { source: "linear", groupId: "G-1" }),
    card("ENG-2"),
  ]);
  assert.deepEqual(ids(rows).sort(), ["ENG-1", "ENG-2"]);
});

test("rows order by priority 1, 2, 3, 4 then 0, newest first inside a priority, id last", () => {
  const at = (minutes: number) =>
    new Date(NOW - minutes * 60_000).toISOString();
  const rows = ticketRows([
    card("none", { priority: 0, updatedAt: at(1) }),
    card("low", { priority: 4 }),
    card("med-old", { priority: 3, updatedAt: at(10) }),
    card("med-new", { priority: 3, updatedAt: at(2) }),
    card("high", { priority: 2 }),
    card("urgent-b", { priority: 1, updatedAt: at(5) }),
    card("urgent-a", { priority: 1, updatedAt: at(5) }),
  ]);
  assert.deepEqual(ids(rows), [
    "urgent-a",
    "urgent-b",
    "high",
    "med-new",
    "med-old",
    "low",
    "none",
  ]);
});

test("the query matches identifier and title case-insensitively; a blank query keeps all", () => {
  const rows = [
    card("ENG-12", { identifier: "ENG-12", title: "Fix login" }),
    card("OPS-3", { identifier: "OPS-3", title: "Rotate keys" }),
  ];
  assert.deepEqual(ids(filterTicketRows(rows, "eng-1")), ["ENG-12"]);
  assert.deepEqual(ids(filterTicketRows(rows, "  ROTATE ")), ["OPS-3"]);
  assert.deepEqual(ids(filterTicketRows(rows, "   ")), ["ENG-12", "OPS-3"]);
  assert.deepEqual(filterTicketRows(rows, "zzz"), []);
});

test("status groups follow the state type order, then name, with No status last", () => {
  const rows = [
    card("a", { linearState: { name: "Done", type: "completed" } }),
    card("b", { linearState: { name: "Todo", type: "unstarted" } }),
    card("c", { linearState: null }),
    card("d", { linearState: { name: "In Review", type: "started" } }),
    card("e", { linearState: { name: "In Progress", type: "started" } }),
    card("f", { linearState: { name: "Backlog", type: "backlog" } }),
    card("g", { linearState: { name: "Canceled", type: "canceled" } }),
    card("h", { linearState: { name: "Triage", type: "triage" } }),
    card("i", { linearState: { name: "Todo", type: "unstarted" } }),
  ];
  const groups = groupTicketRows(rows, "status");
  assert.deepEqual(labels(groups), [
    "Triage",
    "Backlog",
    "Todo",
    "In Progress",
    "In Review",
    "Done",
    "Canceled",
    "No status",
  ]);
  assert.deepEqual(ids(groups[2]?.rows ?? []), ["b", "i"]);
});

test("priority groups read Urgent, High, Medium, Low, then No priority", () => {
  const groups = groupTicketRows(
    [
      card("n", { priority: 0 }),
      card("l", { priority: 4 }),
      card("u", { priority: 1 }),
      card("m", { priority: 3 }),
      card("h", { priority: 2 }),
    ],
    "priority",
  );
  assert.deepEqual(labels(groups), [
    "Urgent",
    "High",
    "Medium",
    "Low",
    "No priority",
  ]);
});

test("project and team group by name with No project and No team last", () => {
  const rows = [
    card("a", { project: { id: "p-web", name: "Web" }, team: OPS }),
    card("b"),
    card("c", { project: { id: "p-core", name: "Core" }, team: ENG }),
    card("d", { project: { id: "p-web", name: "Web" }, team: ENG }),
  ];
  const projects = groupTicketRows(rows, "project");
  assert.deepEqual(labels(projects), ["Core", "Web", "No project"]);
  assert.deepEqual(ids(projects[1]?.rows ?? []), ["a", "d"]);
  assert.deepEqual(labels(groupTicketRows(rows, "team")), [
    "Engineering",
    "Operations",
    "No team",
  ]);
});

test("cycles group as Cycle <n> by number with No cycle last", () => {
  const groups = groupTicketRows(
    [
      card("a", { cycle: 15 }),
      card("b"),
      card("c", { cycle: 9 }),
      card("d", { cycle: 14 }),
    ],
    "cycle",
  );
  assert.deepEqual(labels(groups), [
    "Cycle 9",
    "Cycle 14",
    "Cycle 15",
    "No cycle",
  ]);
});

test("cycle 0 forms its own group and an empty memberIds still counts as a ticket", () => {
  const rows = ticketRows([
    card("z", { cycle: 0 }),
    card("e", { memberIds: [] }),
  ]);
  assert.deepEqual(ids(rows).sort(), ["e", "z"]);
  assert.deepEqual(labels(groupTicketRows(rows, "cycle")), [
    "Cycle 0",
    "No cycle",
  ]);
});

test("none is one group with every row in order, and no rows gives no groups", () => {
  const rows = [card("a"), card("b")];
  const groups = groupTicketRows(rows, "none");
  assert.equal(groups.length, 1);
  assert.deepEqual(ids(groups[0]?.rows ?? []), ["a", "b"]);
  assert.deepEqual(groupTicketRows([], "status"), []);
});

test("parseTicketsGroupBy keeps a known value and lands on status for anything else", () => {
  assert.equal(parseTicketsGroupBy("cycle"), "cycle");
  assert.equal(parseTicketsGroupBy("none"), "none");
  assert.equal(parseTicketsGroupBy(null), "status");
  assert.equal(parseTicketsGroupBy("__proto__"), "status");
  assert.equal(parseTicketsGroupBy(""), "status");
});

test("TICKETS_GROUP_BY_KEY is the persisted storage key", () => {
  assert.equal(TICKETS_GROUP_BY_KEY, "dsp.tickets.groupBy");
});

test("parseTicketsGroupBy returns the default for null, an empty string and an unknown value", () => {
  assert.equal(parseTicketsGroupBy(null), "status");
  assert.equal(parseTicketsGroupBy(""), "status");
  assert.equal(parseTicketsGroupBy("unknown"), "status");
});

test("parseTicketsGroupBy returns each valid value unchanged", () => {
  for (const by of TICKETS_GROUP_BY) {
    assert.equal(parseTicketsGroupBy(by), by);
  }
});
