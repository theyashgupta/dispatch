import test from "node:test";
import assert from "node:assert/strict";
import { groupLaunchArgs } from "./group-launch.js";

void test("a null loop model leaves the configured arguments and adds nothing", () => {
  const claudeArgs = ["--model", "sonnet", "--verbose"];
  assert.deepEqual(groupLaunchArgs({ loopModel: null, claudeArgs }), {
    leadingArgs: [],
    claudeArgs,
  });
});

void test("a loop model adds model and effort and removes both flags from Settings in every form", () => {
  const out = groupLaunchArgs({
    loopModel: "claude-sonnet-5-5:max",
    claudeArgs: [
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "--effort=low",
      "--verbose",
      "--effort",
      "high",
    ],
  });
  assert.deepEqual(out.leadingArgs, [
    "--model",
    "claude-sonnet-5-5",
    "--effort",
    "max",
  ]);
  assert.deepEqual(out.claudeArgs, [
    "--dangerously-skip-permissions",
    "--verbose",
  ]);
});
