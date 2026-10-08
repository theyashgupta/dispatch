import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Column } from "../../../../shared/types.js";
import {
  filterCards,
  groupOptions,
  ticketsByColumn,
} from "./tickets-by-column.js";

function card(id: string, column: Column, extra: Partial<Card> = {}): Card {
  return { id, identifier: id, column, ...extra } as Card;
}

const CARDS = [
  card("g1", "in_progress"),
  card("a", "todo", { groupId: "g1", createdByOrchestrator: "o1" }),
  card("b", "todo", { groupId: "g1" }),
  card("c", "todo", { createdByOrchestrator: "o1" }),
  card("d", "done", { groupId: "g2" }),
  card("e", "inbox"),
];

test("rows come in board order and skip inbox", () => {
  const rows = ticketsByColumn(CARDS);
  assert.deepEqual(
    rows.map((r) => r.label),
    [
      "To Do",
      "In Progress",
      "Needs Input",
      "Agent Done",
      "In Review",
      "Parked",
      "Done",
    ],
  );
  assert.deepEqual(
    rows.map((r) => r.cards.length),
    [3, 1, 0, 0, 0, 0, 1],
  );
});

test("counts the cards created by an orchestrator", () => {
  const todo = ticketsByColumn(CARDS)[0];
  assert.equal(todo?.column, "todo");
  assert.equal(todo?.byOrchestrator, 2);
});

test("filterCards matches members and the group card itself", () => {
  assert.deepEqual(
    filterCards(CARDS, { groupId: "g1" }).map((c) => c.id),
    ["g1", "a", "b"],
  );
  assert.deepEqual(
    filterCards(CARDS, { groupId: "g1", column: "todo" }).map((c) => c.id),
    ["a", "b"],
  );
  assert.equal(filterCards(CARDS, {}).length, CARDS.length);
});

test("groupOptions lists the cards that others name as their group and the cards with a loop", () => {
  const withLoop = card("g3", "todo", { loopProgress: {} as never });
  assert.deepEqual(groupOptions([...CARDS, withLoop]), [
    { id: "g1", label: "g1" },
    { id: "g3", label: "g3" },
  ]);
});

test("groupOptions orders group ids by their number", () => {
  const loop = { loopProgress: {} as never };
  assert.deepEqual(
    groupOptions([
      card("GROUP-10", "todo", loop),
      card("GROUP-9", "todo", loop),
    ]).map((option) => option.label),
    ["GROUP-9", "GROUP-10"],
  );
});
