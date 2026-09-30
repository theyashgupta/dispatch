import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import {
  endpointSchema,
  keysSchema,
  subscribeSchema,
  unsubscribeSchema,
} from "./push-schemas.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const ENDPOINT = "https://push.example.com/abc";
const KEYS = { p256dh: "p", auth: "a" };

test("endpointSchema accepts an https URL up to 2048 characters", () => {
  assert.equal(endpointSchema.safeParse(ENDPOINT).success, true);
  const longest = `https://${"a".repeat(2040)}`;
  assert.equal(endpointSchema.safeParse(longest).success, true);
});

test("endpointSchema rejects every bad endpoint with invalid-endpoint", () => {
  const bad: unknown[] = [
    undefined,
    null,
    5,
    "",
    "http://push.example.com/abc",
    "https://",
    "https://exa mple.com/x",
    `https://${"a".repeat(2041)}`,
  ];
  for (const input of bad) {
    assert.equal(firstCode(endpointSchema, input), "invalid-endpoint");
  }
});

test("keysSchema accepts non-empty p256dh and auth up to 512 characters", () => {
  assert.equal(keysSchema.safeParse(KEYS).success, true);
  const longest = "k".repeat(512);
  assert.equal(
    keysSchema.safeParse({ p256dh: longest, auth: longest }).success,
    true,
  );
});

test("keysSchema rejects every bad keys value with invalid-keys", () => {
  const long = "k".repeat(513);
  const bad: unknown[] = [
    undefined,
    "keys",
    [],
    {},
    { p256dh: "p" },
    { auth: "a" },
    { p256dh: "", auth: "a" },
    { p256dh: "p", auth: "" },
    { p256dh: 1, auth: "a" },
    { p256dh: "p", auth: 1 },
    { p256dh: long, auth: "a" },
    { p256dh: "p", auth: long },
  ];
  for (const input of bad) {
    assert.equal(firstCode(keysSchema, input), "invalid-keys");
  }
});

test("subscribeSchema accepts a valid body", () => {
  assert.equal(
    subscribeSchema.safeParse({ endpoint: ENDPOINT, keys: KEYS }).success,
    true,
  );
});

test("subscribeSchema reports the endpoint failure before the keys failure", () => {
  assert.equal(
    firstCode(subscribeSchema, { endpoint: "nope", keys: "bad" }),
    "invalid-endpoint",
  );
  assert.equal(
    firstCode(subscribeSchema, { endpoint: ENDPOINT }),
    "invalid-keys",
  );
});

test("subscribeSchema gives invalid-endpoint for a missing or non-object body", () => {
  for (const input of [undefined, null, [], "x"]) {
    assert.equal(firstCode(subscribeSchema, input), "invalid-endpoint");
  }
});

test("unsubscribeSchema accepts a valid body and rejects a bad endpoint", () => {
  assert.equal(
    unsubscribeSchema.safeParse({ endpoint: ENDPOINT }).success,
    true,
  );
  for (const input of [undefined, [], {}, { endpoint: "http://x" }]) {
    assert.equal(firstCode(unsubscribeSchema, input), "invalid-endpoint");
  }
});
