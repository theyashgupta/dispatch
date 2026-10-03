import type { ErrorRequestHandler } from "express";
import { HttpError, InternalError } from "../services/domain/errors.js";

/**
 * Turn a typed `HttpError` into its status and the `{ error: code, ...details }` body.
 *
 * @remarks The body keeps `error` as the first key and as the code string, because the web client
 * reads `body.error` as a string. The second assignment stops a `details` field named `error` from
 * replacing the code without moving the key. Any other error goes to the next handler, so routes that still answer by hand keep the
 * Express default behaviour.
 */
export const httpErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (!(err instanceof HttpError) || res.headersSent) {
    next(err);
    return;
  }
  const body: Record<string, unknown> = { error: err.code, ...err.details };
  body.error = err.code;
  res.status(err.status).json(body);
};

/** The first line of an error message, which never carries request text, for a log line. */
export function firstLine(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : "unknown error";
}

/**
 * Run a service call, turning an unexpected throw into `InternalError(code)`.
 *
 * @remarks A typed `HttpError` passes through untouched. When `label` is given, the failure's first
 * line is logged under it before the 500.
 */
export async function orFail<T>(
  code: string,
  run: () => Promise<T> | T,
  label?: string,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (label !== undefined) console.warn(label, firstLine(err));
    throw new InternalError(code);
  }
}
