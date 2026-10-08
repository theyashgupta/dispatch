import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ORCHESTRATOR_MODEL,
  isLoopModel,
  isOrchestratorModel,
  LOOP_MODEL_VALUES,
  normalizeOrchestratorModel,
  ORCHESTRATOR_MODELS,
} from "./orchestrator-models.js";

test("the list holds Opus 5.5, Sonnet 5.5 and Fable 5.1 with Opus as the default", () => {
  assert.deepEqual(
    ORCHESTRATOR_MODELS.map((m) => [m.id, m.label]),
    [
      ["claude-opus-5-5", "Opus 5.5"],
      ["claude-sonnet-5-5", "Sonnet 5.5"],
      ["claude-fable-5-1", "Fable 5.1"],
    ],
  );
  assert.equal(DEFAULT_ORCHESTRATOR_MODEL, "claude-opus-5-5");
});

test("the loop model values are each model at high and max effort", () => {
  assert.deepEqual(LOOP_MODEL_VALUES, [
    "claude-opus-5-5:high",
    "claude-opus-5-5:max",
    "claude-sonnet-5-5:high",
    "claude-sonnet-5-5:max",
    "claude-fable-5-1:high",
    "claude-fable-5-1:max",
  ]);
});

test("an orchestrator model is a listed id or the legacy name opus", () => {
  const table: [string, boolean][] = [
    ["claude-opus-5-5", true],
    ["claude-sonnet-5-5", true],
    ["claude-fable-5-1", true],
    ["opus", true],
    ["sonnet", false],
    ["claude-opus-4", false],
    ["", false],
    ["claude-opus-5-5:high", false],
  ];
  for (const [value, ok] of table) {
    assert.equal(isOrchestratorModel(value), ok, value);
  }
});

test("a loop model is null or a listed value", () => {
  const table: [string | null, boolean][] = [
    [null, true],
    ["claude-opus-5-5:high", true],
    ["claude-fable-5-1:max", true],
    ["claude-opus-5-5", false],
    ["claude-opus-5-5:low", false],
    ["opus", false],
    ["", false],
  ];
  for (const [value, ok] of table) {
    assert.equal(isLoopModel(value), ok, String(value));
  }
});

test("the legacy name maps to Opus 5.5 and other values stay", () => {
  assert.equal(normalizeOrchestratorModel("opus"), "claude-opus-5-5");
  assert.equal(
    normalizeOrchestratorModel("claude-fable-5-1"),
    "claude-fable-5-1",
  );
  assert.equal(normalizeOrchestratorModel("toString"), "toString");
});
