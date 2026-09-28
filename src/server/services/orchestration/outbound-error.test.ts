import assert from "node:assert/strict";
import { test } from "node:test";
import { OUTBOUND_COPY, outboundErrorCopy } from "./outbound-error.js";

function named(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

test("each error class maps to its fixed copy", () => {
  assert.equal(
    outboundErrorCopy(named("LinearAuthError", "HTTP 401")),
    OUTBOUND_COPY.auth,
  );
  assert.equal(
    outboundErrorCopy(named("RateLimited", "ticket source rate-limited")),
    OUTBOUND_COPY.rateLimited,
  );
  assert.equal(
    outboundErrorCopy(new Error("socket hang up")),
    OUTBOUND_COPY.unreachable,
  );
  assert.equal(outboundErrorCopy("not an error"), OUTBOUND_COPY.unreachable);
});

test("a raw provider message never leaks into the copy", () => {
  const raw = "Linear GraphQL errors (HTTP 500): INTERNAL secret-detail";
  assert.ok(!outboundErrorCopy(new Error(raw)).includes("secret-detail"));
});
