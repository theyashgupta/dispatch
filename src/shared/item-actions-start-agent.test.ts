import assert from "node:assert/strict";
import { test } from "node:test";
import { startAgentFor, type StartAgentDeps } from "./item-actions.js";
import type { StartRequest } from "./start-request.js";
import type { Card, Column } from "./types.js";

function setup(column: Column = "todo", fail?: "promote" | "move" | "open") {
  const log: string[] = [];
  const opened: StartRequest[] = [];
  const notices: string[] = [];
  const deps: StartAgentDeps = {
    promoteItem: (id, context) => {
      log.push(`promote:${id}:${context ?? ""}`);
      if (fail === "promote")
        return Promise.reject(new Error("promote failed"));
      return Promise.resolve({
        card: { id: "card-1", column } as unknown as Card,
      });
    },
    moveCard: (id, to) => {
      log.push(`move:${id}:${to}`);
      if (fail === "move") return Promise.reject(new Error("move failed"));
      return Promise.resolve();
    },
    openStart: (request) => {
      if (fail === "open") throw new Error("open failed");
      opened.push(request);
    },
    notice: (text) => notices.push(text),
  };
  return { deps, log, opened, notices };
}

const FAILURE = "Couldn't start the agent. Try again.";

test("a card target opens a new session without promoting", async () => {
  const s = setup();
  await startAgentFor(s.deps, { cardId: "c9" }, "go");
  assert.deepEqual(s.opened, [
    { cardId: "c9", newSession: true, extraDirection: "go" },
  ]);
  assert.deepEqual(s.log, []);
  assert.deepEqual(s.notices, []);
});

test("a card target wins over an item id", async () => {
  const s = setup();
  await startAgentFor(s.deps, { cardId: "c9", itemId: "i1" }, "go");
  assert.equal(s.opened[0]?.cardId, "c9");
  assert.deepEqual(s.log, []);
});

test("an empty target does nothing", async () => {
  const s = setup();
  await startAgentFor(s.deps, {}, "go");
  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.log, []);
  assert.deepEqual(s.notices, []);
});

test("an item is promoted with its context, then start opens for the new card", async () => {
  const s = setup("todo");
  await startAgentFor(s.deps, { itemId: "i1" }, "dir", "ctx");
  assert.deepEqual(s.log, ["promote:i1:ctx"]);
  assert.deepEqual(s.opened, [{ cardId: "card-1", extraDirection: "dir" }]);
  assert.deepEqual(s.notices, []);
});

test("a promoted card that lands in the inbox moves to todo first", async () => {
  const s = setup("inbox");
  await startAgentFor(s.deps, { itemId: "i1" }, "dir");
  assert.deepEqual(s.log, ["promote:i1:", "move:card-1:todo"]);
  assert.deepEqual(s.opened, [{ cardId: "card-1", extraDirection: "dir" }]);
});

test("a promote failure shows one notice and opens nothing", async () => {
  const s = setup("todo", "promote");
  await startAgentFor(s.deps, { itemId: "i1" }, "dir");
  assert.deepEqual(s.notices, [FAILURE]);
  assert.deepEqual(s.opened, []);
});

test("a move failure shows one notice and opens nothing", async () => {
  const s = setup("inbox", "move");
  await startAgentFor(s.deps, { itemId: "i1" }, "dir");
  assert.deepEqual(s.notices, [FAILURE]);
  assert.deepEqual(s.opened, []);
});

test("an openStart failure on a card target shows the notice", async () => {
  const s = setup("todo", "open");
  await startAgentFor(s.deps, { cardId: "c9" }, "dir");
  assert.deepEqual(s.notices, [FAILURE]);
});
