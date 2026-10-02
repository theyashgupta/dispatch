import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import {
  createBodySchema,
  editPurposeBodySchema,
  nameBodySchema,
  nameSchema,
  purposeSchema,
  setValueBodySchema,
  valueSchema,
} from "./vault-schemas.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

test("nameSchema accepts env-var names up to 64 characters", () => {
  for (const name of ["A", "_X", "GITHUB_TOKEN", "A1", "A".repeat(64)]) {
    assert.equal(nameSchema.safeParse(name).success, true);
  }
});

test("nameSchema rejects everything else with invalid-name", () => {
  const bad: unknown[] = [
    undefined,
    null,
    5,
    "",
    "lower",
    "A-B",
    "1A",
    " A",
    "A\n",
    "A".repeat(65),
  ];
  for (const input of bad) {
    assert.equal(firstCode(nameSchema, input), "invalid-name");
  }
});

test("purposeSchema trims and bounds the purpose", () => {
  const result = purposeSchema.safeParse("  why  ");
  assert.equal(result.data, "why");
  assert.equal(purposeSchema.safeParse("p".repeat(200)).success, true);
  for (const input of [
    undefined,
    5,
    "",
    "  ",
    "a\nb",
    "a\rb",
    "p".repeat(201),
  ]) {
    assert.equal(firstCode(purposeSchema, input), "invalid-purpose");
  }
});

test("valueSchema names missing-value for a missing or empty value", () => {
  for (const input of [undefined, null, 5, ""]) {
    assert.equal(firstCode(valueSchema, input), "missing-value");
  }
});

test("valueSchema names invalid-value for a newline or more than 8192 bytes", () => {
  for (const input of ["a\nb", "a\rb", "v".repeat(8193), "é".repeat(4097)]) {
    assert.equal(firstCode(valueSchema, input), "invalid-value");
  }
  assert.equal(valueSchema.safeParse("v".repeat(8192)).success, true);
  assert.equal(valueSchema.safeParse("é".repeat(4096)).success, true);
});

test("createBodySchema checks the name, then the purpose, then the value", () => {
  assert.equal(
    createBodySchema.safeParse({ name: "ABC", purpose: "p" }).success,
    true,
  );
  assert.equal(
    createBodySchema.safeParse({ name: "ABC", purpose: "p", value: "v" })
      .success,
    true,
  );
  for (const input of [undefined, [], {}]) {
    assert.equal(firstCode(createBodySchema, input), "invalid-name");
  }
  assert.equal(
    firstCode(createBodySchema, { name: "x", purpose: "", value: "" }),
    "invalid-name",
  );
  assert.equal(
    firstCode(createBodySchema, { name: "ABC", purpose: "", value: "" }),
    "invalid-purpose",
  );
  assert.equal(
    firstCode(createBodySchema, { name: "ABC", purpose: "p", value: "" }),
    "missing-value",
  );
  assert.equal(
    firstCode(createBodySchema, { name: "ABC", purpose: "p", value: "a\nb" }),
    "invalid-value",
  );
});

test("setValueBodySchema and editPurposeBodySchema name their own field", () => {
  for (const input of [undefined, [], {}]) {
    assert.equal(firstCode(setValueBodySchema, input), "missing-value");
    assert.equal(firstCode(editPurposeBodySchema, input), "invalid-purpose");
  }
  assert.equal(setValueBodySchema.safeParse({ value: "v" }).success, true);
  assert.equal(editPurposeBodySchema.safeParse({ purpose: "p" }).success, true);
});

test("nameBodySchema reads only the name and names invalid-name first", () => {
  assert.deepEqual(nameBodySchema.parse({ name: "API_KEY", purpose: 5 }), {
    name: "API_KEY",
  });
  for (const input of [undefined, [], {}, { name: "bad name" }]) {
    assert.equal(firstCode(nameBodySchema, input), "invalid-name");
  }
});
