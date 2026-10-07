import test from "node:test";
import assert from "node:assert/strict";
import {
  ForbiddenError,
  HttpError,
  PolicyError,
  UnauthorizedError,
} from "./errors.js";

void test("UnauthorizedError carries status 401 and its code", () => {
  const err = new UnauthorizedError("orchestrator-token-required");
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 401);
  assert.equal(err.name, "UnauthorizedError");
  assert.equal(err.code, "orchestrator-token-required");
  assert.equal(err.message, err.code);
  assert.equal(err.details, undefined);
});

void test("ForbiddenError carries status 403 and its code", () => {
  const err = new ForbiddenError("other-board");
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 403);
  assert.equal(err.name, "ForbiddenError");
  assert.equal(err.code, "other-board");
  assert.equal(err.details, undefined);
});

void test("PolicyError is a 403 policy-refused with the reason in details", () => {
  const err = new PolicyError("over-budget", { cardId: "SBX-1" });
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 403);
  assert.equal(err.name, "PolicyError");
  assert.equal(err.code, "policy-refused");
  assert.deepEqual(err.details, { cardId: "SBX-1", reason: "over-budget" });
});

void test("a details reason never overrides the PolicyError reason argument", () => {
  const err = new PolicyError("over-budget", { reason: "spoofed" });
  assert.equal(err.details?.reason, "over-budget");
});
