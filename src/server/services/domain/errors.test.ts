import test from "node:test";
import assert from "node:assert/strict";
import {
  ConflictError,
  HttpError,
  InternalError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "./errors.js";

const cases = [
  {
    make: () => new ValidationError("bad-input"),
    status: 400,
    name: "ValidationError",
  },
  {
    make: () => new NotFoundError("not-found"),
    status: 404,
    name: "NotFoundError",
  },
  { make: () => new ConflictError("busy"), status: 409, name: "ConflictError" },
  {
    make: () => new UpstreamError("upstream-failed"),
    status: 502,
    name: "UpstreamError",
  },
  {
    make: () => new InternalError("write-failed"),
    status: 500,
    name: "InternalError",
  },
];

for (const { make, status, name } of cases) {
  test(`${name} carries status ${status} and its code`, () => {
    const err = make();
    assert.ok(err instanceof HttpError);
    assert.ok(err instanceof Error);
    assert.equal(err.status, status);
    assert.equal(err.name, name);
    assert.equal(err.message, err.code);
    assert.equal(err.details, undefined);
  });
}

test("details ride on the error unchanged", () => {
  const err = new ConflictError("generate-in-progress", { variant: "config" });
  assert.equal(err.code, "generate-in-progress");
  assert.deepEqual(err.details, { variant: "config" });
});
