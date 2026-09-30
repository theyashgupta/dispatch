import type { z } from "zod";
import { ValidationError } from "../services/domain/errors.js";

/**
 * Parse route input with a zod schema, or throw a `ValidationError` with the first issue's code.
 *
 * @remarks Schema messages are client-facing error codes, and schema key order sets precedence: the
 * first failing field's code wins.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "invalid");
  }
  return result.data;
}
