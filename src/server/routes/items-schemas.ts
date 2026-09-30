import { z } from "zod";
import { ITEM_STATES } from "../../shared/types.js";
import { fieldsOf } from "./schema-primitives.js";

const PROMOTE_CONTEXT_MAX = 8000;
const MAX_SNOOZE_MS = Date.UTC(9999, 11, 31, 23, 59, 59);
const UNTIL_CODE = "until must be a future ISO time";

/** A future ISO time, normalized; an issue when malformed, not in the future or past year 9999. */
const futureTimeSchema = z.unknown().transform((value, ctx) => {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms) || ms <= Date.now() || ms > MAX_SNOOZE_MS) {
    ctx.addIssue({ code: "custom", message: UNTIL_CODE });
    return z.NEVER;
  }
  return new Date(ms).toISOString();
});

/** The `GET /items` query; a repeated `state` or `source` arrives as an array and fails. */
export const listQuerySchema = z.object(
  {
    state: z.enum(ITEM_STATES, "invalid state").optional(),
    source: z.string("invalid source").optional(),
  },
  "invalid state",
);

/** The `POST /items/:id/state` body; `snoozed` is not settable here. */
export const setStateBodySchema = z.object(
  { state: z.enum(ITEM_STATES).exclude(["snoozed"], "invalid state") },
  "invalid state",
);

/** The `POST /items/:id/snooze` body; `until` comes out as a normalized ISO string. */
export const snoozeBodySchema = z.object(
  { until: futureTimeSchema },
  UNTIL_CODE,
);

/**
 * The `POST /items/:id/promote` body, where a missing or array body means no context.
 *
 * @remarks Promote has always accepted a bodyless request, so the preprocess keeps an absent or
 * array body from failing the object check.
 */
export const promoteBodySchema = z.preprocess(
  fieldsOf,
  z.object(
    {
      context: z
        .string("invalid context")
        .refine((text) => text.length <= PROMOTE_CONTEXT_MAX, "invalid context")
        .optional(),
    },
    "invalid context",
  ),
);
