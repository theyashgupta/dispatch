import type { z } from "zod";
import { ValidationError } from "../services/domain/errors.js";
import {
  boardRefusal,
  isStaticBoardVariant,
} from "../services/orchestration/boards.js";

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

/**
 * Parse a board body, turning a schema issue that names a fixed-copy variant into its typed error.
 *
 * @remarks Any other schema issue stays a plain 400 with the issue message as the code.
 */
export function parseBoardBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const message = result.error.issues[0]?.message ?? "invalid";
  throw isStaticBoardVariant(message)
    ? boardRefusal(message)
    : new ValidationError(message);
}
