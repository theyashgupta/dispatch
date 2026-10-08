import test from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import {
  addBodySchema,
  editBodySchema,
  orchestratorIdSchema,
  overrideSchema,
  scopeSchema,
} from "./orchestrators-schemas.js";

function code(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const extra = {
  id: "extra-1",
  name: "Extra orchestrator 1",
  role: "extra",
  scope: { groupIds: ["G-1"], ticketIds: [] },
};

void test("the orchestrator id is a lower case slug of 2 to 21 characters", () => {
  for (const id of ["main", "extra-12", "a1"]) {
    assert.equal(code(orchestratorIdSchema, id), undefined, id);
  }
  for (const id of ["", "x", "Main", "1st", "a_b", `a${"b".repeat(21)}`, 7]) {
    assert.equal(code(orchestratorIdSchema, id), "invalid-id", String(id));
  }
});

void test("add fills an empty scope and override and refuses each bad field with its code", () => {
  assert.deepEqual(
    addBodySchema.parse({ id: "main", name: " Main ", role: "main" }),
    {
      id: "main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
      policyOverride: {},
    },
  );
  assert.equal(code(addBodySchema, extra), undefined);
  assert.equal(code(addBodySchema, { ...extra, id: "X" }), "invalid-id");
  assert.equal(code(addBodySchema, { ...extra, name: "  " }), "invalid-name");
  assert.equal(code(addBodySchema, { ...extra, role: "boss" }), "invalid-role");
  assert.equal(code(addBodySchema, { ...extra, other: 1 }), "unknown-field");
});

void test("the scope and the override refuse an extra key and an out of range value", () => {
  assert.equal(
    code(scopeSchema, { groupIds: [], ticketIds: [], x: [] }),
    "unknown-field",
  );
  assert.equal(
    code(scopeSchema, { groupIds: [""], ticketIds: [] }),
    "invalid-groupIds",
  );
  assert.equal(code(overrideSchema, { concurrencyCap: 0 }), undefined);
  assert.equal(
    code(overrideSchema, { concurrencyCap: 21 }),
    "invalid-concurrencyCap",
  );
  assert.equal(
    code(overrideSchema, { budgetPerGroup: 0 }),
    "invalid-budgetPerGroup",
  );
  assert.equal(
    code(overrideSchema, { orchestratorModel: "x" }),
    "unknown-field",
  );
});

void test("an edit needs one known field", () => {
  assert.equal(code(editBodySchema, { name: "Renamed" }), undefined);
  assert.equal(code(editBodySchema, {}), "empty-patch");
  assert.equal(code(editBodySchema, { role: "main" }), "unknown-field");
});
