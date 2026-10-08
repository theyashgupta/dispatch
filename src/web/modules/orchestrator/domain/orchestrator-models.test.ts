import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOrchestratorModel } from "../../../../shared/orchestrator-models.js";
import {
  loopModelOptions,
  loopModelValue,
  orchestratorModelOptions,
  SESSION_SETTINGS,
  storedLoopModel,
} from "./orchestrator-models.js";

test("the orchestrator model list holds the three models, Opus 5.5 first", () => {
  assert.deepEqual(orchestratorModelOptions(), [
    { value: "claude-opus-5-5", label: "Opus 5.5" },
    { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { value: "claude-fable-5-1", label: "Fable 5.1" },
  ]);
});

test("the legacy name opus is Opus 5.5 and adds no option", () => {
  assert.equal(normalizeOrchestratorModel("opus"), "claude-opus-5-5");
  assert.equal(orchestratorModelOptions().length, 3);
});

test("the loop model list starts with Session settings, then each model at high and max effort", () => {
  const options = loopModelOptions();
  assert.deepEqual(options[0], {
    value: SESSION_SETTINGS,
    label: "Session settings",
  });
  assert.equal(options.length, 7);
  assert.deepEqual(options[1], {
    value: "claude-opus-5-5:high",
    label: "Opus 5.5, high effort",
  });
  assert.deepEqual(options[6], {
    value: "claude-fable-5-1:max",
    label: "Fable 5.1, max effort",
  });
});

test("the loop model maps between the stored value and the select value", () => {
  assert.equal(loopModelValue(null), SESSION_SETTINGS);
  assert.equal(storedLoopModel(SESSION_SETTINGS), null);
  assert.equal(storedLoopModel("claude-opus-5-5:max"), "claude-opus-5-5:max");
  assert.equal(loopModelValue("claude-opus-5-5:max"), "claude-opus-5-5:max");
});
