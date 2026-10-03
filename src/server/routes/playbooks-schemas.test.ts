import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import {
  generateSchema,
  slugSchema,
  writeSchema,
} from "./playbooks-schemas.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

test("writeSchema trims the name and keeps the body", () => {
  assert.deepEqual(writeSchema.parse({ name: " Ship ", body: "# x" }), {
    name: "Ship",
    body: "# x",
  });
});

test("writeSchema checks the name before the body", () => {
  const cases: [unknown, string][] = [
    [undefined, "invalid-name"],
    [{ name: "  ", body: "" }, "invalid-name"],
    [{ name: "a\nb", body: "" }, "invalid-name"],
    [{ name: "x".repeat(81), body: "" }, "invalid-name"],
    [{ name: "ok" }, "invalid-body"],
    [{ name: "ok", body: "x".repeat(262145) }, "invalid-body"],
  ];
  for (const [input, code] of cases) {
    assert.equal(firstCode(writeSchema, input), code);
  }
});

test("slugSchema accepts a lowercase slug and rejects anything else", () => {
  assert.equal(slugSchema.parse("ship-it-2"), "ship-it-2");
  for (const input of ["", "-x", "Ship", "a/b", "../x"]) {
    assert.equal(firstCode(slugSchema, input), "invalid-slug");
  }
});

test("generateSchema trims the direction and bounds the source paths", () => {
  assert.deepEqual(generateSchema.parse({ direction: " go " }), {
    direction: "go",
  });
  const cases: [unknown, string][] = [
    [undefined, "invalid-direction"],
    [{ direction: "   " }, "invalid-direction"],
    [{ direction: "x".repeat(10001) }, "invalid-direction"],
    [{ direction: "go", sourcePaths: "a" }, "invalid-sources"],
    [{ direction: "go", sourcePaths: [1] }, "invalid-sources"],
    [{ direction: "go", sourcePaths: Array(9).fill("a") }, "invalid-sources"],
  ];
  for (const [input, code] of cases) {
    assert.equal(firstCode(generateSchema, input), code);
  }
});
