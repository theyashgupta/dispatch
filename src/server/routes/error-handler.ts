import type { ErrorRequestHandler } from "express";
import { HttpError } from "../services/domain/errors.js";

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
