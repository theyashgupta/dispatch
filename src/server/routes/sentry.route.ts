import { Router } from "express";
import { z } from "zod";
import {
  SentryAuthError,
  SentryRequestError,
  SourceRateLimited,
} from "../adapters/source-gateway.js";
import {
  getSentryIssue,
  resolveSentryIssueItem,
  SentryItemUnknown,
  SentryNotConnected,
} from "../services/orchestration/sentry.js";
import {
  HttpError,
  NotFoundError,
  UpstreamError,
} from "../services/domain/errors.js";
import { boardRepository as store } from "../store/board-repository.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

/**
 * Sentry issue detail and resolve for the Errors page.
 *
 * @remarks The issue id is validated and its item looked up before any Sentry call, and a resolve
 * marks the item done only after Sentry answers success. Errors answer an error kind only, never
 * the token or a raw provider body.
 */
export const sentryRouter = Router();

const ISSUE_ID = /^[1-9][0-9]{0,19}$/;

const issueParamsSchema = z.object(
  {
    id: z
      .string("invalid issue")
      .refine((id) => ISSUE_ID.test(id), "invalid issue"),
  },
  "invalid issue",
);

/** Map a Sentry failure to the typed error that carries its status and error kind. */
function toHttpError(err: unknown): HttpError {
  if (err instanceof SentryItemUnknown)
    return new NotFoundError("unknown item");
  if (err instanceof SentryNotConnected)
    return new HttpError(401, "no-credential");
  if (err instanceof SentryAuthError) return new HttpError(401, "rejected");
  if (err instanceof SentryRequestError && err.status === 403) {
    return new HttpError(403, "forbidden");
  }
  if (err instanceof SourceRateLimited)
    return new HttpError(429, "rate-limited");
  if (err instanceof SentryRequestError && err.status === 404) {
    return new NotFoundError("not-found");
  }
  return new UpstreamError("unreachable");
}

sentryRouter.get("/sentry/issue/:id", async (req, res) => {
  const { id } = parseOrThrow(issueParamsSchema, req.params);
  try {
    res.status(200).json(await getSentryIssue(id));
  } catch (err) {
    throw toHttpError(err);
  }
});

sentryRouter.post("/sentry/issue/:id/resolve", async (req, res) => {
  const { id } = parseOrThrow(issueParamsSchema, req.params);
  let itemId: string;
  try {
    itemId = await resolveSentryIssueItem(id);
  } catch (err) {
    throw toHttpError(err);
  }
  await store.setItemState(itemId, "done");
  res.status(204).end();
});

sentryRouter.use(httpErrorHandler);
