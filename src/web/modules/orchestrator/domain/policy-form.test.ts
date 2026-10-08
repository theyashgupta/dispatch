import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_BOARD_KEY,
  defaultBoardPolicy,
} from "../../../../shared/board-key.js";
import {
  isPolicyDirty,
  listedModels,
  POLICY_ERRORS,
  policyFormValues,
  policyPayload,
  SHIP_RIGHTS_OPTIONS,
  USAGE_LIMIT_OPTIONS,
  validatePolicyForm,
  type PolicyFormValues,
} from "./policy-form.js";

const saved = policyFormValues(defaultBoardPolicy(DEFAULT_BOARD_KEY));

function edit(patch: Partial<PolicyFormValues>): PolicyFormValues {
  return { ...saved, ...patch };
}

test("the stored default policy fills a clean form with the legacy model shown as Opus 5.5", () => {
  assert.equal(saved.orchestratorModel, "claude-opus-5-5");
  assert.equal(saved.loopModel, "session-settings");
  assert.deepEqual(validatePolicyForm(saved), {});
  assert.equal(isPolicyDirty(saved, saved), false);
});

test("loops at once accepts 1 to 10 and refuses the rest", () => {
  const table: [string, boolean][] = [
    ["1", true],
    ["10", true],
    ["0", false],
    ["11", false],
    ["2.5", false],
    ["", false],
    ["abc", false],
    ["-1", false],
  ];
  for (const [text, ok] of table) {
    const errors = validatePolicyForm(edit({ concurrencyCap: text }));
    assert.equal(errors.concurrencyCap === undefined, ok, text);
    if (!ok)
      assert.equal(errors.concurrencyCap, "Enter a number from 1 to 10.");
  }
});

test("the handoff percent accepts 10 to 95 and refuses the rest", () => {
  const table: [string, boolean][] = [
    ["10", true],
    ["95", true],
    ["9", false],
    ["96", false],
    ["", false],
  ];
  for (const [text, ok] of table) {
    const errors = validatePolicyForm(
      edit({ handoffPercent: text, handoffHardPercent: "100" }),
    );
    assert.equal(errors.handoffPercent === undefined, ok, text);
    if (!ok) {
      assert.equal(errors.handoffPercent, "Enter a number from 10 to 95.");
    }
  }
});

test("the hard handoff has to be above the handoff percent and at most 100", () => {
  const table: [string, string, boolean][] = [
    ["50", "51", true],
    ["50", "100", true],
    ["50", "50", false],
    ["50", "40", false],
    ["50", "101", false],
    ["50", "", false],
  ];
  for (const [soft, hard, ok] of table) {
    const errors = validatePolicyForm(
      edit({ handoffPercent: soft, handoffHardPercent: hard }),
    );
    assert.equal(
      errors.handoffHardPercent === undefined,
      ok,
      `${soft}/${hard}`,
    );
    if (!ok) {
      assert.equal(
        errors.handoffHardPercent,
        "Enter a number above the handoff percent.",
      );
    }
  }
});

test("the budget is empty or above 0", () => {
  const table: [string, boolean][] = [
    ["", true],
    ["  ", true],
    ["0.5", true],
    ["25", true],
    ["0", false],
    ["-3", false],
    ["abc", false],
  ];
  for (const [text, ok] of table) {
    const errors = validatePolicyForm(edit({ budgetPerGroup: text }));
    assert.equal(errors.budgetPerGroup === undefined, ok, text);
    if (!ok) assert.equal(errors.budgetPerGroup, POLICY_ERRORS.budgetPerGroup);
  }
});

test("a form is dirty when any field differs from the saved values", () => {
  const patches: Partial<PolicyFormValues>[] = [
    { roadmapApproval: "all" },
    { concurrencyCap: "4" },
    { loopModel: "claude-opus-5-5:high" },
    { orchestratorModel: "claude-sonnet-5-5" },
    { handoffPercent: "60" },
    { handoffHardPercent: "90" },
    { usageLimit: "stop" },
    { shipRights: "merge" },
    { budgetPerGroup: "10" },
    { supervisor: saved.supervisor === "on" ? "off" : "on" },
  ];
  for (const patch of patches) {
    assert.equal(
      isPolicyDirty(edit(patch), saved),
      true,
      JSON.stringify(patch),
    );
  }
});

test("the payload holds the ten policy fields with numbers, null and the stored model", () => {
  const payload = policyPayload(
    edit({
      concurrencyCap: "4",
      loopModel: "claude-fable-5-1:max",
      budgetPerGroup: "12.5",
    }),
  );
  assert.deepEqual(Object.keys(payload).sort(), [
    "budgetPerGroup",
    "concurrencyCap",
    "handoffHardPercent",
    "handoffPercent",
    "loopModel",
    "orchestratorModel",
    "roadmapApproval",
    "shipRights",
    "supervisor",
    "usageLimit",
  ]);
  assert.equal(payload.concurrencyCap, 4);
  assert.equal(payload.loopModel, "claude-fable-5-1:max");
  assert.equal(payload.budgetPerGroup, 12.5);
  assert.equal(policyPayload(saved).loopModel, null);
  assert.equal(policyPayload(saved).budgetPerGroup, null);
  assert.equal(policyPayload(saved).orchestratorModel, "claude-opus-5-5");
});

test("no option or payload holds a usage credits value", () => {
  assert.deepEqual(
    USAGE_LIMIT_OPTIONS.map((o) => o.value),
    ["wait", "stop"],
  );
  const everything = JSON.stringify([
    USAGE_LIMIT_OPTIONS,
    SHIP_RIGHTS_OPTIONS,
    policyPayload(saved),
  ]);
  assert.equal(/credit/i.test(everything), false);
});

test("a stored model outside the list shows the default option and counts as changed", () => {
  const stale = policyFormValues({
    ...defaultBoardPolicy(DEFAULT_BOARD_KEY),
    orchestratorModel: "claude-old",
    loopModel: "claude-sonnet-4",
  });
  const shown = listedModels(stale);
  assert.equal(shown.orchestratorModel, "claude-opus-5-5");
  assert.equal(shown.loopModel, "session-settings");
  assert.equal(isPolicyDirty(shown, stale), true);
  const payload = policyPayload(shown);
  assert.equal(payload.orchestratorModel, "claude-opus-5-5");
  assert.equal(payload.loopModel, null);
  assert.equal(isPolicyDirty(listedModels(saved), saved), false);
});
