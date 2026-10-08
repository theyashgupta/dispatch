import { z } from "zod";

export const MARKER_ERROR = "content contains the DISPATCH_STATUS marker";

/**
 * A body's fields, where a missing, array or primitive body has none.
 *
 * @remarks Used as a `z.preprocess` step, so a bodyless request reads as `{}` and never fails the
 * object check.
 */
export function fieldsOf(body: unknown): unknown {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? body
    : {};
}

/** Trimmed text of 1 to `max` characters after trimming, with `code` as the issue. */
export const boundedText = (max: number, code: string) =>
  z
    .string(code)
    .transform((raw) => raw.trim())
    .refine((text) => text !== "" && text.length <= max, code);

/** Digit-only text as a safe integer, with `code` as the issue. */
export const intText = (code: string) =>
  z
    .string(code)
    .regex(/^\d+$/, code)
    .transform(Number)
    .refine(Number.isSafeInteger, code);

/** A lenient `{ force }` body that never fails; only a boolean `true` is force. */
export const forceBodySchema = z.preprocess(
  fieldsOf,
  z.object({
    force: z
      .unknown()
      .optional()
      .transform((force) => force === true),
  }),
);

/**
 * Run a shared `{ ok, error }` parser as a schema, so its messages stay the client error codes.
 *
 * @remarks The field is optional so a missing key reaches `parse` instead of failing in zod.
 */
export function fromResult<T>(
  parse: (
    input: unknown,
  ) => { ok: true; value: T } | { ok: false; error: string },
) {
  return z
    .unknown()
    .optional()
    .transform((input, ctx) => {
      const result = parse(input);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.error });
        return z.NEVER;
      }
      return result.value;
    });
}

/** A `true` or `false` query value as a boolean, with `code` as the issue for anything else. */
export const booleanFilter = (code: string) =>
  z.enum(["true", "false"], code).transform((flag) => flag === "true");
