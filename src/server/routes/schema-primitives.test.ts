import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  MARKER_ERROR,
  boundedText,
  fieldsOf,
  forceBodySchema,
  fromResult,
} from "./schema-primitives.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

test("MARKER_ERROR is the client code for a status marker", () => {
  assert.equal(MARKER_ERROR, "content contains the DISPATCH_STATUS marker");
});

test("fieldsOf keeps an object body and reads anything else as no fields", () => {
  const body = { a: 1 };
  assert.equal(fieldsOf(body), body);
  for (const input of [undefined, null, [], [1], "x", 5, true]) {
    assert.deepEqual(fieldsOf(input), {});
  }
});

test("boundedText trims and accepts 1 to max characters", () => {
  const schema = boundedText(3, "bad");
  assert.equal(schema.parse("  abc  "), "abc");
  for (const input of [undefined, 5, "", "   ", "abcd"]) {
    assert.equal(firstCode(schema, input), "bad");
  }
});

test("forceBodySchema reads only a boolean true as force and never fails", () => {
  assert.deepEqual(forceBodySchema.parse({ force: true }), { force: true });
  for (const input of [
    undefined,
    null,
    [],
    "x",
    {},
    { force: "true" },
    { force: 1 },
  ]) {
    assert.deepEqual(forceBodySchema.parse(input), { force: false });
  }
});

test("fromResult returns the parser value or its error as the issue", () => {
  const schema = fromResult((input) =>
    input === "ok"
      ? { ok: true, value: 42 }
      : { ok: false, error: `bad ${String(input)}` },
  );
  assert.equal(schema.parse("ok"), 42);
  assert.equal(firstCode(schema, "no"), "bad no");
  assert.equal(firstCode(z.object({ f: schema }), {}), "bad undefined");
});
