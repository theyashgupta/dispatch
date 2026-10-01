import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import {
  listQuerySchema,
  promoteBodySchema,
  setStateBodySchema,
  snoozeBodySchema,
} from "./items-schemas.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

test("listQuerySchema accepts no filters, a state, a source and both", () => {
  for (const query of [
    {},
    { state: "read" },
    { source: "fake" },
    { state: "snoozed", source: "s" },
  ]) {
    assert.equal(listQuerySchema.safeParse(query).success, true);
  }
});

test("listQuerySchema names the state before the source", () => {
  for (const state of ["bogus", "", ["read", "done"], 5]) {
    assert.equal(firstCode(listQuerySchema, { state }), "invalid state");
  }
  for (const source of [["a", "b"], 5]) {
    assert.equal(firstCode(listQuerySchema, { source }), "invalid source");
  }
  assert.equal(
    firstCode(listQuerySchema, { state: "bogus", source: ["a", "b"] }),
    "invalid state",
  );
});

test("setStateBodySchema accepts the three settable states", () => {
  for (const state of ["unread", "read", "done"]) {
    assert.equal(setStateBodySchema.safeParse({ state }).success, true);
  }
});

test("setStateBodySchema rejects snoozed, unknown, missing and non-string states", () => {
  for (const input of [
    undefined,
    [],
    {},
    { state: "snoozed" },
    { state: "gone" },
    { state: 5 },
    { state: null },
  ]) {
    assert.equal(firstCode(setStateBodySchema, input), "invalid state");
  }
});

test("snoozeBodySchema normalizes a future time", () => {
  const until = new Date(Date.now() + 3_600_000);
  const parsed = snoozeBodySchema.parse({ until: until.toISOString() });
  assert.equal(parsed.until, until.toISOString());
});

test("snoozeBodySchema rejects every bad time with the until code", () => {
  const code = "until must be a future ISO time";
  const bad: unknown[] = [
    undefined,
    {},
    { until: 5 },
    { until: null },
    { until: "soon" },
    { until: "99999" },
    { until: new Date(Date.now() - 60_000).toISOString() },
    { until: "10000-01-01T00:00:00.000Z" },
  ];
  for (const input of bad)
    assert.equal(firstCode(snoozeBodySchema, input), code);
});

test("promoteBodySchema accepts no body, an array body, no context and a context up to 8000 characters", () => {
  for (const input of [
    undefined,
    [],
    {},
    { context: "x" },
    { context: "x".repeat(8000) },
  ]) {
    assert.equal(promoteBodySchema.safeParse(input).success, true);
  }
});

test("promoteBodySchema rejects a non-string or long context", () => {
  for (const context of [5, null, ["x"], "x".repeat(8001)]) {
    assert.equal(firstCode(promoteBodySchema, { context }), "invalid context");
  }
});
