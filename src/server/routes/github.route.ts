import { Router } from "express";
import {
  GitHubAuthError,
  GitHubRequestError,
  GitHubSsoError,
  SourceRateLimited,
} from "../adapters/source-gateway.js";
import { pollNow } from "../adapters/poller.js";
import {
  getPullRequest,
  GithubNotConnected,
  mergePullRequest,
  reviewPullRequest,
} from "../services/domain/github.js";
import {
  ConflictError,
  HttpError,
  NotFoundError,
  UpstreamError,
} from "../services/domain/errors.js";
import { httpErrorHandler } from "./error-handler.js";
import { mergeSchema, reviewSchema, targetSchema } from "./github-schemas.js";
import { parseOrThrow } from "./parse-input.js";

/**
 * Pull request detail, review and squash merge for the Pull Requests page.
 *
 * @remarks Every path segment is validated before any GitHub call. Errors answer an error kind and,
 * only for GitHub's refusals, GitHub's own message text; never the token or a raw provider body.
 */
export const githubRouter = Router();

/** Map a GitHub failure to the typed error that carries its status and error kind. */
function toHttpError(err: unknown): HttpError {
  if (err instanceof GithubNotConnected)
    return new HttpError(401, "no-credential");
  if (err instanceof GitHubAuthError) return new HttpError(401, "rejected");
  if (err instanceof GitHubSsoError) {
    return new HttpError(
      403,
      "sso-required",
      err.ssoUrl ? { ssoUrl: err.ssoUrl } : undefined,
    );
  }
  if (err instanceof SourceRateLimited)
    return new HttpError(429, "rate-limited");
  if (err instanceof GitHubRequestError && err.status === 404) {
    return new NotFoundError("not-found");
  }
  const message =
    err instanceof GitHubRequestError && err.providerMessage
      ? { message: err.providerMessage }
      : undefined;
  if (
    err instanceof GitHubRequestError &&
    (err.status === 405 || err.status === 409)
  ) {
    return new ConflictError("not-mergeable", message);
  }
  if (err instanceof GitHubRequestError && err.status === 422) {
    return new HttpError(422, "refused", message);
  }
  return new UpstreamError("unreachable");
}

githubRouter.get("/github/pr/:owner/:repo/:number", async (req, res) => {
  const pr = parseOrThrow(targetSchema, req.params);
  try {
    res.status(200).json(await getPullRequest(pr.owner, pr.repo, pr.number));
  } catch (err) {
    throw toHttpError(err);
  }
});

githubRouter.post(
  "/github/pr/:owner/:repo/:number/review",
  async (req, res) => {
    const pr = parseOrThrow(targetSchema, req.params);
    const { event, text } = parseOrThrow(reviewSchema, req.body);
    try {
      await reviewPullRequest(pr.owner, pr.repo, pr.number, {
        event,
        ...(text !== "" ? { body: text } : {}),
      });
    } catch (err) {
      throw toHttpError(err);
    }
    pollNow("github");
    res.status(200).json({ ok: true });
  },
);

githubRouter.post("/github/pr/:owner/:repo/:number/merge", async (req, res) => {
  const pr = parseOrThrow(targetSchema, req.params);
  const { sha } = parseOrThrow(mergeSchema, req.body);
  try {
    await mergePullRequest(pr.owner, pr.repo, pr.number, sha);
  } catch (err) {
    throw toHttpError(err);
  }
  pollNow("github");
  res.status(200).json({ ok: true });
});

githubRouter.use(httpErrorHandler);
