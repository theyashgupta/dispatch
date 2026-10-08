import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptErrorCopy } from "./ticket-copy.js";

test("each validation code has its own copy", () => {
  assert.equal(
    acceptErrorCopy("invalid-title"),
    "Title is too long (max 300 characters).",
  );
  assert.equal(
    acceptErrorCopy("invalid-description"),
    "Description is too long (max 20,000 characters).",
  );
  assert.equal(
    acceptErrorCopy("content contains the DISPATCH_STATUS marker"),
    "The ticket can't contain the reserved DISPATCH_STATUS marker.",
  );
  assert.equal(
    acceptErrorCopy("invalid-images"),
    "Only PNG, JPEG, GIF, and WebP images can be attached (up to 10, 10 MB each).",
  );
});

test("an unknown code or no code reads as a network failure", () => {
  assert.equal(
    acceptErrorCopy("whatever"),
    "Couldn't reach the server. Try again.",
  );
  assert.equal(acceptErrorCopy(null), "Couldn't reach the server. Try again.");
});
