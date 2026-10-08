import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardPolicy } from "../../../../shared/types.js";
import {
  emptyOverrideValues,
  isOverrideDirty,
  overrideOptions,
  overridePayload,
  overrideValues,
  validateOverride,
} from "./override-form.js";

const board: BoardPolicy = {
  roadmapApproval: "all",
  concurrencyCap: 3,
  loopModel: null,
  orchestratorModel: "claude-opus-5-5",
  handoffPercent: 50,
  handoffHardPercent: 80,
  usageLimit: "wait",
  shipRights: "merge",
  budgetPerGroup: 20,
  supervisor: "on",
};

function values(options: { value: string }[]): string[] {
  return options.map((o) => o.value);
}

test("each select starts with Same as board and offers only narrower values in contract order", () => {
  const options = overrideOptions(board);
  assert.equal(options.roadmapApproval[0]?.label, "Same as board");
  assert.deepEqual(values(options.roadmapApproval), ["same", "rules", "ask"]);
  assert.deepEqual(values(options.concurrencyCap), ["same", "2", "1"]);
  assert.deepEqual(values(options.usageLimit), ["same", "stop"]);
  assert.deepEqual(values(options.shipRights), ["same", "open_prs", "none"]);
});

test("a board at its narrowest value leaves only Same as board", () => {
  const options = overrideOptions({
    ...board,
    roadmapApproval: "ask",
    concurrencyCap: 1,
    usageLimit: "stop",
    shipRights: "none",
  });
  assert.deepEqual(values(options.roadmapApproval), ["same"]);
  assert.deepEqual(values(options.concurrencyCap), ["same"]);
  assert.deepEqual(values(options.usageLimit), ["same"]);
  assert.deepEqual(values(options.shipRights), ["same"]);
});

test("no list offers a value wider than the board value", () => {
  const options = overrideOptions({
    ...board,
    roadmapApproval: "rules",
    shipRights: "open_prs",
  });
  assert.deepEqual(values(options.roadmapApproval), ["same", "ask"]);
  assert.deepEqual(values(options.shipRights), ["same", "none"]);
});

test("the option labels are the labels of the Policy form", () => {
  const options = overrideOptions(board);
  assert.equal(
    options.roadmapApproval[1]?.label,
    "Approve when the rules pass, else ask",
  );
  assert.equal(options.usageLimit[1]?.label, "Stop and ask me");
  assert.equal(options.shipRights[2]?.label, "None, I ship");
});

test("the budget accepts empty and amounts above 0 up to the board budget", () => {
  const table: [string, string | undefined][] = [
    ["", undefined],
    ["5", undefined],
    ["20", undefined],
    ["20.01", "Enter an amount at or below the board budget."],
    [
      "0",
      "Enter an amount above 0, or leave it empty to use the board budget.",
    ],
    [
      "-2",
      "Enter an amount above 0, or leave it empty to use the board budget.",
    ],
    [
      "abc",
      "Enter an amount above 0, or leave it empty to use the board budget.",
    ],
  ];
  for (const [text, error] of table) {
    assert.equal(
      validateOverride(
        { ...emptyOverrideValues(), budgetPerGroup: text },
        board,
      ).budgetPerGroup,
      error,
      text,
    );
  }
});

test("a board with no budget has no upper limit", () => {
  const open = { ...board, budgetPerGroup: null };
  assert.deepEqual(
    validateOverride(
      { ...emptyOverrideValues(), budgetPerGroup: "99999" },
      open,
    ),
    {},
  );
});

test("the payload holds only the fields that are not Same as board", () => {
  assert.deepEqual(overridePayload(emptyOverrideValues()), {});
  assert.deepEqual(
    overridePayload({
      roadmapApproval: "ask",
      concurrencyCap: "1",
      usageLimit: "same",
      shipRights: "none",
      budgetPerGroup: "7.5",
    }),
    {
      roadmapApproval: "ask",
      concurrencyCap: 1,
      shipRights: "none",
      budgetPerGroup: 7.5,
    },
  );
});

test("a saved override fills the form and a value no longer narrower shows as Same as board", () => {
  assert.deepEqual(
    overrideValues({ concurrencyCap: 1, shipRights: "none" }, board),
    {
      ...emptyOverrideValues(),
      concurrencyCap: "1",
      shipRights: "none",
    },
  );
  assert.equal(
    overrideValues({ concurrencyCap: 5 }, board).concurrencyCap,
    "same",
  );
});

test("the form is dirty only when a field changes", () => {
  const saved = overrideValues({ concurrencyCap: 1 }, board);
  assert.equal(isOverrideDirty(saved, saved), false);
  assert.equal(isOverrideDirty({ ...saved, usageLimit: "stop" }, saved), true);
  assert.equal(
    isOverrideDirty({ ...saved, budgetPerGroup: " " }, saved),
    false,
  );
});
