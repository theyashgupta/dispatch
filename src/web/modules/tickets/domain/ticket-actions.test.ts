import assert from "node:assert/strict";
import { test } from "node:test";
import type { Column } from "../../../../shared/types.js";
import { ticketActionsFor } from "./ticket-actions.js";

const COLUMNS: readonly Column[] = [
  "todo",
  "in_progress",
  "needs_input",
  "agent_done",
  "in_review",
  "parked",
  "done",
  "inbox",
];

test("start is offered only for a To Do card", () => {
  for (const column of COLUMNS) {
    const actions = ticketActionsFor({ column, url: undefined });
    assert.equal(actions.includes("start"), column === "todo", column);
  }
});

test("done is withheld for Inbox, Done and Agent Done cards", () => {
  for (const column of COLUMNS) {
    const actions = ticketActionsFor({ column, url: undefined });
    assert.equal(
      actions.includes("done"),
      column !== "inbox" && column !== "done" && column !== "agent_done",
      column,
    );
  }
});

test("a grouped member or a card mid-start offers neither start nor done", () => {
  for (const column of ["todo", "in_review"] as const) {
    const grouped = ticketActionsFor({ column, url: undefined, groupId: "g1" });
    const starting = ticketActionsFor({
      column,
      url: undefined,
      provisioningStep: "Creating worktrees",
    });
    assert.deepEqual(grouped, [], column);
    assert.deepEqual(starting, [], column);
  }
});

test("open is offered only for an http or https url, for every column", () => {
  for (const column of COLUMNS) {
    assert.equal(
      ticketActionsFor({ column, url: "https://linear.app/x" }).includes(
        "open",
      ),
      true,
      column,
    );
    assert.equal(
      ticketActionsFor({ column, url: undefined }).includes("open"),
      false,
      column,
    );
  }
  assert.equal(
    ticketActionsFor({
      column: "todo",
      url: "http://127.0.0.1:47931/ENG-1",
    }).includes("open"),
    true,
  );
  for (const url of ["javascript:alert(1)", "data:text/html,x", "not a url"]) {
    assert.equal(
      ticketActionsFor({ column: "todo", url }).includes("open"),
      false,
      url,
    );
  }
});
