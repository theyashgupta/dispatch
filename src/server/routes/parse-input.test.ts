import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { parseOrThrow } from "./parse-input.js";
import { ValidationError } from "../services/domain/errors.js";

const schema = z.object(
  {
    name: z.string({ error: "invalid-name" }),
    body: z.string({ error: "invalid-body" }),
  },
  { error: "invalid-name" },
);

test("valid input comes back parsed", () => {
  assert.deepEqual(parseOrThrow(schema, { name: "a", body: "b", x: 1 }), {
    name: "a",
    body: "b",
  });
});

test("the first failing field's code wins", () => {
  assert.throws(
    () => parseOrThrow(schema, { name: 5, body: 5 }),
    (err) => err instanceof ValidationError && err.code === "invalid-name",
  );
  assert.throws(
    () => parseOrThrow(schema, { name: "a" }),
    (err) => err instanceof ValidationError && err.code === "invalid-body",
  );
});

test("a non-object input takes the object's code", () => {
  assert.throws(
    () => parseOrThrow(schema, undefined),
    (err) =>
      err instanceof ValidationError &&
      err.status === 400 &&
      err.code === "invalid-name",
  );
});
