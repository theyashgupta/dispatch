import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_BOARD_KEY,
  defaultBoardPolicy,
} from "../../../../shared/board-key.js";
import {
  groupPlaybookFromSelect,
  groupPlaybookOptions,
  groupPlaybookSelectValue,
  isPolicyDirty,
  listedModels,
  NO_GROUP_PLAYBOOK,
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
    ["100000", true],
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

test("the budget has an upper limit of 100000 with its own error", () => {
  for (const text of ["100001", "10000000"]) {
    const errors = validatePolicyForm(edit({ budgetPerGroup: text }));
    assert.equal(errors.budgetPerGroup, POLICY_ERRORS.budgetPerGroupMax, text);
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
    { groupPlaybook: "Write code directly" },
  ];
  for (const patch of patches) {
    assert.equal(
      isPolicyDirty(edit(patch), saved),
      true,
      JSON.stringify(patch),
    );
  }
});

test("the payload holds the twelve policy fields with numbers, null and the stored model", () => {
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
    "groupPlaybook",
    "handoffHardPercent",
    "handoffPercent",
    "loopModel",
    "orchestratorModel",
    "roadmapApproval",
    "shipRights",
    "supervisor",
    "usageLimit",
    "wakeMinutes",
  ]);
  assert.equal(payload.concurrencyCap, 4);
  assert.equal(payload.loopModel, "claude-fable-5-1:max");
  assert.equal(payload.budgetPerGroup, 12.5);
  assert.equal(policyPayload(saved).loopModel, null);
  assert.equal(policyPayload(saved).budgetPerGroup, null);
  assert.equal(policyPayload(saved).orchestratorModel, "claude-opus-5-5");
});

test("the form values and the payload keep the group playbook, a name or null", () => {
  assert.equal(saved.groupPlaybook, null);
  assert.equal(policyPayload(saved).groupPlaybook, null);
  const named = policyFormValues({
    ...defaultBoardPolicy(DEFAULT_BOARD_KEY),
    groupPlaybook: "Write code directly",
  });
  assert.equal(named.groupPlaybook, "Write code directly");
  assert.equal(policyPayload(named).groupPlaybook, "Write code directly");
});

test("the group playbook options list None first, then the names in order", () => {
  assert.deepEqual(groupPlaybookOptions(["B", "A"], null), [
    { value: NO_GROUP_PLAYBOOK, label: "None" },
    { value: "B", label: "B" },
    { value: "A", label: "A" },
  ]);
  assert.equal(groupPlaybookOptions(["B", "A"], "A").length, 3);
});

test("a stored playbook missing from the list adds a not found option and keeps the value", () => {
  const options = groupPlaybookOptions(["A"], "Gone");
  assert.deepEqual(options.at(-1), {
    value: "Gone",
    label: "Gone (not found)",
  });
  assert.equal(options.length, 3);
  assert.deepEqual(
    groupPlaybookOptions([], "Gone").map((o) => o.label),
    ["None", "Gone (not found)"],
  );
});

test("while the names are loading a stored playbook shows as a plain option", () => {
  assert.deepEqual(groupPlaybookOptions(undefined, null), [
    { value: NO_GROUP_PLAYBOOK, label: "None" },
  ]);
  assert.deepEqual(groupPlaybookOptions(undefined, "Gone"), [
    { value: NO_GROUP_PLAYBOOK, label: "None" },
    { value: "Gone", label: "Gone" },
  ]);
});

test("the sentinel maps to null and a name maps to itself", () => {
  assert.equal(groupPlaybookFromSelect(NO_GROUP_PLAYBOOK), null);
  assert.equal(groupPlaybookFromSelect("A"), "A");
  assert.equal(groupPlaybookSelectValue(null), NO_GROUP_PLAYBOOK);
  assert.equal(groupPlaybookSelectValue("A"), "A");
  const picked = edit({ groupPlaybook: groupPlaybookFromSelect("A") });
  assert.equal(policyPayload(picked).groupPlaybook, "A");
  const cleared = edit({
    groupPlaybook: groupPlaybookFromSelect(NO_GROUP_PLAYBOOK),
  });
  assert.equal(policyPayload(cleared).groupPlaybook, null);
});

test("clearing a saved group playbook makes the form dirty", () => {
  const named = edit({ groupPlaybook: "A" });
  assert.equal(isPolicyDirty(edit({ groupPlaybook: null }), named), true);
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

test("the wake timer accepts 0 to 1440 and refuses the rest", () => {
  const table: [string, boolean][] = [
    ["0", true],
    ["15", true],
    ["1440", true],
    ["-1", false],
    ["1441", false],
    ["1.5", false],
    ["", false],
    ["abc", false],
  ];
  for (const [text, ok] of table) {
    const errors = validatePolicyForm(edit({ wakeMinutes: text }));
    assert.equal(errors.wakeMinutes === undefined, ok, text);
    if (!ok) {
      assert.equal(errors.wakeMinutes, "Enter a whole number from 0 to 1440.");
    }
  }
});

test("the wake timer is a form string, a payload number, and counts as a change", () => {
  assert.equal(saved.wakeMinutes, "15");
  assert.equal(policyPayload(edit({ wakeMinutes: "0" })).wakeMinutes, 0);
  assert.equal(policyPayload(edit({ wakeMinutes: "1440" })).wakeMinutes, 1440);
  assert.equal(isPolicyDirty(edit({ wakeMinutes: "30" }), saved), true);
});
