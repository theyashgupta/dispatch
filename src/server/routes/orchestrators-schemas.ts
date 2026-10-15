import { z } from "zod";
import { unknownFieldError } from "./schema-primitives.js";

const unknownField = { error: unknownFieldError() };

const scopeIds = (field: string) =>
  z
    .array(
      z
        .string(`invalid-${field}`)
        .min(1, `invalid-${field}`)
        .max(200, `invalid-${field}`),
      `invalid-${field}`,
    )
    .max(200, `invalid-${field}`);

export const scopeSchema = z.strictObject(
  { groupIds: scopeIds("groupIds"), ticketIds: scopeIds("ticketIds") },
  unknownField,
);

/**
 * The five policy fields an extra may narrow; any other key, a model field included, is refused.
 *
 * @remarks
 * The concurrency cap may be 0 here, which blocks the extra from starting loops.
 */
export const overrideSchema = z.strictObject(
  {
    roadmapApproval: z
      .enum(["ask", "rules", "all"], "invalid-roadmapApproval")
      .optional(),
    concurrencyCap: z
      .number("invalid-concurrencyCap")
      .int("invalid-concurrencyCap")
      .min(0, "invalid-concurrencyCap")
      .max(20, "invalid-concurrencyCap")
      .optional(),
    usageLimit: z.enum(["wait", "stop"], "invalid-usageLimit").optional(),
    shipRights: z
      .enum(["none", "open_prs", "merge"], "invalid-shipRights")
      .optional(),
    budgetPerGroup: z
      .number("invalid-budgetPerGroup")
      .positive("invalid-budgetPerGroup")
      .max(100_000, "invalid-budgetPerGroup")
      .nullable()
      .optional(),
  },
  unknownField,
);

const nameSchema = z
  .string("invalid-name")
  .trim()
  .min(1, "invalid-name")
  .max(60, "invalid-name");

export const orchestratorIdSchema = z
  .string("invalid-id")
  .regex(/^[a-z][a-z0-9-]{1,20}$/, "invalid-id");

export const addBodySchema = z.strictObject(
  {
    id: orchestratorIdSchema,
    name: nameSchema,
    role: z.enum(["main", "extra"], "invalid-role"),
    scope: scopeSchema.default({ groupIds: [], ticketIds: [] }),
    policyOverride: overrideSchema.default({}),
  },
  unknownField,
);

/** The body of an edit: the name, the scope or the override; the role and the id never change. */
export const editBodySchema = z
  .strictObject(
    {
      name: nameSchema.optional(),
      scope: scopeSchema.optional(),
      policyOverride: overrideSchema.optional(),
    },
    unknownField,
  )
  .refine((patch) => Object.keys(patch).length > 0, "empty-patch");
