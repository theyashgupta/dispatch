import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import {
  accountOrDefaultIdSchema,
  activeBodySchema,
  loginBodySchema,
  loginCodeBodySchema,
  removableAccountIdSchema,
} from "./accounts-schemas.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const ID = "11111111-1111-4111-8111-111111111111";

test("accountOrDefaultIdSchema accepts default and a registry id", () => {
  assert.equal(accountOrDefaultIdSchema.safeParse("default").success, true);
  assert.equal(accountOrDefaultIdSchema.safeParse(ID).success, true);
});

test("accountOrDefaultIdSchema rejects everything else with invalid-id", () => {
  for (const input of [undefined, null, 5, "", "x", "../etc", "DEFAULT"]) {
    assert.equal(firstCode(accountOrDefaultIdSchema, input), "invalid-id");
  }
});

test("removableAccountIdSchema names default-account only for the default id", () => {
  assert.equal(removableAccountIdSchema.safeParse(ID).success, true);
  assert.equal(
    firstCode(removableAccountIdSchema, "default"),
    "default-account",
  );
  assert.equal(firstCode(removableAccountIdSchema, "nope"), "invalid-id");
});

test("activeBodySchema needs an id", () => {
  assert.equal(activeBodySchema.safeParse({ id: "default" }).success, true);
  for (const input of [undefined, [], {}, { id: 5 }, { id: "x" }]) {
    assert.equal(firstCode(activeBodySchema, input), "invalid-id");
  }
});

test("loginBodySchema treats a missing or array body as no accountId", () => {
  for (const input of [undefined, [], {}]) {
    const result = loginBodySchema.safeParse(input);
    assert.equal(result.success, true);
    assert.equal(result.data?.accountId, undefined);
  }
  assert.equal(loginBodySchema.safeParse({ accountId: ID }).success, true);
});

test("loginBodySchema rejects default and any bad accountId with invalid-id", () => {
  for (const accountId of ["default", "x", "", null, 5, []]) {
    assert.equal(firstCode(loginBodySchema, { accountId }), "invalid-id");
  }
});

test("loginCodeBodySchema trims the code and bounds it", () => {
  const trimmed = loginCodeBodySchema.safeParse({ code: "  abc \n" });
  assert.equal(trimmed.success, true);
  assert.equal(trimmed.data?.code, "abc");
  assert.equal(
    loginCodeBodySchema.safeParse({ code: "x".repeat(512) }).success,
    true,
  );
});

test("loginCodeBodySchema rejects a bad code with invalid-code", () => {
  const bad: unknown[] = [
    undefined,
    [],
    {},
    { code: null },
    { code: 5 },
    { code: "" },
    { code: " \n " },
    { code: "a\nb" },
    { code: "a\rb" },
    { code: "x".repeat(513) },
  ];
  for (const input of bad) {
    assert.equal(firstCode(loginCodeBodySchema, input), "invalid-code");
  }
});
