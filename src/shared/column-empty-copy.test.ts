import assert from "node:assert/strict";
import { test } from "node:test";
import { SINGLE_LINE_COPY } from "./column-empty-copy.js";

test("the seven single-line empty column strings equal the legacy board copy", () => {
  assert.deepEqual(SINGLE_LINE_COPY, {
    in_progress: "Nothing running.",
    needs_input: "Nothing waiting on your input.",
    agent_done: "No finished agents yet.",
    in_review: "Nothing waiting on you.",
    parked: "Nothing set aside.",
    done: "Finished tickets land here.",
    inbox: "Nothing in the inbox.",
  });
});
