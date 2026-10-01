import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import { mergeSchema, reviewSchema, targetSchema } from "./github-schemas.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const SHA = "a".repeat(40);

test("targetSchema accepts owner, repo and number and converts the number", () => {
  assert.deepEqual(
    targetSchema.parse({ owner: "o-1", repo: "r.x_y", number: "42" }),
    { owner: "o-1", repo: "r.x_y", number: 42 },
  );
});

test("targetSchema rejects a bad segment or number with invalid pull request", () => {
  const ok = { owner: "o", repo: "r", number: "1" };
  for (const input of [
    undefined,
    { ...ok, owner: "" },
    { ...ok, owner: ".." },
    { ...ok, repo: "a/b" },
    { ...ok, repo: "x".repeat(101) },
    { ...ok, number: "0" },
    { ...ok, number: "01" },
    { ...ok, number: "12345678901" },
    { ...ok, number: 1 },
  ]) {
    assert.equal(firstCode(targetSchema, input), "invalid pull request");
  }
});

test("reviewSchema trims the text and allows empty text only on approve", () => {
  assert.deepEqual(reviewSchema.parse({ event: "APPROVE" }), {
    event: "APPROVE",
    text: "",
  });
  assert.deepEqual(reviewSchema.parse({ event: "COMMENT", body: " hi " }), {
    event: "COMMENT",
    text: "hi",
  });
  for (const input of [
    undefined,
    { event: "MERGE" },
    { event: "COMMENT" },
    { event: "REQUEST_CHANGES", body: "   " },
    { event: "APPROVE", body: 5 },
    { event: "APPROVE", body: "x".repeat(20001) },
  ]) {
    assert.equal(firstCode(reviewSchema, input), "invalid review");
  }
});

test("mergeSchema accepts only a 40 character lowercase hex sha", () => {
  assert.deepEqual(mergeSchema.parse({ sha: SHA }), { sha: SHA });
  for (const input of [undefined, {}, { sha: "A".repeat(40) }, { sha: "a" }]) {
    assert.equal(firstCode(mergeSchema, input), "invalid sha");
  }
});
