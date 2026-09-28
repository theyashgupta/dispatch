import assert from "node:assert/strict";
import { test } from "node:test";
import { moveErrorCopy } from "./move-error-copy.js";

test("each refused status maps to its panel copy", () => {
  assert.equal(
    moveErrorCopy(400, "stateId is not a state of the card's team"),
    "That state is no longer on the team. Reopen the ticket and try again.",
  );
  assert.equal(
    moveErrorCopy(404, "unknown card id: x"),
    "This ticket is no longer on the board.",
  );
  assert.equal(
    moveErrorCopy(409, "Linear is not connected"),
    "Linear is not connected, or this card has no Linear team.",
  );
});

test("another status shows the server text, and a network failure the fallback", () => {
  assert.equal(moveErrorCopy(500, "boom"), "boom");
  assert.equal(moveErrorCopy(0, null), "Could not reach Dispatch. Try again.");
});
