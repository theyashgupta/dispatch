import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMENT_BODY_MAX, validateCommentBody } from "./comment-body.js";

test("a body of exactly the limit is accepted and one character more is refused", () => {
  assert.equal(validateCommentBody("a".repeat(COMMENT_BODY_MAX)), null);
  assert.equal(
    validateCommentBody("a".repeat(COMMENT_BODY_MAX + 1)),
    "Comment is longer than 20000 characters.",
  );
});

test("empty, whitespace-only and non-string bodies are refused", () => {
  for (const body of ["", "  ", "\n\t", undefined, 42]) {
    assert.equal(validateCommentBody(body), "Comment is empty.");
  }
});

test("a body with the status marker on any line is refused", () => {
  assert.equal(
    validateCommentBody("line one\nline two\nDISPATCH_STATUS: DONE"),
    "Comment cannot contain DISPATCH_STATUS:.",
  );
});

test("a body that mentions dispatch status in prose is accepted", () => {
  assert.equal(
    validateCommentBody("The dispatch status looks fine to me."),
    null,
  );
});
