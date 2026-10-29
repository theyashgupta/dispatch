import assert from "node:assert/strict";
import { test } from "node:test";
import { isDispatchLine } from "./dispatch-lines.js";

test("wake, handoff, cancel, resume and continue lines are Dispatch lines by their start", () => {
  for (const text of [
    "Dispatch wake: CEN-1 needs input.",
    "Context handoff request. Your context is high.",
    "Context handoff request (hard limit).",
    "Ignore the context handoff request above: the handoff is already done and this is the fresh session. Continue the loop.",
    "Resume as the main orchestrator of board CEN.",
    "The loop stopped without a marker. Continue from where you stopped.",
    "The usage limit has reset. Read the progress file.",
  ]) {
    assert.equal(isDispatchLine(text), true, text);
  }
});

test("the kickoff is a Dispatch line by the orchestrator sentence anywhere in it", () => {
  assert.equal(
    isDispatchLine(
      '## Extra direction\nYou are the orchestrator "Main" (id main) of board CEN.',
    ),
    true,
  );
});

test("a user line is not a Dispatch line, even when it names one", () => {
  for (const text of [
    "Start the calendar group first.",
    " Dispatch wake: leading space",
    "Why did the Dispatch wake: line come?",
    "You are the orchestrator, right?",
    "",
  ]) {
    assert.equal(isDispatchLine(text), false, text);
  }
});
