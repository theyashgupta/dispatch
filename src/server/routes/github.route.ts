import { Router, type Response } from "express";
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
import type { PrReviewEvent } from "../../shared/types.js";

/**
 * Pull request detail, review and squash merge for the Pull Requests page.
 *
 * @remarks Every path segment is validated before any GitHub call. Errors answer an error kind and,
 * only for GitHub's refusals, GitHub's own message text; never the token or a raw provider body.
 */
export const githubRouter = Router();

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;
const REVIEW_EVENTS = new Set<string>([
  "APPROVE",
  "REQUEST_CHANGES",
  "COMMENT",
]);
const BODY_MAX = 20000;

interface PrTarget {
  owner: string;
  repo: string;
  number: number;
}

/** Validate the owner, repo and number segments, answering 400 when any is malformed. */
function target(
  params: Record<string, string>,
  res: Response,
): PrTarget | null {
  const { owner = "", repo = "", number = "" } = params;
  const valid = (name: string) => NAME.test(name) && !/^\.+$/.test(name);
  if (!valid(owner) || !valid(repo) || !/^[1-9][0-9]{0,9}$/.test(number)) {
    res.status(400).json({ error: "invalid pull request" });
    return null;
  }
  return { owner, repo, number: Number(number) };
}

/** Map a GitHub failure to its status and error kind. */
function sendGithubError(res: Response, err: unknown): void {
  if (err instanceof GithubNotConnected) {
    res.status(401).json({ error: "no-credential" });
  } else if (err instanceof GitHubAuthError) {
    res.status(401).json({ error: "rejected" });
  } else if (err instanceof GitHubSsoError) {
    res
      .status(403)
      .json(
        err.ssoUrl
          ? { error: "sso-required", ssoUrl: err.ssoUrl }
          : { error: "sso-required" },
      );
  } else if (err instanceof SourceRateLimited) {
    res.status(429).json({ error: "rate-limited" });
  } else if (err instanceof GitHubRequestError && err.status === 404) {
    res.status(404).json({ error: "not-found" });
  } else if (
    err instanceof GitHubRequestError &&
    (err.status === 405 || err.status === 409)
  ) {
    res.status(409).json({
      error: "not-mergeable",
      ...(err.providerMessage ? { message: err.providerMessage } : {}),
    });
  } else if (err instanceof GitHubRequestError && err.status === 422) {
    res.status(422).json({
      error: "refused",
      ...(err.providerMessage ? { message: err.providerMessage } : {}),
    });
  } else {
    res.status(502).json({ error: "unreachable" });
  }
}

githubRouter.get("/github/pr/:owner/:repo/:number", async (req, res) => {
  const pr = target(req.params, res);
  if (!pr) return;
  try {
    res.status(200).json(await getPullRequest(pr.owner, pr.repo, pr.number));
  } catch (err) {
    sendGithubError(res, err);
  }
});

githubRouter.post(
  "/github/pr/:owner/:repo/:number/review",
  async (req, res) => {
    const pr = target(req.params, res);
    if (!pr) return;
    const { event, body } = (req.body ?? {}) as {
      event?: unknown;
      body?: unknown;
    };
    const text = typeof body === "string" ? body.trim() : "";
    if (
      typeof event !== "string" ||
      !REVIEW_EVENTS.has(event) ||
      (body !== undefined && typeof body !== "string") ||
      text.length > BODY_MAX ||
      (event !== "APPROVE" && text === "")
    ) {
      res.status(400).json({ error: "invalid review" });
      return;
    }
    try {
      await reviewPullRequest(pr.owner, pr.repo, pr.number, {
        event: event as PrReviewEvent,
        ...(text !== "" ? { body: text } : {}),
      });
    } catch (err) {
      sendGithubError(res, err);
      return;
    }
    pollNow("github");
    res.status(200).json({ ok: true });
  },
);

githubRouter.post("/github/pr/:owner/:repo/:number/merge", async (req, res) => {
  const pr = target(req.params, res);
  if (!pr) return;
  const sha = (req.body as { sha?: unknown } | undefined)?.sha;
  if (typeof sha !== "string" || !SHA.test(sha)) {
    res.status(400).json({ error: "invalid sha" });
    return;
  }
  try {
    await mergePullRequest(pr.owner, pr.repo, pr.number, sha);
  } catch (err) {
    sendGithubError(res, err);
    return;
  }
  pollNow("github");
  res.status(200).json({ ok: true });
});
