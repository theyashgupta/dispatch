import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityEvent } from "../../shared/types.js";
import { describeEvent } from "./event-copy.js";

const pushed = (reason: string): ActivityEvent => ({
  id: 1,
  cardId: "ENG-1",
  type: "linear_state_pushed",
  fromCol: "todo",
  toCol: "done",
  reason,
  source: "user",
  ts: "2026-09-25T00:00:00.000Z",
});

test("a pushed state reads as the state it set, a failure as its notice", () => {
  assert.equal(describeEvent(pushed("Done")), "Linear state set to Done");
  assert.equal(
    describeEvent(
      pushed(
        "failed: Linear state not updated. Linear could not be reached. Try again.",
      ),
    ),
    "Linear state not updated. Linear could not be reached. Try again.",
  );
});
