import assert from "node:assert/strict";
import { test } from "node:test";
import { ADD_TOOLTIP, entryModel } from "./entry-model.js";

test("no board record gives no entry button", () => {
  assert.equal(entryModel(null), null);
});

test("a board with no orchestrator offers Add orchestrator with its tooltip", () => {
  assert.deepEqual(entryModel({ orchestrators: [] }), {
    hasOrchestrator: false,
    label: "Add orchestrator",
    tooltip: ADD_TOOLTIP,
  });
  assert.equal(
    ADD_TOOLTIP,
    "Add an orchestrator to plan tickets and run loops on this board.",
  );
});

test("a board with an orchestrator offers Orchestrator with no tooltip", () => {
  const record = { id: "main" } as never;
  assert.deepEqual(entryModel({ orchestrators: [record] }), {
    hasOrchestrator: true,
    label: "Orchestrator",
    tooltip: null,
  });
});
